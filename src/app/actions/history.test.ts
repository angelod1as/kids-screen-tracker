import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "../../db/client";
import { migrateDatabase } from "../../db/migrate";
import { approveLog, rejectionNote } from "../../db/queue";
import { activityLogs, ledger, users } from "../../db/schema";
import { seedWithTestUsers } from "../../db/test-users";
import {
  HISTORY_LIMIT,
  MAX_HISTORY_DAYS,
  RECENT_ENTRIES_LIMIT,
} from "../../ui/entries";
import { fetchBalanceAction } from "./balance";
import {
  fetchHistoryAction,
  fetchHistoryDaysAction,
  fetchLedgerEntriesAction,
} from "./history";

/**
 * Only the cookie is mocked. A forged POST with the brother's id is sent, and a
 * permitted answer is checked for his rows: a `where` that lost `user_id` would
 * pass the guard and still leak.
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

/** Unique, so a leak shows as a string rather than a count. */
const KID2_ONLY = "Nintendo do Kid2";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-history-"));
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

  // Activity 5 is "Ler livro" in the seed.
  const log = connection.db
    .insert(activityLogs)
    .values({
      userId: idOf("kid1"),
      activityId: 5,
      // D37: stamped with Mente (2).
      categoryId: 2,
      status: "approved",
      source: "admin",
      occurredOn: "2026-08-30",
      durationMinutes: 60,
      computedHours: 2,
      createdBy: admin1,
      reviewedBy: admin1,
      reviewedAt: new Date("2026-08-30T15:00:00Z"),
      createdAt: new Date("2026-08-30T15:00:00Z"),
    })
    .returning({ id: activityLogs.id })
    .get();

  connection.db
    .insert(ledger)
    .values([
      {
        userId: idOf("kid1"),
        kind: "earn",
        hours: 2,
        occurredOn: "2026-08-30",
        activityLogId: log.id,
        createdBy: admin1,
        createdAt: new Date("2026-08-30T15:00:00Z"),
      },
      {
        userId: idOf("kid1"),
        kind: "spend",
        hours: 1.5,
        occurredOn: "2026-09-01",
        destination: "Xbox",
        createdBy: admin1,
        createdAt: new Date("2026-09-01T20:00:00Z"),
      },
      {
        userId: idOf("kid1"),
        kind: "refund",
        hours: 0.25,
        occurredOn: "2026-09-02",
        destination: "Xbox",
        createdBy: admin1,
        createdAt: new Date("2026-09-02T09:00:00Z"),
      },
      // Same instant as Kid1's latest row, so ordering cannot be what keeps it out.
      {
        userId: idOf("kid2"),
        kind: "spend",
        hours: 4,
        occurredOn: "2026-09-02",
        destination: KID2_ONLY,
        createdBy: admin1,
        createdAt: new Date("2026-09-02T09:00:00Z"),
      },
    ])
    .run();
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

/** The note goes through `rejectionNote`, the real writer, so reader and writer cannot drift. */
function addRejected({
  username,
  occurredOn,
  reason,
  note = null,
  durationMinutes = 90,
  createdAt = new Date("2026-09-01T18:00:00Z"),
}: {
  username: string;
  occurredOn: string;
  reason: string | null;
  note?: string | null;
  durationMinutes?: number | null;
  createdAt?: Date;
}): number {
  return connection.db
    .insert(activityLogs)
    .values({
      userId: idOf(username),
      activityId: 5,
      status: "rejected",
      source: "timer",
      occurredOn,
      durationMinutes,
      note: rejectionNote(note, reason),
      createdBy: idOf(username),
      reviewedBy: idOf("admin1"),
      reviewedAt: createdAt,
      createdAt,
    })
    .returning({ id: activityLogs.id })
    .get().id;
}

function idOf(username: string): number {
  const id = ids.get(username);
  if (id === undefined) {
    throw new Error(`the seed has no user named ${username}`);
  }

  return id;
}

/** Fails if the call resolved, so a guard that stopped guarding cannot pass. */
async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (thrown) {
    return thrown as Error;
  }

  throw new Error("expected the call to be refused, and it was not");
}

