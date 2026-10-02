import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "../../db/client";
import { migrateDatabase } from "../../db/migrate";
import { ledger } from "../../db/schema";
import { seedWithTestUsers } from "../../db/test-users";
import { fetchDashboardAction } from "./dashboard";

/** #9: the direct call a kid can forge. Only the cookie is mocked. */

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
const KID2 = 4;
/** Not round, so a leak shows. */
const KID2_EARNED = 7.25;

let root: string;
let connection: ReturnType<typeof openDatabase>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-dashboard-action-"));
  const databasePath = join(root, "data", "kids.db");
  migrateDatabase(databasePath);
  connection = openDatabase(databasePath);
  seedWithTestUsers(connection);
  mocked.connection = connection;

  connection.db
    .insert(ledger)
    .values({
      userId: KID2,
      kind: "earn",
      hours: KID2_EARNED,
      occurredOn: "2026-09-01",
      createdBy: ADMIN1,
    })
    .run();
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

describe("a kid calling the dashboard directly", () => {
  for (const kidId of [null, KID1, KID2]) {
    it(`is refused, kidId ${kidId}`, async () => {
      mocked.username = "kid1";

      await expect(
        fetchDashboardAction({ kidId, period: "all" }),
      ).rejects.toMatchObject({
        name: "AccessDeniedError",
        reason: "forbidden",
      });
    });
  }

  it("learns nothing from the refusal", async () => {
    mocked.username = "kid1";

    const error = await fetchDashboardAction({ kidId: KID2, period: "all" })
      .then(() => {
        throw new Error("expected a refusal");
      })
      .catch((thrown: Error) => thrown);

    expect(error.message).toBe("Acesso negado.");
    expect(
      JSON.stringify(error, Object.getOwnPropertyNames(error)),
    ).not.toContain(String(KID2_EARNED));
  });
});

describe("nobody at all", () => {
  it("is refused as unauthenticated", async () => {
    mocked.username = null;

    await expect(
      fetchDashboardAction({ kidId: null, period: "4w" }),
    ).rejects.toMatchObject({ reason: "unauthenticated" });
  });
});

describe("an admin", () => {
  it("reads both boys", async () => {
    mocked.username = "admin1";

    const dashboard = await fetchDashboardAction({
      kidId: null,
      period: "all",
    });

    expect(dashboard.balances.map((kid) => kid.id)).toEqual([KID1, KID2]);
    expect(dashboard.balances[1]?.earned).toBe(KID2_EARNED);
  });

  it("reads one boy", async () => {
    mocked.username = "admin1";

    const dashboard = await fetchDashboardAction({ kidId: KID1, period: "4w" });

    expect(dashboard.balances.map((kid) => kid.id)).toEqual([KID1]);
    expect(dashboard.days).toHaveLength(28);
  });

  it("is refused an id that is not a boy's (D33)", async () => {
    mocked.username = "admin1";

    await expect(
      fetchDashboardAction({ kidId: ADMIN1, period: "all" }),
    ).rejects.toThrow("not a boy");
  });
});
