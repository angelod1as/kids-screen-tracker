import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "../../db/client";
import { migrateDatabase } from "../../db/migrate";
import {
  activities,
  activityLogs,
  categories,
  ledger,
  timers,
  users,
} from "../../db/schema";
import { seedWithTestUsers } from "../../db/test-users";
import {
  fetchTimerScreenAction,
  pauseTimerAction,
  resumeTimerAction,
  startTimerAction,
  stopTimerAction,
} from "./timer";

/**
 * Only the cookie and the clock are replaced. The actions read the clock
 * themselves, so these cases move it by hours and days and assert on rows.
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

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** A Tuesday afternoon in São Paulo: 14:00 local, which is 17:00 UTC. */
const START = new Date("2026-09-01T17:00:00.000Z");

let root: string;
let connection: ReturnType<typeof openDatabase>;
let ids: Map<string, number>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-timer-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);
  connection = openDatabase(databasePath);
  seedWithTestUsers(connection);

  mocked.connection = connection;
  mocked.username = "kid1";

  ids = new Map(
    connection.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .all()
      .map((row) => [row.username, row.id] as const),
  );

  // Only `Date`: the other timers are the ones `await` runs on.
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

const BOOK = "Ler livro";
const FRIENDS = "Sair com os amigos";

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

describe("the state lives on the server (#18)", () => {
  it("survives a browser that never came back", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(90 * SECOND);

    const screen = await fetchTimerScreenAction(idOf("kid1"));

    expect(screen.open?.activityName).toBe(BOOK);
    expect(screen.open?.status).toBe("running");
    expect(screen.open?.activeSeconds).toBe(90);
  });

  it("keeps the row itself, not a number in a browser", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));

    const [row] = timerRows("kid1");

    expect(row?.status).toBe("running");
    expect(row?.startedAt).toEqual(START);
    expect(row?.accumulatedSeconds).toBe(0);
  });

  it("refuses a second session while one is open", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));

    await expect(
      startTimerAction(idOf("kid1"), activityId(BOOK)),
    ).rejects.toThrow(/already has an open timer/);
    expect(timerRows("kid1")).toHaveLength(1);
  });

  it("refuses an activity that is not measured by time", async () => {
    // D5: a `fixed` activity pays the same however long it lasted.
    await expect(
      startTimerAction(idOf("kid1"), activityId(FRIENDS)),
    ).rejects.toThrow(/measured by duration/);
    expect(timerRows("kid1")).toHaveLength(0);
  });

  it("refuses an activity whose category was switched off (D14)", async () => {
    const book = activityId(BOOK);
    const category = connection.db
      .select({ categoryId: activities.categoryId })
      .from(activities)
      .where(eq(activities.id, book))
      .get()?.categoryId;

    connection.db
      .update(categories)
      .set({ active: false })
      .where(eq(categories.id, category ?? 0))
      .run();

    // An id is not a permission (D33).
    expect(
      (await fetchTimerScreenAction(idOf("kid1"))).activities.map(
        (activity) => activity.name,
      ),
    ).not.toContain(BOOK);
    await expect(startTimerAction(idOf("kid1"), book)).rejects.toThrow(
      /must be active/,
    );
    expect(timerRows("kid1")).toHaveLength(0);
  });

  it("offers only the activities a stopwatch can measure", async () => {
    const screen = await fetchTimerScreenAction(idOf("kid1"));
    const names = screen.activities.map((activity) => activity.name);

    expect(names).toContain(BOOK);
    expect(names).not.toContain(FRIENDS);
  });
});

