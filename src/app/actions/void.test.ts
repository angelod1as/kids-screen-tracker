import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NewEntry } from "../../db/admin";
import { launchEntry, previewEntry } from "../../db/admin";
import type { AdminWorld } from "../../db/admin.rules";
import { LAUNCHED_AT, makeAdminWorld } from "../../db/admin.rules";
import type { Connection } from "../../db/client";
import { openDatabase } from "../../db/client";
import { refundHours, releaseHours } from "../../db/ledger";
import { migrateDatabase } from "../../db/migrate";
import { approveLog } from "../../db/queue";
import { BOOK, CAR, shiftDay, THAT_DAY } from "../../db/queue.rules";
import { activityLogs, ledger } from "../../db/schema";
import { seedWithTestUsers } from "../../db/test-users";
import { fetchBalanceAction } from "./balance";
import { fetchHistoryAction } from "./history";
import { voidEntryAction } from "./void";

/** D52 against the real modules and endpoint. Only the cookie is replaced. */

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

const roots: string[] = [];
const opened: Connection[] = [];

function freshConnection(): Connection {
  const root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-void-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);

  const connection = openDatabase(databasePath);
  seedWithTestUsers(connection);

  roots.push(root);
  opened.push(connection);

  return connection;
}

let world: AdminWorld;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(LAUNCHED_AT);
  world = makeAdminWorld(freshConnection());
  mocked.connection = world.connection;
  mocked.username = "admin1";
});

