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

import type { Connection } from "./client";
import { openDatabase } from "./client";
import type { ConfigModule, ConfigWorld } from "./config.rules";
import {
  CONFIG_CASES,
  failingConfigCases,
  makeConfigWorld,
} from "./config.rules";
import { migrateDatabase } from "./migrate";
import { seedWithTestUsers } from "./test-users";

/**
 * Sabotage matrix for the category configuration (#26): a broken validation
 * here fails silently. Mutants span `categories.ts`, `input.ts` and
 * `limits.ts`, and one control rewrite must come back uncaught.
 */

const DB_DIR = import.meta.dirname;
const ENGINE_DIR = join(DB_DIR, "..", "engine");
const MUTANT_DIR = join(DB_DIR, "..", "..", ".sabotage-config");

/** By basename: `rehome` points `../engine/limits` at the mutant's own copy. */
const FILES = {
  "categories.ts": { from: DB_DIR },
  "input.ts": { from: DB_DIR },
  "limits.ts": { from: ENGINE_DIR },
} as const;

type File = keyof typeof FILES;

const NAMES = Object.keys(FILES) as File[];

type Edit = { find: string; replace: string };

type Mutation = {
  name: string;
  file: File;
  find: string;
  replace: string;
  /** A second edit: D15 is broken by adding a recalculation and its import. */
  andThen?: Edit;
};

