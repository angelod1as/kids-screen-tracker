import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { parseTypedTime, timeFromHours } from "../ui/hours";
import type { ActivityInput, ActivityRow } from "./activities";
import { listActivities, updateActivity } from "./activities";
import type { CategoryRow } from "./categories";
import { listCategories, updateCategory } from "./categories";
import type { Connection } from "./client";
import { openDatabase } from "./client";
import type { ConfigWorld } from "./config.rules";
import { makeConfigWorld } from "./config.rules";
import { hoursFromTime } from "./input";
import { migrateDatabase } from "./migrate";
import { approveLog } from "./queue";
import { REVIEWED_AT } from "./queue.rules";
import { activities, categories } from "./schema";
import { seedWithTestUsers } from "./test-users";

/** #55: a save that never touched the time field gives back what it read. */

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function freshWorld(): ConfigWorld {
  const root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-roundtrip-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);

  const connection: Connection = openDatabase(databasePath);
  seedWithTestUsers(connection);
  roots.push(root);

  return makeConfigWorld(connection);
}

/** The field as the screen fills it, back through the endpoint's conversion. */
function untouched(hours: number): number {
  const typed = parseTypedTime(timeFromHours(hours));

  if (typed === null) throw new Error(`${hours} does not fill the field`);

  return hoursFromTime(typed, "a field nobody touched");
}

function activityRow(world: ConfigWorld, name: string): ActivityRow {
  const id = world.activityId(name);
  const categoryId = world.connection.db
    .select({ categoryId: activities.categoryId })
    .from(activities)
    .where(eq(activities.id, id))
    .get()?.categoryId;
  const row = listActivities(world.connection, categoryId ?? 0).find(
    (one) => one.id === id,
  );

  if (row === undefined) throw new Error(`no activity named ${name}`);

  return row;
}

function inputOf(
  row: ActivityRow,
  changes: Partial<ActivityInput> = {},
): ActivityInput {
  return {
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    noteRequired: row.noteRequired,
    calcMode: row.calcMode,
    value: row.value === null ? null : untouched(row.value),
    maxSessionMinutes: row.maxSessionMinutes,
    minSessionMinutes: row.minSessionMinutes,
    presumedMinutes: row.presumedMinutes,
    qualityGraded: row.qualityGraded,
    repeatCooldownDays: row.repeatCooldownDays,
    sortOrder: row.sortOrder,
    ...changes,
  };
}

function categoryRow(world: ConfigWorld, name: string): CategoryRow {
  const row = listCategories(world.connection).find((one) => one.name === name);

  if (row === undefined) throw new Error(`no category named ${name}`);

  return row;
}

const CENTS = Array.from({ length: 1000 }, (_, index) => (index + 1) / 100);

const OUT = "Sair com os amigos";

