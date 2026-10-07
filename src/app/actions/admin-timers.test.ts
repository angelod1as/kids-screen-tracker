import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "../../db/client";
import { migrateDatabase } from "../../db/migrate";
import { activities, activityLogs, timers, users } from "../../db/schema";
import { seedWithTestUsers } from "../../db/test-users";
import { startTimer } from "../../db/timers";
import {
  adminCancelTimerAction,
  adminStopTimerAction,
  fetchRunningTimersAction,
} from "./admin-timers";

/** Only the cookie and the clock are replaced, as in `timer.test.ts`. */

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

const SECOND = 1000;
const MINUTE = 60 * SECOND;

const START = new Date("2026-09-01T17:00:00.000Z");
const BOOK = "Ler livro";

let root: string;
let connection: ReturnType<typeof openDatabase>;
let ids: Map<string, number>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-admin-timers-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);
  connection = openDatabase(databasePath);
  seedWithTestUsers(connection);

  mocked.connection = connection;
  mocked.username = "admin1";

  ids = new Map(
    connection.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .all()
      .map((row) => [row.username, row.id] as const),
  );

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
  connection.sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

function idOf(username: string): number {
  const id = ids.get(username);
  if (id === undefined)
    throw new Error(`the seed has no user named ${username}`);

  return id;
}

function activityId(name: string): number {
  const row = connection.db
    .select({ id: activities.id })
    .from(activities)
    .where(eq(activities.name, name))
    .get();

  if (row === undefined)
    throw new Error(`the seed has no activity named ${name}`);

  return row.id;
}

function startBook(username: string): void {
  startTimer(connection, idOf(username), activityId(BOOK), new Date());
}

function pass(ms: number): void {
  vi.setSystemTime(new Date(Date.now() + ms));
}

function logsOf(username: string) {
  return connection.db
    .select()
    .from(activityLogs)
    .where(eq(activityLogs.userId, idOf(username)))
    .all();
}

function timerRows(username: string) {
  return connection.db
    .select()
    .from(timers)
    .where(eq(timers.userId, idOf(username)))
    .all();
}

describe("the admin sees the timers that are running (#84)", () => {
  it("lists the open session, which boy and which activity", async () => {
    startBook("kid1");
    pass(3 * MINUTE);

    const running = await fetchRunningTimersAction();

    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject({
      userId: idOf("kid1"),
      kidName: "Kid1",
      activityName: BOOK,
      status: "running",
    });
    expect(running[0]?.activeSeconds).toBe(3 * 60);
  });

  it("lists nothing when no session is open", async () => {
    expect(await fetchRunningTimersAction()).toEqual([]);
  });

  it("shows each boy only his own session", async () => {
    startBook("kid1");
    startBook("kid2");

    const running = await fetchRunningTimersAction();

    expect(running.map((timer) => timer.userId).sort()).toEqual(
      [idOf("kid1"), idOf("kid2")].sort(),
    );
  });
});

describe("Parar ends it as the boy would (#84, D44, D32)", () => {
  it("files a pending record from the timer, the same path as the boy", async () => {
    startBook("kid1");
    pass(6 * MINUTE);

    // D44: a filed stop settles to null, which is how the screen knows to refresh.
    expect(await adminStopTimerAction(idOf("kid1"), "")).toBeNull();

    const [log] = logsOf("kid1");

    expect(log?.status).toBe("pending");
    expect(log?.source).toBe("timer");
    expect(log?.durationMinutes).toBe(6);
    expect(log?.autoStopped).toBe(false);
    expect(timerRows("kid1")[0]?.status).toBe("stopped");
  });

  it("files nothing when the session is under the floor, and says so (D44)", async () => {
    startBook("kid1");
    pass(10 * SECOND);

    // The admin learns why nothing was filed, not only that the panel vanished.
    expect(await adminStopTimerAction(idOf("kid1"), "")).toEqual({
      kind: "tooShort",
      activityName: BOOK,
      durationMinutes: null,
      durationSeconds: 10,
      minSessionMinutes: 5,
    });
    expect(logsOf("kid1")).toEqual([]);
    expect(timerRows("kid1")[0]?.status).toBe("stopped");
  });

  it("keeps the note the admin attaches", async () => {
    startBook("kid1");
    pass(6 * MINUTE);

    await adminStopTimerAction(idOf("kid1"), "  parei pelo menino  ");

    expect(logsOf("kid1")[0]?.note).toBe("parei pelo menino");
  });

  it("refuses a session the activity needs a note for, filing nothing (#44)", async () => {
    connection.db
      .update(activities)
      .set({ noteRequired: true })
      .where(eq(activities.id, activityId(BOOK)))
      .run();

    startBook("kid1");
    pass(6 * MINUTE);

    await expect(adminStopTimerAction(idOf("kid1"), "")).rejects.toThrow(
      /needs a note/,
    );
    expect(logsOf("kid1")).toEqual([]);
    expect(timerRows("kid1")[0]?.status).toBe("running");
  });
});

describe("Cancelar discards the session (#84)", () => {
  it("leaves no record, marks the timer abandoned, and settles to null", async () => {
    startBook("kid1");
    pass(6 * MINUTE);

    expect(await adminCancelTimerAction(idOf("kid1"))).toBeNull();

    expect(logsOf("kid1")).toEqual([]);
    expect(timerRows("kid1")[0]?.status).toBe("abandoned");
  });

  it("honors a record the session already filed on its own, not a silent discard (D16)", async () => {
    // "Ler livro" caps at 2h; crossing it before the tap files a pending record.
    startBook("kid1");
    pass(5 * 60 * MINUTE);

    const settlement = await adminCancelTimerAction(idOf("kid1"));

    expect(settlement?.kind).toBe("autoStopped");
    expect(logsOf("kid1")).toHaveLength(1);
    expect(logsOf("kid1")[0]?.status).toBe("pending");
    expect(timerRows("kid1")[0]?.status).toBe("stopped");
  });
});

describe("a kid never reaches the admin's actions (#84, D33)", () => {
  const forged = [
    {
      name: "listing the running timers",
      run: () => fetchRunningTimersAction(),
    },
    {
      name: "stopping his brother's timer",
      run: () => adminStopTimerAction(idOf("kid2"), ""),
    },
    {
      name: "cancelling his brother's timer",
      run: () => adminCancelTimerAction(idOf("kid2")),
    },
    {
      name: "stopping his own timer this way",
      run: () => adminStopTimerAction(idOf("kid1"), ""),
    },
  ];

  it.each(forged)("refuses $name", async ({ run }) => {
    mocked.username = "kid1";

    await expect(run()).rejects.toMatchObject({
      name: "AccessDeniedError",
      reason: "forbidden",
    });
  });

  it("writes nothing while refusing to cancel", async () => {
    startBook("kid2");
    pass(6 * MINUTE);
    mocked.username = "kid2";

    await expect(adminCancelTimerAction(idOf("kid2"))).rejects.toMatchObject({
      reason: "forbidden",
    });

    expect(timerRows("kid2")[0]?.status).toBe("running");
    expect(logsOf("kid2")).toEqual([]);
  });
});
