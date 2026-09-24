import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "../../../../db/client";
import { migrateDatabase } from "../../../../db/migrate";
import { activities, activityLogs, users } from "../../../../db/schema";
import { seedWithTestUsers } from "../../../../db/test-users";
import { RESYNCED_TEXT, timerFailureText } from "../../../../ui/failure";
import {
  fetchTimerScreenAction,
  pauseTimerAction,
  startTimerAction,
  stopTimerAction,
} from "../../../actions/timer";
import { recoverFrom } from "./timer-screen";

/**
 * The session lives in a row, never in the browser (#29). A request that never
 * arrived leaves the row for the same tap later; one whose answer was lost has
 * moved it, the tap is refused, and the recovery reads the server again.
 */

const mocked = vi.hoisted(() => ({
  username: null as string | null,
  connection: null as unknown,
}));

vi.mock("../../../../auth/session", () => ({
  SESSION_COOKIE_NAME: "kst_session",
  readSessionUsername: async () => mocked.username,
  startSession: async () => undefined,
  endSession: async () => undefined,
}));

vi.mock("../../../../db", () => ({
  getConnection: () => mocked.connection,
  getDb: () => (mocked.connection as { db: unknown }).db,
}));

const MINUTE = 60 * 1000;

const START = new Date("2026-09-01T17:00:00.000Z");

const NETWORK = new TypeError("Failed to fetch");

let root: string;
let connection: ReturnType<typeof openDatabase>;
let kid1: number;
let book: number;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-timer-failure-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);
  connection = openDatabase(databasePath);
  seedWithTestUsers(connection);

  mocked.connection = connection;
  mocked.username = "kid1";

  kid1 = connection.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, "kid1"))
    .get()?.id as number;
  book = connection.db
    .select({ id: activities.id })
    .from(activities)
    .where(eq(activities.name, "Ler livro"))
    .get()?.id as number;

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
  connection.sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

function pass(ms: number): void {
  vi.setSystemTime(new Date(Date.now() + ms));
}

function logs() {
  return connection.db
    .select()
    .from(activityLogs)
    .where(eq(activityLogs.userId, kid1))
    .all();
}

describe("a network failure on the stopwatch loses nothing (#29)", () => {
  it("keeps the session on the server from the moment it starts", async () => {
    await startTimerAction(kid1, book);
    pass(20 * MINUTE);

    const screen = await fetchTimerScreenAction(kid1);

    expect(screen.open?.status).toBe("running");
    expect(screen.open?.activeSeconds).toBe(20 * 60);
  });

  it("lets the same stop go through later when the first one never arrived", async () => {
    await startTimerAction(kid1, book);
    pass(30 * MINUTE);
    await pauseTimerAction(kid1);

    // *Enviar* failed on the way out; the connection is back ten minutes later.
    pass(10 * MINUTE);

    const recovered = await recoverFrom(NETWORK, () =>
      fetchTimerScreenAction(kid1),
    );

    expect(recovered.data?.open?.status).toBe("paused");
    expect(recovered.data?.open?.activeSeconds).toBe(30 * 60);
    expect(logs()).toHaveLength(0);

    const sent = await stopTimerAction(kid1, "li o capítulo 3");

    expect(sent.open).toBeNull();
    expect(logs()).toHaveLength(1);
    expect(logs()[0]).toMatchObject({
      status: "pending",
      durationMinutes: 30,
      note: "li o capítulo 3",
    });
  });

  it("redraws from the server when the stop arrived and only the answer was lost", async () => {
    await startTimerAction(kid1, book);
    pass(45 * MINUTE);
    await pauseTimerAction(kid1);
    // Written, but the phone got a network error instead of the answer.
    await stopTimerAction(kid1, "");

    const recovered = await recoverFrom(NETWORK, () =>
      fetchTimerScreenAction(kid1),
    );

    expect(recovered.message).toBe(RESYNCED_TEXT);
    expect(recovered.data?.open).toBeNull();
    expect(recovered.data?.pending).toHaveLength(1);
    expect(recovered.data?.pending[0]?.durationMinutes).toBe(45);
    expect(logs()).toHaveLength(1);
  });

  it("redraws from the server when a retry of that stop is refused", async () => {
    await startTimerAction(kid1, book);
    pass(45 * MINUTE);
    await pauseTimerAction(kid1);
    await stopTimerAction(kid1, "");

    // Without the recovery he taps again and is refused: nothing left to stop.
    const retry = await stopTimerAction(kid1, "").then(
      () => null,
      (error: unknown) => error,
    );

    expect(retry).toBeInstanceOf(Error);

    const recovered = await recoverFrom(retry, () =>
      fetchTimerScreenAction(kid1),
    );

    expect(recovered.message).toBe(RESYNCED_TEXT);
    expect(recovered.data?.open).toBeNull();
    expect(logs()).toHaveLength(1);
  });

  it("replaces nothing on screen and says the session is safe while offline", async () => {
    const recovered = await recoverFrom(
      NETWORK,
      () => Promise.reject(new TypeError("Failed to fetch")),
      false,
    );

    expect(recovered.data).toBeNull();
    expect(recovered.message).toBe(timerFailureText(NETWORK, false));
    expect(recovered.message).toContain("não apaga a sessão");
  });
});
