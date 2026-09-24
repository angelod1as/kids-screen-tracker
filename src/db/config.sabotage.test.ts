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
 * The sabotage matrix for the configuration of the categories (#26).
 *
 * The rules it protects all have the same property, and it is a sharper version
 * of the one `admin.sabotage.test.ts` describes: breaking one of these leaves a
 * program in which **nothing at all appears to be wrong**. A validation that has
 * stopped validating does not throw, does not log and does not change a screen —
 * the category saves, the list redraws, the numbers are exactly what the adult
 * typed. What changes is what the engine is handed, and the first symptom is a
 * boy reading a balance three weeks later that went down when he did more.
 *
 * So each mutation below rewrites one clause, compiles the result, and runs the
 * whole `CONFIG_CASES` table against it on a database of its own.
 *
 * **Three files, not one.** The CRUD is `categories.ts`, and both of the rules
 * this phase exists for live elsewhere: what the engine can be handed
 * (`../engine/limits.ts`) and what an adult may type (`input.ts`). A matrix that
 * stopped at the CRUD would report the two floors as protected without ever
 * having touched them. So a mutant is a directory of all three with the imports
 * between them rehomed, and any of the three may be the one that is broken.
 *
 * **The control is as much the point as the mutations are.** One rewrite here
 * changes nothing semantically and has to come back *uncaught*. Without it, a
 * matrix whose loader quietly failed would report every rule protected — and
 * this project has been handed exactly that report before.
 */

const DB_DIR = import.meta.dirname;
const ENGINE_DIR = join(DB_DIR, "..", "engine");
const MUTANT_DIR = join(DB_DIR, "..", "..", ".sabotage-config");

/**
 * The three files a mutant is made of, each with where the real one lives.
 *
 * Flattened into one directory, which is why the map is by basename: `limits.ts`
 * comes from `src/engine/` and the other two from here, and `rehome` below
 * points `../engine/limits` at the sibling copy rather than at the real module.
 * Without that, a mutation of a floor would be loaded from the untouched
 * original and the matrix would report a rule it never broke.
 */
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
  /** The exact text to find in it. */
  find: string;
  /** What to put in its place. */
  replace: string;
  /**
   * A second edit in the same file, applied after the first.
   *
   * Needed by exactly one mutation, and it is the one D15 is about. Every other
   * rule here is broken by *removing* something; "editing recalculates nothing
   * already credited" is a rule about absence, and nothing that can be deleted
   * from this module introduces a recalculation. Breaking it means adding one,
   * and adding one means adding the import it needs as well.
   *
   * Without it the coverage case below still passed — on an accident. The
   * mutation that widens the bonus guard makes the table's default input throw,
   * so it fails six rules at once, D15's among them. A blanket mutation that
   * breaks almost everything is not evidence that any particular rule is
   * guarded, and it would have gone on saying "covered" long after D15 stopped
   * being mutated at all.
   */
  andThen?: Edit;
};

const MUTATIONS: readonly Mutation[] = [
  // --- D14: nada é apagado, e desativar é uma coluna -----------------------
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
    // The guard alone, and not the sentence it throws: an `update` or a `set`
    // on a row that is not there succeeds silently in SQL, changing nothing and
    // reporting nothing, so a screen holding a stale id would tell an adult the
    // category was switched off while it was still in every picker.
    find: "  if (found === undefined) {",
    replace: "  if (false) {",
  },

  // --- criar e editar guardam o que o formulário mandou ---------------------
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

  // --- dois nomes vivos iguais ---------------------------------------------
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

  // --- o piso do passo (o achado do PR #46) --------------------------------
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

  // --- o bônus de retorno que vira permanente (o achado do PR #48) ---------
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

  // --- o que o adulto digitou ----------------------------------------------
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

  // --- os números do formulário chegam ao guarda que os checa ---------------
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

  // --- D15: editar não recalcula nada já creditado --------------------------
  {
    name: "an edit recalculates what it already paid",
    file: "categories.ts",
    // The rule this phase rests on, broken the only way it can be: by adding
    // the recalculation D15 forbids. `config.test.ts` scans this module's
    // source for the two tables it must never name; this is the same rule seen
    // from the behavioural side.
    find: 'import { and, asc, count, desc, eq, ne } from "drizzle-orm";',
    replace:
      'import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";',
    andThen: {
      find: "      .where(eq(categories.id, categoryId))\n      .run();\n  });\n}\n\n/**\n * Switches a category on or off",
      replace:
        "      .where(eq(categories.id, categoryId))\n      .run();\n\n    tx.run(sql`update activity_logs set computed_hours = computed_hours * 2`);\n  });\n}\n\n/**\n * Switches a category on or off",
    },
  },

  // --- a lista que a tela desenha ------------------------------------------
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
 * The rewrite that has to come back uncaught.
 *
 * Two `const` declarations swapped inside `requireCategory`, neither reading the
 * other: the bonus and its threshold are validated from two different fields of
 * the same input.
 *
 * **What it is not:** a rewrite that provably means the same thing. Both
 * validators throw, so the swap changes which sentence a caller gets when
 * *both* fields are bad at once, and it is uncaught because no case in the
 * table supplies two bad fields together. That is "no case looks", which is a
 * weaker claim than "means the same thing" — and it is worth writing down,
 * because a case added carelessly later (one input with a negative bonus *and*
 * a fractional threshold) would start failing the control and the failure would
 * read as a broken matrix rather than as a bad case.
 * It sits directly above the `isUsableReturnBonus` guard, which *is* a rule and
 * is caught above — and the case below edits that neighbour the same way to
 * show the matrix tells them apart.
 *
 * Which is what makes it the control: same file, same loader, same table, same
 * kind of edit — and the answer is no.
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

/**
 * Points a copied file's imports at the right place: at its siblings in the
 * mutant directory, and at the real module for everything else.
 *
 * `origin` is where the file being rehomed actually lives, because the three are
 * not all from one directory: `../engine/limits` is a sibling when
 * `categories.ts` is rehomed and `../engine/day` is not, and both are resolved
 * against `src/db`. Resolving them against the mutant directory instead would
 * silently point every specifier at a file that is not there.
 */
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
    // The lines directly below the control's, edited the same way. One pair
    // is two independent validations in an arbitrary order and the other is
    // the rule this whole phase exists for; the matrix has to tell them
    // apart, and that it does is what the control's silence is worth.
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
