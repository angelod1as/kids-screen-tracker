import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { updateActivity } from "../../db/activities";
import type { Connection } from "../../db/client";
import { openDatabase } from "../../db/client";
import { migrateDatabase } from "../../db/migrate";
import { approveLog, listPendingLogs, rejectLog } from "../../db/queue";
import { requestLog } from "../../db/requests";
import { activities, activityLogs, categories } from "../../db/schema";
import { seedWithTestUsers } from "../../db/test-users";
import { startTimer, stopTimer } from "../../db/timers";
import { fetchHistoryAction } from "./history";
import { fetchTimerScreenAction, requestLogAction } from "./timer";

/**
 * The boy's untimed request (D49, #17) and the presumed duration (#18), end to
 * end. Only the cookie is replaced; the schema, the queue and the engine run.
 */

const mocked = vi.hoisted(() => ({
  username: null as string | null,
  connection: null as unknown,
}));

vi.mock("../../auth/session", () => ({
  SESSION_COOKIE_NAME: "kst_session",
  readSessionUsername: async () => mocked.username,
  startSession: async () => undefined,
  endSession: async () => undefined,
}));

vi.mock("../../db", () => ({
  getConnection: () => mocked.connection,
  getDb: () => (mocked.connection as { db: unknown }).db,
}));

const ADMIN1 = 1;
const KID1 = 3;
const KID2 = 4;

const READING = 5;
const COURSE = 8;
const WORSHIP = 20;
const HOMEWORK = 23;
const FREE = 32;

const NOW = new Date("2026-09-24T15:00:00-03:00");
const TODAY = "2026-09-24";

const roots: string[] = [];
const opened: Connection[] = [];
let connection: Connection;

function freshConnection(): Connection {
  const root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-request-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);

  const opening = openDatabase(databasePath);
  seedWithTestUsers(opening);

  roots.push(root);
  opened.push(opening);

  return opening;
}

function row(logId: number) {
  const found = connection.db
    .select()
    .from(activityLogs)
    .where(eq(activityLogs.id, logId))
    .get();

  if (found === undefined) throw new Error(`no log ${logId}`);

  return found;
}

function logCount(): number {
  return connection.db.select().from(activityLogs).all().length;
}

beforeEach(() => {
  connection = freshConnection();
  mocked.connection = connection;
  mocked.username = "kid1";
});

