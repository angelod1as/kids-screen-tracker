import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Connection } from "../../db/client";
import { openDatabase } from "../../db/client";
import { migrateDatabase } from "../../db/migrate";
import {
  approveLog,
  countPendingLogs,
  listPendingLogs,
  rejectionNote,
  rejectionReason,
  rejectLog,
} from "../../db/queue";
import type { QueueModule, World } from "../../db/queue.rules";
import {
  BOOK,
  failingQueueCases,
  makeWorld,
  QUEUE_CASES,
  REVIEWED_AT,
} from "../../db/queue.rules";
import { activityLogs, users } from "../../db/schema";
import { seedWithTestUsers } from "../../db/test-users";
import {
  approveLogAction,
  countPendingLogsAction,
  fetchQueueAction,
  rejectLogAction,
} from "./queue";

/**
 * The approval queue, end to end (#20).
 *
 * Two halves. The first runs `queue.rules.ts` against the real module, which is
 * where the rules of the approval live; the second is about the endpoints —
 * who may call them, whose id ends up in `reviewed_by`, and what survives a
 * write that fails half way.
 *
 * Only the cookie is replaced. The engine, the transaction and every CHECK
 * constraint of the schema run for real.
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

const REAL: QueueModule = {
  listPendingLogs,
  approveLog,
  rejectLog,
  rejectionNote,
  rejectionReason,
};

const roots: string[] = [];
const opened: Connection[] = [];

/** A migrated, seeded database of its own, cleaned up after the test. */
function freshConnection(): Connection {
  const root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-queue-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);

  const connection = openDatabase(databasePath);
  seedWithTestUsers(connection);

  roots.push(root);
  opened.push(connection);

  return connection;
}

let world: World;

beforeEach(() => {
  world = makeWorld(freshConnection());
  mocked.connection = world.connection;
  mocked.username = "admin1";
});

