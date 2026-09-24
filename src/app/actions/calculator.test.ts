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
 * What the calculator (#17) is handed, and what it is refused.
 *
 * The screen runs the engine in the browser, so this action is the whole of
 * the server side of #17 and everything the engine can get wrong downstream
 * begins here: a history missing a `user_id` filter halves a boy's afternoon
 * with a plausible number and an explanation that adds up; a window shorter
 * than the rules need pays too much and says nothing; a pending log in the list
 * charges him for something an adult refused (D19).
 *
 * Only the cookie is mocked. The guard, the joins and the window arithmetic run
 * for real, against a migrated and seeded database.
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
/** Today in São Paulo, as the action computes it. */
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
      // D37: an approved row carries the bucket it counted under; a pending one
      // has not consumed a bucket yet, and the CHECK requires the null.
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
    // Thirty-two activities minus the one `free` row.
    expect(data.activities).toHaveLength(31);
    expect(
      data.activities.every((activity) =>
        data.categories.some((category) => category.id === activity.categoryId),
      ),
    ).toBe(true);
  });

  it("leaves out the `free` activity, whose value only an adult can type", async () => {
    // D12: Curinga is the admin's escape hatch, and the engine refuses a `free`
    // calculation with no `freeValue`. Offering it would be a button that
    // throws.
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
    // Deactivating a category does not touch its activities, so an offered
    // activity could otherwise point at a category the picker does not have.
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
    // The case above recomputes the expected day off the same clock the action
    // reads, so it can only ever disagree with `toISOString().slice(0, 10)` —
    // the exact bug D13 was written against — between 21:00 and midnight in
    // São Paulo. Measured: swapping `saoPauloDay` for the ISO slice left the
    // whole suite green, correct 12,5% of the day and only if CI happens to run
    // then. The instant is pinned here instead.
    //
    // 02:30Z is 23:30 of the day before in Brasília, and tomorrow's Mente
    // bucket is empty: the boy reads a full rate on his fifth hour of reading.
    vi.useFakeTimers({ toFake: ["Date"] });

    try {
      vi.setSystemTime(new Date("2026-09-03T02:30:00Z"));
      mocked.username = "kid1";

      const data = await fetchCalculatorDataAction(idOf("kid1"));

      expect(data.occurredOn).toBe("2026-09-02");
      expect(data.occurredOn).not.toBe(new Date().toISOString().slice(0, 10));
      // And the window is measured from that day, not from the ISO one.
      expect(data.historyFrom).toBe("2026-08-03");

      // Three hours later it is the next day in São Paulo too, so the day does
      // move — a constant would pass everything above.
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
    // The engine refuses a window shorter than the rules it is about to apply,
    // because a short window is silent over-credit. This is the promise the
    // action makes it.
    mocked.username = "kid1";

    const data = await fetchCalculatorDataAction(idOf("kid1"));
    const byId = new Map(
      data.categories.map((category) => [category.id, category]),
    );

    for (const activity of data.activities) {
      const category = byId.get(activity.categoryId);
      if (category === undefined) continue;

      // Both are `YYYY-MM-DD`, so the lexical order is the calendar order.
      expect(
        data.historyFrom <=
          historyWindowStart(data.occurredOn, activity, category),
        `${activity.name} reads back ${historyLookbackDays(activity, category)} days, and the window starts on ${data.historyFrom}`,
      ).toBe(true);
    }
  });

  it("reaches further than the minimum, so the bonus line can name the day", async () => {
    // `awayText` will not claim a number it cannot see: inside the minimum
    // window the return bonus can only ever read "faz mais de 3 dias", and #17
    // asks for "faz 4 dias".
    mocked.username = "kid1";

    const data = await fetchCalculatorDataAction(idOf("kid1"));

    expect(data.historyFrom).toBe(shiftDate(data.occurredOn, -30));
  });

  it("refuses a row that is not approved, rather than dropping it (D19)", async () => {
    // Two claims, and the old version of this case only made the first one.
    //
    // First: the `where` keeps a pending row out, so the action answers.
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

    // Second: what the action does with a bad row *if it ever gets one*. The
    // query never produces one, which is exactly why nothing used to exercise
    // this half — the assertion could be deleted whole and 674 tests stayed
    // green, because the `where` alone already produced `[]`. So the row is
    // handed to the rule directly. `approvedOnly` is the engine's, and it is
    // the only place D19's status rule is written.
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

    // D37, in the same one place D19 lives: an approved row without the bucket
    // it counted under is a row that was frozen without one, and reading it as
    // "some other category" would quietly empty a bucket.
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
    // D3 buckets by category and D5 says only a `duration` log puts hours in
    // it. Neither column is on `activity_logs`; both come from the join, and
    // without them the engine cannot tell Mente from Corpo.
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
    // The end of the chain: two hours of Mente already read today, so the
    // bucket sits two halvings deep and the next hour of a book is worth a
    // quarter — 1,5 × 0,25 = 0,375, shown as 0,38. If the action handed over
    // the wrong rows, the other boy's or a pending one, this number would be
    // 1,5 and nothing else in this file would notice.
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
    // How many hours of Mente he has already read is his day, and the rule is
    // "kid vê e simula apenas os próprios dados".
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
