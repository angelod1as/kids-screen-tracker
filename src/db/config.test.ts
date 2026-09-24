import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createCategory,
  listCategories,
  setCategoryActive,
  updateCategory,
} from "./categories";
import type { Connection } from "./client";
import { openDatabase } from "./client";
import type { ConfigModule, ConfigWorld } from "./config.rules";
import {
  BOOK,
  CAR,
  CONFIG_CASES,
  MENTE,
  makeConfigWorld,
} from "./config.rules";
import { migrateDatabase } from "./migrate";
import { seedWithTestUsers } from "./test-users";

/** #26 against the real modules, plus D15 proved two ways that fail differently. */

const MODULE: ConfigModule = {
  listCategories,
  createCategory,
  updateCategory,
  setCategoryActive,
};

/** Comments are prose. A docstring that explains D15 is not a violation of it. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function freshWorld(): ConfigWorld {
  const root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-config-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);

  const connection: Connection = openDatabase(databasePath);
  seedWithTestUsers(connection);
  roots.push(root);

  return makeConfigWorld(connection);
}

describe("configuring the categories (#26)", () => {
  it.each(CONFIG_CASES.map((configCase, index) => ({ ...configCase, index })))(
    "$rule — $name",
    (configCase) => {
      const world = freshWorld();

      try {
        expect(configCase.run(MODULE, world)).toEqual(configCase.expected);
      } finally {
        world.connection.sqlite.close();
      }
    },
  );

  it("covers every acceptance criterion of the issue", () => {
    // A table that lost a whole rule still passes every case it kept.
    expect([...new Set(CONFIG_CASES.map((one) => one.rule))].sort()).toEqual([
      "a category can be created, edited and switched off",
      "a category's numbers are held while something is under way",
      "a decay step below the floor is refused",
      "a return bonus with no threshold is refused",
      "editing recalculates nothing already credited",
      "every number the engine reads is checked here",
      "switching a category off deletes nothing",
      "the list is the one the screen draws",
    ]);
  });
});

/** D15: once by balance, once by scanning the source. */
describe("editing recalculates nothing already credited (D15)", () => {
  it("leaves a frozen entry and the balance exactly where they were", () => {
    const world = freshWorld();

    try {
      const logId = world.credit(BOOK, 3);
      // A waiting entry in another category, so a recalculation of pending rows
      // is visible; D37 would refuse the edit on its own category.
      const waitingId = world.addPending({
        activity: CAR,
        durationMinutes: null,
        quality: 1,
      });
      const frozenBefore = world.frozenText(logId);
      const balanceBefore = world.balance();
      const id = world.categoryId(MENTE);

      // Everything the form can do, on the entry's own category.
      updateCategory(world.connection, id, {
        name: "Mente",
        baseRate: 9,
        decayStepHours: 4,
        returnBonusPct: 2,
        returnBonusAfterDays: 30,
        sortOrder: 5,
      });
      setCategoryActive(world.connection, id, false);
      setCategoryActive(world.connection, id, true);
      updateCategory(world.connection, id, {
        name: "Mente renomeada",
        baseRate: null,
        decayStepHours: null,
        returnBonusPct: 0,
        returnBonusAfterDays: 0,
        sortOrder: 0,
      });

      expect(world.balance()).toBe(balanceBefore);
      expect(world.balance()).toBe(3);
      // The name follows (D14); the number does not (D15).
      expect(world.frozenText(logId)).toBe(
        "approved 3 h · Ler livro / Mente renomeada · ledger earn 3",
      );
      expect(frozenBefore).toBe(
        "approved 3 h · Ler livro / Mente · ledger earn 3",
      );
      expect(world.ledgerRows()).toHaveLength(1);
      expect(world.logRow(waitingId).computedHours).toBeNull();
      expect(world.logRow(waitingId).status).toBe("pending");
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("never touches a log or a ledger row, by the source", () => {
    // A module that cannot name the tables cannot rewrite them. Comments are
    // stripped: the docstring explaining D15 names the ledger.
    const source = stripComments(
      readFileSync(join(import.meta.dirname, "categories.ts"), "utf8"),
    );

    // Both spellings: a raw-SQL recalculation passed a camelCase-only scan.
    for (const forbidden of [
      "activityLogs",
      "activity_logs",
      "ledger",
      "calculateEarnedHours",
      "sqlite.prepare",
      "tx.run(",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }

    // And the scan is reading real code, not an emptied file.
    expect(source).toContain("categories");
    expect(source).toContain("activities");
  });
});