afterEach(() => {
  for (const opening of opened.splice(0)) {
    if (opening.sqlite.open) opening.sqlite.close();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("a boy's request (D49)", () => {
  it("is born pending, as his own, in the same queue, marked as a request", async () => {
    const screen = await requestLogAction(KID1, {
      activityId: WORSHIP,
      occurredOn: TODAY,
      note: "culto da noite",
    });

    expect(screen.requested).toEqual({
      activityName: "Igreja, culto",
      occurredOn: TODAY,
    });
    expect(screen.pending.map((item) => item.activityName)).toEqual([
      "Igreja, culto",
    ]);

    const [entry] = listPendingLogs(connection);

    expect(entry).toMatchObject({
      userId: KID1,
      activityId: WORSHIP,
      source: "request",
      durationMinutes: null,
      note: "culto da noite",
    });
    expect(entry?.preview?.hours).toBe(1);
    expect(row(entry?.id ?? 0)).toMatchObject({
      status: "pending",
      createdBy: KID1,
      computedHours: null,
    });
  });

  it("offers every live activity, duration included, and says how long a course is presumed", async () => {
    const screen = await fetchTimerScreenAction(KID1);

    expect(screen.requestable.map((item) => item.id)).toContain(READING);
    expect(screen.requestable.map((item) => item.id)).toContain(FREE);
    expect(
      screen.requestable.find((item) => item.id === COURSE)?.presumedMinutes,
    ).toBe(60);
    expect(
      screen.requestable.find((item) => item.id === READING)?.presumedMinutes,
    ).toBeNull();
  });

  it("refuses a request in his brother's name, and writes nothing", async () => {
    await expect(
      requestLogAction(KID2, { activityId: WORSHIP, occurredOn: TODAY }),
    ).rejects.toThrow();

    expect(logCount()).toBe(0);
  });

  it("refuses an activity that is switched off, even one the picker never showed", async () => {
    connection.db
      .update(activities)
      .set({ active: false })
      .where(eq(activities.id, WORSHIP))
      .run();

    await expect(
      requestLogAction(KID1, { activityId: WORSHIP, occurredOn: TODAY }),
    ).rejects.toThrow(/not active/);
    expect(logCount()).toBe(0);
  });

  it("refuses an activity under a category that is switched off", async () => {
    connection.db
      .update(categories)
      .set({ active: false })
      .where(eq(categories.id, 4))
      .run();

    await expect(
      requestLogAction(KID1, { activityId: WORSHIP, occurredOn: TODAY }),
    ).rejects.toThrow(/not active/);
    expect(logCount()).toBe(0);
  });

  it("refuses an activity that does not exist", async () => {
    await expect(
      requestLogAction(KID1, { activityId: 9999, occurredOn: TODAY }),
    ).rejects.toThrow(/no activity 9999/);
  });

  it("refuses a malformed day, and a duration that is not whole minutes", async () => {
    await expect(
      requestLogAction(KID1, { activityId: WORSHIP, occurredOn: "2026-02-30" }),
    ).rejects.toThrow(/real day/);
    await expect(
      requestLogAction(KID1, {
        activityId: READING,
        occurredOn: TODAY,
        durationMinutes: 1.5,
      }),
    ).rejects.toThrow(/whole number of minutes/);
    await expect(
      requestLogAction(KID1, { activityId: READING, occurredOn: TODAY }),
    ).rejects.toThrow(/whole number of minutes/);
    expect(logCount()).toBe(0);
  });

  it("takes any day, back or forward: the owner's call", () => {
    requestLog(
      connection,
      KID1,
      { activityId: WORSHIP, occurredOn: "2026-01-04" },
      NOW,
    );
    requestLog(
      connection,
      KID1,
      { activityId: WORSHIP, occurredOn: "2026-12-25" },
      NOW,
    );

    expect(
      listPendingLogs(connection).map((entry) => entry.occurredOn),
    ).toEqual(["2026-01-04", "2026-12-25"]);
  });

  it("carries the minutes the boy typed for a duration activity", () => {
    const { logId } = requestLog(
      connection,
      KID1,
      { activityId: READING, occurredOn: TODAY, durationMinutes: 45 },
      NOW,
    );

    expect(row(logId)).toMatchObject({
      durationMinutes: 45,
      durationSeconds: 45 * 60,
      source: "request",
    });
  });

  it("drops minutes sent for an activity that is not measured by duration", () => {
    const { logId } = requestLog(
      connection,
      KID1,
      { activityId: WORSHIP, occurredOn: TODAY, durationMinutes: 600 },
      NOW,
    );

    expect(row(logId).durationMinutes).toBeNull();
  });

  it("puts no limit on how many: twenty requests are twenty entries, decided in D32's order", () => {
    for (let index = 0; index < 20; index += 1) {
      requestLog(
        connection,
        KID1,
        { activityId: READING, occurredOn: "2026-09-20", durationMinutes: 30 },
        NOW,
      );
    }

    const later = startTimer(connection, KID1, READING, NOW);
    expect(later.proposed).toBeNull();
    const stopped = stopTimer(
      connection,
      KID1,
      null,
      new Date(NOW.getTime() + 60 * 60 * 1000),
    );

    const entries = listPendingLogs(connection);
    const timed = entries.find((entry) => entry.source === "timer");

    expect(entries).toHaveLength(21);
    expect(stopped.proposed).not.toBeNull();
    // The first of them is Mente's debut (D47), so the later session waits
    // too: twenty decisions stand in front of it.
    expect(timed?.blockedBy?.id).toBe(entries[0]?.id);
    expect(entries.filter((entry) => entry.blockedBy !== null)).toHaveLength(
      20,
    );

    for (const entry of entries.filter((item) => item.source === "request")) {
      rejectLog(connection, entry.id, ADMIN1, null, NOW);
    }

    expect(listPendingLogs(connection)[0]?.blockedBy).toBeNull();
  });

  it("shows a refusal with its reason in his history, as the stopwatch's does", async () => {
    const { logId } = requestLog(
      connection,
      KID1,
      { activityId: WORSHIP, occurredOn: TODAY },
      NOW,
    );

    rejectLog(connection, logId, ADMIN1, "não teve culto hoje", NOW);

    const history = await fetchHistoryAction(KID1, 10);

    expect(history).toEqual([
      expect.objectContaining({
        kind: "rejected",
        label: "Igreja, culto",
        reason: "não teve culto hoje",
      }),
    ]);
  });

  it("grades a delivery and values a free activity at approval, never before", () => {
    const homework = requestLog(
      connection,
      KID1,
      { activityId: HOMEWORK, occurredOn: TODAY },
      NOW,
    );
    const free = requestLog(
      connection,
      KID1,
      { activityId: FREE, occurredOn: TODAY },
      NOW,
    );

    expect(listPendingLogs(connection).map((entry) => entry.preview)).toEqual([
      null,
      null,
    ]);

    expect(
      approveLog(connection, homework.logId, ADMIN1, { quality: 1 }, NOW).hours,
    ).toBe(1);
    expect(
      approveLog(connection, free.logId, ADMIN1, { freeValue: 2.5 }, NOW).hours,
    ).toBe(2.5);
    expect(row(free.logId).freeValue).toBe(2.5);
  });
});

describe("the presumed duration (#18)", () => {
  it("files a course at an hour when the boy sends no minutes", () => {
    const { logId } = requestLog(
      connection,
      KID1,
      { activityId: COURSE, occurredOn: TODAY },
      NOW,
    );

    expect(row(logId).durationMinutes).toBe(60);
    expect(listPendingLogs(connection)[0]?.preview?.hours).toBe(1.5);
    expect(approveLog(connection, logId, ADMIN1, {}, NOW).hours).toBe(1.5);
  });

  it("reprices when the adult corrects it upwards", () => {
    const { logId } = requestLog(
      connection,
      KID1,
      { activityId: COURSE, occurredOn: TODAY },
      NOW,
    );

    // Mente halves every hour: 1,5 for the first, 0,75/h for the next half.
    expect(
      approveLog(connection, logId, ADMIN1, { durationMinutes: 90 }, NOW).hours,
    ).toBe(1.88);
    expect(row(logId)).toMatchObject({
      durationMinutes: 90,
      durationSeconds: 90 * 60,
      computedHours: 1.88,
    });
  });

  it("reprices when the adult corrects it downwards", () => {
    const { logId } = requestLog(
      connection,
      KID1,
      { activityId: COURSE, occurredOn: TODAY },
      NOW,
    );

    expect(
      approveLog(connection, logId, ADMIN1, { durationMinutes: 30 }, NOW).hours,
    ).toBe(0.75);
  });

  it("does not move a request already waiting when the presumed duration changes (D37)", () => {
    const { logId } = requestLog(
      connection,
      KID1,
      { activityId: COURSE, occurredOn: TODAY },
      NOW,
    );

    updateActivity(connection, COURSE, {
      categoryId: 2,
      name: "Curso ou aula extra",
      calcMode: "duration",
      value: 1.5,
      maxSessionMinutes: 120,
      minSessionMinutes: 5,
      presumedMinutes: 120,
      qualityGraded: false,
      repeatCooldownDays: 0,
      sortOrder: 4,
    });

    expect(
      connection.db
        .select({ presumed: activities.presumedMinutes })
        .from(activities)
        .where(eq(activities.id, COURSE))
        .get()?.presumed,
    ).toBe(120);
    expect(row(logId).durationMinutes).toBe(60);
    expect(approveLog(connection, logId, ADMIN1, {}, NOW).hours).toBe(1.5);
  });
});

describe("approving a request on the queue screen (D49)", () => {
  const untimed = {
    blockedBy: null,
    qualityGraded: false,
    quality: null,
    durationMinutes: null,
  };

  it("approves an untimed fixed request with no minutes typed", async () => {
    const { canApprove } = await import("../(app)/admin/fila/queue-list");

    expect(canApprove({ ...untimed, calcMode: "fixed" }, false, "")).toBe(true);
    expect(canApprove({ ...untimed, calcMode: "fixed" }, true, "")).toBe(true);
  });

  it("waits for the adult's value on a free request", async () => {
    const { canApprove } = await import("../(app)/admin/fila/queue-list");
    const free = { ...untimed, calcMode: "free" as const };

    expect(canApprove(free, false, "")).toBe(false);
    expect(canApprove(free, true, "", null, "")).toBe(false);
    expect(canApprove(free, true, "", null, "2,5")).toBe(true);
  });
});