describe("pausing does not count time (#18)", () => {
  it("freezes the clock and starts it again where it stopped", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(60 * SECOND);
    await pauseTimerAction(idOf("kid1"));

    pass(2 * HOUR);

    const paused = await fetchTimerScreenAction(idOf("kid1"));
    expect(paused.open?.status).toBe("paused");
    expect(paused.open?.activeSeconds).toBe(60);

    await resumeTimerAction(idOf("kid1"));
    pass(30 * SECOND);

    const running = await fetchTimerScreenAction(idOf("kid1"));
    expect(running.open?.activeSeconds).toBe(90);
  });

  it("writes the record with the active minutes and not the wall clock", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(20 * MINUTE);
    await pauseTimerAction(idOf("kid1"));
    pass(3 * HOUR);
    await resumeTimerAction(idOf("kid1"));
    pass(10 * MINUTE);
    await stopTimerAction(idOf("kid1"), "");

    const [log] = logsOf("kid1");

    // Three hours and a half of wall clock, thirty minutes of reading.
    expect(log?.durationMinutes).toBe(30);
    expect(log?.startedAt).toEqual(START);
  });

  it("does not pay a rounded second for every tap of Pausar", async () => {
    // `Math.round` on banked seconds broke every tie upward: two hundred
    // half-second taps were banked as three minutes.
    await startTimerAction(idOf("kid1"), activityId(BOOK));

    for (let cycle = 0; cycle < 200; cycle += 1) {
      pass(500);
      await pauseTimerAction(idOf("kid1"));
      await resumeTimerAction(idOf("kid1"));
    }

    await stopTimerAction(idOf("kid1"), "");

    // Since #71 nothing is filed at all: each stretch banks zero whole seconds.
    expect(logsOf("kid1")[0]?.durationMinutes ?? 0).toBeLessThanOrEqual(2);
  });

  it("pauses idempotently, so tapping Parar keeps the pause it was in", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(5 * MINUTE);
    await pauseTimerAction(idOf("kid1"));
    const first = timerRows("kid1")[0]?.pausedAt;

    pass(HOUR);
    await pauseTimerAction(idOf("kid1"));

    // D16's twelve hours count from the pause; moving the stamp would restart them.
    expect(timerRows("kid1")[0]?.pausedAt).toEqual(first);
    expect(timerRows("kid1")[0]?.accumulatedSeconds).toBe(5 * 60);
  });
});