describe("a kid reading his own history (#16)", () => {
  it("gets his entries, most recent first", async () => {
    mocked.username = "kid1";

    const entries = await fetchLedgerEntriesAction(idOf("kid1"), 10);

    expect(entries.map((entry) => entry.occurredOn)).toEqual([
      "2026-09-02",
      "2026-09-01",
      "2026-08-30",
    ]);
  });

  it("shows the activity on an earn and the destination on a spend", async () => {
    mocked.username = "kid1";

    const entries = await fetchLedgerEntriesAction(idOf("kid1"), 10);

    expect(
      entries.map((entry) => [entry.kind, entry.label, entry.hours]),
    ).toEqual([
      ["refund", "Xbox", 0.25],
      ["spend", "Xbox", 1.5],
      ["earn", "Ler livro", 2],
    ]);
  });

  it("names who decided each entry, and nobody on a spend or refund (emenda à D50)", async () => {
    mocked.username = "kid1";
    addRejected({ username: "kid1", occurredOn: "2026-09-03", reason: "não" });

    const entries = await fetchHistoryAction(idOf("kid1"), 10);

    expect(entries.map((entry) => [entry.kind, entry.decidedBy])).toEqual([
      ["rejected", "Admin1"],
      ["refund", null],
      ["spend", null],
      ["earn", "Admin1"],
    ]);
  });

  it("names an entry that has neither, rather than leaving the line blank", async () => {
    connection.db
      .insert(ledger)
      .values({
        userId: idOf("kid1"),
        kind: "spend",
        hours: 1,
        occurredOn: "2026-09-03",
        createdBy: idOf("admin1"),
      })
      .run();
    mocked.username = "kid1";

    const [first] = await fetchLedgerEntriesAction(idOf("kid1"), 10);

    expect(first?.label).toBe("Sem descrição");
  });

  it("returns nothing at all when he has nothing", async () => {
    connection.db.delete(ledger).run();
    mocked.username = "kid1";

    await expect(fetchLedgerEntriesAction(idOf("kid1"), 10)).resolves.toEqual(
      [],
    );
  });

  it("stops at the limit it is given, taking the most recent", async () => {
    mocked.username = "kid1";

    const entries = await fetchLedgerEntriesAction(idOf("kid1"), 2);

    expect(entries.map((entry) => entry.occurredOn)).toEqual([
      "2026-09-02",
      "2026-09-01",
    ]);
  });

  it("refuses a limit that is not a page, including SQLite's -1", async () => {
    // SQLite reads `LIMIT -1` as "no limit".
    mocked.username = "kid1";

    for (const limit of [-1, 0, 1.5, Number.NaN, HISTORY_LIMIT + 1]) {
      await expect(
        fetchLedgerEntriesAction(idOf("kid1"), limit),
        String(limit),
      ).rejects.toThrow(/between 1 and 200/);
    }

    await expect(
      fetchLedgerEntriesAction(idOf("kid1"), RECENT_ENTRIES_LIMIT),
    ).resolves.toBeInstanceOf(Array);
    await expect(
      fetchLedgerEntriesAction(idOf("kid1"), HISTORY_LIMIT),
    ).resolves.toBeInstanceOf(Array);
  });

  it("keeps the two page sizes the screens were designed around", () => {
    // Nothing else pins these numbers, and #15 and #16 were written against them.
    expect(RECENT_ENTRIES_LIMIT).toBe(5);
    expect(HISTORY_LIMIT).toBe(200);
  });
});

describe("the history does not leak the other boy (#16)", () => {
  it("leaves his rows out of a list the caller is allowed to have", async () => {
    // Kid1 may read Kid1; only the `where` keeps his brother's rows out.
    mocked.username = "kid1";

    const entries = await fetchLedgerEntriesAction(idOf("kid1"), 100);

    expect(entries.map((entry) => entry.label)).not.toContain(KID2_ONLY);
    expect(JSON.stringify(entries)).not.toContain(KID2_ONLY);
  });

  it("refuses a request carrying the brother's id", async () => {
    mocked.username = "kid1";

    await expect(
      fetchLedgerEntriesAction(idOf("kid2"), 10),
    ).rejects.toMatchObject({
      name: "AccessDeniedError",
      reason: "forbidden",
    });
  });

  it("refuses it in the other direction too", async () => {
    mocked.username = "kid2";

    await expect(
      fetchLedgerEntriesAction(idOf("kid1"), 10),
    ).rejects.toMatchObject({ reason: "forbidden" });
  });

  it("refuses a caller with no session", async () => {
    mocked.username = null;

    await expect(
      fetchLedgerEntriesAction(idOf("kid1"), 10),
    ).rejects.toMatchObject({ reason: "unauthenticated" });
  });

  it("tells the refused caller nothing about what it was hiding", async () => {
    mocked.username = "kid1";

    const error = await refusal(fetchLedgerEntriesAction(idOf("kid2"), 10));

    expect(error.message).toBe("Acesso negado.");
    expect(
      JSON.stringify(error, Object.getOwnPropertyNames(error)),
    ).not.toContain(KID2_ONLY);
  });

  it("lets an admin read both", async () => {
    mocked.username = "admin1";

    await expect(
      fetchLedgerEntriesAction(idOf("kid2"), 10),
    ).resolves.toHaveLength(1);
    await expect(
      fetchLedgerEntriesAction(idOf("kid1"), 10),
    ).resolves.toHaveLength(3);
  });
});

