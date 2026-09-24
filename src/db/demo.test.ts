import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "./client";
import { clearDemoData, countDemoRows, DEMO_NOTE, seedDemoData } from "./demo";
import { migrateDatabase } from "./migrate";
import { activityLogs, ledger, users } from "./schema";
import { seedWithTestUsers } from "./test-users";

/**
 * The demo path, and the three promises that make it safe to have at all.
 *
 * 1. it is not the seed, and it does not touch what the seed writes;
 * 2. every row it writes carries the stamp, so the removal can be surgical;
 * 3. `clearDemoData` puts the database back exactly as `seedDatabase` left it.
 *
 * The third is the one somebody will depend on without this context, before
 * launch, so it is checked by comparing whole table counts rather than by
 * trusting the delete's own report.
 */

const TODAY = "2026-09-02";

let root: string;
let connection: ReturnType<typeof openDatabase>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-demo-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);
  connection = openDatabase(databasePath);
  seedWithTestUsers(connection);
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

const TABLES = [
  "users",
  "categories",
  "activities",
  "activity_logs",
  "ledger",
  "regimes",
  "timers",
] as const;

function counts(): Record<string, number> {
  return Object.fromEntries(
    TABLES.map((table) => [
      table,
      (
        connection.sqlite
          .prepare(`select count(*) as c from ${table}`)
          .get() as { c: number }
      ).c,
    ]),
  );
}

function idOf(username: string): number {
  const row = connection.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .get();

  if (row === undefined) throw new Error(`the seed has no user ${username}`);

  return row.id;
}

/** The same sum `fetchBalanceAction` computes, over the demo's rows. */
function balanceOf(username: string): number {
  const rows = connection.db
    .select({ kind: ledger.kind, hours: ledger.hours })
    .from(ledger)
    .where(eq(ledger.userId, idOf(username)))
    .all();

  return (
    Math.round(
      rows.reduce(
        (sum, row) => sum + (row.kind === "spend" ? -row.hours : row.hours),
        0,
      ) * 100,
    ) / 100
  );
}

/** How many ledger rows a boy has. */
function entriesOf(username: string): number {
  return connection.db
    .select({ id: ledger.id })
    .from(ledger)
    .where(eq(ledger.userId, idOf(username)))
    .all().length;
}

describe("the demo is not the seed", () => {
  it("leaves the people, the categories and the activities alone", () => {
    const before = counts();

    seedDemoData(connection, TODAY);

    const after = counts();
    expect(after.users).toBe(before.users);
    expect(after.categories).toBe(before.categories);
    expect(after.activities).toBe(before.activities);
  });

  it("writes one week however many times it is run", () => {
    // `db:seed` is idempotent and sits in the same table of commands in
    // `docs/demo-data.md`, so this one is too. It was not: running it twice
    // wrote the week twice — measured at 22 logs and 36 ledger rows, with
    // Kid1's balance doubled — and the only warning was a sentence in a
    // docstring.
    const first = seedDemoData(connection, TODAY);
    const afterFirst = counts();

    const second = seedDemoData(connection, TODAY);

    expect(second).toEqual(first);
    expect(counts()).toEqual(afterFirst);
    expect(countDemoRows(connection)).toEqual({
      logs: first.logs,
      ledger: first.ledger,
    });

    // And the way back is still one command, from either state.
    clearDemoData(connection);

    expect(countDemoRows(connection)).toEqual({ logs: 0, ledger: 0 });
  });

  it("writes nothing until it is called", () => {
    // `seedDatabase` on its own leaves every screen of Phase 3 empty, which is
    // the state a real installation is in on day one.
    expect(counts()).toMatchObject({
      activity_logs: 0,
      ledger: 0,
      regimes: 0,
      timers: 0,
    });
  });
});