describe("stopping proposes a record (#18)", () => {
  it("creates it as pending, from the timer, with nothing credited", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(6 * MINUTE);
    await stopTimerAction(idOf("kid1"), "Terminei o capítulo 4");

    const [log] = logsOf("kid1");

    expect(log?.status).toBe("pending");
    expect(log?.source).toBe("timer");
    expect(log?.note).toBe("Terminei o capítulo 4");
    expect(log?.autoStopped).toBe(false);
    expect(log?.computedHours).toBeNull();
    expect(log?.reviewedBy).toBeNull();
    expect(connection.db.select().from(ledger).all()).toEqual([]);
  });

  it("rounds the duration to the nearest minute (D17, amended by #71)", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(5 * MINUTE + 30 * SECOND);
    await stopTimerAction(idOf("kid1"), "");

    expect(logsOf("kid1")[0]?.durationMinutes).toBe(6);
    expect(logsOf("kid1")[0]?.durationSeconds).toBe(330);
  });

  it("files nothing for ten seconds, and says why (#71)", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(10 * SECOND);
    const screen = await stopTimerAction(idOf("kid1"), "");

    // Ten seconds used to reach the queue as a one-minute session.
    expect(logsOf("kid1")).toEqual([]);
    expect(screen.proposed).toBeNull();
    expect(screen.settlement).toEqual({
      kind: "tooShort",
      activityName: BOOK,
      durationMinutes: null,
      durationSeconds: 10,
      minSessionMinutes: 5,
    });
    expect(screen.open).toBeNull();
    expect(timerRows("kid1")[0]?.status).toBe("stopped");
  });

  it("refuses 4min59s and files 5min exactly and 5min01s (D44)", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(5 * MINUTE - SECOND);
    const short = await stopTimerAction(idOf("kid1"), "");

    expect(logsOf("kid1")).toEqual([]);
    expect(short.settlement).toEqual({
      kind: "tooShort",
      activityName: BOOK,
      durationMinutes: null,
      durationSeconds: 299,
      minSessionMinutes: 5,
    });

    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(5 * MINUTE);
    await stopTimerAction(idOf("kid1"), "");

    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(5 * MINUTE + SECOND);
    await stopTimerAction(idOf("kid1"), "");

    expect(
      logsOf("kid1").map((log) => [log.durationSeconds, log.durationMinutes]),
    ).toEqual([
      [300, 5],
      [301, 5],
    ]);
  });

  it("refuses under the activity's own floor, and names it (D44)", async () => {
    connection.db
      .update(activities)
      .set({ minSessionMinutes: 10 })
      .where(eq(activities.id, activityId(BOOK)))
      .run();

    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(9 * MINUTE);
    const screen = await stopTimerAction(idOf("kid1"), "");

    expect(logsOf("kid1")).toEqual([]);
    expect(screen.settlement?.minSessionMinutes).toBe(10);
  });

  it("keeps the thirty seconds of #71 for a session opened before the floor", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    // What 0004 backfills into every timer that was already open (D37, D38).
    connection.db.update(timers).set({ minSessionMinutes: 0 }).run();
    pass(29 * SECOND);
    const short = await stopTimerAction(idOf("kid1"), "");

    expect(logsOf("kid1")).toEqual([]);
    expect(short.settlement?.minSessionMinutes).toBe(0);

    await startTimerAction(idOf("kid1"), activityId(BOOK));
    connection.db.update(timers).set({ minSessionMinutes: 0 }).run();
    pass(30 * SECOND);
    await stopTimerAction(idOf("kid1"), "");

    expect(logsOf("kid1")[0]?.durationSeconds).toBe(30);
    expect(logsOf("kid1")[0]?.durationMinutes).toBe(1);
  });

  it("keeps the floor a session opened under, whichever way it moves (D37, D38)", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    connection.db
      .update(activities)
      .set({ minSessionMinutes: 30 })
      .where(eq(activities.id, activityId(BOOK)))
      .run();
    pass(6 * MINUTE);
    await stopTimerAction(idOf("kid1"), "");

    expect(logsOf("kid1")[0]?.durationMinutes).toBe(6);
  });

  it("keeps the seconds a session with a pause actually ran (D17)", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(4 * MINUTE + 40 * SECOND);
    await pauseTimerAction(idOf("kid1"));
    pass(3 * HOUR);
    await resumeTimerAction(idOf("kid1"));
    pass(20 * SECOND);
    await stopTimerAction(idOf("kid1"), "");

    expect(logsOf("kid1")[0]?.durationSeconds).toBe(300);
    expect(logsOf("kid1")[0]?.durationMinutes).toBe(5);
  });

  it("gives a session of no length no record at all (#71)", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    const screen = await stopTimerAction(idOf("kid1"), "");

    expect(logsOf("kid1")).toEqual([]);
    expect(screen.settlement?.kind).toBe("tooShort");
  });

  it("closes the session, so the screen is ready for the next one", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(5 * MINUTE);
    const screen = await stopTimerAction(idOf("kid1"), "");

    expect(screen.open).toBeNull();
    expect(screen.proposed).toEqual({
      activityName: BOOK,
      durationMinutes: 5,
      durationSeconds: 300,
    });
    expect(timerRows("kid1")[0]?.status).toBe("stopped");
  });

  it("takes the record's day from the start and not from the stop (D13)", async () => {
    // 23:50 in São Paulo, stopped after midnight.
    vi.setSystemTime(new Date("2026-09-02T02:50:00.000Z"));
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(20 * MINUTE);
    await stopTimerAction(idOf("kid1"), "");

    expect(logsOf("kid1")[0]?.occurredOn).toBe("2026-09-01");
  });

  it("caps what the browser may attach to it", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(MINUTE);

    await expect(
      stopTimerAction(idOf("kid1"), "x".repeat(501)),
    ).rejects.toThrow(/at most 500 characters/);
    expect(logsOf("kid1")).toEqual([]);
  });
});

