import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Connection } from "../../db/client";
import { openDatabase } from "../../db/client";
import { migrateDatabase } from "../../db/migrate";
import { ledger, spendRequests } from "../../db/schema";
import { requestSpend } from "../../db/spend-requests";
import { seedWithTestUsers } from "../../db/test-users";
import { fetchHistoryAction } from "./history";
import {
  approveSpendRequestAction,
  cancelSpendRequestAction,
  countPendingSpendRequestsAction,
  fetchOwnSpendRequestsAction,
  fetchSpendRequestsAction,
  previewSpendApprovalAction,
  rejectSpendRequestAction,
  requestSpendAction,
} from "./spend-requests";

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

const KID1 = 3;
const KID2 = 4;

const roots: string[] = [];
const opened: Connection[] = [];
let connection: Connection;

function fresh(): Connection {
  const root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-spend-act-"));
  const databasePath = join(root, "data", "kids.db");
  migrateDatabase(databasePath);
  const opening = openDatabase(databasePath);
  seedWithTestUsers(opening);
  roots.push(root);
  opened.push(opening);
  return opening;
}

beforeEach(() => {
  connection = fresh();
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

describe("requestSpendAction (D58)", () => {
  it("files the boy's own pending request", async () => {
    await requestSpendAction(KID1, {
      time: { hours: 2, minutes: 0 },
      destination: "Xbox",
      note: "quero jogar",
    });

    const [row] = connection.db.select().from(spendRequests).all();
    expect(row).toMatchObject({
      userId: KID1,
      hours: 2,
      destination: "Xbox",
      note: "quero jogar",
      status: "pending",
    });
  });

  it("refuses a request in his brother's name, and writes nothing", async () => {
    await expect(
      requestSpendAction(KID2, {
        time: { hours: 1, minutes: 0 },
        destination: "TV",
      }),
    ).rejects.toThrow();

    expect(connection.db.select().from(spendRequests).all()).toEqual([]);
  });

  it("refuses minutes of 60 or more (D33)", async () => {
    await expect(
      requestSpendAction(KID1, {
        time: { hours: 1, minutes: 60 },
        destination: "TV",
      }),
    ).rejects.toThrow(/between 0 and 59/);
  });
});

describe("the admin decision (D58)", () => {
  beforeEach(() => {
    mocked.username = "admin1";
  });

  it("lists pending requests and approves into a ledger spend", async () => {
    requestSpend(
      connection,
      KID1,
      { hours: 2, destination: "Xbox" },
      new Date(),
    );

    const pending = await fetchSpendRequestsAction();
    expect(pending).toHaveLength(1);
    const first = pending[0];
    if (first === undefined) throw new Error("no pending request");

    const movement = await approveSpendRequestAction(first.id);
    expect(movement).toMatchObject({ hours: 2, balance: -2 });

    const [spend] = connection.db.select().from(ledger).all();
    expect(spend).toMatchObject({ kind: "spend", hours: 2, createdBy: 1 });
    expect(await fetchSpendRequestsAction()).toEqual([]);
  });

  it("debits the corrected amount when the adult edits it", async () => {
    const { requestId } = requestSpend(
      connection,
      KID1,
      { hours: 2, destination: "Xbox" },
      new Date(),
    );

    const movement = await approveSpendRequestAction(requestId, {
      time: { hours: 1, minutes: 30 },
    });
    expect(movement.hours).toBe(1.5);
  });

  it("previews the resulting balance without writing (D53's manner)", async () => {
    const { requestId } = requestSpend(
      connection,
      KID1,
      { hours: 3, destination: "Xbox" },
      new Date(),
    );

    const preview = await previewSpendApprovalAction(requestId);
    expect(preview).toMatchObject({
      displayName: "Kid1",
      destination: "Xbox",
      hours: 3,
      before: 0,
      after: -3,
    });
    expect(connection.db.select().from(ledger).all()).toEqual([]);
  });

  it("rejecting moves nothing (D19)", async () => {
    const { requestId } = requestSpend(
      connection,
      KID1,
      { hours: 2, destination: "Xbox" },
      new Date(),
    );

    await rejectSpendRequestAction(requestId);

    const [row] = connection.db
      .select()
      .from(spendRequests)
      .where(eq(spendRequests.id, requestId))
      .all();
    expect(row).toMatchObject({ status: "rejected", ledgerId: null });
    expect(connection.db.select().from(ledger).all()).toEqual([]);
  });

  it("shows a rejected request in history, not only a push (D58, D52)", async () => {
    const { requestId } = requestSpend(
      connection,
      KID1,
      { hours: 2, destination: "Xbox" },
      new Date(),
    );
    await rejectSpendRequestAction(requestId, "agora não");

    mocked.username = "kid1";
    const [entry] = await fetchHistoryAction(KID1, 10);

    expect(entry).toMatchObject({
      kind: "rejected",
      label: "Xbox",
      reason: "agora não",
      decidedBy: "Admin1",
      fromSpendRequest: true,
    });
  });

  it("counts the pending requests for the admin home", async () => {
    requestSpend(
      connection,
      KID1,
      { hours: 2, destination: "Xbox" },
      new Date(),
    );

    expect(await countPendingSpendRequestsAction()).toBe(1);
  });

  it("shows the approved spend in history as a request (D58)", async () => {
    const { requestId } = requestSpend(
      connection,
      KID1,
      { hours: 2, destination: "Xbox", note: "quero jogar" },
      new Date(),
    );
    await approveSpendRequestAction(requestId);

    mocked.username = "kid1";
    const [entry] = await fetchHistoryAction(KID1, 10);

    expect(entry).toMatchObject({
      kind: "spend",
      hours: 2,
      label: "Xbox",
      observation: "quero jogar",
      requestedBy: "Kid1",
      decidedBy: "Admin1",
    });
  });

  it("refuses a kid at the admin endpoints", async () => {
    mocked.username = "kid1";
    const { requestId } = requestSpend(
      connection,
      KID1,
      { hours: 2, destination: "Xbox" },
      new Date(),
    );

    await expect(fetchSpendRequestsAction()).rejects.toThrow();
    await expect(approveSpendRequestAction(requestId)).rejects.toThrow();
  });
});

describe("the boy's own requests and cancelling (D59)", () => {
  function filed(userId: number, destination: string): number {
    return requestSpend(
      connection,
      userId,
      { hours: 2, destination },
      new Date(),
    ).requestId;
  }

  function statusOf(requestId: number) {
    return connection.db
      .select()
      .from(spendRequests)
      .where(eq(spendRequests.id, requestId))
      .get();
  }

  it("shows him his own pending, approved and rejected requests, and only his", async () => {
    const pending = filed(KID1, "Xbox");
    const approved = filed(KID1, "TV");
    const rejected = filed(KID1, "Celular");
    filed(KID2, "Do irmão");

    mocked.username = "admin1";
    await approveSpendRequestAction(approved, {
      time: { hours: 1, minutes: 30 },
    });
    await rejectSpendRequestAction(rejected);

    mocked.username = "kid1";
    const own = await fetchOwnSpendRequestsAction(KID1);

    expect(own.map((request) => [request.id, request.status])).toEqual(
      expect.arrayContaining([
        [pending, "pending"],
        [approved, "approved"],
        [rejected, "rejected"],
      ]),
    );
    expect(own).toHaveLength(3);
    expect(own.find((request) => request.id === approved)).toMatchObject({
      hours: 2,
      approvedHours: 1.5,
    });
    expect(own.some((request) => request.destination === "Do irmão")).toBe(
      false,
    );
  });

  it("refuses to show him his brother's requests", async () => {
    filed(KID2, "Do irmão");

    await expect(fetchOwnSpendRequestsAction(KID2)).rejects.toThrow(
      "Acesso negado.",
    );
  });

  it("cancels his own pending request and leaves no ledger row", async () => {
    const requestId = filed(KID1, "Xbox");

    await cancelSpendRequestAction(requestId);

    expect(statusOf(requestId)).toMatchObject({
      status: "cancelled",
      ledgerId: null,
      reviewedBy: KID1,
    });
    expect(connection.db.select().from(ledger).all()).toEqual([]);

    mocked.username = "admin1";
    expect(await fetchSpendRequestsAction()).toEqual([]);
    expect(await countPendingSpendRequestsAction()).toBe(0);
    await expect(approveSpendRequestAction(requestId)).rejects.toThrow(
      /no pending spend request/,
    );
    expect(connection.db.select().from(ledger).all()).toEqual([]);
  });

  it("refuses to cancel an approved or a rejected request, and changes nothing", async () => {
    const approved = filed(KID1, "TV");
    const rejected = filed(KID1, "Celular");
    mocked.username = "admin1";
    await approveSpendRequestAction(approved);
    await rejectSpendRequestAction(rejected);
    const before = connection.db.select().from(spendRequests).all();

    mocked.username = "kid1";
    await expect(cancelSpendRequestAction(approved)).rejects.toThrow();
    await expect(cancelSpendRequestAction(rejected)).rejects.toThrow();

    expect(connection.db.select().from(spendRequests).all()).toEqual(before);
    expect(connection.db.select().from(ledger).all()).toHaveLength(1);
  });

  it("refuses to cancel his brother's request with the fixed sentence an unknown id gets", async () => {
    const brothers = filed(KID2, "Do irmão");

    await expect(cancelSpendRequestAction(brothers)).rejects.toThrow(
      "Acesso negado.",
    );
    await expect(cancelSpendRequestAction(9999)).rejects.toThrow(
      "Acesso negado.",
    );
    expect(statusOf(brothers)).toMatchObject({ status: "pending" });
  });

  it("does not let an adult cancel: he refuses instead (D19)", async () => {
    const requestId = filed(KID1, "Xbox");
    mocked.username = "admin1";

    await expect(cancelSpendRequestAction(requestId)).rejects.toThrow();
    expect(statusOf(requestId)).toMatchObject({ status: "pending" });
  });

  it("refuses a signed-out caller before reading anything", async () => {
    const requestId = filed(KID1, "Xbox");
    mocked.username = null;

    await expect(cancelSpendRequestAction(requestId)).rejects.toThrow(
      "Acesso negado.",
    );
    expect(statusOf(requestId)).toMatchObject({ status: "pending" });
  });

  it("keeps a cancelled request out of the history", async () => {
    const requestId = filed(KID1, "Xbox");
    await cancelSpendRequestAction(requestId);

    expect(await fetchHistoryAction(KID1, 10)).toEqual([]);
  });
});