const MUTATIONS: readonly Mutation[] = [
  {
    name: "a category is born switched off",
    file: "categories.ts",
    find: "        sortOrder: checked.sortOrder,\n        active: true,",
    replace: "        sortOrder: checked.sortOrder,\n        active: false,",
  },
  {
    name: "switching a category off clears its numbers too",
    file: "categories.ts",
    find: "    tx.update(categories)\n      .set({ active })",
    replace:
      "    tx.update(categories)\n      .set({ active, baseRate: null })",
  },
  {
    name: "switching off is not reversible, because it writes false either way",
    file: "categories.ts",
    find: "    tx.update(categories)\n      .set({ active })",
    replace: "    tx.update(categories)\n      .set({ active: false })",
  },
  {
    name: "a category that does not exist is not noticed",
    file: "categories.ts",
    // The guard, not the sentence: an update of a missing row succeeds silently.
    find: "  if (found === undefined) {",
    replace: "  if (false) {",
  },

  {
    name: "the name is stored with the spaces around it",
    file: "categories.ts",
    find: "  const name = input.name.trim();",
    replace: "  const name = input.name;",
  },
  {
    name: "a category with no name at all is accepted",
    file: "categories.ts",
    find: '  if (name === "") {',
    replace: "  if (false) {",
  },
  {
    name: "an edit writes the name and leaves every number as it was",
    file: "categories.ts",
    find: "        name: checked.name,\n        baseRate: checked.baseRate,\n        decayStepHours: checked.decayStepHours,\n        returnBonusPct: checked.returnBonusPct,\n        returnBonusAfterDays: checked.returnBonusAfterDays,\n        sortOrder: checked.sortOrder,\n      })\n      .where(eq(categories.id, categoryId))",
    replace:
      "        name: checked.name,\n      })\n      .where(eq(categories.id, categoryId))",
  },
  {
    name: "an edit drops the decay step it was given",
    file: "categories.ts",
    find: "        decayStepHours: checked.decayStepHours,\n        returnBonusPct: checked.returnBonusPct,\n        returnBonusAfterDays: checked.returnBonusAfterDays,\n        sortOrder: checked.sortOrder,\n      })\n      .where(eq(categories.id, categoryId))",
    replace:
      "        decayStepHours: null,\n        returnBonusPct: checked.returnBonusPct,\n        returnBonusAfterDays: checked.returnBonusAfterDays,\n        sortOrder: checked.sortOrder,\n      })\n      .where(eq(categories.id, categoryId))",
  },

  {
    name: "two live categories may share a name",
    file: "categories.ts",
    find: "  if (clash !== undefined) {",
    replace: "  if (false) {",
  },
  {
    name: "a switched-off category still burns its name (D14)",
    file: "categories.ts",
    find: "        eq(categories.name, name),\n        eq(categories.active, true),",
    replace: "        eq(categories.name, name),",
  },
  {
    name: "a switched-off category is held to the live rows' name rule",
    file: "categories.ts",
    find: "    if (found.active) {\n      requireNameIsFree(tx, checked.name, categoryId);\n    }",
    replace: "    requireNameIsFree(tx, checked.name, categoryId);",
  },
  {
    name: "an edit never checks the name at all",
    file: "categories.ts",
    find: "    if (found.active) {\n      requireNameIsFree(tx, checked.name, categoryId);\n    }",
    replace:
      "    if (false) {\n      requireNameIsFree(tx, checked.name, categoryId);\n    }",
  },
  {
    name: "a category collides with itself when it is edited",
    file: "categories.ts",
    find: "        exceptId === null ? undefined : ne(categories.id, exceptId),",
    replace: "        undefined,",
  },
  {
    name: "switching one back on skips the name check",
    file: "categories.ts",
    find: "    if (active) {\n      requireNameIsFree(tx, found.name, categoryId);\n    }",
    replace:
      "    if (false) {\n      requireNameIsFree(tx, found.name, categoryId);\n    }",
  },

  {
    name: "the decay step floor is not applied at all",
    file: "categories.ts",
    find: "  if (!isUsableDecayStep(decayStepHours)) {",
    replace: "  if (false) {",
  },
  {
    name: "the floor lets everything through",
    file: "limits.ts",
    find: "  return decayStepHours >= MIN_DECAY_STEP_HOURS;",
    replace: "  return true;",
  },
  {
    name: "the floor is exclusive, so the floor itself is refused",
    file: "limits.ts",
    find: "  return decayStepHours >= MIN_DECAY_STEP_HOURS;",
    replace: "  return decayStepHours > MIN_DECAY_STEP_HOURS;",
  },
  {
    name: "the floor is a twentieth of an hour instead of a quarter",
    file: "limits.ts",
    find: "export const MIN_DECAY_STEP_HOURS = 0.25;",
    replace: "export const MIN_DECAY_STEP_HOURS = 0.05;",
  },
  {
    name: "an empty step is read as a bad value instead of as no decay (D2)",
    file: "limits.ts",
    find: "  if (decayStepHours === null) return true;",
    replace: "  if (decayStepHours === null) return false;",
  },

  {
    name: "the return bonus pair is not checked at all",
    file: "categories.ts",
    find: "  if (!isUsableReturnBonus(returnBonusPct, returnBonusAfterDays)) {",
    replace: "  if (false) {",
  },
  {
    name: "any bonus and any threshold go together",
    file: "limits.ts",
    find: "  return returnBonusAfterDays >= MIN_RETURN_BONUS_AFTER_DAYS;",
    replace: "  return true;",
  },
  {
    name: "the threshold may be zero after all",
    file: "limits.ts",
    find: "export const MIN_RETURN_BONUS_AFTER_DAYS = 1;",
    replace: "export const MIN_RETURN_BONUS_AFTER_DAYS = 0;",
  },
  {
    name: "a bonus of zero now needs a threshold too, which the seed does not have",
    file: "limits.ts",
    find: "  if (returnBonusPct <= 0) return true;",
    replace: "  if (returnBonusPct < 0) return true;",
  },

  {
    name: "a number of hours that is not a number at all is accepted",
    file: "input.ts",
    find: "  const rounded = Math.round(hours * 100) / 100;\n\n  if (!Number.isFinite(rounded) || rounded < 0 || rounded > MAX_HOURS) {",
    replace:
      "  const rounded = Math.round(hours * 100) / 100;\n\n  if (rounded < 0 || rounded > MAX_HOURS) {",
  },
  {
    name: "a negative rate is accepted",
    file: "input.ts",
    find: "  const rounded = Math.round(hours * 100) / 100;\n\n  if (!Number.isFinite(rounded) || rounded < 0 || rounded > MAX_HOURS) {",
    replace:
      "  const rounded = Math.round(hours * 100) / 100;\n\n  if (!Number.isFinite(rounded) || rounded > MAX_HOURS) {",
  },
  {
    name: "a rate above the column ceiling is accepted",
    file: "input.ts",
    find: "  const rounded = Math.round(hours * 100) / 100;\n\n  if (!Number.isFinite(rounded) || rounded < 0 || rounded > MAX_HOURS) {",
    replace:
      "  const rounded = Math.round(hours * 100) / 100;\n\n  if (!Number.isFinite(rounded) || rounded < 0) {",
  },
  {
    name: "a typed rate keeps every decimal it was given",
    file: "input.ts",
    find: "export function requireNonNegativeHours(hours: number, what: string): number {\n  requireNumber(hours, what);\n\n  const rounded = Math.round(hours * 100) / 100;",
    replace:
      "export function requireNonNegativeHours(hours: number, what: string): number {\n  requireNumber(hours, what);\n\n  const rounded = hours;",
  },
  {
    name: "a counter may be a fraction",
    file: "input.ts",
    find: "  if (!Number.isInteger(count) || count < min || count > MAX_COUNT) {",
    replace: "  if (count < min || count > MAX_COUNT) {",
  },
  {
    name: "a counter may be negative",
    file: "input.ts",
    find: "  if (!Number.isInteger(count) || count < min || count > MAX_COUNT) {",
    replace: "  if (!Number.isInteger(count) || count > MAX_COUNT) {",
  },
  {
    name: "text of any length reaches the column",
    file: "input.ts",
    find: "  if (text !== null && text.length > MAX_TEXT_LENGTH) {",
    replace: "  if (false) {",
  },

  {
    name: "the decay step reaches the column unchecked",
    file: "categories.ts",
    find: '      : requireNonNegativeHours(input.decayStepHours, "a decay step");',
    replace: "      : input.decayStepHours;",
  },
  {
    name: "the return bonus reaches the column unchecked",
    file: "categories.ts",
    find: '  const returnBonusPct = requireBonusFraction(\n    input.returnBonusPct,\n    "a return bonus",\n  );',
    replace: "  const returnBonusPct = input.returnBonusPct;",
  },
  {
    name: "the bonus threshold reaches the column unchecked",
    file: "categories.ts",
    find: '  const returnBonusAfterDays = requireCount(\n    input.returnBonusAfterDays,\n    "a return bonus threshold",\n  );',
    replace: "  const returnBonusAfterDays = input.returnBonusAfterDays;",
  },
  {
    name: "the base rate reaches the column unchecked",
    file: "categories.ts",
    find: '        : requireNonNegativeHours(input.baseRate, "a base rate"),',
    replace: "        : input.baseRate,",
  },
  {
    name: "a bonus may exceed the column ceiling",
    file: "input.ts",
    find: "  const rounded = Math.round(pct * BONUS_DECIMALS) / BONUS_DECIMALS;\n\n  if (!Number.isFinite(rounded) || rounded < 0 || rounded > MAX_HOURS) {",
    replace:
      "  const rounded = Math.round(pct * BONUS_DECIMALS) / BONUS_DECIMALS;\n\n  if (!Number.isFinite(rounded) || rounded < 0) {",
  },
  {
    name: "a bonus that is not a number is coerced instead of refused",
    file: "input.ts",
    find: "export function requireBonusFraction(pct: number, what: string): number {\n  requireNumber(pct, what);",
    replace:
      "export function requireBonusFraction(pct: number, what: string): number {",
  },
  {
    name: "a rate that is not a number is coerced instead of refused",
    file: "input.ts",
    find: "export function requireNonNegativeHours(hours: number, what: string): number {\n  requireNumber(hours, what);",
    replace:
      "export function requireNonNegativeHours(hours: number, what: string): number {",
  },
  {
    name: "a bonus is quantized to whole percentage points",
    file: "input.ts",
    find: "  const rounded = Math.round(pct * BONUS_DECIMALS) / BONUS_DECIMALS;",
    replace: "  const rounded = Math.round(pct * 100) / 100;",
  },

  {
    name: "an edit recalculates what it already paid",
    file: "categories.ts",
    // D15, from the behavioural side; `config.test.ts` scans the source.
    find: 'import { and, asc, count, desc, eq, ne } from "drizzle-orm";',
    replace:
      'import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";',
    andThen: {
      find: "      .where(eq(categories.id, categoryId))\n      .run();\n  });\n}\n\n/**\n * Switches a category on or off",
      replace:
        "      .where(eq(categories.id, categoryId))\n      .run();\n\n    tx.run(sql`update activity_logs set computed_hours = computed_hours * 2`);\n  });\n}\n\n/**\n * Switches a category on or off",
    },
  },

  {
    name: "the switched-off ones are not sorted to the end",
    file: "categories.ts",
    find: "      desc(categories.active),\n      asc(categories.sortOrder),",
    replace: "      asc(categories.sortOrder),",
  },
  {
    name: "the list ignores the order an adult set",
    file: "categories.ts",
    find: "      desc(categories.active),\n      asc(categories.sortOrder),\n      asc(categories.id),",
    replace: "      desc(categories.active),\n      asc(categories.id),",
  },
  {
    name: "a category with no activities disappears from the list",
    file: "categories.ts",
    find: "    .leftJoin(activities, eq(activities.categoryId, categories.id))",
    replace:
      "    .innerJoin(activities, eq(activities.categoryId, categories.id))",
  },
  {
    name: "an empty category is counted as having one activity",
    file: "categories.ts",
    find: "      activityCount: count(activities.id),",
    replace: "      activityCount: count(),",
  },
];

