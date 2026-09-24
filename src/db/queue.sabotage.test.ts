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
import type { QueueModule, World } from "./queue.rules";
import { failingQueueCases, makeWorld, QUEUE_CASES } from "./queue.rules";
import { seedWithTestUsers } from "./test-users";

/**
 * Sabotage matrix for the approval (#20): a broken rule leaves a working
 * queue with a wrong number. One control rewrite must come back uncaught.
 */

const SOURCE_PATH = join(import.meta.dirname, "queue.ts");
const MUTANT_DIR = join(import.meta.dirname, "..", "..", ".sabotage-queue");

/** Assembled from halves so Biome does not read them as unmarked templates. */
const NOTE = `$${"{note}"}`;
const WRITTEN = `$${"{written}"}`;

/** `\n${marker}`, assembled likewise. */
const NEWLINE_MARKER = `${"\\n"}$${"{marker}"}`;

type Mutation = {
  name: string;
  edits: { find: string; replace: string }[];
};

const MUTATIONS: readonly Mutation[] = [
  {
    name: "the history stops at the entry's own day (D34)",
    edits: [
      {
        find: "        lte(activityLogs.occurredOn, historyTo),",
        replace: "        lte(activityLogs.occurredOn, log.occurredOn),",
      },
    ],
  },
  {
    name: "the far end of the window is the entry's own day (D34)",
    edits: [
      {
        find: "  const historyTo = historyWindowEnd(\n    log.occurredOn,\n    found.activity,\n    found.category,\n  );",
        replace: "  const historyTo = log.occurredOn;",
      },
    ],
  },
  {
    name: "the calculation reads today instead of the day it happened",
    edits: [
      {
        find: '  isEarlier,\n  returnBonusWindowStart,\n} from "../engine/calculate";',
        replace:
          '  isEarlier,\n  returnBonusWindowStart,\n  saoPauloDay,\n} from "../engine/calculate";',
      },
      {
        find: "    occurredOn: log.occurredOn,\n    durationMinutes: log.durationMinutes,",
        replace:
          '    occurredOn: saoPauloDay(new Date("2026-09-13T15:00:00.000Z")),\n    durationMinutes: log.durationMinutes,',
      },
    ],
  },
  {
    name: "the ledger row is dated the day of the approval",
    edits: [
      {
        find: "        occurredOn: log.occurredOn,\n        activityLogId: logId,",
        replace:
          '        occurredOn: "2026-09-13",\n        activityLogId: logId,',
      },
    ],
  },
  {
    name: "the history window is as short as the entry's own day",
    edits: [
      {
        find: "  const historyFrom = historyWindowStart(\n    log.occurredOn,\n    found.activity,\n    found.category,\n  );",
        replace: "  const historyFrom = log.occurredOn;",
      },
    ],
  },

  {
    name: "pending and rejected entries fill the bucket too",
    edits: [
      {
        find: '        eq(activityLogs.status, "approved"),\n',
        replace: "",
      },
    ],
  },
  {
    name: "a rejection is written as an approval",
    edits: [
      {
        find: '        status: "rejected",\n        note: rejectionNote(log.note, reason),',
        replace:
          '        status: "approved",\n        note: rejectionNote(log.note, reason),',
      },
    ],
  },
  {
    name: "the refusal's reason writes over what the boy said",
    edits: [
      {
        find: `  return note === null || note.trim() === "" ? written : \`${NOTE}\\n${WRITTEN}\`;`,
        replace: "  return written;",
      },
    ],
  },
  {
    name: "a refusal with no reason wipes the note",
    edits: [
      {
        find: '  if (reason === null || reason.trim() === "") {\n    return note;\n  }',
        replace:
          '  if (reason === null || reason.trim() === "") {\n    return null;\n  }',
      },
    ],
  },
  {
    name: "the reason is read back from the first marker, not the last (#72)",
    edits: [
      {
        find: `  const appended = note.lastIndexOf(\`${NEWLINE_MARKER}\`);`,
        replace: `  const appended = note.indexOf(\`${NEWLINE_MARKER}\`);`,
      },
    ],
  },
  {
    name: "a reason that opens the note is not read back at all (#72)",
    edits: [
      {
        find: "    appended === -1 ? (note.startsWith(marker) ? 0 : -1) : appended + 1;",
        replace: "    appended === -1 ? -1 : appended + 1;",
      },
    ],
  },

  {
    name: "the frozen value is zero",
    edits: [
      {
        find: "        computedHours: calculation.hours,",
        replace: "        computedHours: 0,",
      },
    ],
  },
  {
    name: "the ledger row carries a different number from the entry",
    edits: [
      {
        find: "        hours: calculation.hours,",
        replace: "        hours: calculation.hours + 1,",
      },
    ],
  },
  {
    name: "the credit lands on whoever approved it",
    edits: [
      {
        find: '        userId: log.userId,\n        kind: "earn",',
        replace: '        userId: reviewerId,\n        kind: "earn",',
      },
    ],
  },
  {
    name: "a value of zero is written to the ledger anyway",
    edits: [
      {
        find: "    if (calculation.hours <= 0) {",
        replace: "    if (calculation.hours < 0) {",
      },
    ],
  },
  {
    name: "nothing is ever credited",
    edits: [
      {
        find: "    if (calculation.hours <= 0) {",
        replace: "    if (true) {",
      },
    ],
  },

  {
    name: "the corrected duration is ignored",
    edits: [
      {
        find: "      durationMinutes: edits.durationMinutes ?? log.durationMinutes,",
        replace: "      durationMinutes: log.durationMinutes,",
      },
    ],
  },
  {
    name: "the corrected activity is ignored",
    edits: [
      {
        find: "      activityId: edits.activityId ?? log.activityId,",
        replace: "      activityId: log.activityId,",
      },
    ],
  },
  {
    name: "the corrected note is ignored",
    edits: [
      {
        find: "        note: edits.note === undefined ? log.note : edits.note,",
        replace: "        note: log.note,",
      },
    ],
  },
  {
    name: "the correction is applied after the value is computed",
    edits: [
      {
        find: "    const calculation = calculationFor(tx, edited);",
        replace: "    const calculation = calculationFor(tx, log);",
      },
    ],
  },
  {
    name: "a duration of zero reaches the database",
    edits: [
      {
        find: "  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {",
        replace: "  if (false) {",
      },
    ],
  },

  {
    name: "an entry can be reviewed twice",
    edits: [
      {
        find: '  if (log.status !== "pending") {',
        replace: "  if (false) {",
      },
    ],
  },

  {
    name: "an entry can be approved while an earlier one is still waiting",
    edits: [
      {
        find: "    if (blocking !== undefined) {",
        replace: "    if (false) {",
      },
    ],
  },
  {
    name: "the order only matters inside one day",
    edits: [
      {
        find: '        eq(activityLogs.status, "pending"),\n        gte(activityLogs.occurredOn, historyFrom),',
        replace:
          '        eq(activityLogs.status, "pending"),\n        gte(activityLogs.occurredOn, log.occurredOn),',
      },
    ],
  },
  {
    name: "anything still waiting blocks, including the entry itself",
    edits: [
      {
        find: "    .find((candidate) =>\n      isEarlier(candidate, log.occurredOn, {\n        createdAt: log.createdAt,\n        id: log.id,\n      }),\n    );",
        replace: "    .find(() => true);",
      },
    ],
  },
  {
    name: "the queue does not say which entry stands in the way",
    edits: [
      {
        find: "    blockedBy: pendingBefore(connection.db, row) ?? null,",
        replace: "    blockedBy: null,",
      },
    ],
  },

  {
    name: "the activity an entry is moved to is not checked at all",
    edits: [
      {
        find: "    requireEditableActivity(tx, edited, edited.activityId);\n",
        replace: "",
      },
    ],
  },
  {
    name: "a deactivated activity can be chosen",
    edits: [
      {
        find: "  if (!target.active || !target.categoryActive) {",
        replace: "  if (false) {",
      },
    ],
  },
  {
    name: "a timed session can be approved as something with no duration",
    edits: [
      {
        find: '  if (log.durationMinutes !== null && target.calcMode !== "duration") {',
        replace: "  if (false) {",
      },
    ],
  },
  {
    name: "a duration the column would refuse reaches it",
    edits: [
      {
        find: " || minutes > MAX_MINUTES",
        replace: "",
      },
    ],
  },

  {
    name: "the queue shows entries that were already decided",
    edits: [
      {
        find: '    .where(eq(activityLogs.status, "pending"))',
        replace: "    .where(eq(activityLogs.userId, activityLogs.userId))",
      },
    ],
  },
  {
    name: "the preview is not the calculation the approval will make",
    edits: [
      {
        find: "    ...priceOrExplain(connection.db, row),",
        replace:
          "    preview: { hours: 1, lines: [] },\n    unpriceable: null,",
      },
    ],
  },
  {
    name: "the debut is priced as a return (D47)",
    edits: [
      {
        find: "    categoryFirstDay: categoryFirstDay(db, log.userId, found.category.id),",
        replace: '    categoryFirstDay: "2000-01-01",',
      },
    ],
  },
  {
    name: "a pending debut blocks nothing (D32, D47)",
    edits: [
      {
        find: "  return blocking === undefined\n    ? pendingDebutBefore(",
        replace:
          "  return blocking === undefined\n    ? undefined && pendingDebutBefore(",
      },
    ],
  },
];

