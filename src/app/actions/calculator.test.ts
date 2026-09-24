import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "../../db/client";
import { migrateDatabase } from "../../db/migrate";
import { activities, activityLogs, categories, users } from "../../db/schema";
import { seedWithTestUsers } from "../../db/test-users";
import {
  approvedOnly,
  calculateEarnedHours,
  historyLookbackDays,
  historyWindowStart,
  shiftDate,
} from "../../engine/calculate";
import { fetchCalculatorDataAction } from "./calculator";

/** D37: the bucket an approved fixture row counted under. */
function categoryOf(
  connection: ReturnType<typeof openDatabase>,
  activityId: number,
): number {
  const row = connection.db
    .select({ categoryId: activities.categoryId })
    .from(activities)
    .where(eq(activities.id, activityId))
    .get();

  if (row === undefined) throw new Error(`no activity ${activityId}`);

  return row.categoryId;
}

/**
 * The whole server side of #17: a missing `user_id` filter, a short window or a
 * pending row here is a plausible wrong number downstream. Only the cookie is
 * mocked.
 */

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
let today: string;

/** "Ler livro" and "Futebol ou outro esporte coletivo" in the seed. */
const BOOK = 5;
const FOOTBALL = 1;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-calculator-"));
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

  today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

function addLog(options: {
  username: string;
  activityId: number;
  occurredOn: string;
  durationMinutes?: number;
  status?: "pending" | "approved" | "rejected";
}): number {
  const status = options.status ?? "approved";
  const admin1 = idOf("admin1");
  const stamp = new Date(`${options.occurredOn}T15:00:00Z`);

  return connection.db
    .insert(activityLogs)
    .values({
      userId: idOf(options.username),
      activityId: options.activityId,
      // D37: a pending row has consumed no bucket yet, and the CHECK requires the null.
      categoryId:
        status === "approved"
          ? categoryOf(connection, options.activityId)
          : null,
      status,
      source: "admin",
      occurredOn: options.occurredOn,
      durationMinutes: options.durationMinutes ?? null,
      computedHours: status === "approved" ? 2 : null,
      createdBy: admin1,
      reviewedBy: status === "pending" ? null : admin1,
      reviewedAt: status === "pending" ? null : stamp,
      createdAt: stamp,
    })
    .returning({ id: activityLogs.id })
    .get().id;
}