/**
 * The control: two independent `const`s swapped. Uncaught only because no
 * case has two bad fields at once; the neighbouring rule, edited alike, is caught.
 */
const CONTROL: Mutation = {
  name: "the bonus and its threshold are checked in the other order",
  file: "categories.ts",
  find:
    "  const returnBonusPct = requireBonusFraction(\n" +
    "    input.returnBonusPct,\n" +
    '    "a return bonus",\n' +
    "  );\n" +
    "  const returnBonusAfterDays = requireCount(\n" +
    "    input.returnBonusAfterDays,\n" +
    '    "a return bonus threshold",\n' +
    "  );",
  replace:
    "  const returnBonusAfterDays = requireCount(\n" +
    "    input.returnBonusAfterDays,\n" +
    '    "a return bonus threshold",\n' +
    "  );\n" +
    "  const returnBonusPct = requireBonusFraction(\n" +
    "    input.returnBonusPct,\n" +
    '    "a return bonus",\n' +
    "  );",
};

/** Three minutes: the slowest mutant measured 53,7 s against the old 60 s. */
const ONE_MUTANT_MS = 180_000;

const sources = new Map<File, string>();
const roots: string[] = [];

beforeAll(() => {
  for (const name of NAMES) {
    sources.set(name, readFileSync(join(FILES[name].from, name), "utf8"));
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

/** A migrated, seeded database of its own for one case. */
function freshWorld(): ConfigWorld {
  const root = mkdtempSync(
    join(tmpdir(), "kids-screen-tracker-config-mutant-"),
  );
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);

  const connection: Connection = openDatabase(databasePath);
  seedWithTestUsers(connection);
  roots.push(root);

  return makeConfigWorld(connection);
}

/** Siblings resolve inside the mutant directory, everything else against `origin`. */
function rehome(mutated: string, origin: string, dir: string): string {
  return mutated.replace(/from "(\.[^"]*)"/g, (_whole, specifier: string) => {
    const resolved = resolve(origin, specifier);
    const name = `${basename(resolved)}.ts` as File;

    return NAMES.includes(name)
      ? `from "./${basename(resolved)}"`
      : `from "${relative(dir, resolved)}"`;
  });
}

