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

/**
 * The configuration of the categories (#26), against the real modules.
 *
 * The table is `config.rules.ts`, shared with the sabotage matrix. What is here
 * beyond running it is the pair of checks D15 asks for in so many words —
 * "editar **não recalcula** nada já creditado — teste provando" — written two
 * different ways, because they fail for different reasons.
 */

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
    // A table that quietly lost a whole rule still passes every case it kept.
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

/**
 * D15, proved twice.
 *
 * The first is the behavioural half: a credited entry, a category edited under
 * it in every way the form allows, and the frozen value and the balance read on
 * both sides. The second is the structural half, and it is the sharper of the
 * two — a recalculation added by somebody thinking about something else would
 * have to survive a source scan as well as a balance assertion, and the scan is
 * the one that cannot be satisfied by accident.
 */
describe("editing recalculates nothing already credited (D15)", () => {
  it("leaves a frozen entry and the balance exactly where they were", () => {
    const world = freshWorld();

    try {
      const logId = world.credit(BOOK, 3);
      // A waiting entry beside the credited one, in a *different* category —
      // D37 refuses to edit a category that has one of its own waiting, which
      // is the point of that rule. This one is Casa's, so editing Mente is
      // allowed and the fixture still has a pending row in it.
      //
      // It is here because a recalculation scoped to *pending* rows slipped
      // past a fixture that only had approved ones: 1300 tests stayed green
      // with every pending entry's frozen value doubled on any category edit.
      // Its `computed_hours` is null while it waits, and stays null.
      const waitingId = world.addPending({
        activity: CAR,
        durationMinutes: null,
        quality: 1,
      });
      const frozenBefore = world.frozenText(logId);
      const balanceBefore = world.balance();
      const id = world.categoryId(MENTE);

      // Everything the form can do, one after another, on the category the
      // entry was written under.
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
      // The name follows, because the history reads it through the foreign key
      // and D14 is what keeps that readable. The *number* does not move, and
      // the number is what D15 is about.
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
    // A module that cannot name the tables cannot rewrite them, and that holds
    // for a recalculation nobody has written yet. `activity_logs` and `ledger`
    // are the two tables D15 freezes; `categories.ts` imports neither.
    //
    // Comments are stripped first, and finding that out cost a run: the
    // module's own docstring explains D15 by saying that the ledger row is
    // written beside the frozen value, and a scan that counts prose fails over
    // the sentence that documents the rule. It is the same trap Tailwind's
    // extractor sprang on this repository — a file that argues against a thing
    // by name contains the name — and `design.test.ts` answers it the same way.
    const source = stripComments(
      readFileSync(join(import.meta.dirname, "categories.ts"), "utf8"),
    );

    // Both spellings, and both tables. The camelCase names are drizzle's; the
    // snake_case ones are what raw SQL uses, and a recalculation written as
    // `connection.sqlite.prepare("update activity_logs set computed_hours ...")`
    // passed this scan and the balance case beside it — measured, 1300 tests
    // green with every pending entry's frozen value doubled on any category
    // edit. The behavioural half missed it because it credited only an
    // *approved* entry; the scan missed it because it only knew one spelling.
    for (const forbidden of [
      "activityLogs",
      "activity_logs",
      "ledger",
      "calculateEarnedHours",
      // The two ways to reach raw SQL from a module that has a connection.
      "sqlite.prepare",
      "tx.run(",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }

    // And the scan is looking at real code, not at a file it stripped to
    // nothing: it does name the two tables the module is allowed to touch.
    expect(source).toContain("categories");
    expect(source).toContain("activities");
  });
});