describe("what the calculator is given (#17)", () => {
  it("offers the seeded activities, grouped under their categories", async () => {
    mocked.username = "kid1";

    const data = await fetchCalculatorDataAction(idOf("kid1"));

    expect(data.categories.map((category) => category.name)).toEqual([
      "Corpo",
      "Mente",
      "Criativo",
      "Convívio",
      "Escola",
      "Casa",
      "Curinga",
    ]);
    expect(data.activities).toHaveLength(31);
    expect(
      data.activities.every((activity) =>
        data.categories.some((category) => category.id === activity.categoryId),
      ),
    ).toBe(true);
  });

  it("leaves out the `free` activity, whose value only an adult can type", async () => {
    // D12: the engine refuses `free` without a value; offering it would throw.
    mocked.username = "kid1";

    const data = await fetchCalculatorDataAction(idOf("kid1"));

    expect(data.activities.map((activity) => activity.calcMode)).not.toContain(
      "free",
    );
    expect(data.activities.map((activity) => activity.name)).not.toContain(
      "Atividade avulsa",
    );
  });

  it("leaves out an activity that was deactivated (D14)", async () => {
    connection.db
      .update(activities)
      .set({ active: false })
      .where(eq(activities.id, BOOK))
      .run();
    mocked.username = "kid1";

    const data = await fetchCalculatorDataAction(idOf("kid1"));

    expect(data.activities.map((activity) => activity.id)).not.toContain(BOOK);
  });

  it("leaves out an activity whose category was deactivated", async () => {
    connection.db
      .update(categories)
      .set({ active: false })
      .where(eq(categories.id, 2))
      .run();
    mocked.username = "kid1";

    const data = await fetchCalculatorDataAction(idOf("kid1"));

    expect(data.categories.map((category) => category.id)).not.toContain(2);
    expect(
      data.activities.map((activity) => activity.categoryId),
    ).not.toContain(2);
  });

  it("says which day it is, in São Paulo (D13)", async () => {
    mocked.username = "kid1";

    const data = await fetchCalculatorDataAction(idOf("kid1"));

    expect(data.occurredOn).toBe(today);
    expect(data.occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("says the São Paulo day at half past eleven at night (D13)", async () => {
    // Pinned: the ISO-slice bug D13 guards against only shows between 21:00
    // and midnight in São Paulo. 02:30Z is 23:30 the day before.
    vi.useFakeTimers({ toFake: ["Date"] });

    try {
      vi.setSystemTime(new Date("2026-09-03T02:30:00Z"));
      mocked.username = "kid1";

      const data = await fetchCalculatorDataAction(idOf("kid1"));

      expect(data.occurredOn).toBe("2026-09-02");
      expect(data.occurredOn).not.toBe(new Date().toISOString().slice(0, 10));
      expect(data.historyFrom).toBe("2026-08-03");

      // Three hours later the day moves too, so a constant cannot pass.
      vi.setSystemTime(new Date("2026-09-03T03:00:00Z"));

      expect((await fetchCalculatorDataAction(idOf("kid1"))).occurredOn).toBe(
        "2026-09-03",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the history the calculator reads", () => {
  it("reaches at least as far back as every offered activity needs", async () => {
    // A short window is silent over-credit, so the engine refuses one.
    mocked.username = "kid1";

    const data = await fetchCalculatorDataAction(idOf("kid1"));
    const byId = new Map(
      data.categories.map((category) => [category.id, category]),
    );

    for (const activity of data.activities) {
      const category = byId.get(activity.categoryId);
      if (category === undefined) continue;

      expect(
        data.historyFrom <=
          historyWindowStart(data.occurredOn, activity, category),
        `${activity.name} reads back ${historyLookbackDays(activity, category)} days, and the window starts on ${data.historyFrom}`,
      ).toBe(true);
    }
  });

  it("reaches further than the minimum, so the bonus line can name the day", async () => {
    // Inside the minimum window the bonus line can only say "faz mais de 3 dias".
    mocked.username = "kid1";

    const data = await fetchCalculatorDataAction(idOf("kid1"));

    expect(data.historyFrom).toBe(shiftDate(data.occurredOn, -30));
  });

  it("refuses a row that is not approved, rather than dropping it (D19)", async () => {
    // The `where` keeps a pending row out.
    addLog({
      username: "kid1",
      activityId: BOOK,
      occurredOn: today,
      durationMinutes: 60,
      status: "pending",
    });
    mocked.username = "kid1";

    const data = await fetchCalculatorDataAction(idOf("kid1"));

    expect(data.history).toEqual([]);

    // And a bad row is refused, not dropped: handed straight to `approvedOnly`,
    // since the query never produces one.
    expect(() =>
      approvedOnly([{ id: 1, status: "pending", categoryId: null }]),
    ).toThrow(/only approved logs/);
    expect(() =>
      approvedOnly([{ id: 2, status: "rejected", categoryId: null }]),
    ).toThrow(/only approved logs/);
    expect(() =>
      approvedOnly([
        { id: 3, status: "approved", categoryId: 2 },
        { id: 4, status: "rejected", categoryId: null },
      ]),
    ).toThrow(/log 4/);
    expect(
      approvedOnly([{ id: 5, status: "approved", categoryId: 2 }]),
    ).toEqual([{ id: 5, status: "approved", categoryId: 2 }]);

    // D37: an approved row without its bucket would quietly empty one.
    expect(() =>
      approvedOnly([{ id: 6, status: "approved", categoryId: null }]),
    ).toThrow(/its bucket was never frozen/);
  });

  it("carries only approved logs (D19)", async () => {
    addLog({
      username: "kid1",
      activityId: BOOK,
      occurredOn: today,
      durationMinutes: 60,
    });
    addLog({
      username: "kid1",
      activityId: BOOK,
      occurredOn: today,
      durationMinutes: 60,
      status: "pending",
    });
    addLog({
      username: "kid1",
      activityId: BOOK,
      occurredOn: today,
      durationMinutes: 60,
      status: "rejected",
    });
    mocked.username = "kid1";

    const data = await fetchCalculatorDataAction(idOf("kid1"));

    expect(data.history).toHaveLength(1);
    expect(data.history.every((log) => log.status === "approved")).toBe(true);
  });

  it("carries only the caller's logs", async () => {
    addLog({
      username: "kid2",
      activityId: BOOK,
      occurredOn: today,
      durationMinutes: 60,
    });
    mocked.username = "kid1";

    const data = await fetchCalculatorDataAction(idOf("kid1"));

    expect(data.history).toEqual([]);
  });

  it("leaves out what fell out of the window", async () => {
    addLog({
      username: "kid1",
      activityId: BOOK,
      occurredOn: shiftDate(today, -31),
      durationMinutes: 60,
    });
    mocked.username = "kid1";

    const data = await fetchCalculatorDataAction(idOf("kid1"));

    expect(data.history).toEqual([]);
  });

  it("carries the category and the mode the bucket is counted by", async () => {
    // D3 and D5 need both columns, and both come from the join.
    addLog({
      username: "kid1",
      activityId: FOOTBALL,
      occurredOn: today,
      durationMinutes: 90,
    });
    mocked.username = "kid1";

    const data = await fetchCalculatorDataAction(idOf("kid1"));

    expect(data.history[0]).toMatchObject({
      categoryId: 1,
      calcMode: "duration",
      durationMinutes: 90,
    });
  });

  it("is what the engine actually charges the boy for", async () => {
    // Two hours of Mente today: the next hour is worth a quarter, 0,375 → 0,38.
    // Wrong rows would make it 1,5.
    addLog({
      username: "kid1",
      activityId: BOOK,
      occurredOn: today,
      durationMinutes: 120,
    });
    mocked.username = "kid1";

    const data = await fetchCalculatorDataAction(idOf("kid1"));
    const book = data.activities.find((activity) => activity.id === BOOK);
    const mente = data.categories.find((category) => category.id === 2);

    if (book === undefined || mente === undefined) {
      throw new Error("the seed lost Ler livro");
    }

    const calculation = calculateEarnedHours({
      userId: data.userId,
      activity: book,
      category: mente,
      occurredOn: data.occurredOn,
      durationMinutes: 60,
      history: data.history,
      historyFrom: data.historyFrom,
      historyTo: data.historyTo,
      categoryFirstDay: data.categoryFirstDays[mente.id] ?? null,
    });

    expect(data.categoryFirstDays[mente.id]).toBe(today);
    expect(calculation.hours).toBe(0.38);
    expect(calculation.lines.map((line) => line.text)).toStrictEqual([
      "Ler livro, 1h × 1,5 — você já fez 2h de Mente hoje",
      "um quarto, de 2h a 3h de Mente no dia",
    ]);
  });
});

describe("the calculator refuses the other boy's day (#13, #17)", () => {
  it("refuses a request carrying the brother's id", async () => {
    mocked.username = "kid1";

    await expect(fetchCalculatorDataAction(idOf("kid2"))).rejects.toMatchObject(
      {
        name: "AccessDeniedError",
        reason: "forbidden",
      },
    );
  });

  it("refuses it in the other direction too", async () => {
    mocked.username = "kid2";

    await expect(fetchCalculatorDataAction(idOf("kid1"))).rejects.toMatchObject(
      { reason: "forbidden" },
    );
  });

  it("refuses a caller with no session", async () => {
    mocked.username = null;

    await expect(fetchCalculatorDataAction(idOf("kid1"))).rejects.toMatchObject(
      { reason: "unauthenticated" },
    );
  });

  it("lets an admin simulate against a boy's day", async () => {
    mocked.username = "admin1";

    await expect(
      fetchCalculatorDataAction(idOf("kid1")),
    ).resolves.toMatchObject({ userId: idOf("kid1") });
  });
});

describe("the calculator writes nothing (#17)", () => {
  it("leaves every table exactly as it found it", async () => {
    addLog({
      username: "kid1",
      activityId: BOOK,
      occurredOn: today,
      durationMinutes: 60,
    });
    mocked.username = "kid1";

    const before = counts();
    await fetchCalculatorDataAction(idOf("kid1"));
    await fetchCalculatorDataAction(idOf("kid1"));

    expect(counts()).toEqual(before);
  });
});

/** Row counts of every table a write could land in. */
function counts(): Record<string, number> {
  const tables = [
    "users",
    "categories",
    "activities",
    "activity_logs",
    "ledger",
    "regimes",
    "timers",
  ];

  return Object.fromEntries(
    tables.map((table) => [
      table,
      (
        connection.sqlite
          .prepare(`select count(*) as c from ${table}`)
          .get() as { c: number }
      ).c,
    ]),
  );
}
