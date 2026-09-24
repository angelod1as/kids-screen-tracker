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

import type { AdminWorld } from "./admin.rules";
import { makeAdminWorld } from "./admin.rules";
import type { Connection } from "./client";
import { openDatabase } from "./client";
import type { LedgerModule } from "./ledger.rules";
import { failingLedgerCases, LEDGER_CASES } from "./ledger.rules";
import { migrateDatabase } from "./migrate";
import { seedWithTestUsers } from "./test-users";

/**
 * The sabotage matrix for the release and the refund (#23, #24).
 *
 * Same shape and same argument as `admin.sabotage.test.ts`, including the three
 * files: the two movements are `ledger.ts`, and two of their rules live beside
 * them in `input.ts` and `people.ts`.
 *
 * What these two functions have that the launch does not is a rule about
 * something **not** happening: the balance may go below zero, without limit, so
 * there is no check to break — only one to *add*. A mutation that adds one is
 * how a matrix can protect an absence, and it is the first one below.
 */

const DB_DIR = import.meta.dirname;
const MUTANT_DIR = join(DB_DIR, "..", "..", ".sabotage-ledger");

const FILES = ["ledger.ts", "input.ts", "people.ts"] as const;

type File = (typeof FILES)[number];

type Mutation = {
  name: string;
  file: File;
  find: string;
  replace: string;
};

const MUTATIONS: readonly Mutation[] = [
  // --- o saldo pode ficar negativo, sem limite ------------------------------
  {
    name: "a release is refused when the boy does not have the hours",
    file: "ledger.ts",
    find: "    requireActiveKid(tx, release.userId);\n",
    replace:
      "    requireActiveKid(tx, release.userId);\n\n" +
      "    if (hours > 1) {\n" +
      '      throw new Error("not enough balance");\n' +
      "    }\n",
  },

  // --- #23: liberar debita -------------------------------------------------
  {
    name: "a release adds instead of taking away",
    file: "ledger.ts",
    find: '        kind: "spend",',
    replace: '        kind: "earn",',
  },
  {
    name: "a release lands on the adult who made it",
    file: "ledger.ts",
    find: "        userId: release.userId,\n        kind:",
    replace: "        userId: adminId,\n        kind:",
  },
  {
    name: "the adult who did it is not the one written down",
    file: "ledger.ts",
    find: '        destination: destination === "" ? null : destination,\n        createdBy: adminId,',
    replace:
      '        destination: destination === "" ? null : destination,\n        createdBy: release.userId,',
  },
  {
    name: "a release takes an hour more than it says",
    file: "ledger.ts",
    find: "        hours,\n        occurredOn,",
    replace: "        hours: hours + 1,\n        occurredOn,",
  },
  {
    name: "a release is dated a day of its own",
    file: "ledger.ts",
    find: "  const occurredOn = saoPauloDay(now);",
    replace: '  const occurredOn = "2026-01-01";',
  },
  {
    name: "the destination is not written down",
    file: "ledger.ts",
    find: '        destination: destination === "" ? null : destination,',
    replace: "        destination: null,",
  },
  {
    name: "a destination of nothing but spaces is written down as one",
    file: "ledger.ts",
    find: '        destination: destination === "" ? null : destination,',
    replace: "        destination,",
  },

  // --- #24: estornar soma, com data e motivo -------------------------------
  {
    name: "a refund takes away instead of giving back",
    file: "ledger.ts",
    find: '        kind: "refund",',
    replace: '        kind: "spend",',
  },
  {
    name: "a refund is dated the day it was typed",
    file: "ledger.ts",
    find: "        occurredOn: refund.occurredOn,",
    replace: "        occurredOn: saoPauloDay(now),",
  },
  {
    name: "the reason is not written down",
    file: "ledger.ts",
    find: "        note: reason,",
    replace: "        note: null,",
  },
  {
    name: "a refund with no reason is accepted",
    file: "ledger.ts",
    find: '  if (reason === "") {',
    replace: "  if (false) {",
  },
  {
    name: "a refund gives back a different number from the one asked for",
    file: "ledger.ts",
    find: '        kind: "refund",\n        hours,',
    replace: '        kind: "refund",\n        hours: hours / 2,',
  },

  // --- o que o adulto digitou ----------------------------------------------
  {
    name: "an amount is not checked at all",
    file: "input.ts",
    find: "  if (!Number.isFinite(rounded) || rounded < SMALLEST_HOURS) {",
    replace: "  if (false) {",
  },
  {
    name: "infinity is an amount, since it is above the floor",
    file: "input.ts",
    find: "  if (!Number.isFinite(rounded) || rounded < SMALLEST_HOURS) {",
    replace: "  if (rounded < SMALLEST_HOURS) {",
  },
  {
    name: "an amount is stored with whatever precision it arrived with",
    file: "input.ts",
    find: "  const rounded = Math.round(hours * 100) / 100;",
    replace: "  const rounded = hours;",
  },
  {
    name: "an amount has no ceiling but the column's own",
    file: "input.ts",
    find: "  if (rounded > MAX_HOURS) {",
    replace: "  if (false) {",
  },
  {
    name: "free text is not held to any length",
    file: "input.ts",
    find: "  if (text !== null && text.length > MAX_TEXT_LENGTH) {",
    replace: "  if (false) {",
  },
  {
    name: "a movement can be dated tomorrow",
    file: "input.ts",
    find: "  if (day > today) {",
    replace: "  if (false) {",
  },

  // --- D33: quem pode receber ----------------------------------------------
  {
    name: "anybody with a row can be released for",
    file: "people.ts",
    find: '  if (found.role !== "kid" || !found.active) {',
    replace: "  if (false) {",
  },
  {
    name: "a boy who was switched off is still a boy",
    file: "people.ts",
    find: '  if (found.role !== "kid" || !found.active) {',
    replace: '  if (found.role !== "kid") {',
  },
  {
    name: "somebody who does not exist is written for anyway",
    file: "people.ts",
    find: "  if (found === undefined) {",
    replace: "  if (false) {",
  },
];

