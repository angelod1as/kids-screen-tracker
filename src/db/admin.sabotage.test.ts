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

import type { AdminModule, AdminWorld } from "./admin.rules";
import { ADMIN_CASES, failingAdminCases, makeAdminWorld } from "./admin.rules";
import type { Connection } from "./client";
import { openDatabase } from "./client";
import { migrateDatabase } from "./migrate";
import { seedWithTestUsers } from "./test-users";

/**
 * Sabotage matrix for the launch (#22): a broken rule leaves a working program
 * with a wrong number. Mutants span `admin.ts`, `input.ts` and `people.ts`,
 * and one control rewrite must come back uncaught.
 */

const DB_DIR = import.meta.dirname;
const MUTANT_DIR = join(DB_DIR, "..", "..", ".sabotage-admin");

const FILES = ["admin.ts", "input.ts", "people.ts"] as const;

type File = (typeof FILES)[number];

type Mutation = {
  name: string;
  file: File;
  find: string;
  replace: string;
};

const MUTATIONS: readonly Mutation[] = [
  {
    name: "the entry is born pending, like a boy's proposal",
    file: "admin.ts",
    find: '        status: "approved",\n        source: "admin",',
    replace: '        status: "pending",\n        source: "admin",',
  },
  {
    name: "the entry does not say which adult wrote it",
    file: "admin.ts",
    find: "        createdBy: adminId,\n        reviewedBy: adminId,",
    replace: "        createdBy: adminId,\n        reviewedBy: null,",
  },
  {
    name: "the entry says it came from the stopwatch",
    file: "admin.ts",
    find: '        status: "approved",\n        source: "admin",',
    replace: '        status: "approved",\n        source: "timer",',
  },
  {
    name: "no ledger row is written at all",
    file: "admin.ts",
    find: "    if (calculation.hours <= 0) {",
    replace: "    if (true) {",
  },
  {
    name: "the credit lands on the adult who launched it",
    file: "admin.ts",
    find: '        userId: entry.userId,\n        kind: "earn",',
    replace: '        userId: adminId,\n        kind: "earn",',
  },
  {
    name: "the ledger row carries a different number from the entry",
    file: "admin.ts",
    find: '        kind: "earn",\n        hours: calculation.hours,',
    replace: '        kind: "earn",\n        hours: calculation.hours + 1,',
  },
  {
    name: "the frozen value is zero",
    file: "admin.ts",
    find: "        computedHours: calculation.hours,",
    replace: "        computedHours: 0,",
  },
  {
    name: "the note the adult wrote is dropped",
    file: "admin.ts",
    find: "        note: entry.note ?? null,",
    replace: "        note: null,",
  },

  {
    name: "the value is computed for today instead of the day it happened",
    file: "admin.ts",
    find: "      occurredOn: checked.occurredOn,\n      durationMinutes: checked.durationMinutes ?? null,\n      quality: checked.quality ?? null,\n      freeValue: checked.freeValue ?? null,\n    });\n\n    const written = tx",
    replace:
      "      occurredOn: today,\n      durationMinutes: checked.durationMinutes ?? null,\n      quality: checked.quality ?? null,\n      freeValue: checked.freeValue ?? null,\n    });\n\n    const written = tx",
  },
  {
    name: "the ledger row is dated the day it was typed",
    file: "admin.ts",
    find: "        occurredOn: entry.occurredOn,\n        activityLogId: written.id,",
    replace: "        occurredOn: today,\n        activityLogId: written.id,",
  },
  {
    name: "the history window is as short as the entry's own day",
    file: "admin.ts",
    find: "  const historyFrom = historyWindowStart(\n    entry.occurredOn,\n    found.activity,\n    found.category,\n  );",
    replace: "  const historyFrom = entry.occurredOn;",
  },
  {
    name: "a pending or refused entry fills the day's bucket too (D19)",
    file: "admin.ts",
    find: '        eq(activityLogs.status, "approved"),\n        gte(activityLogs.occurredOn, historyFrom),',
    replace: "        gte(activityLogs.occurredOn, historyFrom),",
  },

  {
    name: "the window stops at the entry's own day, so a later one is invisible",
    file: "admin.ts",
    find: "        lte(activityLogs.occurredOn, historyTo),",
    replace: "        lte(activityLogs.occurredOn, historyFrom),",
  },
  {
    name: "the far end of the window is the entry's own day (D34)",
    file: "admin.ts",
    find: "  const historyTo = historyWindowEnd(\n    entry.occurredOn,\n    found.activity,\n    found.category,\n  );",
    replace: "  const historyTo = entry.occurredOn;",
  },
  {
    name: "an entry is frozen while an earlier one is still waiting",
    file: "admin.ts",
    find: "    if (blocking !== undefined) {",
    replace: "    if (false) {",
  },
  {
    name: "the order only matters inside one day",
    file: "admin.ts",
    find: '        eq(activityLogs.status, "pending"),\n        gte(activityLogs.occurredOn, historyFrom),',
    replace:
      '        eq(activityLogs.status, "pending"),\n        gte(activityLogs.occurredOn, entry.occurredOn),',
  },
  {
    name: "a refused entry blocks the launch as a waiting one does",
    file: "admin.ts",
    find: '        eq(activityLogs.status, "pending"),\n        gte(activityLogs.occurredOn, historyFrom),',
    replace: "        gte(activityLogs.occurredOn, historyFrom),",
  },
  {
    name: "the preview does not say what stands in the way",
    file: "admin.ts",
    find: "    blockedBy: pendingBefore(db, entry) ?? null,",
    replace: "    blockedBy: null,",
  },

  {
    name: "a duration is stored whatever the mode",
    file: "admin.ts",
    find: '        durationMinutes:\n          found.activity.calcMode === "duration"\n            ? (entry.durationMinutes ?? null)\n            : null,',
    replace: "        durationMinutes: entry.durationMinutes ?? null,",
  },
  {
    name: "a grade is stored whatever the activity",
    file: "admin.ts",
    find: "        quality: found.activity.qualityGraded ? (entry.quality ?? null) : null,",
    replace: "        quality: entry.quality ?? null,",
  },
  {
    name: "the typed value of a free activity is dropped",
    file: "admin.ts",
    find: '        freeValue:\n          found.activity.calcMode === "free"\n            ? (checked.freeValue ?? null)\n            : null,',
    replace: "        freeValue: null,",
  },
  {
    name: "a duration of zero reaches the database",
    file: "admin.ts",
    find: "    if (\n      minutes == null ||\n      !Number.isInteger(minutes) ||\n      minutes < 1 ||\n      minutes > MAX_MINUTES\n    ) {",
    replace: "    if (false) {",
  },

  {
    name: "a deactivated activity can be launched",
    file: "admin.ts",
    find: "  if (!found.active || !found.categoryActive) {",
    replace: "  if (false) {",
  },
  {
    name: "a deactivated category does not stop its activity",
    file: "admin.ts",
    find: "  if (!found.active || !found.categoryActive) {",
    replace: "  if (!found.active) {",
  },
  {
    name: "the launch does not check who it is for",
    file: "admin.ts",
    find: "    requireActiveKid(tx, entry.userId);\n\n    const found = requireLaunchableActivity(tx, entry.activityId);",
    replace:
      "    const found = requireLaunchableActivity(tx, entry.activityId);",
  },
  {
    name: "anybody with a row can have an entry launched for them",
    file: "people.ts",
    find: '  if (found.role !== "kid" || !found.active) {',
    replace: "  if (false) {",
  },
  {
    name: "a deactivated boy is still a boy",
    file: "people.ts",
    find: '  if (found.role !== "kid" || !found.active) {',
    replace: '  if (found.role !== "kid") {',
  },

  {
    name: "an entry can be dated tomorrow",
    file: "input.ts",
    find: "  if (day > today) {",
    replace: "  if (false) {",
  },
  {
    name: "a day that is not on the calendar is accepted",
    file: "input.ts",
    find: "  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(day) || shiftDate(day, 0) !== day) {",
    replace: "  if (false) {",
  },
  {
    name: "a free activity's value is not checked at all",
    file: "admin.ts",
    find: '        freeValue: requireHours(\n          entry.freeValue ?? Number.NaN,\n          "a free activity\'s value",\n        ),',
    replace: "        freeValue: entry.freeValue ?? Number.NaN,",
  },
  {
    name: "the value of a free activity is checked and then thrown away",
    file: "admin.ts",
    find: '  return activity.calcMode === "free"',
    replace: '  return false && activity.calcMode === "free"',
  },
  {
    name: "the debut is priced as a return (D47)",
    file: "admin.ts",
    find: "    categoryFirstDay: categoryFirstDay(db, entry.userId, found.category.id),",
    replace: '    categoryFirstDay: "2000-01-01",',
  },
  {
    name: "a pending debut blocks nothing (D32, D47)",
    file: "admin.ts",
    find: "  return blocking === undefined\n    ? pendingDebutBefore(",
    replace:
      "  return blocking === undefined\n    ? undefined && pendingDebutBefore(",
  },
];

