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
import {
  auditDisabledActivities,
  deleteNeverUsedActivities,
} from "./activity-audit";
import type { Connection } from "./client";
import { openDatabase } from "./client";
import { migrateDatabase } from "./migrate";
import { approveLog, listPendingLogs } from "./queue";
import { REVIEWED_AT } from "./queue.rules";
import { seedWithTestUsers } from "./test-users";
import { startTimer, stopTimer } from "./timers";

/** #27 against the real module, plus the source scan half of D15's proof. */

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
    // A table that lost a whole rule still passes every case it kept.
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
    expect(source).toContain("activities");
    expect(source).toContain("categories");
  });

  it("never reads the category's rate, which D11 keeps out of the calculation", () => {
    // D11: the suggestion is the screen's (`suggestedValue`); a fallback would be invisible.
    const source = stripComments(
      readFileSync(join(import.meta.dirname, "activities.ts"), "utf8"),
    );

    expect(source).not.toContain("baseRate");
  });
});

/** D33's guard in `approveLog`, now asked of every approval, not only a move. */
describe("a pending entry is not re-priced by an edit made under it", () => {
  /** A state written straight to the column, so the backstop behind D37 is exercised. */
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

  /** A legitimate edit leaves an unpriceable entry: why `LogEdits.quality` exists (D37). */
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

      // Unguarded, one minute of reading paid 4,5 h.
      expect(() =>
        approveLog(world.connection, logId, world.adminId, {}, REVIEWED_AT),
      ).toThrow(/not measured by duration/);

      // Still waiting: an adult moves or refuses it (D19, D33).
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
    // Unguarded, `/admin/fila` returned HTTP 500 for both boys.
    const world = freshWorld();

    try {
      const logId = fileAGradedSession(world);
      const rows = listPendingLogs(world.connection);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(logId);
      expect(rows[0]?.preview).toBeNull();
      expect(rows[0]?.unpriceable).toEqual(["grade"]);

      // The endpoint still refuses (D33); the tolerance is the list's.
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
    // With the entry filed, the Configuration screen refuses and names it.
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
    // The floor decides filing, not price, so D37 does not lock it.
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
    // The guard does not simply refuse every approval.
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

describe("an activity's description (#40)", () => {
  function podcast(world: ActivityWorld, description?: string | null) {
    return {
      categoryId: world.categoryId("Mente"),
      name: "Podcast",
      description,
      calcMode: "duration" as const,
      value: 1.5,
      maxSessionMinutes: null,
      minSessionMinutes: 5,
      qualityGraded: false,
      repeatCooldownDays: 0,
      sortOrder: 9,
    };
  }

  function descriptionOf(world: ActivityWorld, id: number) {
    return listActivities(world.connection, world.categoryId("Mente")).find(
      (row) => row.id === id,
    )?.description;
  }

  it("is stored trimmed, and read back by the Configuration list", () => {
    const world = freshWorld();

    try {
      const id = createActivity(
        world.connection,
        podcast(world, "  Só episódio inteiro.  "),
      );

      expect(descriptionOf(world, id)).toBe("Só episódio inteiro.");
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("is null when missing or blank", () => {
    const world = freshWorld();

    try {
      const missing = createActivity(world.connection, podcast(world));
      const blank = createActivity(world.connection, podcast(world, "   "));

      expect(descriptionOf(world, missing)).toBeNull();
      expect(descriptionOf(world, blank)).toBeNull();
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("takes 200 characters and refuses 201", () => {
    const world = freshWorld();

    try {
      const id = createActivity(
        world.connection,
        podcast(world, "x".repeat(200)),
      );

      expect(descriptionOf(world, id)).toHaveLength(200);
      expect(() =>
        updateActivity(world.connection, id, podcast(world, "x".repeat(201))),
      ).toThrow(
        "an activity description is at most 200 characters, received 201",
      );
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("can be written, and cleared, with an entry waiting: it prices nothing (D37)", () => {
    const world = freshWorld();

    try {
      const id = world.activityId("Ler livro");
      const book = {
        categoryId: world.categoryId("Mente"),
        name: "Ler livro",
        calcMode: "duration" as const,
        value: 1.5,
        maxSessionMinutes: 120,
        minSessionMinutes: 5,
        qualityGraded: false,
        repeatCooldownDays: 0,
        sortOrder: 1,
      };

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

      updateActivity(world.connection, id, {
        ...book,
        description: "Livro, não apostila.",
      });
      expect(descriptionOf(world, id)).toBe("Livro, não apostila.");

      updateActivity(world.connection, id, { ...book, description: "" });
      expect(descriptionOf(world, id)).toBeNull();
      expect(world.logRow(world.newestLogId()).status).toBe("pending");
    } finally {
      world.connection.sqlite.close();
    }
  });
});

describe("an activity's observation prompt (#85)", () => {
  function podcast(world: ActivityWorld, observationPrompt?: string | null) {
    return {
      categoryId: world.categoryId("Mente"),
      name: "Podcast",
      noteRequired: true,
      observationPrompt,
      calcMode: "duration" as const,
      value: 1.5,
      maxSessionMinutes: null,
      minSessionMinutes: 5,
      qualityGraded: false,
      repeatCooldownDays: 0,
      sortOrder: 9,
    };
  }

  function promptOf(world: ActivityWorld, id: number) {
    return listActivities(world.connection, world.categoryId("Mente")).find(
      (row) => row.id === id,
    )?.observationPrompt;
  }

  it("is stored trimmed, and read back by the Configuration list", () => {
    const world = freshWorld();

    try {
      const id = createActivity(
        world.connection,
        podcast(world, "  O que você ouviu?  "),
      );

      expect(promptOf(world, id)).toBe("O que você ouviu?");
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("is null when missing or blank", () => {
    const world = freshWorld();

    try {
      const missing = createActivity(world.connection, podcast(world));
      const blank = createActivity(world.connection, podcast(world, "   "));

      expect(promptOf(world, missing)).toBeNull();
      expect(promptOf(world, blank)).toBeNull();
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("takes 200 characters and refuses 201", () => {
    const world = freshWorld();

    try {
      const id = createActivity(
        world.connection,
        podcast(world, "x".repeat(200)),
      );

      expect(promptOf(world, id)).toHaveLength(200);
      expect(() =>
        updateActivity(world.connection, id, podcast(world, "x".repeat(201))),
      ).toThrow(
        "an observation prompt is at most 200 characters, received 201",
      );
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("can be written, and cleared, with an entry waiting: it prices nothing (D37)", () => {
    const world = freshWorld();

    try {
      const id = world.activityId("Ler livro");
      const book = {
        categoryId: world.categoryId("Mente"),
        name: "Ler livro",
        calcMode: "duration" as const,
        value: 1.5,
        maxSessionMinutes: 120,
        minSessionMinutes: 5,
        qualityGraded: false,
        repeatCooldownDays: 0,
        sortOrder: 1,
      };

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

      updateActivity(world.connection, id, {
        ...book,
        observationPrompt: "Qual capítulo?",
      });
      expect(promptOf(world, id)).toBe("Qual capítulo?");

      updateActivity(world.connection, id, { ...book, observationPrompt: "" });
      expect(promptOf(world, id)).toBeNull();
      expect(world.logRow(world.newestLogId()).status).toBe("pending");
    } finally {
      world.connection.sqlite.close();
    }
  });
});

describe("auditing and deleting never-used disabled activities (#83)", () => {
  function fileALog(world: ActivityWorld, name: string): void {
    startTimer(
      world.connection,
      world.kidId,
      world.activityId(name),
      new Date("2026-09-13T12:00:00.000Z"),
    );
    stopTimer(
      world.connection,
      world.kidId,
      null,
      new Date("2026-09-13T12:05:00.000Z"),
    );
  }

  it("counts the logs and timers pointing at each disabled activity", () => {
    const world = freshWorld();

    try {
      fileALog(world, "Ler livro");
      world.startSession("Bicicleta");
      // forceActivity: a raw switch-off, so D37's waiting guard does not block it.
      world.forceActivity("Ler livro", { active: false });
      world.forceActivity("Bicicleta", { active: false });

      const byName = new Map(
        auditDisabledActivities(world.connection).map((row) => [row.name, row]),
      );

      // A stopped session keeps its timer row beside the log it produced.
      expect(byName.get("Ler livro")).toMatchObject({
        logCount: 1,
        timerCount: 1,
      });
      expect(byName.get("Bicicleta")).toMatchObject({
        logCount: 0,
        timerCount: 1,
      });
      expect(byName.has("Academia")).toBe(false);
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("never deletes a disabled activity that has a log (D14)", () => {
    const world = freshWorld();

    try {
      fileALog(world, "Ler livro");
      world.forceActivity("Ler livro", { active: false });

      const removed = deleteNeverUsedActivities(world.connection);

      expect(removed.map((row) => row.name)).not.toContain("Ler livro");
      expect(
        auditDisabledActivities(world.connection).map((row) => row.name),
      ).toContain("Ler livro");
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("never deletes a disabled activity that has an open timer (FK safety)", () => {
    const world = freshWorld();

    try {
      world.startSession("Bicicleta");
      world.forceActivity("Bicicleta", { active: false });

      const removed = deleteNeverUsedActivities(world.connection);

      expect(removed.map((row) => row.name)).not.toContain("Bicicleta");
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("deletes a disabled activity that was never logged or timed", () => {
    const world = freshWorld();

    try {
      world.forceActivity("Bicicleta", { active: false });

      const removed = deleteNeverUsedActivities(world.connection);

      expect(removed.map((row) => row.name)).toContain("Bicicleta");
      expect(
        auditDisabledActivities(world.connection).map((row) => row.name),
      ).not.toContain("Bicicleta");
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("leaves an active never-used activity untouched", () => {
    const world = freshWorld();

    try {
      const before = world.activityId("Bicicleta");

      deleteNeverUsedActivities(world.connection);

      expect(world.activityId("Bicicleta")).toBe(before);
    } finally {
      world.connection.sqlite.close();
    }
  });
});
