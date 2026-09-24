import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ActivityModule, ActivityWorld } from "./activities.rules";
import {
  ACTIVITY_CASES,
  failingActivityCases,
  makeActivityWorld,
} from "./activities.rules";
import type { Connection } from "./client";
import { openDatabase } from "./client";
import { migrateDatabase } from "./migrate";
import { seedWithTestUsers } from "./test-users";

/**
 * The sabotage matrix for the configuration of the activities (#27).
 *
 * Same argument as `config.sabotage.test.ts`, and one addition specific to this
 * half. The rule that matters most here is D11's — the value is explicit and is
 * never taken from the category — and it is the hardest rule in this phase to
 * test by ordinary means, because breaking it produces *correct-looking
 * numbers*: most activities are priced at their category's rate anyway, so an
 * activity that silently fell back to `base_rate` would agree with the seed
 * everywhere it was checked. The cases that catch it are the ones about an
 * activity priced away from its category and about a category that declares no
 * rate at all.
 *
 * **The control has to come back uncaught**, for the reason the other matrix
 * gives: without it, a matrix whose loader quietly failed would report every
 * rule protected.
 */

const DB_DIR = import.meta.dirname;
const MUTANT_DIR = join(DB_DIR, "..", "..", ".sabotage-activities");

/** The two files a mutant is made of: the CRUD and what an adult may type. */
const FILES = ["activities.ts", "input.ts", "pending.ts"] as const;

type File = (typeof FILES)[number];

type Edit = { find: string; replace: string };

type Mutation = {
  name: string;
  file: File;
  find: string;
  replace: string;
  /**
   * A second edit in the same file, applied after the first.
   *
   * One mutation needs it, and it is the one D15 is about. Every other rule
   * here is broken by *removing* something, so a single edit reaches it — but
   * "editing recalculates nothing already credited" is a rule about absence,
   * and nothing that can be deleted from this module introduces a
   * recalculation. Breaking it means adding one, and adding one means adding
   * the import it needs as well. Without this the coverage case below reported
   * that rule as having no mutation at all, which is exactly the report it
   * exists to produce.
   */
  andThen?: Edit;
};