async function loadMutant(
  index: number,
  mutation: Mutation,
): Promise<ConfigModule> {
  const dir = join(MUTANT_DIR, `m${index}`);
  mkdirSync(dir, { recursive: true });

  for (const name of NAMES) {
    const source = sources.get(name) ?? "";

    writeFileSync(
      join(dir, name),
      rehome(
        name === mutation.file ? mutate(mutation, source) : source,
        FILES[name].from,
        dir,
      ),
    );
  }

  return (await import(
    /* @vite-ignore */ `../../.sabotage-config/m${index}/categories.ts?v=${Date.now()}-${index}`
  )) as ConfigModule;
}

/** Applies one mutation, refusing to pretend when a needle has moved. */
function mutate(mutation: Mutation, source: string): string {
  const edits: Edit[] = [
    { find: mutation.find, replace: mutation.replace },
    ...(mutation.andThen === undefined ? [] : [mutation.andThen]),
  ];

  return edits.reduce((text, edit) => {
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

describe("a configuration broken on purpose", () => {
  it.each(MUTATIONS.map((mutation, index) => ({ ...mutation, index })))(
    "is caught when $name",
    async (mutation) => {
      const failures = failingConfigCases(
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

  it("covers every rule of #26 with at least one mutation", {
    timeout: ONE_MUTANT_MS * 4,
  }, async () => {
    const caught = new Set<string>();

    for (const [index, mutation] of MUTATIONS.entries()) {
      for (const failure of failingConfigCases(
        await loadMutant(MUTATIONS.length + index, mutation),
        freshWorld,
      )) {
        caught.add(failure.rule);
      }
    }

    expect([...caught].sort()).toEqual(
      [...new Set(CONFIG_CASES.map((one) => one.rule))].sort(),
    );
  });
});

describe("the control: the matrix can still say no", () => {
  it("does not catch a rewrite that means the same thing", {
    timeout: ONE_MUTANT_MS,
  }, async () => {
    const failures = failingConfigCases(
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

  it("catches the neighbouring clause that is a rule", {
    timeout: ONE_MUTANT_MS,
  }, async () => {
    // Edited like the control, but a rule: the matrix must tell them apart.
    const failures = failingConfigCases(
      await loadMutant(2 * MUTATIONS.length + 1, {
        name: "the guard below the control is dropped",
        file: "categories.ts",
        find: "  if (!isUsableReturnBonus(returnBonusPct, returnBonusAfterDays)) {",
        replace: "  if (false) {",
      }),
      freshWorld,
    );

    expect(failures.length).toBeGreaterThan(0);
  });
});