describe("the history shows what an adult refused (#72)", () => {
  it("puts the refusal in the list, with its day, activity, duration and reason", async () => {
    addRejected({
      username: "kid1",
      occurredOn: "2026-09-03",
      reason: "Você estava no celular",
    });
    mocked.username = "kid1";

    const [first] = await fetchHistoryAction(idOf("kid1"), 10);

    expect(first).toMatchObject({
      kind: "rejected",
      occurredOn: "2026-09-03",
      label: "Ler livro",
      durationMinutes: 90,
      reason: "Você estava no celular",
    });
  });

  it("keeps the boy's own note out of the reason", async () => {
    // One column holds both (`rejectionNote`); #72 wants only the adult's sentence.
    addRejected({
      username: "kid1",
      occurredOn: "2026-09-03",
      note: "Li dois capítulos",
      reason: "Você estava no celular",
    });
    mocked.username = "kid1";

    const [first] = await fetchHistoryAction(idOf("kid1"), 10);

    expect(first).toMatchObject({ reason: "Você estava no celular" });
    expect(JSON.stringify(first)).not.toContain("Li dois capítulos");
  });

  it("carries no reason at all when the adult wrote none", async () => {
    // #20 makes a reasonless refusal normal; null must stay null.
    addRejected({ username: "kid1", occurredOn: "2026-09-03", reason: null });
    mocked.username = "kid1";

    const [first] = await fetchHistoryAction(idOf("kid1"), 10);

    expect(first).toMatchObject({ kind: "rejected", reason: null });
  });

  it("orders the refusal among the ledger rows, most recent first", async () => {
    // Not appended: it belongs on the day it happened.
    addRejected({ username: "kid1", occurredOn: "2026-09-01", reason: null });
    mocked.username = "kid1";

    const entries = await fetchHistoryAction(idOf("kid1"), 10);

    expect(entries.map((entry) => [entry.occurredOn, entry.kind])).toEqual([
      ["2026-09-02", "refund"],
      ["2026-09-01", "spend"],
      ["2026-09-01", "rejected"],
      ["2026-08-30", "earn"],
    ]);
  });

  it("leaves the balance exactly where it was (D19)", async () => {
    mocked.username = "kid1";
    const before = await fetchBalanceAction(idOf("kid1"));

    addRejected({
      username: "kid1",
      occurredOn: "2026-09-03",
      reason: "Não foi isso",
      durationMinutes: 600,
    });

    await expect(fetchBalanceAction(idOf("kid1"))).resolves.toBe(before);
    await expect(
      fetchLedgerEntriesAction(idOf("kid1"), 10),
    ).resolves.toHaveLength(3);
  });

  it("does not show what is still waiting, nor what was approved twice", async () => {
    mocked.username = "kid1";

    const entries = await fetchHistoryAction(idOf("kid1"), 10);

    expect(entries.map((entry) => entry.kind)).toEqual([
      "refund",
      "spend",
      "earn",
    ]);
  });

  it("stops at the limit it is given, counting both tables together", async () => {
    addRejected({ username: "kid1", occurredOn: "2026-09-03", reason: null });
    mocked.username = "kid1";

    const entries = await fetchHistoryAction(idOf("kid1"), 2);

    expect(entries.map((entry) => [entry.occurredOn, entry.kind])).toEqual([
      ["2026-09-03", "rejected"],
      ["2026-09-02", "refund"],
    ]);
  });

  it("refuses a limit that is not a page, including SQLite's -1", async () => {
    mocked.username = "kid1";

    for (const limit of [-1, 0, 1.5, Number.NaN, HISTORY_LIMIT + 1]) {
      await expect(
        fetchHistoryAction(idOf("kid1"), limit),
        String(limit),
      ).rejects.toThrow(/between 1 and 200/);
    }
  });
});