/** The control: the window's two ends computed in swapped order. */
const CONTROL: Mutation = {
  name: "the two ends of the window are computed in the other order",
  file: "admin.ts",
  find:
    "  const historyFrom = historyWindowStart(\n" +
    "    entry.occurredOn,\n" +
    "    found.activity,\n" +
    "    found.category,\n" +
    "  );\n" +
    "  const historyTo = historyWindowEnd(\n" +
    "    entry.occurredOn,\n" +
    "    found.activity,\n" +
    "    found.category,\n" +
    "  );",
  replace:
    "  const historyTo = historyWindowEnd(\n" +
    "    entry.occurredOn,\n" +
    "    found.activity,\n" +
    "    found.category,\n" +
    "  );\n" +
    "  const historyFrom = historyWindowStart(\n" +
    "    entry.occurredOn,\n" +
    "    found.activity,\n" +
    "    found.category,\n" +
    "  );",
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

/** A migrated, seeded database of its own for one case. */
function freshWorld(): AdminWorld {
  const root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-admin-mutant-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);

  const connection: Connection = openDatabase(databasePath);
  seedWithTestUsers(connection);
  roots.push(root);

  return makeAdminWorld(connection);
}

/** Siblings stay siblings, or a mutation of `input.ts` would never load. */
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
): Promise<AdminModule> {
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
    /* @vite-ignore */ `../../.sabotage-admin/m${index}/admin.ts?v=${Date.now()}-${index}`
  )) as AdminModule;
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

