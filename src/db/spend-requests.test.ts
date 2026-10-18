import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { Connection } from "./client";
import { openDatabase } from "./client";
import { migrateDatabase } from "./migrate";
import { ledger, spendRequests } from "./schema";
import {
  approveSpendRequest,
  countPendingSpendRequests,
  listPendingSpendRequests,
  rejectSpendRequest,
  requestSpend,
} from "./spend-requests";
import { seedWithTestUsers } from "./test-users";

const KID1 = 3;
const KID2 = 4;
const ADMIN1 = 1;

const roots: string[] = [];

function fresh(): Connection {
  const root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-spend-req-"));
  migrateDatabase(join(root, "data", "kids.db"));
  const connection = openDatabase(join(root, "data", "kids.db"));
  seedWithTestUsers(connection);
  roots.push(root);
  return connection;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const NOW = new Date("2026-10-18T15:00:00Z");

describe("requestSpend", () => {
  it("files the boy's own pending request", () => {
    const connection = fresh();

    const { requestId } = requestSpend(
      connection,
      KID1,
      { hours: 2, destination: "Xbox", note: "quero jogar" },
      NOW,
    );

    const row = connection.db
      .select()
      .from(spendRequests)
      .where(eq(spendRequests.id, requestId))
      .get();

    expect(row).toMatchObject({
      userId: KID1,
      hours: 2,
      destination: "Xbox",
      note: "quero jogar",
      status: "pending",
      createdBy: KID1,
      ledgerId: null,
      reviewedBy: null,
    });
  });

  it("refuses an empty destination (D58: the what-for is required)", () => {
    const connection = fresh();

    expect(() =>
      requestSpend(connection, KID1, { hours: 1, destination: "  " }, NOW),
    ).toThrow(/destination/);
  });

  it("refuses an inactive or unknown kid (D33)", () => {
    const connection = fresh();

    expect(() =>
      requestSpend(connection, 999, { hours: 1, destination: "Xbox" }, NOW),
    ).toThrow();
  });

  it("may exceed the balance: no floor (D58)", () => {
    const connection = fresh();

    expect(() =>
      requestSpend(connection, KID1, { hours: 50, destination: "TV" }, NOW),
    ).not.toThrow();
  });
});

describe("listPendingSpendRequests", () => {
  it("returns pending requests with the boy's name, oldest first", () => {
    const connection = fresh();
    requestSpend(connection, KID1, { hours: 2, destination: "Xbox" }, NOW);
    requestSpend(connection, KID2, { hours: 1, destination: "TV" }, NOW);

    const pending = listPendingSpendRequests(connection);

    expect(pending.map((p) => p.destination)).toEqual(["Xbox", "TV"]);
    expect(pending[0]).toMatchObject({ userId: KID1, userName: "Kid1" });
  });

  it("drops a decided request", () => {
    const connection = fresh();
    const { requestId } = requestSpend(
      connection,
      KID1,
      { hours: 2, destination: "Xbox" },
      NOW,
    );
    approveSpendRequest(connection, requestId, ADMIN1, {}, NOW);

    expect(listPendingSpendRequests(connection)).toEqual([]);
  });
});

describe("countPendingSpendRequests", () => {
  it("counts only the pending ones", () => {
    const connection = fresh();
    requestSpend(connection, KID1, { hours: 2, destination: "Xbox" }, NOW);
    const { requestId } = requestSpend(
      connection,
      KID2,
      { hours: 1, destination: "TV" },
      NOW,
    );
    rejectSpendRequest(connection, requestId, ADMIN1, null, NOW);

    expect(countPendingSpendRequests(connection)).toBe(1);
  });
});

describe("approveSpendRequest", () => {
  it("writes a ledger spend and links it, naming the approver (D58)", () => {
    const connection = fresh();
    const { requestId } = requestSpend(
      connection,
      KID1,
      { hours: 2, destination: "Xbox", note: "quero jogar" },
      NOW,
    );

    const result = approveSpendRequest(connection, requestId, ADMIN1, {}, NOW);

    expect(result).toMatchObject({ hours: 2, occurredOn: "2026-10-18" });

    const request = connection.db
      .select()
      .from(spendRequests)
      .where(eq(spendRequests.id, requestId))
      .get();
    expect(request).toMatchObject({
      status: "approved",
      reviewedBy: ADMIN1,
    });
    expect(request?.ledgerId).not.toBeNull();

    const spend = connection.db
      .select()
      .from(ledger)
      .where(eq(ledger.id, request?.ledgerId as number))
      .get();
    expect(spend).toMatchObject({
      userId: KID1,
      kind: "spend",
      hours: 2,
      destination: "Xbox",
      note: "quero jogar",
      createdBy: ADMIN1,
      occurredOn: "2026-10-18",
    });
  });

  it("debits the adult's corrected amount when given (D58)", () => {
    const connection = fresh();
    const { requestId } = requestSpend(
      connection,
      KID1,
      { hours: 2, destination: "Xbox" },
      NOW,
    );

    approveSpendRequest(connection, requestId, ADMIN1, { hours: 1.5 }, NOW);

    const request = connection.db
      .select()
      .from(spendRequests)
      .where(eq(spendRequests.id, requestId))
      .get();
    const spend = connection.db
      .select()
      .from(ledger)
      .where(eq(ledger.id, request?.ledgerId as number))
      .get();
    expect(spend?.hours).toBe(1.5);
  });

  it("refuses a request that is not pending", () => {
    const connection = fresh();
    const { requestId } = requestSpend(
      connection,
      KID1,
      { hours: 2, destination: "Xbox" },
      NOW,
    );
    approveSpendRequest(connection, requestId, ADMIN1, {}, NOW);

    expect(() =>
      approveSpendRequest(connection, requestId, ADMIN1, {}, NOW),
    ).toThrow();
  });
});

describe("rejectSpendRequest", () => {
  it("moves nothing: no ledger row, marked rejected (D19)", () => {
    const connection = fresh();
    const { requestId } = requestSpend(
      connection,
      KID1,
      { hours: 2, destination: "Xbox" },
      NOW,
    );

    rejectSpendRequest(connection, requestId, ADMIN1, null, NOW);

    const request = connection.db
      .select()
      .from(spendRequests)
      .where(eq(spendRequests.id, requestId))
      .get();
    expect(request).toMatchObject({
      status: "rejected",
      reviewedBy: ADMIN1,
      ledgerId: null,
    });
    expect(connection.db.select().from(ledger).all()).toEqual([]);
  });

  it("keeps the reason beside the boy's comment, never over it (#20)", () => {
    const connection = fresh();
    const { requestId } = requestSpend(
      connection,
      KID1,
      { hours: 2, destination: "Xbox", note: "quero jogar" },
      NOW,
    );

    rejectSpendRequest(connection, requestId, ADMIN1, "agora não", NOW);

    const request = connection.db
      .select()
      .from(spendRequests)
      .where(eq(spendRequests.id, requestId))
      .get();
    expect(request?.note).toBe("quero jogar\nRecusado: agora não");
  });
});
