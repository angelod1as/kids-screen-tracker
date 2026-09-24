import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Connection } from "./client";
import { openDatabase } from "./client";
import { migrateDatabase } from "./migrate";
import { seedWithTestUsers } from "./test-users";
import type { TimersModule, World } from "./timers.rules";
import { failingTimersCases, makeWorld, TIMERS_CASES } from "./timers.rules";

/**
 * The sabotage matrix for the settlement (#18, #19).
 *
 * The one this project was told it was missing. Round 1 mutated
 * `src/db/timers.ts` nine ways and three of the nine survived the entire suite:
 * the rounding of the banked seconds, the instant a stop is dated at, and the
 * re-read inside `readTimer`'s transaction — the only thing between two tabs
 * and two records for one session, deletable with 799 tests still green.
 *
 * All three are mutations here, and the third is the reason `timers.rules.ts`
 * has a connection that lets another tab in between the two reads: a rule that
 * only holds under concurrency needs a case that produces some.
 *
 * **The control has to come back uncaught**, as in the two matrices before
 * this one, so that a loader that quietly failed cannot report every rule
 * protected.
 */

const SOURCE_PATH = join(import.meta.dirname, "timers.ts");
const MUTANT_DIR = join(import.meta.dirname, "..", "..", ".sabotage-timers");

type Mutation = {
  name: string;
  /** One or more exact rewrites, all of which have to apply. */
  edits: { find: string; replace: string }[];
};

const MUTATIONS: readonly Mutation[] = [
  // --- o registro sai dos carimbos ------------------------------------------
  {
    name: "the record is dated at the confirmation instead of at the pause",
    edits: [
      {
        find: '    const endedAt =\n      reconciliation.state.status === "paused"\n        ? (reconciliation.state.pausedAt ?? now)\n        : now;',
        replace: "    const endedAt = now;",
      },
    ],
  },
  {
    name: "the record's day comes from the read instead of from the start",
    edits: [
      {
        find: "      occurredOn: saoPauloDay(entry.startedAt),",
        replace: "      occurredOn: saoPauloDay(entry.endedAt),",
      },
    ],
  },
  {
    name: "the duration is the wall clock instead of the active seconds",
    edits: [
      {
        find: "  const minutes = durationMinutes(seconds);",
        replace:
          "  const minutes = durationMinutes(\n    (entry.endedAt.getTime() - entry.startedAt.getTime()) / 1000,\n  );",
      },
    ],
  },
  {
    name: "the banked seconds are rounded up on every pause",
    edits: [
      {
        find: '      accumulatedSeconds: Math.floor(reconciliation.activeSeconds),\n      status: "paused",',
        replace:
          '      accumulatedSeconds: Math.round(reconciliation.activeSeconds),\n      status: "paused",',
      },
    ],
  },
  {
    name: "the record is born approved instead of pending",
    edits: [
      {
        find: '      status: "pending",\n      source: "timer",',
        replace: '      status: "approved",\n      source: "timer",',
      },
    ],
  },
  {
    name: "the note the boy wrote is dropped",
    edits: [
      {
        find: "      note: entry.note,",
        replace: "      note: null,",
      },
    ],
  },

  // --- uma sessão por menino, e só o que dá para cronometrar ----------------
  {
    name: "a second session can be opened while one is running",
    edits: [
      {
        find: "    if (open !== undefined) {",
        replace: "    if (false) {",
      },
    ],
  },
  {
    name: "anything at all can be timed",
    edits: [
      {
        find: '    if (\n      activity === undefined ||\n      !activity.active ||\n      !activity.categoryActive ||\n      activity.calcMode !== "duration"\n    ) {',
        replace: "    if (activity === undefined) {",
      },
    ],
  },
  {
    name: "an activity whose category is switched off can still be timed",
    edits: [
      {
        find: "      !activity.categoryActive ||\n",
        replace: "",
      },
    ],
  },

  // --- a liquidação acontece uma vez ----------------------------------------
  {
    name: "the settlement is written from the row read outside the transaction",
    edits: [
      {
        find: "  return writeTransaction(connection, (tx) => {\n    const fresh = selectOpenTimer(tx, userId);",
        replace:
          "  return writeTransaction(connection, (tx) => {\n    const fresh = row;",
      },
    ],
  },
  {
    name: "the re-read is made but its answer is thrown away",
    edits: [
      {
        find: "    const settled = reconcileTimer(\n      stateOf(fresh),\n      fresh.maxSessionMinutes,\n      now,\n    );",
        replace: "    const settled = reconciliation;",
      },
    ],
  },
  {
    name: "a session another tab already settled is settled again",
    edits: [
      {
        find: "    if (fresh === undefined) {",
        replace: "    if (false) {",
      },
    ],
  },
  {
    name: "a mutation acts on a session that has already ended",
    edits: [
      {
        find: "    if (reconciliation.settledAt !== null) {",
        replace: "    if (false) {",
      },
    ],
  },

  // --- D44: a sessão mínima -------------------------------------------------
  {
    name: "a stop files a session under the floor",
    edits: [
      {
        find: "    if (!reachesMinimum(reconciliation.activeSeconds, row.minSessionMinutes)) {",
        replace:
          "    if (durationMinutes(reconciliation.activeSeconds) === 0) {",
      },
    ],
  },
  {
    name: "the turn of the day files a session under the floor",
    edits: [
      {
        find: "\n  if (!reachesMinimum(reconciliation.activeSeconds, row.minSessionMinutes)) {",
        replace:
          "\n  if (durationMinutes(reconciliation.activeSeconds) === 0) {",
      },
    ],
  },
  {
    name: "the floor is read live instead of from the session's stamp",
    edits: [
      {
        find: "        minSessionMinutes: timers.minSessionMinutes,",
        replace: "        minSessionMinutes: activities.minSessionMinutes,",
      },
    ],
  },

  // --- o limite, o abandono e a virada do dia -------------------------------
  {
    name: "an abandoned session leaves a record after all",
    edits: [
      {
        find: "  if (!reconciliation.autoStopped) {",
        replace: "  if (false) {",
      },
    ],
  },
  {
    name: "a session that ended by itself leaves no record",
    edits: [
      {
        find: "  if (!reconciliation.autoStopped) {",
        replace: "  if (true) {",
      },
    ],
  },
  {
    name: "the record of an automatic stop is not marked as one",
    edits: [
      {
        find: "    autoStopped: true,\n  });",
        replace: "    autoStopped: false,\n  });",
      },
    ],
  },
  {
    name: "the turn of the day is announced as the limit",
    edits: [
      {
        find: '    kind: reconciliation.reason === "dayEnd" ? "dayEnded" : "autoStopped",',
        replace: '    kind: "autoStopped",',
      },
    ],
  },
  {
    name: "the settled row keeps the state it had",
    edits: [
      {
        find: "      status: reconciliation.state.status,\n      pausedAt: reconciliation.state.pausedAt,",
        replace: "      status: row.status,\n      pausedAt: row.pausedAt,",
      },
    ],
  },
];