const MUTATIONS: readonly Mutation[] = [
  // --- criar, editar, desativar --------------------------------------------
  {
    name: "an activity is born switched off",
    file: "activities.ts",
    find: "        sortOrder: checked.sortOrder,\n        active: true,",
    replace: "        sortOrder: checked.sortOrder,\n        active: false,",
  },
  {
    name: "switching one off writes false whichever way it is asked",
    file: "activities.ts",
    find: "    tx.update(activities)\n      .set({ active })",
    replace: "    tx.update(activities)\n      .set({ active: false })",
  },
  {
    name: "an activity that does not exist is not noticed",
    file: "activities.ts",
    find: "  if (found === undefined) {\n    throw new Error(`there is no activity ",
    replace: "  if (false) {\n    throw new Error(`there is no activity ",
  },
  {
    name: "the name is stored with the spaces around it",
    file: "activities.ts",
    find: "  const name = input.name.trim();",
    replace: "  const name = input.name;",
  },
  {
    name: "an activity with no name at all is accepted",
    file: "activities.ts",
    find: '  if (name === "") {',
    replace: "  if (false) {",
  },
  {
    name: "a way of counting nobody implemented is accepted",
    file: "activities.ts",
    find: "  if (!CALC_MODES.includes(input.calcMode)) {",
    replace: "  if (false) {",
  },
  {
    name: "an edit writes the name and leaves every number as it was",
    file: "activities.ts",
    // `tx.update(...).set({` in front, because the identical field list is
    // also the insert's `.values({`.
    find: "    tx.update(activities)\n      .set({\n        categoryId: checked.categoryId,\n        name: checked.name,\n        calcMode: checked.calcMode,\n        value: checked.value,\n        maxSessionMinutes: checked.maxSessionMinutes,\n        minSessionMinutes: checked.minSessionMinutes,\n        qualityGraded: checked.qualityGraded,\n        repeatCooldownDays: checked.repeatCooldownDays,\n        sortOrder: checked.sortOrder,",
    replace:
      "    tx.update(activities)\n      .set({\n        name: checked.name,",
  },
  {
    name: "an edit cannot move an activity to another category",
    file: "activities.ts",
    find: "    tx.update(activities)\n      .set({\n        categoryId: checked.categoryId,\n        name: checked.name,\n        calcMode: checked.calcMode,",
    replace:
      "    tx.update(activities)\n      .set({\n        name: checked.name,\n        calcMode: checked.calcMode,",
  },
  {
    name: "the grade flag is dropped on the way in",
    file: "activities.ts",
    find: "    qualityGraded: input.qualityGraded,",
    replace: "    qualityGraded: false,",
  },

  // --- D11: o value é explícito, e é quem manda ----------------------------
  {
    name: "a non-free activity may be stored with no value at all",
    file: "activities.ts",
    find: "  } else if (input.value === null) {",
    replace: "  } else if (false) {",
  },
  {
    name: "a free activity may carry a value it will never use",
    file: "activities.ts",
    find: "    if (input.value !== null) {",
    replace: "    if (false) {",
  },
  {
    name: "the value is dropped between the check and the write",
    file: "activities.ts",
    find: '    value:\n      input.value === null\n        ? null\n        : requireNonNegativeHours(input.value, "an activity value"),',
    replace: "    value: input.value,",
  },
  {
    name: "the value the form sent is not the value that is stored",
    file: "activities.ts",
    find: "        calcMode: checked.calcMode,\n        value: checked.value,\n        maxSessionMinutes: checked.maxSessionMinutes,\n        minSessionMinutes: checked.minSessionMinutes,\n        qualityGraded: checked.qualityGraded,\n        repeatCooldownDays: checked.repeatCooldownDays,\n        sortOrder: checked.sortOrder,\n        active: true,",
    replace:
      "        calcMode: checked.calcMode,\n        value: checked.value === null ? null : 2,\n        maxSessionMinutes: checked.maxSessionMinutes,\n        minSessionMinutes: checked.minSessionMinutes,\n        qualityGraded: checked.qualityGraded,\n        repeatCooldownDays: checked.repeatCooldownDays,\n        sortOrder: checked.sortOrder,\n        active: true,",
  },

  // --- D16: o limite só existe onde há sessão ------------------------------
  {
    name: "a session limit is kept on a mode that has no session",
    file: "activities.ts",
    find: '    input.calcMode === "duration" && input.maxSessionMinutes !== null',
    replace: "    input.maxSessionMinutes !== null",
  },
  {
    name: "a duration activity loses the limit it was given",
    file: "activities.ts",
    find: '      ? requireCount(input.maxSessionMinutes, "a session limit", { min: 1 })\n      : null;',
    replace: "      ? null\n      : null;",
  },
  {
    name: "a session limit of zero minutes reaches the column",
    file: "activities.ts",
    find: '      ? requireCount(input.maxSessionMinutes, "a session limit", { min: 1 })',
    replace: '      ? requireCount(input.maxSessionMinutes, "a session limit")',
  },

  // --- D44: a sessão mínima -------------------------------------------------
  {
    name: "a duration activity loses the floor it was given",
    file: "activities.ts",
    find: '      ? requireCount(input.minSessionMinutes, "a minimum session", { min: 1 })\n      : DEFAULT_MIN_SESSION_MINUTES;',
    replace:
      "      ? DEFAULT_MIN_SESSION_MINUTES\n      : DEFAULT_MIN_SESSION_MINUTES;",
  },
  {
    name: "a floor of zero minutes reaches the column",
    file: "activities.ts",
    find: '      ? requireCount(input.minSessionMinutes, "a minimum session", { min: 1 })',
    replace:
      '      ? requireCount(input.minSessionMinutes, "a minimum session")',
  },
  {
    name: "a floor above the session limit is stored",
    file: "activities.ts",
    find: "  if (maxSessionMinutes !== null && minSessionMinutes > maxSessionMinutes) {",
    replace: "  if (false) {",
  },

  // --- D33: a guarda de categoria inativa vale no endpoint -----------------
  {
    name: "an activity can be created under a switched-off category",
    file: "activities.ts",
    find: "  if (!found.active) {",
    replace: "  if (false) {",
  },
  {
    name: "a category that does not exist is not noticed either",
    file: "activities.ts",
    find: "  if (found === undefined) {\n    throw new Error(`there is no category ",
    replace: "  if (false) {\n    throw new Error(`there is no category ",
  },
  {
    name: "the create does not check the category at all",
    file: "activities.ts",
    find: "    requireLiveCategory(tx, checked.categoryId);\n\n    return tx\n      .insert(activities)",
    replace: "    return tx\n      .insert(activities)",
  },
  {
    name: "an activity can be moved into a switched-off category",
    file: "activities.ts",
    find: "    const found = requireActivityRow(tx, activityId);\n    requireLiveCategory(tx, checked.categoryId);",
    replace: "    requireActivityRow(tx, activityId);",
  },
  {
    name: "an activity can be switched back on under a dead category",
    file: "activities.ts",
    find: "    if (active) {\n      requireLiveCategory(tx, found.categoryId);\n    }",
    replace:
      "    if (false) {\n      requireLiveCategory(tx, found.categoryId);\n    }",
  },
  {
    name: "switching one off needs its category to be on, which strands it",
    file: "activities.ts",
    find: "    if (active) {\n      requireLiveCategory(tx, found.categoryId);\n    }",
    replace: "    requireLiveCategory(tx, found.categoryId);",
  },

  // --- os contadores -------------------------------------------------------
  {
    name: "a cooldown is not checked at all",
    file: "activities.ts",
    find: '    repeatCooldownDays: requireCount(\n      input.repeatCooldownDays,\n      "a repeat cooldown",\n    ),',
    replace: "    repeatCooldownDays: input.repeatCooldownDays,",
  },
  {
    name: "a sort order is not checked at all",
    file: "activities.ts",
    find: '    sortOrder: requireCount(input.sortOrder, "a sort order"),',
    replace: "    sortOrder: input.sortOrder,",
  },
  {
    name: "a counter may be a fraction",
    file: "input.ts",
    find: "  if (!Number.isInteger(count) || count < min || count > MAX_COUNT) {",
    replace: "  if (count < min || count > MAX_COUNT) {",
  },
  {
    name: "a counter may be below its floor",
    file: "input.ts",
    find: "  if (!Number.isInteger(count) || count < min || count > MAX_COUNT) {",
    replace: "  if (!Number.isInteger(count) || count > MAX_COUNT) {",
  },
  {
    name: "a value that is not a number at all is accepted",
    file: "input.ts",
    find: "  const rounded = Math.round(hours * 100) / 100;\n\n  if (!Number.isFinite(rounded) || rounded < 0 || rounded > MAX_HOURS) {",
    replace:
      "  const rounded = Math.round(hours * 100) / 100;\n\n  if (rounded < 0 || rounded > MAX_HOURS) {",
  },
  {
    name: "a negative value is accepted",
    file: "input.ts",
    find: "  const rounded = Math.round(hours * 100) / 100;\n\n  if (!Number.isFinite(rounded) || rounded < 0 || rounded > MAX_HOURS) {",
    replace:
      "  const rounded = Math.round(hours * 100) / 100;\n\n  if (!Number.isFinite(rounded) || rounded > MAX_HOURS) {",
  },
  {
    name: "a typed value keeps every decimal it was given",
    file: "input.ts",
    find: "export function requireNonNegativeHours(hours: number, what: string): number {\n  requireNumber(hours, what);\n\n  const rounded = Math.round(hours * 100) / 100;",
    replace:
      "export function requireNonNegativeHours(hours: number, what: string): number {\n  requireNumber(hours, what);\n\n  const rounded = hours;",
  },
  {
    name: "text of any length reaches the column",
    file: "input.ts",
    find: "  if (text !== null && text.length > MAX_TEXT_LENGTH) {",
    replace: "  if (false) {",
  },

  // --- a lista que a tela desenha ------------------------------------------
  {
    name: "the switched-off ones are not sorted to the end",
    file: "activities.ts",
    find: "      desc(activities.active),\n      asc(activities.sortOrder),",
    replace: "      asc(activities.sortOrder),",
  },
  {
    name: "the list ignores the order an adult set",
    file: "activities.ts",
    find: "      desc(activities.active),\n      asc(activities.sortOrder),\n      asc(activities.id),",
    replace: "      desc(activities.active),\n      asc(activities.id),",
  },
  {
    name: "the list is every activity, not this category's",
    file: "activities.ts",
    find: "    .where(eq(activities.categoryId, categoryId))\n    .orderBy(",
    replace: "    .orderBy(",
  },

  // --- D37: nada muda de preço debaixo de uma entrada que já espera ---------
  {
    name: "a waiting entry does not stop a repricing edit",
    file: "activities.ts",
    find:
      "    if (repriced) {\n      refuseWhileWaiting(tx, [activityId], `$" +
      "{found.name}`);\n    }",
    replace:
      "    if (false) {\n      refuseWhileWaiting(tx, [activityId], `$" +
      "{found.name}`);\n    }",
  },
  {
    name: "the value is not counted as a repricing change",
    file: "activities.ts",
    find: "      checked.value !== found.value ||\n",
    replace: "",
  },
  {
    name: "the grade flag is not counted as a repricing change",
    file: "activities.ts",
    find: "      checked.qualityGraded !== found.qualityGraded ||\n",
    replace: "",
  },
  {
    name: "the cooldown is not counted as a repricing change",
    file: "activities.ts",
    find: "      checked.repeatCooldownDays !== found.repeatCooldownDays ||\n",
    replace: "",
  },
  {
    name: "switching an activity off strands the entry waiting under it",
    file: "activities.ts",
    find:
      "    if (!active) {\n      refuseWhileWaiting(tx, [activityId], `$" +
      "{found.name}`);\n    }",
    replace:
      "    if (false) {\n      refuseWhileWaiting(tx, [activityId], `$" +
      "{found.name}`);\n    }",
  },
  {
    name: "the refusal never fires, whatever is waiting",
    file: "pending.ts",
    find: "  if (waiting === undefined) return;",
    replace: "  return;",
  },
  {
    name: "a refused or approved entry counts as one still waiting",
    file: "pending.ts",
    find: '        eq(activityLogs.status, "pending"),\n',
    replace: "",
  },
  {
    name: "an open stopwatch session does not stop a repricing edit",
    file: "pending.ts",
    find: '        inArray(timers.status, ["running", "paused"]),\n',
    replace: '        inArray(timers.status, ["stopped"]),\n',
  },
  {
    name: "only a filed entry counts, never a session still on the clock",
    file: "pending.ts",
    find: '  if (queued !== undefined) {\n    return { ...queued, kind: "queued" };\n  }',
    replace:
      '  return queued === undefined ? undefined : { ...queued, kind: "queued" };',
  },
  {
    name: "a paused session is treated as finished",
    file: "pending.ts",
    find: '        inArray(timers.status, ["running", "paused"]),\n',
    replace: '        inArray(timers.status, ["running"]),\n',
  },

  // --- D15: mudar a taxa não reescreve o passado ---------------------------
  {
    name: "an edit recalculates what it already paid",
    file: "activities.ts",
    // The rule this whole phase rests on, broken the only way it can be: by
    // adding the recalculation that D15 forbids. `config.test.ts` and
    // `activities.test.ts` both scan this module's source for the two tables it
    // must never name; this is the same rule seen from the behavioural side.
    find: 'import { asc, desc, eq } from "drizzle-orm";',
    replace: 'import { asc, desc, eq, sql } from "drizzle-orm";',
    andThen: {
      // The last field of the `.set({...})` in front: `setActivityActive` ends
      // with the same three lines.
      find: "        sortOrder: checked.sortOrder,\n      })\n      .where(eq(activities.id, activityId))\n      .run();\n  });\n}",
      replace:
        "        sortOrder: checked.sortOrder,\n      })\n      .where(eq(activities.id, activityId))\n      .run();\n\n    tx.run(\n      sql`update activity_logs set computed_hours = computed_hours * 2 where activity_id = " +
        // Assembled rather than written out: the mutant's source needs a real
        // template placeholder, and Biome reads one inside a plain string as a
        // mistake wherever it appears.
        "${" +
        "activityId}`,\n    );\n  });\n}",
    },
  },
];

