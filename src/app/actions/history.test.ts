import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "../../db/client";
import { migrateDatabase } from "../../db/migrate";
import { rejectionNote } from "../../db/queue";
import { activityLogs, ledger, users } from "../../db/schema";
import { seedWithTestUsers } from "../../db/test-users";
import { HISTORY_LIMIT, RECENT_ENTRIES_LIMIT } from "../../ui/entries";
import { fetchBalanceAction } from "./balance";
import { fetchHistoryAction, fetchLedgerEntriesAction } from "./history";

/**
 * The history (#16), end to end, against a real database.
 *
 * Both are server actions, which means both are HTTP endpoints that take a
 * number. "Não vaza nenhum dado do outro menino" is not a statement about what
 * the screen draws — the screen never draws a link to the brother's history —
 * it is a statement about what happens when a POST arrives carrying the
 * brother's id. What follows sends exactly that request, and separately checks
 * that a *permitted* answer contains none of the other boy's rows either: a
 * `where` that lost its `user_id` would pass the guard and still leak.
 *
 * Only the cookie is mocked, the same two modules as `balance.test.ts`. The
 * guard, the user lookup and the queries all run for real.
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

/**
 * A destination nothing else in this file uses, so a leak of Kid2's row into
 * Kid1's list is visible as a string and not as a count.
 */
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

  // One approved log, so an `earn` row has an activity name to show. Activity 5
  // is "Ler livro" in the seed.
  const log = connection.db
    .insert(activityLogs)
    .values({
      userId: idOf("kid1"),
      activityId: 5,
      // D37: activity 5 is "Ler livro", under Mente (2).
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
      // Same day and same instant as Kid1's most recent row, so an ordering
      // that happens to work cannot be what keeps this out of his list.
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

/**
 * An entry an adult refused, written the way `rejectLog` writes one (#72, D19).
 *
 * The note goes through `rejectionNote`, the real writer, rather than being
 * typed out here: what the screen reads back has to be what the queue wrote,
 * and a literal in this file would keep passing the day the two stop agreeing.
 * Nothing else about the row moves — no `computed_hours`, no ledger line —
 * because that is what D19 says a refusal is.
 */
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
      // Activity 5 is "Ler livro" in the seed.
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

/**
 * The error a call was refused with. Fails loudly if it was not refused at all
 * — a `.catch()` that hands back the resolved value would let a guard that
 * stopped guarding pass the assertions below.
 */
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
    // #16: "cada linha mostra data, atividade ou destino, e as horas".
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
    // The empty state of #16, at the level of the data. What the screen writes
    // over it is `screens.test.ts`.
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
    // `LIMIT -1` is "no limit" in SQLite, so a forged request with it came back
    // with the whole ledger — measured, and the ceiling the screen relies on
    // stopped being one for anybody not using the screen. It is not a leak: the
    // `where` is still on the caller's own id.
    mocked.username = "kid1";

    for (const limit of [-1, 0, 1.5, Number.NaN, HISTORY_LIMIT + 1]) {
      await expect(
        fetchLedgerEntriesAction(idOf("kid1"), limit),
        String(limit),
      ).rejects.toThrow(/between 1 and 200/);
    }

    // The two the app itself asks for are inside it.
    await expect(
      fetchLedgerEntriesAction(idOf("kid1"), RECENT_ENTRIES_LIMIT),
    ).resolves.toBeInstanceOf(Array);
    await expect(
      fetchLedgerEntriesAction(idOf("kid1"), HISTORY_LIMIT),
    ).resolves.toBeInstanceOf(Array);
  });

  it("keeps the two page sizes the screens were designed around", () => {
    // Both constants could be changed to anything and nothing went red: the
    // home screen asserts it asks for `RECENT_ENTRIES_LIMIT`, not that the
    // number is five, and nothing at all mentioned 200. They are the numbers
    // #15 and #16 were written against, so they are written down.
    expect(RECENT_ENTRIES_LIMIT).toBe(5);
    expect(HISTORY_LIMIT).toBe(200);
  });
});

describe("the history does not leak the other boy (#16)", () => {
  it("leaves his rows out of a list the caller is allowed to have", async () => {
    // The guard is not what protects this: Kid1 is allowed to read Kid1.
    // The `where` is. A query that lost it would pass every access test in the
    // repository and still put this string on his screen.
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
    // One text column holds both (`rejectionNote`), and what #72 asks for is
    // the sentence the adult wrote — not the one the boy typed when he stopped
    // the stopwatch.
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
    // #20 makes refusing without a reason a normal thing to do, so null has to
    // reach the screen as null. Anything else would be the app writing a
    // sentence the adult chose not to.
    addRejected({ username: "kid1", occurredOn: "2026-09-03", reason: null });
    mocked.username = "kid1";

    const [first] = await fetchHistoryAction(idOf("kid1"), 10);

    expect(first).toMatchObject({ kind: "rejected", reason: null });
  });

  it("orders the refusal among the ledger rows, most recent first", async () => {
    // Not appended at the end: it belongs on the day it happened, which is the
    // day the boy is looking for it on.
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
    // And it is not in the ledger list either: it has no ledger row to be in.
    await expect(
      fetchLedgerEntriesAction(idOf("kid1"), 10),
    ).resolves.toHaveLength(3);
  });

  it("does not show what is still waiting, nor what was approved twice", async () => {
    // A pending entry is not history yet, and an approved one is already in
    // the list under the hours it paid.
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
  /** A refusal of Kid2's, named so a leak is visible as a string. */
  const KID2_REFUSAL = "Motivo que só o Kid2 tem";

  beforeEach(() => {
    addRejected({
      username: "kid2",
      occurredOn: "2026-09-03",
      reason: KID2_REFUSAL,
    });
  });

  it("refuses a request carrying the brother's id", async () => {
    // The screen `/admin/historico/4` is not what keeps him out: this is. The
    // action is a POST endpoint taking a number, and a boy with a legitimate
    // login can send it.
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
    // The guard is not what protects this one: Kid1 is allowed to read
    // Kid1. The `where` on the log table is, and a query that lost it would
    // pass every access case above and still put this string on his screen.
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