describe("the demo week", () => {
  it("gives one boy a positive balance and the other a negative one", () => {
    // Both are needed to look at the boy's home screen: the ink of a negative
    // balance, and an ordinary positive one beside it.
    seedDemoData(connection, TODAY);

    expect(balanceOf("kid1")).toBeGreaterThan(0);
    expect(balanceOf("kid2")).toBeLessThan(0);
  });

  it("writes more than five entries for one boy, so `os últimos cinco` means something", () => {
    seedDemoData(connection, TODAY);

    expect(entriesOf("kid1")).toBeGreaterThan(5);
  });

  it("puts entries on more than one day, so the ordering can be read", () => {
    seedDemoData(connection, TODAY);

    const days = new Set(
      connection.db
        .select({ occurredOn: ledger.occurredOn })
        .from(ledger)
        .where(eq(ledger.userId, idOf("kid1")))
        .all()
        .map((row) => row.occurredOn),
    );

    expect(days.size).toBeGreaterThan(3);
  });

  it("dates the newest rows on the day it was given (D13)", () => {
    seedDemoData(connection, TODAY);

    const days = connection.db
      .select({ occurredOn: ledger.occurredOn })
      .from(ledger)
      .all()
      .map((row) => row.occurredOn);

    expect(days).toContain(TODAY);
    expect(
      Math.max(...days.map((day) => Number(day.replaceAll("-", "")))),
    ).toBe(Number(TODAY.replaceAll("-", "")));
  });

  it("stamps every row it writes", () => {
    seedDemoData(connection, TODAY);

    const logs = connection.db
      .select({ note: activityLogs.note })
      .from(activityLogs)
      .all();
    const rows = connection.db.select({ note: ledger.note }).from(ledger).all();
    for (const row of [...logs, ...rows]) {
      expect(row.note).toBe(DEMO_NOTE);
    }

    expect(countDemoRows(connection)).toEqual({
      logs: logs.length,
      ledger: rows.length,
    });
  });

  it("credits the ledger with what the engine says, and nothing else", () => {
    // The demo runs the engine, so the ledger on the home screen and the
    // calculator on the next tab cannot disagree about the same day.
    seedDemoData(connection, TODAY);

    const credited = connection.db
      .select({
        hours: ledger.hours,
        logId: ledger.activityLogId,
      })
      .from(ledger)
      .all()
      .filter((row) => row.logId !== null);
    const computed = new Map(
      connection.db
        .select({ id: activityLogs.id, hours: activityLogs.computedHours })
        .from(activityLogs)
        .all()
        .map((row) => [row.id, row.hours] as const),
    );

    expect(credited.length).toBeGreaterThan(5);
    for (const row of credited) {
      expect(row.hours).toBe(computed.get(row.logId ?? -1));
    }
  });
});

describe("the demo comes back out", () => {
  it("returns the database to exactly the state db:seed leaves it in", () => {
    const seeded = counts();

    seedDemoData(connection, TODAY);
    expect(counts()).not.toEqual(seeded);

    clearDemoData(connection);

    expect(counts()).toEqual(seeded);
    expect(countDemoRows(connection)).toEqual({ logs: 0, ledger: 0 });
  });

  it("reports what it removed", () => {
    const written = seedDemoData(connection, TODAY);
    const removed = clearDemoData(connection);

    expect(removed).toEqual(written);
  });

  it("is safe to run when there is nothing to remove", () => {
    const seeded = counts();

    expect(clearDemoData(connection)).toEqual({ logs: 0, ledger: 0 });
    expect(counts()).toEqual(seeded);
  });

  it("leaves a row that is not the demo's alone", () => {
    // The removal has to be safe after Phase 4 and Phase 5 have written real
    // rows next to these, and whoever runs it will not have read this file.
    seedDemoData(connection, TODAY);

    const admin1 = connection.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .all()
      .find((row) => row.username === "admin1");
    if (admin1 === undefined) throw new Error("the seed lost admin1");

    connection.db
      .insert(ledger)
      .values({
        userId: admin1.id,
        kind: "earn",
        hours: 1,
        occurredOn: TODAY,
        note: "um lançamento de verdade",
        createdBy: admin1.id,
      })
      .run();

    clearDemoData(connection);

    const left = connection.db.select({ note: ledger.note }).from(ledger).all();

    expect(left.map((row) => row.note)).toEqual(["um lançamento de verdade"]);
  });
});
