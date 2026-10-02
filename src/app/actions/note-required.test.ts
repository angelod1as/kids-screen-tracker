import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listActivities, updateActivity } from "../../db/activities";
import { launchEntry } from "../../db/admin";
import type { Connection } from "../../db/client";
import { openDatabase } from "../../db/client";
import { migrateDatabase } from "../../db/migrate";
import { listPendingLogs } from "../../db/queue";
import { requestLog } from "../../db/requests";
import { activities, activityLogs, timers } from "../../db/schema";
import { seedWithTestUsers } from "../../db/test-users";
import {
  fetchTimerScreenAction,
  requestLogAction,
  startTimerAction,
  stopTimerAction,
} from "./timer";

/**
 * #44, called as a forged POST would call it: no screen in the way, only the
 * cookie and the clock replaced.
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

/** `duration`, limit 120 min. */
const READING = 5;
/** `fixed`, Convívio. */
const FRIENDS = 15;
const WORSHIP = 20;

const MINUTE = 60 * 1000;
const START = new Date("2026-09-01T17:00:00.000Z");
const TODAY = "2026-09-01";

let root: string;
let connection: Connection;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-note-required-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);
  connection = openDatabase(databasePath);
  seedWithTestUsers(connection);

  mocked.connection = connection;
  mocked.username = "kid1";

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
  connection.sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

function requireNote(activityId: number, required = true): void {
  connection.db
    .update(activities)
    .set({ noteRequired: required })
    .where(eq(activities.id, activityId))
    .run();
}

function pass(ms: number): void {
  vi.setSystemTime(new Date(Date.now() + ms));
}

function logs() {
  return connection.db.select().from(activityLogs).all();
}

function openTimers() {
  return connection.db
    .select({ status: timers.status })
    .from(timers)
    .all()
    .filter((row) => row.status === "running" || row.status === "paused");
}

describe("the stopwatch's Enviar (#44)", () => {
  it("refuses an empty or blank note when the activity requires one, and leaves the session open", async () => {
    requireNote(READING);
    await startTimerAction(KID1, READING);
    pass(20 * MINUTE);

    await expect(stopTimerAction(KID1, "")).rejects.toThrow(/needs a note/);
    await expect(stopTimerAction(KID1, "   ")).rejects.toThrow(/needs a note/);
    await expect(stopTimerAction(KID1, "\u200b\u2060")).rejects.toThrow(
      /needs a note/,
    );

    expect(logs()).toHaveLength(0);
    expect(openTimers()).toHaveLength(1);

    await stopTimerAction(KID1, "  li o capítulo três ");

    expect(logs()).toMatchObject([
      { status: "pending", source: "timer", note: "li o capítulo três" },
    ]);
  });

  it("files without a note when the activity does not require one", async () => {
    await startTimerAction(KID1, READING);
    pass(20 * MINUTE);
    await stopTimerAction(KID1, "");

    expect(logs()).toMatchObject([{ status: "pending", note: null }]);
  });

  it("asks nothing under the floor, where nothing is filed (D44)", async () => {
    requireNote(READING);
    await startTimerAction(KID1, READING);
    pass(2 * MINUTE);

    const screen = await stopTimerAction(KID1, "");

    expect(screen.settlement?.kind).toBe("tooShort");
    expect(logs()).toHaveLength(0);
  });

  it("reads the key live: switched on while the session runs, it holds Enviar back", async () => {
    const opened = await startTimerAction(KID1, READING);
    expect(opened.open?.noteRequired).toBe(false);

    requireNote(READING);
    pass(20 * MINUTE);

    expect((await fetchTimerScreenAction(KID1)).open?.noteRequired).toBe(true);
    await expect(stopTimerAction(KID1, "")).rejects.toThrow(/needs a note/);
  });

  it("files a session that stopped by itself without a note: nobody was there to write one", async () => {
    requireNote(READING);
    await startTimerAction(KID1, READING);
    pass(3 * 60 * MINUTE);

    const screen = await fetchTimerScreenAction(KID1);

    expect(screen.settlement?.kind).toBe("autoStopped");
    expect(logs()).toMatchObject([
      { status: "pending", durationMinutes: 120, note: null },
    ]);
  });
});

describe("the request without a stopwatch (#44, D49)", () => {
  it("refuses an empty or blank note when the activity requires one, and writes nothing", async () => {
    requireNote(FRIENDS);

    await expect(
      requestLogAction(KID1, { activityId: FRIENDS, occurredOn: TODAY }),
    ).rejects.toThrow(/needs a note/);
    await expect(
      requestLogAction(KID1, {
        activityId: FRIENDS,
        occurredOn: TODAY,
        note: "  ",
      }),
    ).rejects.toThrow(/needs a note/);
    await expect(
      requestLogAction(KID1, {
        activityId: FRIENDS,
        occurredOn: TODAY,
        note: "\u200b\u200c\u200d",
      }),
    ).rejects.toThrow(/needs a note/);

    expect(logs()).toHaveLength(0);

    await requestLogAction(KID1, {
      activityId: FRIENDS,
      occurredOn: TODAY,
      note: "cinema com a turma",
    });

    expect(logs()).toMatchObject([
      { status: "pending", source: "request", note: "cinema com a turma" },
    ]);
  });

  it("files without a note when the activity does not require one", async () => {
    requireNote(FRIENDS);

    await requestLogAction(KID1, { activityId: WORSHIP, occurredOn: TODAY });

    expect(logs()).toMatchObject([{ activityId: WORSHIP, note: null }]);
  });

  it("tells the picker which activities require one", async () => {
    requireNote(FRIENDS);

    const screen = await fetchTimerScreenAction(KID1);

    expect(
      screen.requestable.find((item) => item.id === FRIENDS)?.noteRequired,
    ).toBe(true);
    expect(
      screen.requestable.find((item) => item.id === WORSHIP)?.noteRequired,
    ).toBe(false);
  });
});

describe("what the key leaves alone (#44)", () => {
  it("does not hold the adult's launch to it (D18)", () => {
    requireNote(FRIENDS);

    const launched = launchEntry(
      connection,
      { userId: KID1, activityId: FRIENDS, occurredOn: TODAY },
      ADMIN1,
      START,
    );

    expect(launched.hours).toBe(3);
  });

  it("is switched on in Configuração with an entry waiting, which stays waiting as it was (D37)", () => {
    const { logId } = requestLog(
      connection,
      KID1,
      { activityId: FRIENDS, occurredOn: TODAY },
      START,
    );
    const [friends] = listActivities(connection, 4).filter(
      (activity) => activity.id === FRIENDS,
    );

    updateActivity(connection, FRIENDS, {
      categoryId: 4,
      name: "Sair com os amigos",
      noteRequired: true,
      calcMode: "fixed",
      value: 3,
      maxSessionMinutes: null,
      minSessionMinutes: friends?.minSessionMinutes ?? 5,
      qualityGraded: false,
      repeatCooldownDays: 0,
      sortOrder: friends?.sortOrder ?? 0,
    });

    expect(
      listActivities(connection, 4).find((activity) => activity.id === FRIENDS)
        ?.noteRequired,
    ).toBe(true);
    expect(listPendingLogs(connection)).toMatchObject([
      { id: logId, note: null, preview: { hours: 3 } },
    ]);
  });
});