/**
 * The rewrite that has to come back uncaught.
 *
 * The two guards at the top of `updateActivity`'s transaction, swapped. Neither
 * reads the other and both throw before anything is written, so which of them
 * refuses first is not a rule — an update that names a missing activity *and* a
 * dead category is refused either way, and no case in the table asks which
 * sentence it got.
 *
 * It sits between two edits that are rules: dropping either guard is caught
 * above, and the case below drops one of them the same way to show the matrix
 * tells the reorder from the removal.
 */
const CONTROL: Mutation = {
  name: "the two guards on an edit run in the other order",
  file: "activities.ts",
  find:
    "    const found = requireActivityRow(tx, activityId);\n" +
    "    requireLiveCategory(tx, checked.categoryId);",
  replace:
    "    requireLiveCategory(tx, checked.categoryId);\n" +
    "    const found = requireActivityRow(tx, activityId);",
};

/**
 * How long one mutant gets: compile it, load it, and run the whole table on a
 * migrated and seeded database of its own.
 *
 * Three minutes, not one, and the margin is the point. Measured on a developer
 * laptop under a parallel suite run, the slowest mutation here took **53,7 s**
 * against a 60 s limit — it passed, and it would have failed on any machine a
 * little slower, which CI's shared runner routinely is. A matrix that goes red
 * because a runner was busy teaches whoever sees it to re-run rather than to
 * read, and a mutation nobody reads is a rule nobody is protecting.
 *
 * The cost of being wrong in this direction is a slower failure; in the other
 * it is a flaky one.
 */
