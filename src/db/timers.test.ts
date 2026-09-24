import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Connection } from "./client";
import { openDatabase } from "./client";
import { migrateDatabase } from "./migrate";
import { seedWithTestUsers } from "./test-users";
import {
  listTimedActivities,
  pauseTimer,
  readTimer,
  resumeTimer,
  startTimer,
  stopTimer,
} from "./timers";
import type { TimersModule, World } from "./timers.rules";
import { failingTimersCases, makeWorld, TIMERS_CASES } from "./timers.rules";

/**
 * The settlement as written, against the table in `timers.rules.ts`.
 *
 * `src/app/actions/timer.test.ts` covers the same module through the endpoints,
 * with the clock faked; this runs the table the sabotage matrix runs, so that
 * the matrix and the ordinary test are asking the same questions of the same
 * fixtures. A matrix whose table nothing else exercises is a second program.
 */

const REAL: TimersModule = {
  readTimer,
  startTimer,
  pauseTimer,
  resumeTimer,
  stopTimer,
  listTimedActivities,
};

const roots: string[] = [];

function freshWorld(): World {
  const root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-timers-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);

  const connection: Connection = openDatabase(databasePath);
  seedWithTestUsers(connection);
  roots.push(root);

  return makeWorld(connection, databasePath);
}

describe("the settlement as written", () => {
  it("answers every case of the table correctly", () => {
    try {
      expect(
        failingTimersCases(REAL, freshWorld).map(
          (timersCase) => timersCase.name,
        ),
      ).toEqual([]);
    } finally {
      for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
      }
    }
  }, 30_000);

  it("has a table with something in it", () => {
    expect(TIMERS_CASES.length).toBeGreaterThan(10);
  });

  it("covers each rule with more than one case", () => {
    const perRule = new Map<string, number>();

    for (const timersCase of TIMERS_CASES) {
      perRule.set(timersCase.rule, (perRule.get(timersCase.rule) ?? 0) + 1);
    }

    for (const [rule, count] of perRule) {
      expect(count, rule).toBeGreaterThan(1);
    }
  });
});