describe("the automatic stop (#19, D16)", () => {
  /** Reads the screen `after` milliseconds past the start of a book session. */
  async function readAfter(after: number) {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(after);

    return fetchTimerScreenAction(idOf("kid1"));
  }

  it("stops at the limit exactly, and marks the record", async () => {
    const screen = await readAfter(5 * HOUR);
    const [log] = logsOf("kid1");

    expect(screen.open).toBeNull();
    expect(screen.settlement).toEqual({
      kind: "autoStopped",
      activityName: BOOK,
      durationMinutes: 120,
      durationSeconds: 120 * 60,
    });
    expect(log?.autoStopped).toBe(true);
    expect(log?.status).toBe("pending");
    expect(log?.durationMinutes).toBe(120);
    expect(log?.startedAt).toEqual(START);
    expect(log?.endedAt).toEqual(new Date(START.getTime() + 2 * HOUR));
  });

  it("writes the record once, however many times it is read", async () => {
    await readAfter(5 * HOUR);
    await fetchTimerScreenAction(idOf("kid1"));
    await fetchTimerScreenAction(idOf("kid1"));

    expect(logsOf("kid1")).toHaveLength(1);
  });

  it("says nothing the second time: the notice belongs to the settlement", async () => {
    await readAfter(5 * HOUR);

    expect((await fetchTimerScreenAction(idOf("kid1"))).settlement).toBeNull();
  });

  it("leaves the boy his own record to look at afterwards", async () => {
    const screen = await readAfter(5 * HOUR);

    expect(screen.pending).toHaveLength(1);
    expect(screen.pending[0]?.autoStopped).toBe(true);
  });

  it("settles on a pause or a stop, not only on a read", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(5 * HOUR);
    const screen = await pauseTimerAction(idOf("kid1"));

    expect(screen.settlement?.kind).toBe("autoStopped");
    expect(logsOf("kid1")[0]?.durationMinutes).toBe(120);
    expect(timerRows("kid1")[0]?.status).toBe("stopped");
  });

  it("counts the limit in active time, so a pause does not spend it", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(HOUR);
    await pauseTimerAction(idOf("kid1"));
    pass(6 * HOUR);
    await resumeTimerAction(idOf("kid1"));

    pass(59 * MINUTE);
    expect((await fetchTimerScreenAction(idOf("kid1"))).open).not.toBeNull();

    pass(2 * MINUTE);
    expect((await fetchTimerScreenAction(idOf("kid1"))).open).toBeNull();
    expect(logsOf("kid1")[0]?.durationMinutes).toBe(120);
  });
});

/** Nothing between the action and the row substitutes the moment of the read. */
describe("the record does not depend on when the app was opened (#19)", () => {
  async function recordReadAfter(after: number) {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(after);
    await fetchTimerScreenAction(idOf("kid1"));

    const [log] = logsOf("kid1");

    return {
      occurredOn: log?.occurredOn,
      startedAt: log?.startedAt?.toISOString(),
      endedAt: log?.endedAt?.toISOString(),
      durationMinutes: log?.durationMinutes,
      autoStopped: log?.autoStopped,
    };
  }

  it("is the same record a second late and forty days late", async () => {
    const prompt = await recordReadAfter(2 * HOUR + SECOND);

    connection.db.delete(activityLogs).run();
    connection.db.delete(timers).run();
    vi.setSystemTime(START);

    const late = await recordReadAfter(40 * 24 * HOUR);

    expect(late).toEqual(prompt);
    expect(prompt.endedAt).toBe(
      new Date(START.getTime() + 2 * HOUR).toISOString(),
    );
  });
});

describe("an abandoned session (#19, D16)", () => {
  /** Morning: a pause begun after midday is closed by the day before twelve hours pass (D31). */
  const MORNING = new Date("2026-09-01T11:00:00.000Z");

  beforeEach(() => {
    vi.setSystemTime(MORNING);
  });

  it("leaves no record at all after twelve hours paused", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(10 * MINUTE);
    await pauseTimerAction(idOf("kid1"));
    pass(13 * HOUR);

    const screen = await fetchTimerScreenAction(idOf("kid1"));

    expect(screen.open).toBeNull();
    expect(screen.settlement).toEqual({
      kind: "abandoned",
      activityName: BOOK,
      durationMinutes: null,
      durationSeconds: null,
    });
    expect(logsOf("kid1")).toEqual([]);
    expect(timerRows("kid1")[0]?.status).toBe("abandoned");
  });

  it("is still the boy's session at eleven hours and fifty-nine minutes", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(10 * MINUTE);
    await pauseTimerAction(idOf("kid1"));
    pass(12 * HOUR - MINUTE);

    const screen = await fetchTimerScreenAction(idOf("kid1"));

    expect(screen.open?.status).toBe("paused");
    expect(screen.open?.activeSeconds).toBe(600);
  });

  it("cannot be resumed once it is gone", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(10 * MINUTE);
    await pauseTimerAction(idOf("kid1"));
    pass(13 * HOUR);

    const screen = await resumeTimerAction(idOf("kid1"));

    expect(screen.settlement?.kind).toBe("abandoned");
    expect(logsOf("kid1")).toEqual([]);
  });
});

