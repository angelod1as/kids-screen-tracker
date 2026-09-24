import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  createActivity,
  listActivities,
  setActivityActive,
  updateActivity,
} from "./activities";
import type { ActivityModule, ActivityWorld } from "./activities.rules";
import { ACTIVITY_CASES, makeActivityWorld } from "./activities.rules";
import type { Connection } from "./client";
import { openDatabase } from "./client";
import { migrateDatabase } from "./migrate";
import { approveLog, listPendingLogs } from "./queue";
import { REVIEWED_AT } from "./queue.rules";
import { seedWithTestUsers } from "./test-users";
import { startTimer, stopTimer } from "./timers";

/**
 * The configuration of the activities (#27), against the real module.
 *
 * The table is `activities.rules.ts`, shared with the sabotage matrix. What is
 * here beyond running it is the second half of D15's proof — the source scan —
 * written the same way `config.test.ts` writes it, and for the same reason: a
 * recalculation added by somebody thinking about something else has to survive
 * both a balance assertion and a scan, and only the second cannot be satisfied
 * by accident.
 */

const MODULE: ActivityModule = {
  listActivities,
  createActivity,
  updateActivity,
  setActivityActive,
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

function freshWorld(): ActivityWorld {
  const root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-activities-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);

  const connection: Connection = openDatabase(databasePath);
  seedWithTestUsers(connection);
  roots.push(root);

  return makeActivityWorld(connection);
}

describe("configuring the activities (#27)", () => {
  it.each(ACTIVITY_CASES.map((one, index) => ({ ...one, index })))(
    "$rule — $name",
    (activityCase) => {
      const world = freshWorld();

      try {
        expect(activityCase.run(MODULE, world)).toEqual(activityCase.expected);
      } finally {
        world.connection.sqlite.close();
      }
    },
  );

  it("covers every acceptance criterion of the issue", () => {
    // A table that quietly lost a whole rule still passes every case it kept.
    expect([...new Set(ACTIVITY_CASES.map((one) => one.rule))].sort()).toEqual([
      "a waiting entry is priced by the table it was written under",
      "an activity can be created, edited and switched off",
      "an activity is only ever under a live category",
      "changing the rate does not rewrite the past",
      "every counter the engine reads is checked here",
      "switching an activity off deletes nothing",
      "the list is the one the screen draws",
      "the value is explicit, and it is what the engine reads",
    ]);
  });
});