/** The control: a `where` bound `isEarlier` already enforces, removed. */
const CONTROL: Mutation = {
  name: "the query stops bounding the history at the entry's own day",
  edits: [
    {
      find: "        lte(activityLogs.occurredOn, log.occurredOn),\n",
      replace: "",
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
  const root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-queue-mutant-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);

  const connection: Connection = openDatabase(databasePath);
  seedWithTestUsers(connection);
  roots.push(root);

  return makeWorld(connection);
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
): Promise<QueueModule> {
  const name = `mutant-${index}.ts`;
  writeFileSync(join(MUTANT_DIR, name), rehome(mutated));

  return (await import(
    /* @vite-ignore */ `../../.sabotage-queue/${name}?v=${Date.now()}-${index}`
  )) as QueueModule;
}

/** Applies one mutation, refusing to pretend when a needle has moved. */
function mutate(mutation: Mutation): string {
  let mutated = source;

  for (const edit of mutation.edits) {
    expect(
      mutated.includes(edit.find),
      `the mutation target is no longer in queue.ts:\n${edit.find}`,
    ).toBe(true);

    mutated = mutated.replace(edit.find, edit.replace);
  }

  expect(mutated).not.toBe(source);

  return mutated;
}

describe("an approval broken on purpose", () => {
  it.each(MUTATIONS.map((mutation, index) => ({ ...mutation, index })))(
    "is caught when $name",
    async (mutation) => {
      const failures = failingQueueCases(
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

  it("covers every rule of #20 with at least one mutation", {
    timeout: 120_000,
  }, async () => {
    const caught = new Set<string>();

    for (const [index, mutation] of MUTATIONS.entries()) {
      for (const failure of failingQueueCases(
        await loadMutant(MUTATIONS.length + index, mutate(mutation)),
        freshWorld,
      )) {
        caught.add(failure.rule);
      }
    }

    expect([...caught].sort()).toEqual(
      [...new Set(QUEUE_CASES.map((queueCase) => queueCase.rule))].sort(),
    );
  });
});

describe("the control: the matrix can still say no", () => {
  it("does not catch a rewrite that means the same thing", {
    timeout: 30_000,
  }, async () => {
    const failures = failingQueueCases(
      await loadMutant(2 * MUTATIONS.length, mutate(CONTROL)),
      freshWorld,
    );

    expect(
      failures.map((failure) => failure.name),
      "the control was caught, so the matrix is failing mutants for a " +
        "reason other than the one it claims — a load error, or a table " +
        "comparing everything against undefined",
    ).toEqual([]);
  });

  it("catches the neighbouring clause that is a rule", {
    timeout: 30_000,
  }, async () => {
    // Edited like the control, but D19: the matrix must tell them apart.
    const failures = failingQueueCases(
      await loadMutant(
        2 * MUTATIONS.length + 1,
        mutate({
          name: "the approved-only filter is dropped from the same where",
          edits: [
            {
              find: '        eq(activityLogs.status, "approved"),\n',
              replace: "",
            },
          ],
        }),
      ),
      freshWorld,
    );

    expect(failures.length).toBeGreaterThan(0);
  });
});
