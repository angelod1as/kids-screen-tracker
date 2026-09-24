import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "../../db/client";
import { migrateDatabase } from "../../db/migrate";
import { ledger, users } from "../../db/schema";
import { seedWithTestUsers } from "../../db/test-users";
import { fetchBalanceAction } from "./balance";
import { listKidsAction } from "./people";

/** Sends the forged POST with the brother's id (#13). Only the cookie is mocked. */

const mocked = vi.hoisted(() => ({
  username: null as string | null,
  db: null as unknown,
}));

vi.mock("../../auth/session", () => ({
  SESSION_COOKIE_NAME: "kst_session",
  readSessionUsername: async () => mocked.username,
  startSession: async () => undefined,
  endSession: async () => undefined,
}));

vi.mock("../../db", () => ({
  getDb: () => mocked.db,
}));

let root: string;
let connection: ReturnType<typeof openDatabase>;
let ids: Map<string, number>;

/** Kid1's ledger, in hours: 4 earned, 1,5 spent, 0,25 refunded. */
const KID1_BALANCE = 2.75;
/** Not round and not Kid1's, so a leak shows as a wrong value. */
const KID2_BALANCE = 7.25;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-balance-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);
  connection = openDatabase(databasePath);
  seedWithTestUsers(connection);

  mocked.db = connection.db;
  mocked.username = null;

  ids = new Map(
    connection.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .all()
      .map((row) => [row.username, row.id] as const),
  );

  const admin1 = idOf("admin1");
  connection.db
    .insert(ledger)
    .values([
      {
        userId: idOf("kid1"),
        kind: "earn",
        hours: 4,
        occurredOn: "2026-09-01",
        createdBy: admin1,
      },
      {
        userId: idOf("kid1"),
        kind: "spend",
        hours: 1.5,
        occurredOn: "2026-09-01",
        createdBy: admin1,
      },
      {
        userId: idOf("kid1"),
        kind: "refund",
        hours: 0.25,
        occurredOn: "2026-09-02",
        createdBy: admin1,
      },
      {
        userId: idOf("kid2"),
        kind: "earn",
        hours: 10.5,
        occurredOn: "2026-09-01",
        createdBy: admin1,
      },
      {
        userId: idOf("kid2"),
        kind: "spend",
        hours: 3.25,
        occurredOn: "2026-09-02",
        createdBy: admin1,
      },
    ])
    .run();
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

function idOf(username: string): number {
  const id = ids.get(username);
  if (id === undefined) {
    throw new Error(`the seed has no user named ${username}`);
  }

  return id;
}

describe("a kid reading his own balance", () => {
  it("gets it", async () => {
    mocked.username = "kid1";

    await expect(fetchBalanceAction(idOf("kid1"))).resolves.toBe(KID1_BALANCE);
  });

  it("gets earn plus refund minus spend", async () => {
    mocked.username = "kid2";

    await expect(fetchBalanceAction(idOf("kid2"))).resolves.toBe(KID2_BALANCE);
  });
});

/** Fails if the call resolved, so a guard that stopped guarding cannot pass. */
async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (thrown) {
    return thrown as Error;
  }

  throw new Error("expected the call to be refused, and it was not");
}

describe("a kid forging his brother's id", () => {
  it("is refused, and gets no number at all", async () => {
    mocked.username = "kid1";

    await expect(fetchBalanceAction(idOf("kid2"))).rejects.toMatchObject({
      name: "AccessDeniedError",
      reason: "forbidden",
    });
  });

  it("is refused in the other direction too", async () => {
    mocked.username = "kid2";

    await expect(fetchBalanceAction(idOf("kid1"))).rejects.toMatchObject({
      name: "AccessDeniedError",
      reason: "forbidden",
    });
  });

  it("is refused for an admin's id", async () => {
    mocked.username = "kid1";

    await expect(fetchBalanceAction(idOf("admin1"))).rejects.toMatchObject({
      reason: "forbidden",
    });
  });

  it("learns nothing from the refusal about the other balance", async () => {
    mocked.username = "kid1";

    const error = await refusal(fetchBalanceAction(idOf("kid2")));

    expect(error.message).toBe("Acesso negado.");
    expect(
      JSON.stringify(error, Object.getOwnPropertyNames(error)),
    ).not.toContain(String(KID2_BALANCE));
  });

  it("cannot get his brother's id out of the app either", async () => {
    // The only endpoint that hands out both ids is admin-only.
    mocked.username = "kid1";

    await expect(listKidsAction()).rejects.toMatchObject({
      reason: "forbidden",
    });
  });
});

describe("nobody at all", () => {
  it("is refused as unauthenticated", async () => {
    mocked.username = null;

    await expect(fetchBalanceAction(idOf("kid1"))).rejects.toMatchObject({
      reason: "unauthenticated",
    });
  });

  it("is refused even for an id that does not exist", async () => {
    mocked.username = null;

    await expect(fetchBalanceAction(9999)).rejects.toMatchObject({
      reason: "unauthenticated",
    });
  });
});

describe("an admin", () => {
  it("reads both boys", async () => {
    mocked.username = "admin1";

    await expect(fetchBalanceAction(idOf("kid1"))).resolves.toBe(KID1_BALANCE);
    await expect(fetchBalanceAction(idOf("kid2"))).resolves.toBe(KID2_BALANCE);
  });

  it("reads them as the other admin too", async () => {
    mocked.username = "admin2";

    await expect(fetchBalanceAction(idOf("kid2"))).resolves.toBe(KID2_BALANCE);
  });

  it("gets the two boys, in seed order, from listKidsAction", async () => {
    mocked.username = "admin1";

    await expect(listKidsAction()).resolves.toEqual([
      { id: idOf("kid1"), displayName: "Kid1" },
      { id: idOf("kid2"), displayName: "Kid2" },
    ]);
  });
});

describe("the balance itself", () => {
  it("is zero for a boy with no ledger rows", async () => {
    connection.db.delete(ledger).run();
    mocked.username = "kid1";

    await expect(fetchBalanceAction(idOf("kid1"))).resolves.toBe(0);
  });

  it("may go negative, without limit", async () => {
    connection.db.delete(ledger).run();
    connection.db
      .insert(ledger)
      .values({
        userId: idOf("kid1"),
        kind: "spend",
        hours: 12.5,
        occurredOn: "2026-09-02",
        createdBy: idOf("admin1"),
      })
      .run();
    mocked.username = "kid1";

    await expect(fetchBalanceAction(idOf("kid1"))).resolves.toBe(-12.5);
  });

  it("rounds to two decimals, once (D9)", async () => {
    connection.db.delete(ledger).run();
    connection.db
      .insert(ledger)
      .values([
        {
          userId: idOf("kid1"),
          kind: "earn",
          hours: 0.1,
          occurredOn: "2026-09-01",
          createdBy: idOf("admin1"),
        },
        {
          userId: idOf("kid1"),
          kind: "earn",
          hours: 0.2,
          occurredOn: "2026-09-01",
          createdBy: idOf("admin1"),
        },
      ])
      .run();
    mocked.username = "kid1";

    // 0.1 + 0.2 must not render with sixteen decimals.
    await expect(fetchBalanceAction(idOf("kid1"))).resolves.toBe(0.3);
  });
});