afterEach(() => {
  for (const connection of opened.splice(0)) {
    if (connection.sqlite.open) connection.sqlite.close();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("the queue as written", () => {
  it("answers every case of the table correctly", () => {
    expect(
      failingQueueCases(REAL, () => makeWorld(freshConnection())).map(
        (queueCase) => queueCase.name,
      ),
    ).toEqual([]);
  });

  it("has a table with something in it", () => {
    // A matrix run against an empty table proves nothing, loudly.
    expect(QUEUE_CASES.length).toBeGreaterThan(15);
  });

  it("covers each rule with more than one case", () => {
    const perRule = new Map<string, number>();

    for (const queueCase of QUEUE_CASES) {
      perRule.set(queueCase.rule, (perRule.get(queueCase.rule) ?? 0) + 1);
    }

    for (const [rule, count] of perRule) {
      expect(count, rule).toBeGreaterThan(1);
    }
  });
});

describe("approving is one tap (#20)", () => {
  it("takes nothing but the entry's id", async () => {
    const id = world.addPending({ activity: BOOK });

    await approveLogAction(id);

    expect(world.logRow(id).status).toBe("approved");
    expect(world.logRow(id).computedHours).toBe(1.5);
  });

  it("answers with what is left, so the screen does not ask again", async () => {
    const id = world.addPending({ activity: BOOK });
    world.addPending({ activity: BOOK });

    const data = await approveLogAction(id);

    expect(data.entries).toHaveLength(1);
    expect(data.activities.map((activity) => activity.name)).toContain(BOOK);
  });

  it("records who decided, from the cookie and not from the request", async () => {
    const id = world.addPending({ activity: BOOK });
    mocked.username = "admin2";

    await approveLogAction(id);

    const admin2 = world.connection.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, "admin2"))
      .get();

    expect(world.logRow(id).reviewedBy).toBe(admin2?.id);
  });
});

/**
 * "Congela `computed_hours` e grava a linha do ledger **na mesma transação**".
 *
 * The claim is not that both writes happen; it is that neither happens without
 * the other. So the ledger insert is made to fail, after the entry has already
 * been updated, and the entry has to come back out still pending with no value
 * frozen on it.
 */
describe("the value and the ledger row are one write (#20)", () => {
  it("leaves the entry pending when the ledger row cannot be written", () => {
    const id = world.addPending({ activity: BOOK });

    // The ledger insert is made to fail where it happens — after the entry has
    // already been updated to `approved` with its value frozen on it. If the
    // two writes were not one transaction, the entry would come back approved,
    // worth three hours, with nothing in the ledger: hours a boy can see and
    // cannot spend, and no way to notice.
    //
    // A trigger rather than a duplicate row, because `ledger_owner_guard_insert`
    // already refuses to credit a log that is not yet approved — the two ways
    // of provoking the failure are the same failure, and only this one can be
    // set up while the entry is still pending.
    world.connection.sqlite.exec(
      "create trigger probe_block_ledger before insert on ledger " +
        "begin select raise(abort, 'probe: no ledger row today'); end;",
    );

    expect(() =>
      approveLog(world.connection, id, world.adminId, {}, REVIEWED_AT),
    ).toThrow(/probe: no ledger row today/);

    world.connection.sqlite.exec("drop trigger probe_block_ledger;");

    const row = world.logRow(id);

    expect(row.status).toBe("pending");
    expect(row.computedHours).toBeNull();
    expect(row.reviewedBy).toBeNull();
    expect(world.ledgerRows()).toEqual([]);
  });

  it("credits exactly one ledger row per approved entry", () => {
    const id = world.addPending({ activity: BOOK });
    approveLog(world.connection, id, world.adminId, {}, REVIEWED_AT);

    expect(world.ledgerRows()).toHaveLength(1);
    expect(world.ledgerRows()[0]?.activityLogId).toBe(id);
  });

  /**
   * The trap this module was written around: a value computed before the
   * transaction is a value computed against a bucket that has since moved.
   *
   * The preview is read first, exactly as the screen reads it, and then another
   * entry of the same day is approved before the adult taps. What is credited
   * has to be the number the bucket says at that moment, not the one the screen
   * was showing.
   */
  it("recomputes at the approval, never from the preview the screen drew", () => {
    const first = world.addPending({ activity: BOOK });
    const second = world.addPending({ activity: BOOK });

    const drawn = listPendingLogs(world.connection);

    expect(drawn.map((entry) => entry.preview?.hours)).toEqual([1.5, 1.5]);

    approveLog(world.connection, first, world.adminId, {}, REVIEWED_AT);
    approveLog(world.connection, second, world.adminId, {}, REVIEWED_AT);

    expect(world.logRow(second).computedHours).toBe(0.75);
    expect(world.ledgerRows().map((row) => row.hours)).toEqual([1.5, 0.75]);
  });
});

describe("rejecting creates nothing (D19)", () => {
  it("writes no ledger row and freezes no value", async () => {
    const id = world.addPending({ activity: BOOK });

    await rejectLogAction(id, "Você estava no celular");

    expect(world.logRow(id).status).toBe("rejected");
    expect(world.logRow(id).computedHours).toBeNull();
    expect(world.ledgerRows()).toEqual([]);
  });

  it("takes a refusal with no reason at all", async () => {
    const id = world.addPending({ activity: BOOK, note: "meia hora" });

    await rejectLogAction(id);

    expect(world.logRow(id).note).toBe("meia hora");
  });

  it("caps the reason", async () => {
    const id = world.addPending({ activity: BOOK });

    await expect(rejectLogAction(id, "x".repeat(501))).rejects.toThrow(
      /at most 500 characters/,
    );
    expect(world.logRow(id).status).toBe("pending");
  });

  it("keeps a rejected entry out of every later calculation", async () => {
    const refusedLog = world.addPending({ activity: BOOK });
    const kept = world.addPending({ activity: BOOK });

    await rejectLogAction(refusedLog);
    await approveLogAction(kept);

    // The refused hour did not fill the bucket.
    expect(world.logRow(kept).computedHours).toBe(1.5);
  });
});

describe("only an admin reaches the queue (#13)", () => {
  const forged = [
    { name: "reading it", run: () => fetchQueueAction() },
    { name: "approving from it", run: () => approveLogAction(1) },
    { name: "rejecting from it", run: () => rejectLogAction(1, "porque sim") },
  ];

  it.each(forged)("refuses a kid $name", async ({ run }) => {
    world.addPending({ activity: BOOK });
    mocked.username = "kid1";

    await expect(run()).rejects.toMatchObject({
      name: "AccessDeniedError",
      reason: "forbidden",
    });
  });

  it.each(forged)("refuses nobody at all $name", async ({ run }) => {
    world.addPending({ activity: BOOK });
    mocked.username = null;

    await expect(run()).rejects.toMatchObject({ reason: "unauthenticated" });
  });

  it("writes nothing while refusing", async () => {
    const id = world.addPending({ activity: BOOK });
    mocked.username = "kid1";

    await expect(approveLogAction(id)).rejects.toMatchObject({
      reason: "forbidden",
    });

    expect(world.logRow(id).status).toBe("pending");
    expect(world.ledgerRows()).toEqual([]);
  });

  it("holds both boys, which is why it is not about one of them", async () => {
    const kid2 = world.connection.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, "kid2"))
      .get();

    world.addPending({ activity: BOOK });
    world.connection.db
      .update(activityLogs)
      .set({ userId: kid2?.id ?? 0 })
      .run();
    world.addPending({ activity: BOOK });

    const data = await fetchQueueAction();

    expect(data.entries.map((entry) => entry.kidName).sort()).toEqual([
      "Kid1",
      "Kid2",
    ]);
  });
});

describe("counting what is waiting (#21)", () => {
  it("counts the pending entries and nothing else", () => {
    // Against a database, not a mock. Every consumer of this number stubs the
    // action, so without this the `where` is asserted by nothing: counting
    // approved and rejected rows too would put a permanent yellow badge on the
    // admin's home screen with nothing waiting, and no test would notice.
    world.addPending({ activity: BOOK });
    world.addPending({ activity: BOOK });
    world.addApproved({ activity: BOOK });

    const rejected = world.addPending({ activity: BOOK });
    rejectLog(world.connection, rejected, world.adminId, null, REVIEWED_AT);

    expect(countPendingLogs(world.connection)).toBe(2);
    expect(countPendingLogs(world.connection)).toBe(
      listPendingLogs(world.connection).length,
    );
  });

  it("is zero on a database where nobody has proposed anything", () => {
    expect(countPendingLogs(world.connection)).toBe(0);
  });

  it("refuses a kid, who has no business counting his brother's entries", async () => {
    mocked.username = "kid1";

    await expect(countPendingLogsAction()).rejects.toMatchObject({
      name: "AccessDeniedError",
      reason: "forbidden",
    });
  });

  it("refuses a request with no cookie at all", async () => {
    mocked.username = null;

    await expect(countPendingLogsAction()).rejects.toMatchObject({
      reason: "unauthenticated",
    });
  });
});
