import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// D57: the bonus split is measured with the bonus ON; default ships off.
vi.mock("../engine/flags", () => ({ BONUS_ENABLED: true }));

import { launchEntry } from "./admin";
import { openDatabase } from "./client";
import { readDashboard } from "./dashboard";
import { releaseHours } from "./ledger";
import { migrateDatabase } from "./migrate";
import { activities, activityLogs } from "./schema";
import { seedWithTestUsers } from "./test-users";

const ADMIN1 = 1;
const KID1 = 3;
const KID2 = 4;

let root: string;
let connection: ReturnType<typeof openDatabase>;
let clock: number;

function activityId(name: string): number {
  const row = connection.db
    .select({ id: activities.id })
    .from(activities)
    .where(eq(activities.name, name))
    .get();
  if (row === undefined) throw new Error(`no activity ${name}`);

  return row.id;
}

/** Launched through the real path, so each row is frozen as production freezes it. */
function launch(userId: number, name: string, day: string, minutes: number) {
  clock += 1000;

  return launchEntry(
    connection,
    {
      userId,
      activityId: activityId(name),
      occurredOn: day,
      durationMinutes: minutes,
    },
    ADMIN1,
    new Date(clock),
  );
}

function week() {
  return readDashboard(connection, {
    kidIds: [KID1],
    from: "2026-09-01",
    to: "2026-09-07",
  });
}