const ONE_MUTANT_MS = 180_000;

const sources = new Map<File, string>();
const roots: string[] = [];

beforeAll(() => {
  for (const file of FILES) {
    sources.set(file, readFileSync(join(DB_DIR, file), "utf8"));
  }
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

function freshWorld(): ActivityWorld {
  const root = mkdtempSync(
    join(tmpdir(), "kids-screen-tracker-activity-mutant-"),
  );
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);

  const connection: Connection = openDatabase(databasePath);
  seedWithTestUsers(connection);
  roots.push(root);

  return makeActivityWorld(connection);
}

/** Points a copied file's imports at its sibling, or at the real module. */
function rehome(mutated: string, dir: string): string {
  return mutated.replace(/from "(\.[^"]*)"/g, (_whole, specifier: string) => {
    const resolved = resolve(DB_DIR, specifier);
    const name = `${basename(resolved)}.ts` as File;

    return FILES.includes(name)
      ? `from "./${basename(resolved)}"`
      : `from "${relative(dir, resolved)}"`;
  });
}

async function loadMutant(
  index: number,
  mutation: Mutation,
): Promise<ActivityModule> {
  const dir = join(MUTANT_DIR, `m${index}`);
  mkdirSync(dir, { recursive: true });

  for (const file of FILES) {
    const source = sources.get(file) ?? "";

    writeFileSync(
      join(dir, file),
      rehome(file === mutation.file ? mutate(mutation, source) : source, dir),
    );
  }

  return (await import(
    /* @vite-ignore */ `../../.sabotage-activities/m${index}/activities.ts?v=${Date.now()}-${index}`
  )) as ActivityModule;
}