describe("a session ends with the day it began on (D3, D13)", () => {
  /** 23:30 in São Paulo, which is 02:30Z the next day. */
  const LATE = new Date("2026-09-02T02:30:00.000Z");

  /** The instant São Paulo's 2 September begins. */
  const MIDNIGHT = new Date("2026-09-02T03:00:00.000Z");

  it("closes at midnight, with what it counted, on the day it began", async () => {
    vi.setSystemTime(LATE);
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(HOUR);

    const screen = await fetchTimerScreenAction(idOf("kid1"));
    const [log] = logsOf("kid1");

    expect(screen.open).toBeNull();
    expect(screen.settlement).toEqual({
      kind: "dayEnded",
      activityName: BOOK,
      durationMinutes: 30,
      durationSeconds: 30 * 60,
    });
    expect(log?.occurredOn).toBe("2026-09-01");
    expect(log?.endedAt).toEqual(MIDNIGHT);
    expect(log?.durationMinutes).toBe(30);
    expect(log?.autoStopped).toBe(true);
    expect(timerRows("kid1")[0]?.status).toBe("stopped");
  });

  it("files nothing when the day turns on a session under a minute (#71)", async () => {
    // This used to hit `activity_logs_duration_minutes_check` and take the screen down.
    vi.setSystemTime(new Date("2026-09-02T02:59:50.000Z"));
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(HOUR);

    const screen = await fetchTimerScreenAction(idOf("kid1"));

    expect(logsOf("kid1")).toEqual([]);
    expect(screen.open).toBeNull();
    expect(screen.settlement).toEqual({
      kind: "tooShort",
      activityName: BOOK,
      durationMinutes: null,
      durationSeconds: 10,
      minSessionMinutes: 5,
    });
    expect(timerRows("kid1")[0]?.status).toBe("stopped");
  });

  it("refuses a session the day cuts under the floor, and lets the boy start again (D44, D31)", async () => {
    // 23:57: three minutes at midnight, under the floor.
    vi.setSystemTime(new Date("2026-09-02T02:57:00.000Z"));
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(HOUR);

    const screen = await fetchTimerScreenAction(idOf("kid1"));

    expect(logsOf("kid1")).toEqual([]);
    expect(screen.open).toBeNull();
    expect(screen.settlement).toEqual({
      kind: "tooShort",
      activityName: BOOK,
      durationMinutes: null,
      durationSeconds: 180,
      minSessionMinutes: 5,
    });

    const again = await startTimerAction(idOf("kid1"), activityId(BOOK));

    expect(again.open?.status).toBe("running");
  });

  it("still files the day's record once it reaches the floor (D44)", async () => {
    vi.setSystemTime(new Date("2026-09-02T02:55:00.000Z"));
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(HOUR);

    const screen = await fetchTimerScreenAction(idOf("kid1"));

    expect(screen.settlement?.kind).toBe("dayEnded");
    expect(logsOf("kid1")[0]?.durationSeconds).toBe(300);
    expect(logsOf("kid1")[0]?.durationMinutes).toBe(5);
    expect(logsOf("kid1")[0]?.occurredOn).toBe("2026-09-01");
  });

  it("gives the same record whenever the app is opened again", async () => {
    vi.setSystemTime(LATE);
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(40 * 24 * HOUR);
    await fetchTimerScreenAction(idOf("kid1"));

    const [log] = logsOf("kid1");

    expect(log?.occurredOn).toBe("2026-09-01");
    expect(log?.endedAt).toEqual(MIDNIGHT);
    expect(log?.durationMinutes).toBe(30);
  });

  it("cannot be parked overnight by pausing inside every twelve hours", async () => {
    vi.setSystemTime(new Date("2026-09-02T02:50:00.000Z"));
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(5 * MINUTE);
    await pauseTimerAction(idOf("kid1"));

    pass(11 * HOUR);
    const screen = await resumeTimerAction(idOf("kid1"));

    expect(screen.open).toBeNull();
    expect(screen.settlement?.kind).toBe("dayEnded");
    expect(timerRows("kid1")[0]?.status).toBe("stopped");
    expect(logsOf("kid1")[0]?.occurredOn).toBe("2026-09-01");
    expect(logsOf("kid1")[0]?.durationMinutes).toBe(5);
  });

  it("bounds what a session with no limit can accumulate", async () => {
    // A session with no limit (D16) used to accrue until a CHECK walled the stopwatch off.
    connection.db
      .update(activities)
      .set({ maxSessionMinutes: null })
      .where(eq(activities.id, activityId(BOOK)))
      .run();

    vi.setSystemTime(new Date("2026-09-01T03:00:00.000Z"));
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(20 * 24 * HOUR);
    await fetchTimerScreenAction(idOf("kid1"));

    expect(timerRows("kid1")[0]?.accumulatedSeconds).toBe(24 * 60 * 60);
    expect(logsOf("kid1")[0]?.durationMinutes).toBe(24 * 60);
  });
});