describe("the history of the other boy is his alone (#72, #73, D33)", () => {
  const KID2_REFUSAL = "Motivo que só o Kid2 tem";

  beforeEach(() => {
    addRejected({
      username: "kid2",
      occurredOn: "2026-09-03",
      reason: KID2_REFUSAL,
    });
  });

  it("refuses a request carrying the brother's id", async () => {
    // The endpoint, not the `/admin` route, is what keeps him out.
    mocked.username = "kid1";

    await expect(fetchHistoryAction(idOf("kid2"), 10)).rejects.toMatchObject({
      name: "AccessDeniedError",
      reason: "forbidden",
    });
  });

  it("refuses it in the other direction too", async () => {
    mocked.username = "kid2";

    await expect(fetchHistoryAction(idOf("kid1"), 10)).rejects.toMatchObject({
      reason: "forbidden",
    });
  });

  it("refuses a caller with no session", async () => {
    mocked.username = null;

    await expect(fetchHistoryAction(idOf("kid1"), 10)).rejects.toMatchObject({
      reason: "unauthenticated",
    });
  });

  it("tells the refused caller nothing about what it was hiding", async () => {
    mocked.username = "kid1";

    const error = await refusal(fetchHistoryAction(idOf("kid2"), 10));

    expect(error.message).toBe("Acesso negado.");
    expect(
      JSON.stringify(error, Object.getOwnPropertyNames(error)),
    ).not.toContain(KID2_REFUSAL);
  });

  it("leaves his refusals out of a list the caller is allowed to have", async () => {
    // Kid1 may read Kid1; only the `where` on the log table keeps these out.
    addRejected({ username: "kid1", occurredOn: "2026-09-03", reason: null });
    mocked.username = "kid1";

    const entries = await fetchHistoryAction(idOf("kid1"), 100);

    expect(JSON.stringify(entries)).not.toContain(KID2_REFUSAL);
    expect(JSON.stringify(entries)).not.toContain(KID2_ONLY);
  });

  it("lets an admin read both, which is what #73 is", async () => {
    mocked.username = "admin1";

    await expect(fetchHistoryAction(idOf("kid2"), 10)).resolves.toHaveLength(2);
    await expect(fetchHistoryAction(idOf("kid1"), 10)).resolves.toHaveLength(3);
  });
});

