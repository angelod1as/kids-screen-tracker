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
  countPendingSpendRequestsAction,
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
    await rejectSpendRequestAction(requestId);

    mocked.username = "kid1";
    const [entry] = await fetchHistoryAction(KID1, 10);

    expect(entry).toMatchObject({
      kind: "rejected",
      label: "Xbox",
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
