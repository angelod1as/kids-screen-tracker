import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminWorld } from "../../db/admin.rules";
import { LAUNCHED_AT, makeAdminWorld } from "../../db/admin.rules";
import type { Connection } from "../../db/client";
import { openDatabase } from "../../db/client";
import { refundHours, releaseHours } from "../../db/ledger";
import type { LedgerModule } from "../../db/ledger.rules";
import { failingLedgerCases, LEDGER_CASES } from "../../db/ledger.rules";
import { migrateDatabase } from "../../db/migrate";
import { THAT_DAY } from "../../db/queue.rules";
import { users } from "../../db/schema";
import { seedWithTestUsers } from "../../db/test-users";
import { fetchLedgerEntriesAction } from "./history";
import {
  previewRefundAction,
  previewReleaseAction,
  refundHoursAction,
  releaseHoursAction,
} from "./ledger";

/** `ledger.rules.ts` against the real module, then the endpoints. Only the cookie is replaced. */

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

const REAL: LedgerModule = { releaseHours, refundHours };

const roots: string[] = [];
const opened: Connection[] = [];

function freshConnection(): Connection {
  const root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-ledger-"));
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
  // The endpoints read the clock; see `admin.test.ts`.
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

describe("the two movements as written", () => {
  it("answer every case of the table correctly", () => {
    expect(
      failingLedgerCases(REAL, () => makeAdminWorld(freshConnection())).map(
        (ledgerCase) => ledgerCase.name,
      ),
    ).toEqual([]);
  });

  it("have a table with something in it", () => {
    expect(LEDGER_CASES.length).toBeGreaterThan(15);
  });

  it("cover each rule with more than one case", () => {
    const perRule = new Map<string, number>();

    for (const ledgerCase of LEDGER_CASES) {
      perRule.set(ledgerCase.rule, (perRule.get(ledgerCase.rule) ?? 0) + 1);
    }

    for (const [rule, count] of perRule) {
      expect(count, rule).toBeGreaterThan(1);
    }
  });
});

describe("who may release and refund (#13)", () => {
  it("refuses a kid releasing against himself", async () => {
    mocked.username = "kid1";

    await expect(
      releaseHoursAction({ userId: world.kidId, hours: 1 }),
    ).rejects.toMatchObject({ name: "AccessDeniedError", reason: "forbidden" });
  });

  it("refuses a kid refunding himself", async () => {
    mocked.username = "kid1";

    await expect(
      refundHoursAction({
        userId: world.kidId,
        hours: 1,
        occurredOn: THAT_DAY,
        reason: "eu mereço",
      }),
    ).rejects.toMatchObject({ reason: "forbidden" });
  });

  it("refuses a kid touching his brother", async () => {
    mocked.username = "kid2";

    await expect(
      releaseHoursAction({ userId: world.kidId, hours: 1 }),
    ).rejects.toMatchObject({ reason: "forbidden" });
  });

  it("refuses a request with no cookie at all", async () => {
    mocked.username = null;

    await expect(
      releaseHoursAction({ userId: world.kidId, hours: 1 }),
    ).rejects.toMatchObject({ reason: "unauthenticated" });
  });

  it("lets the other admin do both", async () => {
    mocked.username = "admin2";

    await expect(
      releaseHoursAction({ userId: world.kidId, hours: 1 }),
    ).resolves.toMatchObject({ hours: 1, balance: -1 });
  });
});

describe("what comes back (#23, #24)", () => {
  it("says the balance the release left, below zero and all", async () => {
    await expect(
      releaseHoursAction({
        userId: world.kidId,
        hours: 2.5,
        destination: "Xbox",
      }),
    ).resolves.toEqual({ hours: 2.5, balance: -2.5 });
  });

  it("says the balance the refund left", async () => {
    await releaseHoursAction({ userId: world.kidId, hours: 2 });

    await expect(
      refundHoursAction({
        userId: world.kidId,
        hours: 2,
        occurredOn: THAT_DAY,
        reason: "ficou fora do ar",
      }),
    ).resolves.toEqual({ hours: 2, balance: 0 });
  });

  it("writes the adult who sent the request as the one who did it", async () => {
    mocked.username = "admin2";

    await releaseHoursAction({ userId: world.kidId, hours: 1 });

    expect(world.ledgerText()).toContain("by 2 to 3");
  });
});

describe("what the boy sees afterwards (#23, #24)", () => {
  it("shows a refund as a refund, named by the reason it was given", async () => {
    await refundHoursAction({
      userId: world.kidId,
      hours: 2,
      occurredOn: THAT_DAY,
      reason: "O Xbox ficou fora do ar",
    });

    mocked.username = "kid1";

    await expect(
      fetchLedgerEntriesAction(world.kidId, 5),
    ).resolves.toMatchObject([
      {
        kind: "refund",
        hours: 2,
        occurredOn: THAT_DAY,
        label: "O Xbox ficou fora do ar",
      },
    ]);
  });

  it("shows a release as a spend, named by where the hours went", async () => {
    await releaseHoursAction({
      userId: world.kidId,
      hours: 1,
      destination: "PlayStation",
    });

    mocked.username = "kid1";

    await expect(
      fetchLedgerEntriesAction(world.kidId, 5),
    ).resolves.toMatchObject([{ kind: "spend", label: "PlayStation" }]);
  });

  it("says a release with no destination has none, rather than showing nothing", async () => {
    await releaseHoursAction({ userId: world.kidId, hours: 1 });

    mocked.username = "kid1";

    await expect(
      fetchLedgerEntriesAction(world.kidId, 5),
    ).resolves.toMatchObject([{ kind: "spend", label: "Sem descrição" }]);
  });

  it("never puts one boy's movement on the other one's extract", async () => {
    await releaseHoursAction({ userId: world.otherKidId, hours: 1 });

    mocked.username = "kid1";

    await expect(fetchLedgerEntriesAction(world.kidId, 5)).resolves.toEqual([]);
  });
});

describe("the confirmation's numbers (D52)", () => {
  const REFUND = { hours: 1, occurredOn: THAT_DAY, reason: "Não usou" };

  it("reads a release's balance before and after, and writes nothing", async () => {
    await refundHoursAction({ userId: world.kidId, ...REFUND, hours: 0.58 });
    const written = world.ledgerText();

    await expect(
      previewReleaseAction({ userId: world.kidId, hours: 1 }),
    ).resolves.toEqual({
      displayName: "Kid1",
      hours: 1,
      before: 0.58,
      after: -0.42,
    });
    expect(world.ledgerText()).toBe(written);
  });

  it("reads a refund's balance before and after, and writes nothing", async () => {
    await releaseHoursAction({ userId: world.kidId, hours: 0.42 });
    const written = world.ledgerText();

    await expect(
      previewRefundAction({ userId: world.kidId, ...REFUND }),
    ).resolves.toEqual({
      displayName: "Kid1",
      hours: 1,
      before: -0.42,
      after: 0.58,
    });
    expect(world.ledgerText()).toBe(written);
  });

  it("names the boy the request carries, not another one", async () => {
    await expect(
      previewRefundAction({ userId: world.otherKidId, ...REFUND }),
    ).resolves.toMatchObject({ displayName: "Kid2" });
  });

  it("says after what the write then leaves", async () => {
    await refundHoursAction({ userId: world.kidId, ...REFUND, hours: 3 });

    const { after } = await previewReleaseAction({
      userId: world.kidId,
      hours: 1.234,
    });
    const done = await releaseHoursAction({
      userId: world.kidId,
      hours: 1.234,
    });

    expect(after).toBe(1.77);
    expect(done.balance).toBe(after);
  });

  it("refuses a kid, for himself or his brother", async () => {
    mocked.username = "kid1";

    await expect(
      previewRefundAction({ userId: world.kidId, ...REFUND }),
    ).rejects.toMatchObject({ reason: "forbidden" });
    await expect(
      previewReleaseAction({ userId: world.otherKidId, hours: 1 }),
    ).rejects.toMatchObject({ reason: "forbidden" });
  });

  it("refuses what the write would refuse: no hours, or an inactive boy", async () => {
    await expect(
      previewReleaseAction({ userId: world.kidId, hours: 0 }),
    ).rejects.toThrow("what is released");

    world.connection.db
      .update(users)
      .set({ active: false })
      .where(eq(users.id, world.kidId))
      .run();

    await expect(
      previewRefundAction({ userId: world.kidId, ...REFUND }),
    ).rejects.toThrow("D14, D33");
  });
});