describe("the history says which value an adult decided (D50)", () => {
  /** Activity 15 is "Sair com os amigos", `fixed` at 3h, in the seed. */
  function approvePending(
    username: string,
    edits: { overrideHours?: number; overrideReason?: string } = {},
  ): number {
    const id = connection.db
      .insert(activityLogs)
      .values({
        userId: idOf(username),
        activityId: 15,
        status: "pending",
        source: "request",
        occurredOn: "2026-09-03",
        createdBy: idOf(username),
        createdAt: new Date("2026-09-03T18:00:00Z"),
      })
      .returning({ id: activityLogs.id })
      .get().id;

    approveLog(
      connection,
      id,
      idOf("admin1"),
      edits,
      new Date("2026-09-03T19:00:00Z"),
    );

    return id;
  }

  it("marks the earn an adult overrode, with the rule's number and the reason", async () => {
    mocked.username = "kid1";
    const before = await fetchBalanceAction(idOf("kid1"));

    approvePending("kid1", {
      overrideHours: 1,
      overrideReason: "Ficou só uma hora",
    });

    const [latest] = await fetchHistoryAction(idOf("kid1"), 10);
    expect(latest).toMatchObject({
      kind: "earn",
      hours: 1,
      override: { ruleHours: 3, reason: "Ficou só uma hora" },
    });
    await expect(fetchBalanceAction(idOf("kid1"))).resolves.toBe(before + 1);
  });

  it("does not mark an earn the rule priced", async () => {
    mocked.username = "kid1";

    approvePending("kid1");

    const entries = await fetchHistoryAction(idOf("kid1"), 10);
    expect(entries[0]).toMatchObject({ kind: "earn", hours: 3 });
    expect(
      entries.filter((entry) => "override" in entry && entry.override !== null),
    ).toEqual([]);
  });

  it("shows an adult's zero, in its place, and moves no hours (D10)", async () => {
    mocked.username = "kid1";
    const before = await fetchBalanceAction(idOf("kid1"));

    const id = approvePending("kid1", { overrideHours: 0 });

    const entries = await fetchHistoryAction(idOf("kid1"), 10);
    expect(entries.map((entry) => entry.kind)).toEqual([
      "zero",
      "refund",
      "spend",
      "earn",
    ]);
    expect(entries[0]).toMatchObject({
      id,
      label: "Sair com os amigos",
      override: { ruleHours: 3, reason: null },
    });
    await expect(fetchBalanceAction(idOf("kid1"))).resolves.toBe(before);
  });

  it("shows a zero the rule gave too, unmarked (D10)", async () => {
    // Activity 26 is "Lavar o carro", `delivery` graded, in the seed.
    const id = connection.db
      .insert(activityLogs)
      .values({
        userId: idOf("kid1"),
        activityId: 26,
        status: "pending",
        source: "request",
        occurredOn: "2026-09-03",
        quality: 0,
        createdBy: idOf("kid1"),
        createdAt: new Date("2026-09-03T18:00:00Z"),
      })
      .returning({ id: activityLogs.id })
      .get().id;
    approveLog(connection, id, idOf("admin1"), {}, new Date());
    mocked.username = "kid1";

    const [latest] = await fetchHistoryAction(idOf("kid1"), 10);

    expect(latest).toMatchObject({ id, kind: "zero", override: null });
  });

  it("leaves the brother's zero out of a list the caller is allowed to have", async () => {
    approvePending("kid2", { overrideHours: 0 });
    mocked.username = "kid1";

    const entries = await fetchHistoryAction(idOf("kid1"), 10);

    expect(entries.map((entry) => entry.kind)).not.toContain("zero");
  });
});