/** Applies one mutation, refusing to pretend when a needle has moved. */
function mutate(mutation: Mutation, source: string): string {
  const edits: Edit[] = [
    { find: mutation.find, replace: mutation.replace },
    ...(mutation.andThen === undefined ? [] : [mutation.andThen]),
  ];

  return edits.reduce((text, edit) => {
    // Exactly once, and not merely present. `String.replace` takes the first
    // match, so an ambiguous needle silently mutates a different function from
    // the one the mutation is named after — measured here: "an activity that
    // does not exist is not noticed" matched `requireLiveCategory` rather than
    // `requireActivityRow`, making it a duplicate of another mutation and
    // leaving `requireActivityRow`'s guard untouched by the whole matrix, while
    // every test stayed green.
    const occurrences = text.split(edit.find).length - 1;

    expect(
      occurrences,
      `the mutation target is not in ${mutation.file} exactly once ` +
        `(found ${occurrences}):\n${edit.find}`,
    ).toBe(1);

    const mutated = text.replace(edit.find, edit.replace);

    expect(mutated).not.toBe(text);

    return mutated;
  }, source);
}

describe("an activity CRUD broken on purpose", () => {
  it.each(MUTATIONS.map((mutation, index) => ({ ...mutation, index })))(
    "is caught when $name",
    async (mutation) => {
      const failures = failingActivityCases(
        await loadMutant(mutation.index, mutation),
        freshWorld,
      );

      expect(
        failures.length,
        "this mutation broke a rule and no case noticed",
      ).toBeGreaterThan(0);
    },
    ONE_MUTANT_MS,
  );

  it("covers every rule of #27 with at least one mutation", {
    timeout: ONE_MUTANT_MS * 4,
  }, async () => {
    const caught = new Set<string>();

    for (const [index, mutation] of MUTATIONS.entries()) {
      for (const failure of failingActivityCases(
        await loadMutant(MUTATIONS.length + index, mutation),
        freshWorld,
      )) {
        caught.add(failure.rule);
      }
    }

    expect([...caught].sort()).toEqual(
      [...new Set(ACTIVITY_CASES.map((one) => one.rule))].sort(),
    );
  });
});