afterEach(() => {
  vi.useRealTimers();
  for (const connection of opened.splice(0)) {
    if (connection.sqlite.open) connection.sqlite.close();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function reading(minutes: number, overrides: Partial<NewEntry> = {}): NewEntry {
  return {
    userId: world.kidId,
    activityId: world.activityId(BOOK),
    occurredOn: THAT_DAY,
    durationMinutes: minutes,
    ...overrides,
  };
}

function launch(entry: NewEntry) {
  return launchEntry(world.connection, entry, world.adminId, new Date());
}

function balance(userId = world.kidId) {
  return fetchBalanceAction(userId);
}

function ledgerIdOf(kind: "spend" | "refund") {
  const row = world.connection.db
    .select({ id: ledger.id })
    .from(ledger)
    .where(eq(ledger.kind, kind))
    .get();

  if (row === undefined) throw new Error(`no ${kind} row`);

  return row.id;
}

describe("the balance goes back to what it was before the entry (D52)", () => {
  it("for an adult's launch", async () => {
    await releaseHoursAsAdmin(1);
    const before = await balance();
    const { logId } = launch(reading(180));

    expect(await balance()).toBeCloseTo(before + 2.63, 2);
    await expect(voidEntryAction({ kind: "log", id: logId })).resolves.toEqual({
      balance: before,
    });
  });

  it("for a release", async () => {
    launch(reading(60));
    const before = await balance();
    await releaseHoursAsAdmin(3);

    await expect(
      voidEntryAction({ kind: "ledger", id: ledgerIdOf("spend") }),
    ).resolves.toEqual({ balance: before });
  });

  it("for a refund", async () => {
    const before = await balance();
    refundHours(
      world.connection,
      { userId: world.kidId, hours: 3, occurredOn: THAT_DAY, reason: "erro" },
      world.adminId,
      new Date(),
    );

    await expect(
      voidEntryAction({ kind: "ledger", id: ledgerIdOf("refund") }),
    ).resolves.toEqual({ balance: before });
  });

  it("for an entry approved from the queue", async () => {
    const before = await balance();
    const id = world.addPending({ activity: BOOK, durationMinutes: 60 });
    approveLog(world.connection, id, world.adminId, {}, new Date());

    expect(await balance()).toBe(before + 1.5);
    await expect(voidEntryAction({ kind: "log", id })).resolves.toEqual({
      balance: before,
    });
  });

  it("and the other boy's balance never moves", async () => {
    const { logId } = launch(reading(60));
    const other = await balance(world.otherKidId);

    await voidEntryAction({ kind: "log", id: logId });

    expect(await balance(world.otherKidId)).toBe(other);
  });
});

describe("the trail stays (D14, D52)", () => {
  it("keeps the log and its ledger row as they were, and says who voided and when", async () => {
    const { logId } = launch(reading(60));
    const before = world.entryText(logId);
    const ledgerBefore = world.ledgerText();

    vi.setSystemTime(new Date("2026-09-14T15:00:00.000Z"));
    mocked.username = "admin2";
    await voidEntryAction({ kind: "log", id: logId });

    expect(world.entryText(logId)).toBe(before);
    expect(world.ledgerText()).toBe(ledgerBefore);
    expect(
      world.connection.db
        .select({ at: activityLogs.voidedAt, by: activityLogs.voidedBy })
        .from(activityLogs)
        .where(eq(activityLogs.id, logId))
        .get(),
    ).toEqual({ at: new Date("2026-09-14T15:00:00.000Z"), by: 2 });
  });

  it("shows the voided entry in the boy's history, not counted", async () => {
    const { logId } = launch(reading(60));
    vi.setSystemTime(new Date("2026-09-14T15:00:00.000Z"));
    await voidEntryAction({ kind: "log", id: logId });

    mocked.username = "kid1";

    await expect(fetchHistoryAction(world.kidId, 10)).resolves.toMatchObject([
      {
        kind: "earn",
        hours: 1.5,
        label: BOOK,
        voided: { on: "2026-09-14", by: "Admin1" },
      },
    ]);
  });

  it("shows a voided release the same way", async () => {
    await releaseHoursAsAdmin(2);
    await voidEntryAction({ kind: "ledger", id: ledgerIdOf("spend") });

    await expect(fetchHistoryAction(world.kidId, 10)).resolves.toMatchObject([
      { kind: "spend", hours: 2, voided: { on: "2026-09-13", by: "Admin1" } },
    ]);
  });
});

/**
 * The bucket of the day (D3) no longer counts the voided entry for what comes
 * next; what was frozen with it inside stays frozen (D15).
 */
describe("the day's bucket (D3, D15, D52)", () => {
  it("measures: a mistaken 2h, a real 1h frozen after it, the void, and a real 1h after the void", async () => {
    const mistake = launch(reading(120));
    const frozen = launch(reading(60));

    expect([mistake.hours, frozen.hours]).toEqual([2.25, 0.38]);

    await voidEntryAction({ kind: "log", id: mistake.logId });

    // D15: the hour frozen with the mistake in its bucket is not repriced.
    expect(world.entryText(frozen.logId)).toContain("0.38 h");
    // The next hour reads a bucket of one hour, the real one: ×0,5.
    expect(launch(reading(60)).hours).toBe(0.75);
  });

  it("measures the same day without the mistake, for comparison", () => {
    expect([launch(reading(60)).hours, launch(reading(60)).hours]).toEqual([
      1.5, 0.75,
    ]);
  });

  it("measures the same day had the mistake kept counting", () => {
    launch(reading(120));
    launch(reading(60));

    expect(launch(reading(60)).hours).toBe(0.19);
  });

  it("the preview reads the bucket the same way", async () => {
    const { logId } = launch(reading(120));
    await voidEntryAction({ kind: "log", id: logId });

    expect(
      previewEntry(world.connection, reading(60), new Date()).calculation.hours,
    ).toBe(1.5);
  });

  it("a voided car wash no longer holds the week's cooldown (D6)", async () => {
    const car: NewEntry = {
      userId: world.kidId,
      activityId: world.activityId(CAR),
      occurredOn: shiftDay(THAT_DAY, -3),
      quality: 1,
    };
    const mistake = launch(car);

    await voidEntryAction({ kind: "log", id: mistake.logId });

    // Counting, the wash three days earlier would halve this one.
    expect(launch({ ...car, occurredOn: THAT_DAY }).hours).toBe(mistake.hours);
  });

  it("a voided entry is no one's debut: the category's first day moves with it (D47)", async () => {
    const early = launch(reading(60, { occurredOn: shiftDay(THAT_DAY, -10) }));

    await voidEntryAction({ kind: "log", id: early.logId });

    // With the early one counting this would be a return, 1,5 × 1,5.
    expect(launch(reading(60)).hours).toBe(1.5);
  });
});

describe("what is refused (D33, D52)", () => {
  it("refuses a kid, for his own entry", async () => {
    const { logId } = launch(reading(60));
    mocked.username = "kid1";

    await expect(
      voidEntryAction({ kind: "log", id: logId }),
    ).rejects.toMatchObject({ name: "AccessDeniedError", reason: "forbidden" });
    mocked.username = "admin1";
    expect(await balance()).toBe(1.5);
  });

  it("refuses a request with no cookie", async () => {
    mocked.username = null;

    await expect(
      voidEntryAction({ kind: "ledger", id: 1 }),
    ).rejects.toMatchObject({ reason: "unauthenticated" });
  });

  it("says so when the entry is already voided, and moves nothing twice", async () => {
    const { logId } = launch(reading(60));
    await voidEntryAction({ kind: "log", id: logId });

    await expect(voidEntryAction({ kind: "log", id: logId })).resolves.toEqual({
      refused: `A entrada ${logId} já foi anulada.`,
    });
    expect(await balance()).toBe(0);
  });

  it("says so for a release voided twice", async () => {
    await releaseHoursAsAdmin(1);
    const id = ledgerIdOf("spend");
    await voidEntryAction({ kind: "ledger", id });

    await expect(voidEntryAction({ kind: "ledger", id })).resolves.toEqual({
      refused: "Esta movimentação já foi anulada.",
    });
    expect(await balance()).toBe(0);
  });

  it("refuses a pending entry: that is the queue's to decide", async () => {
    const id = world.addPending({ activity: BOOK });

    await expect(voidEntryAction({ kind: "log", id })).rejects.toThrow(
      "is pending, not approved",
    );
  });

  it("voids an activity's credit on its log, where the engine reads it", async () => {
    const { logId } = launch(reading(120));
    const credit = world.connection.db
      .select({ id: ledger.id })
      .from(ledger)
      .where(eq(ledger.activityLogId, logId))
      .get();

    await expect(
      voidEntryAction({ kind: "ledger", id: credit?.id ?? 0 }),
    ).resolves.toEqual({ balance: 0 });
    expect(
      world.connection.db
        .select({ at: ledger.voidedAt })
        .from(ledger)
        .where(eq(ledger.activityLogId, logId))
        .get(),
    ).toEqual({ at: null });
    expect(launch(reading(60)).hours).toBe(1.5);
  });

  it("refuses an id that is not an entry", async () => {
    await expect(voidEntryAction({ kind: "log", id: 999 })).rejects.toThrow(
      "there is no activity log 999",
    );
    await expect(voidEntryAction({ kind: "ledger", id: -1 })).rejects.toThrow(
      "positive integer",
    );
  });
});

async function releaseHoursAsAdmin(hours: number) {
  releaseHours(
    world.connection,
    { userId: world.kidId, hours },
    world.adminId,
    new Date(),
  );
}