describe("the history opens on the newest days with an entry (#64)", () => {
  function days(entries: { occurredOn: string }[]): string[] {
    return [...new Set(entries.map((entry) => entry.occurredOn))];
  }

  function addSpend(username: string, occurredOn: string): void {
    connection.db
      .insert(ledger)
      .values({
        userId: idOf(username),
        kind: "spend",
        hours: 0.5,
        occurredOn,
        destination: "Xbox",
        createdBy: idOf("admin1"),
        createdAt: new Date(`${occurredOn}T12:00:00Z`),
      })
      .run();
  }

  it("is empty, with nothing more, for a boy with no entry", async () => {
    connection.db
      .delete(ledger)
      .where(eq(ledger.userId, idOf("kid2")))
      .run();
    mocked.username = "kid2";

    await expect(fetchHistoryDaysAction(idOf("kid2"), 2)).resolves.toEqual({
      entries: [],
      more: false,
    });
  });

  it("shows a single day whole, with nothing more", async () => {
    mocked.username = "kid2";

    const page = await fetchHistoryDaysAction(idOf("kid2"), 2);

    expect(days(page.entries)).toEqual(["2026-09-02"]);
    expect(page.more).toBe(false);
  });

  it("skips the empty days between two entries", async () => {
    // Kid1 has 30/08, 01/09 and 02/09; 31/08 is empty.
    mocked.username = "kid1";

    const first = await fetchHistoryDaysAction(idOf("kid1"), 2);
    const next = await fetchHistoryDaysAction(idOf("kid1"), 3);

    expect(days(first.entries)).toEqual(["2026-09-02", "2026-09-01"]);
    expect(first.more).toBe(true);
    expect(days(next.entries)).toEqual([
      "2026-09-02",
      "2026-09-01",
      "2026-08-30",
    ]);
  });

  it("says the list ended once the oldest day is shown", async () => {
    mocked.username = "kid1";

    const page = await fetchHistoryDaysAction(idOf("kid1"), 3);

    expect(page.more).toBe(false);
    await expect(fetchHistoryDaysAction(idOf("kid1"), 10)).resolves.toEqual(
      page,
    );
  });

  it("counts a day that holds only a refusal or a zero, and shows them", async () => {
    addRejected({
      username: "kid1",
      occurredOn: "2026-09-05",
      reason: "Não foi isso",
      createdAt: new Date("2026-09-05T18:00:00Z"),
    });
    const zero = connection.db
      .insert(activityLogs)
      .values({
        userId: idOf("kid1"),
        activityId: 15,
        status: "pending",
        source: "request",
        occurredOn: "2026-09-04",
        createdBy: idOf("kid1"),
        createdAt: new Date("2026-09-04T18:00:00Z"),
      })
      .returning({ id: activityLogs.id })
      .get().id;
    approveLog(
      connection,
      zero,
      idOf("admin1"),
      { overrideHours: 0 },
      new Date("2026-09-04T19:00:00Z"),
    );
    mocked.username = "kid1";

    const page = await fetchHistoryDaysAction(idOf("kid1"), 2);

    expect(page.entries.map((entry) => [entry.occurredOn, entry.kind])).toEqual(
      [
        ["2026-09-05", "rejected"],
        ["2026-09-04", "zero"],
      ],
    );
    expect(page.entries[0]).toMatchObject({ reason: "Não foi isso" });
    expect(page.more).toBe(true);
  });

  it("keeps a voided entry inside the window, marked (D52)", async () => {
    connection.db
      .update(ledger)
      .set({
        voidedAt: new Date("2026-09-03T10:00:00Z"),
        voidedBy: idOf("admin1"),
      })
      .where(eq(ledger.destination, "Xbox"))
      .run();
    mocked.username = "kid1";

    const page = await fetchHistoryDaysAction(idOf("kid1"), 1);

    expect(page.entries).toMatchObject([
      { kind: "refund", voided: { on: "2026-09-03", by: expect.any(String) } },
    ]);
  });

  it("reads only the window from the database, not the whole history", async () => {
    for (let day = 1; day <= 20; day += 1) {
      addSpend("kid1", `2026-07-${String(day).padStart(2, "0")}`);
    }
    const statements: string[] = [];
    const prepare = connection.sqlite.prepare.bind(connection.sqlite);
    vi.spyOn(connection.sqlite, "prepare").mockImplementation((source) => {
      statements.push(source);
      return prepare(source);
    });
    mocked.username = "kid1";

    const page = await fetchHistoryDaysAction(idOf("kid1"), 2);

    expect(days(page.entries)).toEqual(["2026-09-02", "2026-09-01"]);
    expect(JSON.stringify(page)).not.toContain("2026-07-");
    // Every read of entries is bounded by the window's first day in SQL.
    const reads = statements.filter(
      (source) =>
        /from "(ledger|activity_logs)"/.test(source) && !/union/.test(source),
    );
    expect(reads).toHaveLength(3);
    for (const source of reads) {
      expect(source).toMatch(/"occurred_on" >= \?/);
    }
    // The day list stops one past the window, which is how `more` is known.
    const [union] = statements.filter((source) => /union/.test(source));
    expect(union).toMatch(/limit \?/);
    expect(page.more).toBe(true);
  });

  it("refuses a page that is not between 1 and the cap", async () => {
    mocked.username = "kid1";

    for (const value of [-1, 0, 1.5, Number.NaN, MAX_HISTORY_DAYS + 1]) {
      await expect(
        fetchHistoryDaysAction(idOf("kid1"), value),
        String(value),
      ).rejects.toThrow(/between 1 and 60 days/);
    }
  });

  it("refuses the brother's id, on every page (D33)", async () => {
    mocked.username = "kid1";

    for (const value of [2, 3, MAX_HISTORY_DAYS]) {
      await expect(
        fetchHistoryDaysAction(idOf("kid2"), value),
      ).rejects.toMatchObject({
        name: "AccessDeniedError",
        reason: "forbidden",
      });
    }
  });

  it("refuses a caller with no session", async () => {
    mocked.username = null;

    await expect(fetchHistoryDaysAction(idOf("kid1"), 2)).rejects.toMatchObject(
      { reason: "unauthenticated" },
    );
  });

  it("leaves the brother's entries out of a page the caller may have", async () => {
    mocked.username = "kid1";

    const page = await fetchHistoryDaysAction(idOf("kid1"), MAX_HISTORY_DAYS);

    expect(JSON.stringify(page)).not.toContain(KID2_ONLY);
  });

  it("lets an admin page through either boy", async () => {
    mocked.username = "admin1";

    await expect(
      fetchHistoryDaysAction(idOf("kid2"), 2),
    ).resolves.toMatchObject({ more: false });
    await expect(
      fetchHistoryDaysAction(idOf("kid1"), 2),
    ).resolves.toMatchObject({ more: true });
  });
});