/**
 * The rewrite that has to come back uncaught.
 *
 * The two spellings of "the destination, trimmed, or null" are the same
 * function. It is the shape of tidying a reviewer suggests, it sits one line
 * above a ternary that *is* a rule — an empty destination becomes null — and
 * the matrix has to be able to tell the two apart. That it does is what the
 * control's silence is worth, and the case below the control proves the other
 * half.
 */
const CONTROL: Mutation = {
  file: "ledger.ts",
  name: "the destination is trimmed with fewer characters",
  find:
    "  const destination =\n" +
    "    release.destination === undefined || release.destination === null\n" +
    "      ? null\n" +
    "      : release.destination.trim();",
  replace: "  const destination = release.destination?.trim() ?? null;",
};

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

function freshWorld(): AdminWorld {
  const root = mkdtempSync(
    join(tmpdir(), "kids-screen-tracker-ledger-mutant-"),
  );
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);

  const connection: Connection = openDatabase(databasePath);
  seedWithTestUsers(connection);
  roots.push(root);

  return makeAdminWorld(connection);
}

/** See `admin.sabotage.test.ts`: siblings stay siblings, everything else is real. */
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
): Promise<LedgerModule> {
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
    /* @vite-ignore */ `../../.sabotage-ledger/m${index}/ledger.ts?v=${Date.now()}-${index}`
  )) as LedgerModule;
}

/** Applies one mutation, refusing to pretend when a needle has moved. */
function mutate(mutation: Mutation, source: string): string {
  expect(
    source.includes(mutation.find),
    `the mutation target is no longer in ${mutation.file}:\n${mutation.find}`,
  ).toBe(true);

  const mutated = source.replace(mutation.find, mutation.replace);

  expect(mutated).not.toBe(source);

  return mutated;
}

describe("a movement broken on purpose", () => {
  it.each(MUTATIONS.map((mutation, index) => ({ ...mutation, index })))(
    "is caught when $name",
    async (mutation) => {
      const failures = failingLedgerCases(
        await loadMutant(mutation.index, mutation),
        freshWorld,
      );

      expect(
        failures.length,
        "this mutation broke a rule and no case noticed",
      ).toBeGreaterThan(0);
    },
    60_000,
  );

  it("covers every rule of #23 and #24 with at least one mutation", {
    timeout: 300_000,
  }, async () => {
    const caught = new Set<string>();

    for (const [index, mutation] of MUTATIONS.entries()) {
      for (const failure of failingLedgerCases(
        await loadMutant(MUTATIONS.length + index, mutation),
        freshWorld,
      )) {
        caught.add(failure.rule);
      }
    }

    expect([...caught].sort()).toEqual(
      [...new Set(LEDGER_CASES.map((ledgerCase) => ledgerCase.rule))].sort(),
    );
  });
});

describe("the control: the matrix can still say no", () => {
  it("does not catch a rewrite that means the same thing", {
    timeout: 60_000,
  }, async () => {
    const failures = failingLedgerCases(
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
    timeout: 60_000,
  }, async () => {
    // One line below the control's, about the same value: a destination of
    // nothing but spaces is not a destination. One is a spelling and one is a
    // rule, and the matrix has to tell them apart.
    const failures = failingLedgerCases(
      await loadMutant(2 * MUTATIONS.length + 1, {
        file: "ledger.ts",
        name: "an empty destination is written down as an empty destination",
        find: '        destination: destination === "" ? null : destination,',
        replace: "        destination,",
      }),
      freshWorld,
    );

    expect(failures.length).toBeGreaterThan(0);
  });
});
