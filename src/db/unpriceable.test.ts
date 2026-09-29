import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { ActivityWorld } from "./activities.rules";
import { makeActivityWorld } from "./activities.rules";
import { openDatabase } from "./client";
import { migrateDatabase } from "./migrate";
import { approveLog, listPendingLogs } from "./queue";
import { REVIEWED_AT } from "./queue.rules";
import { requestLog } from "./requests";
import { seedWithTestUsers } from "./test-users";

/** #37: every way an entry reaches the queue unpriceable, and what it says is missing. */

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function freshWorld(): ActivityWorld {
  const root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-unpriceable-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);

  const connection = openDatabase(databasePath);
  seedWithTestUsers(connection);
  roots.push(root);

  return makeActivityWorld(connection);
}

function request(
  world: ActivityWorld,
  activity: string,
  durationMinutes?: number,
): number {
  return requestLog(
    world.connection,
    world.kidId,
    {
      activityId: world.activityId(activity),
      occurredOn: "2026-09-13",
      durationMinutes,
    },
    new Date("2026-09-13T15:00:00.000Z"),
  ).logId;
}

function entryOf(world: ActivityWorld, logId: number) {
  return listPendingLogs(world.connection).find((one) => one.id === logId);
}

describe("an entry the rule cannot price says what is missing (#37)", () => {
  it("a `free` request is missing its value, and the value prices it (D49)", () => {
    const world = freshWorld();

    try {
      const logId = request(world, "Atividade avulsa");

      expect(entryOf(world, logId)?.preview).toBeNull();
      expect(entryOf(world, logId)?.unpriceable).toEqual(["value"]);

      expect(
        approveLog(
          world.connection,
          logId,
          world.adminId,
          { freeValue: 2.5 },
          REVIEWED_AT,
        ).hours,
      ).toBe(2.5);
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("a graded request is missing its grade, and the grade prices it (D37)", () => {
    const world = freshWorld();

    try {
      const logId = request(world, "Lição de casa do dia");

      expect(entryOf(world, logId)?.unpriceable).toEqual(["grade"]);

      expect(
        approveLog(
          world.connection,
          logId,
          world.adminId,
          { quality: 0.5 },
          REVIEWED_AT,
        ).hours,
      ).toBe(0.5);
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("a graded `free` request is missing both", () => {
    const world = freshWorld();

    try {
      world.forceActivity("Atividade avulsa", { qualityGraded: true });
      const logId = request(world, "Atividade avulsa");

      expect(entryOf(world, logId)?.unpriceable).toEqual(["value", "grade"]);
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("an entry without minutes under a `duration` activity is missing its duration", () => {
    const world = freshWorld();

    try {
      const logId = request(world, "Trabalho entregue antes do prazo");
      // D37 refuses this edit on the screen; the column is written directly.
      world.forceActivity("Trabalho entregue antes do prazo", {
        calcMode: "duration",
      });

      expect(entryOf(world, logId)?.unpriceable).toEqual(["duration"]);
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("any other cause names nothing, and the engine's words stay off the entry", () => {
    const world = freshWorld();

    try {
      world.forceActivity("Ler livro", { value: 1_000_000 });
      const logId = request(world, "Ler livro", 1_000_000);
      const entry = entryOf(world, logId);

      expect(entry?.preview).toBeNull();
      expect(entry?.unpriceable).toEqual([]);
      expect(JSON.stringify(entry)).not.toContain("máximo");
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("a priceable entry has nothing missing", () => {
    const world = freshWorld();

    try {
      const logId = request(world, "Ler livro", 60);

      expect(entryOf(world, logId)?.preview?.hours).toBe(1.5);
      expect(entryOf(world, logId)?.unpriceable).toBeNull();
    } finally {
      world.connection.sqlite.close();
    }
  });
});