/**
 * The rewrite that has to come back uncaught.
 *
 * `orderBy(desc(timers.id))` picks which of two open timers is read, and there
 * is never more than one: the transaction in `startTimer` is what makes that
 * true, and this only says which first `limit 1` means. Removing it changes the
 * plan and not the answer — same file, same loader, same table, and the answer
 * is no.
 */
const CONTROL: Mutation = {
  name: "the open timer is read without saying which one comes first",
  edits: [
    {
      find: "      .orderBy(desc(timers.id))\n",
      replace: "",
    },
    {
      find: 'import { and, desc, eq, inArray } from "drizzle-orm";',
      replace: 'import { and, eq, inArray } from "drizzle-orm";',
    },
  ],
};

let source: string;
const roots: string[] = [];

beforeAll(() => {
  source = readFileSync(SOURCE_PATH, "utf8");
  mkdirSync(MUTANT_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(MUTANT_DIR, { recursive: true, force: true });
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A migrated, seeded database of its own for one case. */
function freshWorld(): World {
  const root = mkdtempSync(
    join(tmpdir(), "kids-screen-tracker-timers-mutant-"),
  );
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);

  const connection: Connection = openDatabase(databasePath);
  seedWithTestUsers(connection);
  roots.push(root);

  return makeWorld(connection, databasePath);
}

function rehome(mutated: string): string {
  return mutated.replace(
    /from "(\.[^"]*)"/g,
    (_whole, specifier: string) =>
      `from "${relative(MUTANT_DIR, resolve(import.meta.dirname, specifier))}"`,
  );
}

async function loadMutant(
  index: number,
  mutated: string,
): Promise<TimersModule> {
  const name = `mutant-${index}.ts`;
  writeFileSync(join(MUTANT_DIR, name), rehome(mutated));

  return (await import(
    /* @vite-ignore */ `../../.sabotage-timers/${name}?v=${Date.now()}-${index}`
  )) as TimersModule;
}

/** Applies one mutation, refusing to pretend when a needle has moved. */
function mutate(mutation: Mutation): string {
  let mutated = source;

  for (const edit of mutation.edits) {
    expect(
      mutated.includes(edit.find),
      `the mutation target is no longer in timers.ts:\n${edit.find}`,
    ).toBe(true);

    mutated = mutated.replace(edit.find, edit.replace);
  }

  expect(mutated).not.toBe(source);

  return mutated;
}

describe("a settlement broken on purpose", () => {
  it.each(MUTATIONS.map((mutation, index) => ({ ...mutation, index })))(
    "is caught when $name",
    async (mutation) => {
      const failures = failingTimersCases(
        await loadMutant(mutation.index, mutate(mutation)),
        freshWorld,
      );

      expect(
        failures.length,
        "this mutation broke a rule and no case noticed",
      ).toBeGreaterThan(0);
    },
    30_000,
  );

  it("covers every rule of #18 and #19 with at least one mutation", {
    timeout: 120_000,
  }, async () => {
    const caught = new Set<string>();

    for (const [index, mutation] of MUTATIONS.entries()) {
      for (const failure of failingTimersCases(
        await loadMutant(MUTATIONS.length + index, mutate(mutation)),
        freshWorld,
      )) {
        caught.add(failure.rule);
      }
    }

    expect([...caught].sort()).toEqual(
      [...new Set(TIMERS_CASES.map((timersCase) => timersCase.rule))].sort(),
    );
  });
});

describe("the control: the matrix can still say no", () => {
  it("does not catch a rewrite that means the same thing", async () => {
    const failures = failingTimersCases(
      await loadMutant(2 * MUTATIONS.length, mutate(CONTROL)),
      freshWorld,
    );

    expect(
      failures.map((timersCase) => timersCase.name),
      "the control was caught, so the matrix is failing mutants for a reason other than the one it claims — a load error, or a table comparing everything against undefined",
    ).toEqual([]);
  }, 30_000);
});