describe("the one write a kid makes is his own (#13)", () => {
  const forged = [
    {
      name: "starting a session in his brother's name",
      run: () => startTimerAction(idOf("kid2"), activityId(BOOK)),
    },
    {
      name: "reading his brother's timer",
      run: () => fetchTimerScreenAction(idOf("kid2")),
    },
    {
      name: "pausing his brother's timer",
      run: () => pauseTimerAction(idOf("kid2")),
    },
    {
      name: "resuming his brother's timer",
      run: () => resumeTimerAction(idOf("kid2")),
    },
    {
      name: "stopping his brother's timer, which would propose a record",
      run: () => stopTimerAction(idOf("kid2"), "não fui eu"),
    },
  ];

  it.each(forged)("refuses $name", async ({ run }) => {
    mocked.username = "kid1";

    await expect(run()).rejects.toMatchObject({
      name: "AccessDeniedError",
      reason: "forbidden",
    });
  });

  it.each(forged)("refuses $name to nobody at all", async ({ run }) => {
    mocked.username = null;

    await expect(run()).rejects.toMatchObject({ reason: "unauthenticated" });
  });

  it("writes nothing while refusing", async () => {
    mocked.username = "kid1";

    await expect(
      startTimerAction(idOf("kid2"), activityId(BOOK)),
    ).rejects.toMatchObject({ reason: "forbidden" });

    expect(timerRows("kid2")).toEqual([]);
    expect(logsOf("kid2")).toEqual([]);
  });

  it("lets an admin read a boy's timer", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    mocked.username = "admin1";

    expect((await fetchTimerScreenAction(idOf("kid1"))).open?.status).toBe(
      "running",
    );
  });

  it("shows a boy only his own pending records", async () => {
    await startTimerAction(idOf("kid1"), activityId(BOOK));
    pass(5 * MINUTE);
    await stopTimerAction(idOf("kid1"), "");

    mocked.username = "kid2";
    await startTimerAction(idOf("kid2"), activityId(BOOK));
    pass(5 * MINUTE);
    await stopTimerAction(idOf("kid2"), "");

    mocked.username = "kid1";
    const screen = await fetchTimerScreenAction(idOf("kid1"));

    expect(screen.pending).toHaveLength(1);
    expect(
      connection.db
        .select()
        .from(activityLogs)
        .where(
          and(
            eq(activityLogs.userId, idOf("kid1")),
            eq(activityLogs.status, "pending"),
          ),
        )
        .all(),
    ).toHaveLength(1);
  });
});