describe("the control: the matrix can still say no", () => {
  it("does not catch a rewrite that means the same thing", {
    timeout: ONE_MUTANT_MS,
  }, async () => {
    const failures = failingActivityCases(
      await loadMutant(2 * MUTATIONS.length, CONTROL),
      freshWorld,
    );

    expect(
      failures.map((failure) => failure.name),
      "the control was caught, so the matrix is failing mutants for a " +
        "reason other than the one it claims — a load error, or a table " +
        "comparing everything against undefined",
    ).toEqual([]);
  });

  it("catches the removal the reorder is a control for", {
    timeout: ONE_MUTANT_MS,
  }, async () => {
    // The same two lines, with one of them deleted instead of moved. Order is
    // not a rule and presence is; that the matrix tells them apart is what
    // the control's silence is worth.
    const failures = failingActivityCases(
      await loadMutant(2 * MUTATIONS.length + 1, {
        name: "the category guard is dropped from the edit",
        file: "activities.ts",
        find:
          "    const found = requireActivityRow(tx, activityId);\n" +
          "    requireLiveCategory(tx, checked.categoryId);",
        replace: "    const found = requireActivityRow(tx, activityId);",
      }),
      freshWorld,
    );

    expect(failures.length).toBeGreaterThan(0);
  });
});
