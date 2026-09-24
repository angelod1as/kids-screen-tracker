import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { launchEntry, previewEntry } from "../../db/admin";
import type { AdminModule, AdminWorld } from "../../db/admin.rules";
import {
  ADMIN_CASES,
  FREE,
  failingAdminCases,
  LAUNCHED_AT,
  makeAdminWorld,
} from "../../db/admin.rules";
import type { Connection } from "../../db/client";
import { openDatabase } from "../../db/client";
import { migrateDatabase } from "../../db/migrate";
import { listPendingLogs } from "../../db/queue";
import { BOOK, THAT_DAY } from "../../db/queue.rules";
import { activities, activityLogs } from "../../db/schema";
import { seedWithTestUsers } from "../../db/test-users";
import {
  fetchLaunchDataAction,
  launchEntryAction,
  previewEntryAction,
} from "./admin";

/**
 * Launching an activity, end to end (#22).
 *
 * Two halves, as in `queue.test.ts`. The first runs `admin.rules.ts` against
 * the real module, which is where the rules of the launch live; the second is
 * about the endpoints — who may call them, and whose id ends up in
 * `reviewed_by`.
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

const REAL: AdminModule = { previewEntry, launchEntry };

const roots: string[] = [];
const opened: Connection[] = [];

function freshConnection(): Connection {
  const root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-admin-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);

  const connection = openDatabase(databasePath);
  seedWithTestUsers(connection);

  roots.push(root);
  opened.push(connection);

  return connection;
}

let world: AdminWorld;

/**
 * The clock the endpoints read.
 *
 * The rules table hands `now` in, so its cases are independent of the machine's
 * clock; an action takes it from `new Date()`, which is the whole point — the
 * day an entry may not be dated after is the server's day and not a parameter
 * anybody can send. So the clock is fixed to the same moment the fixtures are
 * built around, and `Date` is the only thing faked.
 */
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

describe("the launch as written", () => {
  it("answers every case of the table correctly", () => {
    expect(
      failingAdminCases(REAL, () => makeAdminWorld(freshConnection())).map(
        (adminCase) => adminCase.name,
      ),
    ).toEqual([]);
  });

  it("has a table with something in it", () => {
    // A matrix run against an empty table proves nothing, loudly.
    expect(ADMIN_CASES.length).toBeGreaterThan(25);
  });

  it("covers each rule with more than one case", () => {
    const perRule = new Map<string, number>();

    for (const adminCase of ADMIN_CASES) {
      perRule.set(adminCase.rule, (perRule.get(adminCase.rule) ?? 0) + 1);
    }

    for (const [rule, count] of perRule) {
      expect(count, rule).toBeGreaterThan(1);
    }
  });
});

/** The entry the endpoint cases send. */
function entry(userId: number) {
  return {
    userId,
    activityId: world.activityId(BOOK),
    occurredOn: THAT_DAY,
    durationMinutes: 60,
  };
}

describe("who may launch (#13)", () => {
  it("refuses a kid launching for himself", async () => {
    mocked.username = "kid1";

    await expect(launchEntryAction(entry(world.kidId))).rejects.toMatchObject({
      name: "AccessDeniedError",
      reason: "forbidden",
    });
  });

  it("refuses a kid launching for his brother", async () => {
    mocked.username = "kid1";

    await expect(
      launchEntryAction(entry(world.otherKidId)),
    ).rejects.toMatchObject({ reason: "forbidden" });
  });

  it("refuses a kid asking what something would be worth for his brother", async () => {
    mocked.username = "kid1";

    await expect(
      previewEntryAction(entry(world.otherKidId)),
    ).rejects.toMatchObject({ reason: "forbidden" });
  });

  it("refuses a kid the pickers as well", async () => {
    mocked.username = "kid1";

    await expect(fetchLaunchDataAction()).rejects.toMatchObject({
      reason: "forbidden",
    });
  });

  it("refuses a request with no cookie at all", async () => {
    mocked.username = null;

    await expect(launchEntryAction(entry(world.kidId))).rejects.toMatchObject({
      reason: "unauthenticated",
    });
  });

  it("lets the other admin launch too", async () => {
    mocked.username = "admin2";

    await expect(launchEntryAction(entry(world.kidId))).resolves.toMatchObject({
      hours: 1.5,
    });
  });
});