describe("saving without touching the time field (#55, D9)", () => {
  it("keeps every hundredth from 0,01 to 10,00 of a `fixed` value", () => {
    const world = freshWorld();

    try {
      const id = world.activityId(OUT);
      const moved: number[] = [];

      for (const stored of CENTS) {
        world.connection.db
          .update(activities)
          .set({ value: stored })
          .where(eq(activities.id, id))
          .run();

        updateActivity(world.connection, id, inputOf(activityRow(world, OUT)));

        if (activityRow(world, OUT).value !== stored) moved.push(stored);
      }

      expect(moved).toEqual([]);
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("keeps every hundredth from 0,25 to 10,00 of a decay step (D35's floor)", () => {
    const world = freshWorld();

    try {
      const id = world.categoryId("Mente");
      const moved: number[] = [];

      for (const stored of CENTS.filter((one) => one >= 0.25)) {
        world.connection.db
          .update(categories)
          .set({ decayStepHours: stored })
          .where(eq(categories.id, id))
          .run();

        const row = categoryRow(world, "Mente");

        updateCategory(world.connection, id, {
          name: row.name,
          baseRate: row.baseRate,
          decayStepHours: untouched(stored),
          returnBonusPct: row.returnBonusPct,
          returnBonusAfterDays: row.returnBonusAfterDays,
          sortOrder: row.sortOrder,
        });

        if (categoryRow(world, "Mente").decayStepHours !== stored) {
          moved.push(stored);
        }
      }

      expect(moved).toEqual([]);
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("still stores a newly typed time on the minute grid", () => {
    const world = freshWorld();

    try {
      const id = world.activityId(OUT);

      world.connection.db
        .update(activities)
        .set({ value: 0.66 })
        .where(eq(activities.id, id))
        .run();

      updateActivity(
        world.connection,
        id,
        inputOf(activityRow(world, OUT), {
          value: hoursFromTime({ hours: 0, minutes: 41 }, "a new value"),
        }),
      );

      expect(activityRow(world, OUT).value).toBe(0.68);
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("keeps it across a switch between `fixed` and `delivery`, both hours", () => {
    const world = freshWorld();

    try {
      const id = world.activityId(OUT);

      world.connection.db
        .update(activities)
        .set({ value: 0.66 })
        .where(eq(activities.id, id))
        .run();

      updateActivity(
        world.connection,
        id,
        inputOf(activityRow(world, OUT), { calcMode: "delivery" }),
      );

      const saved = activityRow(world, OUT);

      expect(saved.calcMode).toBe("delivery");
      expect(saved.value).toBe(0.66);
    } finally {
      world.connection.sqlite.close();
    }
  });
});

describe("an off-grid value with an entry waiting (#55, D37, D55)", () => {
  it("lets the name, the description and the note switch change, and prices the entry as before", () => {
    const world = freshWorld();

    try {
      const id = world.activityId(OUT);

      world.connection.db
        .update(activities)
        .set({ value: 0.66 })
        .where(eq(activities.id, id))
        .run();

      const logId = world.addPending({ activity: OUT, durationMinutes: null });
      const row = activityRow(world, OUT);

      updateActivity(
        world.connection,
        id,
        inputOf(row, {
          name: "Sair com a turma",
          description: "Praça ou cinema.",
          noteRequired: true,
        }),
      );

      const saved = activityRow(world, "Sair com a turma");

      expect(saved.value).toBe(0.66);
      expect(saved.noteRequired).toBe(true);
      expect(
        approveLog(world.connection, logId, world.adminId, {}, REVIEWED_AT)
          .hours,
      ).toBe(0.66);
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("still refuses a value actually retyped under the entry", () => {
    const world = freshWorld();

    try {
      const id = world.activityId(OUT);

      world.connection.db
        .update(activities)
        .set({ value: 0.66 })
        .where(eq(activities.id, id))
        .run();

      const logId = world.addPending({ activity: OUT, durationMinutes: null });

      expect(() =>
        updateActivity(
          world.connection,
          id,
          inputOf(activityRow(world, OUT), {
            value: hoursFromTime({ hours: 0, minutes: 41 }, "a new value"),
          }),
        ),
      ).toThrow(new RegExp(`a entrada ${logId} \\(${OUT}`));
    } finally {
      world.connection.sqlite.close();
    }
  });

  it("lets a category be renamed with an off-grid step and an entry waiting", () => {
    const world = freshWorld();

    try {
      const id = world.categoryId("Mente");

      world.connection.db
        .update(categories)
        .set({ decayStepHours: 1.01 })
        .where(eq(categories.id, id))
        .run();

      world.addPending({ activity: "Ler livro" });

      const row = categoryRow(world, "Mente");

      updateCategory(world.connection, id, {
        name: "Cabeça",
        baseRate: row.baseRate,
        decayStepHours: untouched(1.01),
        returnBonusPct: row.returnBonusPct,
        returnBonusAfterDays: row.returnBonusAfterDays,
        sortOrder: row.sortOrder,
      });

      expect(categoryRow(world, "Cabeça").decayStepHours).toBe(1.01);
    } finally {
      world.connection.sqlite.close();
    }
  });
});