describe("changing the rate does not rewrite the past (D15)", () => {
  it("never touches a log or a ledger row, by the source", () => {
    const source = stripComments(
      readFileSync(join(import.meta.dirname, "activities.ts"), "utf8"),
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

    // And the scan is looking at real code, not a file it stripped to nothing.
    expect(source).toContain("activities");
    expect(source).toContain("categories");
  });

  it("never reads the category's rate, which D11 keeps out of the calculation", () => {
    // The suggestion is the screen's (`suggestedValue`, in `activity-list.tsx`).
    // A fallback here would be a number nobody typed governing a boy's
    // afternoon, and it would be invisible: the activity would simply pay the
    // category's rate, which is what most of them do anyway.
    const source = stripComments(
      readFileSync(join(import.meta.dirname, "activities.ts"), "utf8"),
    );

    expect(source).not.toContain("baseRate");
  });
});

/**
 * What a Configuration edit must not do to an entry that is already waiting.
 *
 * #26 and #27 make `calc_mode` and `active` editable without a deploy, which is
 * the point of the phase — and it re-opened D33's measured exploit from the
 * other end. The guard in `approveLog` used to run only when an adult *moved*
 * the entry, which was sound for exactly as long as an activity could not
 * change under a pending one.
 *
 * The fix is in `src/db/queue.ts`, where the number is frozen. The case lives
 * here, because this is the module that made it reachable.
 */
describe("a pending entry is not re-priced by an edit made under it", () => {
  /**
   * A filed session whose activity was then forced into a state the CRUD would
   * refuse to create.
   *
   * D37 now closes every route an adult has to these states: the edit is
   * refused while a session is open *and* while an entry waits. That is the
   * point of it — and it means `requireEditableActivity` in `approveLog` no
   * longer has a reachable case of its own. It is kept, and tested here against
   * a state written straight to the column, because it is the thing that
   * catches these if D37 ever has a hole: one guard stops the state being
   * built, the other stops it being frozen, and the second is worth nothing if
   * nothing ever exercises it.
   */
  function fileASessionThenForce(
    world: ActivityWorld,
    patch: Record<string, unknown>,
  ): number {
    const start = new Date("2026-09-13T12:00:00.000Z");
    const stop = new Date("2026-09-13T12:05:00.000Z");

    startTimer(
      world.connection,
      world.kidId,
      world.activityId("Ler livro"),
      start,
    );
    stopTimer(world.connection, world.kidId, null, stop);
    world.forceActivity("Ler livro", patch);

    return world.newestLogId();
  }

  /**
   * A graded activity's session, built the way an adult really reaches it.
   *
   * This one needs no forcing: turning the grade on with nothing running and
   * nothing waiting is a legitimate edit, and the boy's next session then files
   * an entry the engine cannot price, because the stopwatch has no grade to
   * give. It is the one unpriceable state D37 does not prevent, which is why
   * `LogEdits.quality` exists.
   */
  function fileAGradedSession(world: ActivityWorld): number {
    const id = world.activityId("Ler livro");

    updateActivity(world.connection, id, {
      categoryId: world.categoryId("Mente"),
      name: "Ler livro",
      calcMode: "duration",
      value: 2,
      maxSessionMinutes: 120,
      minSessionMinutes: 5,
      qualityGraded: true,
      repeatCooldownDays: 0,
      sortOrder: 1,
    });

    startTimer(
      world.connection,
      world.kidId,
      id,
      new Date("2026-09-13T12:00:00.000Z"),
    );
    stopTimer(
      world.connection,
      world.kidId,
      null,
      new Date("2026-09-13T14:00:00.000Z"),
    );

    return world.newestLogId();
  }

  it("refuses a five-minute session whose activity became `fixed` at 3h", () => {
    const world = freshWorld();

    try {
      const logId = fileASessionThenForce(world, {
        calcMode: "fixed",
        value: 3,
        maxSessionMinutes: null,
      });

      // Measured before the guard was widened: this paid 4,5 h — three fixed
      // hours and the return bonus — for one minute of reading, with the
      // duration ignored, and nobody forged or edited anything.
      expect(() =>
        approveLog(world.connection, logId, world.adminId, {}, REVIEWED_AT),
      ).toThrow(/not measured by duration/);

      // And it is still waiting rather than half-decided: an adult has to move
      // it or refuse it (D19), which is the decision D33 says a person makes.
      expect(world.logRow(logId).status).toBe("pending");
      expect(world.ledgerRows()).toHaveLength(0);
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("refuses one whose activity was switched off under it (D14, D33)", () => {
    const world = freshWorld();

    try {
      const logId = fileASessionThenForce(world, { active: false });

      expect(() =>
        approveLog(world.connection, logId, world.adminId, {}, REVIEWED_AT),
      ).toThrow(/is not active and cannot be chosen/);
      expect(world.logRow(logId).status).toBe("pending");
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("leaves a queue it cannot price as one row with a sentence, not a 500", () => {
    // Measured before `preview` was nullable: this returned HTTP 500 for
    // `/admin/fila`, for both boys at once, behind the generic error screen —
    // with the home page still counting one pendency and no path in the app to
    // see it, explain it or undo it. The one screen that can refuse it (D19)
    // was the screen that had stopped existing.
    const world = freshWorld();

    try {
      const logId = fileAGradedSession(world);
      const rows = listPendingLogs(world.connection);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(logId);
      expect(rows[0]?.preview).toBeNull();
      expect(rows[0]?.unpriceable).toMatch(/needs quality/);

      // And the endpoint still refuses loudly: the tolerance is the list's, not
      // the approval's (D33).
      expect(() =>
        approveLog(world.connection, logId, world.adminId, {}, REVIEWED_AT),
      ).toThrow(/needs quality/);

      // The bound: an ordinary entry is still priced.
      const plain = freshWorld();

      try {
        plain.addPending({ activity: "Ler livro", durationMinutes: 60 });

        expect(listPendingLogs(plain.connection)[0]?.preview?.hours).toBe(1.5);
      } finally {
        plain.connection.sqlite.close();
      }
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("refuses the edit itself once the entry is in the queue (D37)", () => {
    // The other half, and the one an adult actually meets: with the entry
    // already filed, the Configuration screen refuses and names it.
    const world = freshWorld();

    try {
      const logId = world.addPending({
        activity: "Ler livro",
        durationMinutes: 1,
      });

      expect(() =>
        updateActivity(world.connection, world.activityId("Ler livro"), {
          categoryId: world.categoryId("Mente"),
          name: "Ler livro",
          calcMode: "duration",
          value: 180,
          maxSessionMinutes: 120,
          minSessionMinutes: 5,
          qualityGraded: false,
          repeatCooldownDays: 0,
          sortOrder: 1,
        }),
      ).toThrow(new RegExp(`a entrada ${logId} \\(Ler livro`));
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("lets the floor move with an entry in the queue, and leaves the entry as it was (D37, D44)", () => {
    // The floor decides whether a session is filed, never what a filed one is
    // worth, so it is not among the fields D37 refuses.
    const world = freshWorld();

    try {
      const id = world.activityId("Ler livro");

      startTimer(
        world.connection,
        world.kidId,
        id,
        new Date("2026-09-13T12:00:00.000Z"),
      );
      stopTimer(
        world.connection,
        world.kidId,
        null,
        new Date("2026-09-13T13:00:00.000Z"),
      );
      const logId = world.newestLogId();

      updateActivity(world.connection, id, {
        categoryId: world.categoryId("Mente"),
        name: "Ler livro",
        calcMode: "duration",
        value: 1.5,
        maxSessionMinutes: 120,
        minSessionMinutes: 90,
        qualityGraded: false,
        repeatCooldownDays: 0,
        sortOrder: 1,
      });

      expect(world.logRow(logId).status).toBe("pending");
      expect(
        approveLog(world.connection, logId, world.adminId, {}, REVIEWED_AT)
          .hours,
      ).toBe(1.5);
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("refuses a floor above the limit in the database too (D44)", () => {
    const world = freshWorld();

    try {
      expect(() =>
        world.connection.sqlite
          .prepare(
            "update activities set min_session_minutes = 121 where name = 'Ler livro'",
          )
          .run(),
      ).toThrow(/activities_min_under_max_session_check/);
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("still approves one nothing was done to", () => {
    // The bound that makes the two cases above mean something: the guard is not
    // simply refusing every approval.
    const world = freshWorld();

    try {
      const logId = world.addPending({
        activity: "Ler livro",
        durationMinutes: 60,
      });

      expect(
        approveLog(world.connection, logId, world.adminId, {}, REVIEWED_AT)
          .hours,
      ).toBe(1.5);
    } finally {
      world.connection.sqlite.close();
    }
  });
});