describe("what the launch writes (#22, D18)", () => {
  it("stamps the adult who sent the request, not the one in the payload", async () => {
    mocked.username = "admin2";

    const { logId } = await launchEntryAction(entry(world.kidId));
    const row = world.connection.db
      .select({
        createdBy: activityLogs.createdBy,
        reviewedBy: activityLogs.reviewedBy,
        source: activityLogs.source,
        status: activityLogs.status,
      })
      .from(activityLogs)
      .where(eq(activityLogs.id, logId))
      .get();

    // Admin2 is the second seeded user, and nothing in the request said so.
    expect(row).toMatchObject({
      createdBy: 2,
      reviewedBy: 2,
      source: "admin",
      status: "approved",
    });
  });

  it("answers with the balance the entry left behind", async () => {
    await expect(launchEntryAction(entry(world.kidId))).resolves.toMatchObject({
      hours: 1.5,
      creditedLedger: true,
      balance: 1.5,
    });
  });
});

describe("what the pickers offer (#22, D14)", () => {
  it("includes the free activity the boy's calculator leaves out (D12)", async () => {
    const data = await fetchLaunchDataAction();

    expect(data.activities.map((activity) => activity.name)).toContain(FREE);
  });

  it("leaves out a deactivated activity", async () => {
    world.setActivityActive(BOOK, false);

    const data = await fetchLaunchDataAction();

    expect(data.activities.map((activity) => activity.name)).not.toContain(
      BOOK,
    );
  });

  it("leaves out an active activity under a deactivated category", async () => {
    world.setCategoryActive("Mente", false);

    const data = await fetchLaunchDataAction();

    expect(data.activities.map((activity) => activity.name)).not.toContain(
      BOOK,
    );
  });

  it("offers every seeded activity while nothing is switched off", async () => {
    // The list is what the criterion is about; a picker that lost half the
    // table would still pass the two cases above.
    const data = await fetchLaunchDataAction();
    const live = world.connection.db
      .select({ id: activities.id })
      .from(activities)
      .all();

    expect(data.activities).toHaveLength(live.length);
  });

  it("says what today is, in São Paulo", async () => {
    const data = await fetchLaunchDataAction();

    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("the preview is not the write", () => {
  it("computes again, so two launches of one day do not both read an empty bucket", async () => {
    const asked = await previewEntryAction(entry(world.kidId));

    await launchEntryAction(entry(world.kidId));

    const second = await launchEntryAction(entry(world.kidId));

    // The preview said 1,5 hours and was true when it was drawn; the second
    // launch reads the bucket the first one filled.
    expect(asked.calculation.hours).toBe(1.5);
    expect(second.hours).toBe(0.75);
  });

  it("leaves nothing behind when a launch is refused", async () => {
    // A pending entry earlier in the canonical order (D32): the launch is
    // refused, and neither the log nor the ledger row exists afterwards.
    // Counting the logs matters as much as the ledger — the refusal happens
    // before the insert, so a ledger assertion alone would pass with no
    // transaction at all and would be testing the ordering, not the rollback.
    const before = world.logCount();

    world.addPending({ activity: BOOK, occurredOn: THAT_DAY });

    await expect(launchEntryAction(entry(world.kidId))).rejects.toThrow(
      /comes before it and is still waiting/,
    );

    expect(world.ledgerText()).toBe("no ledger");
    expect(world.logCount()).toBe(before + 1);
  });

  it("pays a retroactive launch out of what the days after it spent (D34)", async () => {
    // The case D34 was written for, through the endpoint: Tuesday's wash is
    // frozen first and keeps its 3 h; Monday is launched afterwards, reads the
    // seven-day allowance Tuesday already spent, and is credited half. The
    // pair costs 4,5 h, which is what the cooldown owes — it used to cost 6 h.
    const tuesday = world.addApproved({
      activity: "Lavar o carro",
      occurredOn: "2026-09-08",
      durationMinutes: null,
      quality: 1,
      hours: 3,
    });

    const monday = await launchEntryAction({
      userId: world.kidId,
      activityId: world.activityId("Lavar o carro"),
      occurredOn: "2026-09-07",
      durationMinutes: null,
      quality: 1,
    });

    expect(monday.hours).toBe(1.5);
    expect(world.logRow(tuesday).computedHours).toBe(3);
    // The explanation the adult reads names the rule that halved it.
    expect(monday.calculation.lines.map((line) => line.text)).toContain(
      "metade, você fez isso outra vez em 7 dias",
    );
  });

  it("names the same blocker the queue would name (D32, one rule)", async () => {
    // `pendingBefore` is written twice — once for the approval and once for
    // the launch — and each copy has a matrix of its own. What no matrix can
    // see is the two drifting apart, which is the failure this project keeps
    // finding. So one fixture is put to both: the queue's second entry and a
    // launch of the same shape have to name the same waiting entry.
    const first = world.addPending({ activity: BOOK, occurredOn: THAT_DAY });
    world.addPending({ activity: BOOK, occurredOn: THAT_DAY });

    const queued = listPendingLogs(world.connection)[1]?.blockedBy;
    const launched = await previewEntryAction(entry(world.kidId));

    expect(queued?.id).toBe(first);
    expect(launched.blockedBy?.id).toBe(first);
  });
});