function mente() {
  const found = week().categories.find((category) => category.name === "Mente");
  if (found === undefined) throw new Error("no Mente");

  return found;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-dashboard-"));
  const databasePath = join(root, "data", "kids.db");
  migrateDatabase(databasePath);
  connection = openDatabase(databasePath);
  seedWithTestUsers(connection);
  clock = Date.parse("2026-09-07T15:00:00Z");

  // Mente: 1,5 per hour, step 1 h, +50% when it alternates off another
  // participant (D56).
  launch(KID1, "Ler livro", "2026-09-01", 60); // 1,50: first of the day
  launch(KID1, "Ler livro", "2026-09-01", 60); // 0,75: one step deep
  // Criativo earlier on the 6th, so the reading after it alternates (D56): 0,75.
  launch(KID1, "Praticar instrumento", "2026-09-06", 30);
  launch(KID1, "Ler livro", "2026-09-06", 60); // 2,25: 1,50 + the alternation bonus
  launch(KID2, "Futebol ou outro esporte coletivo", "2026-09-02", 60);
  releaseHours(
    connection,
    { userId: KID1, hours: 1 },
    ADMIN1,
    new Date("2026-09-03T15:00:00Z"),
  );
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

describe("hours per category (#9)", () => {
  it("adds up what was credited, per day and in total", () => {
    const dashboard = week();
    const category = mente();

    expect(dashboard.days).toHaveLength(7);
    expect(category.earned).toBe(4.5);
    expect(category.earnedPerDay).toEqual([2.25, 0, 0, 0, 0, 2.25, 0]);
    expect(category.entries).toBe(3);
    expect(category.activityMinutes).toBe(180);
  });

  it("divides only timed hours by the time, so a `fixed` entry does not inflate the yield", () => {
    clock += 1000;
    launchEntry(
      connection,
      {
        userId: KID1,
        activityId: activityId("Academia"),
        occurredOn: "2026-09-04",
      },
      ADMIN1,
      new Date(clock),
    );
    launch(KID1, "Bicicleta", "2026-09-05", 60);

    const corpo = week().categories.find((c) => c.name === "Corpo");

    expect(corpo?.activityMinutes).toBe(60);
    expect(corpo?.activityEarned).toBe(1.5);
    expect(corpo?.earned).toBeGreaterThan(1.5);
  });

  it("reads only the kids asked for", () => {
    const corpo = week().categories.find((c) => c.name === "Corpo");

    expect(corpo?.entries).toBe(0);
  });
});

describe("decay and the alternation bonus, off the engine's own lines (#9, #54)", () => {
  it("splits the credited hours into the table, the decay and the bonus", () => {
    expect(mente().split).toEqual({ rule: 4.5, decay: -0.75, bonus: 0.75 });
  });

  it("counts the days past one step, and the entries that took a bonus", () => {
    const category = mente();

    expect(category.kidDays).toBe(2);
    expect(category.kidDaysPastStep).toBe(1);
    expect(category.bonusEntries).toBe(1);
  });

  it("leaves out an entry today's table no longer gives, rather than recompute it (D15)", () => {
    connection.db
      .update(activities)
      .set({ value: 2 })
      .where(eq(activities.id, activityId("Ler livro")))
      .run();

    const dashboard = week();

    expect(dashboard.unreproduced).toBe(3);
    expect(mente().split).toEqual({ rule: 0, decay: 0, bonus: 0 });
    expect(mente().earned).toBe(4.5);
  });

  it("leaves out an adult's number (D50)", () => {
    connection.db
      .update(activityLogs)
      .set({ overridden: true })
      .where(
        and(
          eq(activityLogs.activityId, activityId("Ler livro")),
          eq(activityLogs.computedHours, 0.75),
        ),
      )
      .run();

    expect(week().overridden).toBe(1);
    expect(mente().split).toEqual({ rule: 3, decay: 0, bonus: 0.75 });
    expect(mente().excluded).toBe(1);
  });

  it("keeps an overridden entry in the category, and out of the bonus count", () => {
    connection.db
      .update(activityLogs)
      .set({ overridden: true })
      .where(
        and(
          eq(activityLogs.activityId, activityId("Ler livro")),
          eq(activityLogs.occurredOn, "2026-09-06"),
        ),
      )
      .run();

    const category = mente();

    expect(category.bonusEntries).toBe(0);
    expect(category.excluded).toBe(1);
  });
});

describe("balance over time (#9)", () => {
  it("runs the ledger day by day and totals the period", () => {
    const [kid1] = week().balances;

    expect(kid1?.points.map((point) => point.balance)).toEqual([
      2.25, 2.25, 1.25, 1.25, 1.25, 4.25, 4.25,
    ]);
    expect(kid1?.earned).toBe(5.25);
    expect(kid1?.spent).toBe(1);
  });

  it("starts from what came before the period", () => {
    const [kid1] = readDashboard(connection, {
      kidIds: [KID1],
      from: "2026-09-05",
      to: "2026-09-07",
    }).balances;

    expect(kid1?.points.map((point) => point.balance)).toEqual([
      1.25, 4.25, 4.25,
    ]);
    expect(kid1?.earned).toBe(3);
  });

  it("drops a voided entry from the balance and every count (D52)", () => {
    connection.db
      .update(activityLogs)
      .set({ voidedAt: new Date(clock + 1000), voidedBy: ADMIN1 })
      .where(eq(activityLogs.occurredOn, "2026-09-06"))
      .run();

    const dashboard = week();

    expect(dashboard.balances[0]?.points.at(-1)?.balance).toBe(1.25);
    expect(mente().entries).toBe(2);
  });
});

describe("activities used and unused (#9)", () => {
  it("ranks what was used and lists the rest", () => {
    const dashboard = week();

    expect(dashboard.used.map((use) => [use.name, use.entries])).toEqual([
      ["Ler livro", 3],
      ["Praticar instrumento", 1],
    ]);
    expect(dashboard.unused.map((use) => use.name)).toContain(
      "Futebol ou outro esporte coletivo",
    );
    expect(dashboard.unused.map((use) => use.name)).not.toContain("Ler livro");
  });

  it("starts at the first row when asked for everything", () => {
    const dashboard = readDashboard(connection, {
      kidIds: [KID1, KID2],
      from: null,
      to: "2026-09-07",
    });

    expect(dashboard.days[0]).toBe("2026-09-01");
    expect(dashboard.balances.map((kid) => kid.id)).toEqual([KID1, KID2]);
  });
});