describe("a launch broken on purpose", () => {
  it.each(MUTATIONS.map((mutation, index) => ({ ...mutation, index })))(
    "is caught when $name",
    async (mutation) => {
      const failures = failingAdminCases(
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

  it("covers every rule of #22 with at least one mutation", {
    timeout: 300_000,
  }, async () => {
    const caught = new Set<string>();

    for (const [index, mutation] of MUTATIONS.entries()) {
      for (const failure of failingAdminCases(
        await loadMutant(MUTATIONS.length + index, mutation),
        freshWorld,
      )) {
        caught.add(failure.rule);
      }
    }

    expect([...caught].sort()).toEqual(
      [...new Set(ADMIN_CASES.map((adminCase) => adminCase.rule))].sort(),
    );
  });
});

describe("the control: the matrix can still say no", () => {
  it("does not catch a rewrite that means the same thing", {
    timeout: 60_000,
  }, async () => {
    const failures = failingAdminCases(
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
    // Edited like the control, but D19: the matrix must tell them apart.
    const failures = failingAdminCases(
      await loadMutant(2 * MUTATIONS.length + 1, {
        name: "the approved-only filter is dropped from the same where",
        file: "admin.ts",
        find: '        eq(activityLogs.status, "approved"),\n        gte(activityLogs.occurredOn, historyFrom),',
        replace: "        gte(activityLogs.occurredOn, historyFrom),",
      }),
      freshWorld,
    );

    expect(failures.length).toBeGreaterThan(0);
  });
});
