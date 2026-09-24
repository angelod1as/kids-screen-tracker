import { asc, eq } from "drizzle-orm";

import type { Connection } from "./client";
import type { LogEdits, QueueEntry } from "./queue";
import { activities, activityLogs, ledger, users } from "./schema";

/**
 * The rules of #20, written out one case at a time.
 *
 * Same shape and same reason as `src/auth/access.rules.ts` and
 * `src/engine/timer.rules.ts`: two files run this table. `queue.test.ts`
 * asserts the real module answers every case, and `queue.sabotage.test.ts`
 * rewrites `src/db/queue.ts` one clause at a time and asserts each mutant gets
 * at least one case wrong.
 *
 * These cases touch a database, which the other two tables do not, because the
 * rules they are about are rules *of* the writing: "congela `computed_hours` e
 * grava o ledger na MESMA transação" is not a statement any pure function can
 * be asked about. Each case is handed a freshly migrated and seeded database of
 * its own and answers with one string.
 */

/** The part of `src/db/queue.ts` a case may call. */
export type QueueModule = {
  listPendingLogs: (connection: Connection) => QueueEntry[];
  approveLog: (
    connection: Connection,
    logId: number,
    reviewerId: number,
    edits: LogEdits,
    now: Date,
  ) => { hours: number; creditedLedger: boolean };
  rejectLog: (
    connection: Connection,
    logId: number,
    reviewerId: number,
    reason: string | null,
    now: Date,
  ) => void;
  rejectionNote: (note: string | null, reason: string | null) => string | null;
  rejectionReason: (note: string | null) => string | null;
};

/**
 * The moment every case is reviewed at.
 *
 * Fixed, and deliberately a different day from any entry being approved: the
 * rule under test is that the value comes from the day the entry happened (D8),
 * and a table that reviewed things on the day they happened could not tell the
 * two apart.
 */
export const REVIEWED_AT = new Date("2026-09-13T15:00:00.000Z");

/** The São Paulo day `REVIEWED_AT` falls on. */
export const TODAY = "2026-09-13";

/** Three days earlier: the day the entries under review happened. */
export const THAT_DAY = "2026-09-10";

export type World = {
  connection: Connection;
  /** Kid1. */
  kidId: number;
  /** Admin1, who is doing the reviewing. */
  adminId: number;
  activityId: (name: string) => number;
  addPending: (entry: {
    activity: string;
    occurredOn?: string;
    durationMinutes?: number | null;
    /** Defaults to the minutes times sixty, which is what they round back to. */
    durationSeconds?: number | null;
    quality?: number | null;
    note?: string | null;
    createdAtMs?: number;
  }) => number;
  addApproved: (entry: {
    activity: string;
    occurredOn?: string;
    durationMinutes?: number | null;
    quality?: number | null;
    hours?: number;
    createdAtMs?: number;
  }) => number;
  logRow: (id: number) => {
    status: string;
    computedHours: number | null;
    durationMinutes: number | null;
    durationSeconds: number | null;
    activityName: string;
    note: string | null;
    reviewedBy: number | null;
  };
  ledgerRows: () => {
    userId: number;
    kind: string;
    hours: number;
    occurredOn: string;
    activityLogId: number | null;
    createdBy: number;
  }[];
};

/**
 * `YYYY-MM-DD` shifted by whole days, written out rather than imported.
 *
 * Same argument as the one in `src/engine/cases.ts`: a table that shifts its
 * dates with the engine's own helper cannot see the day the two disagree.
 */
export function shiftDay(date: string, days: number): string {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);

  return shifted.toISOString().slice(0, 10);
}

/** The seeded activities the cases use, by name. */
export const BOOK = "Ler livro";
export const COMIC = "Ler quadrinhos ou HQ";
export const CAR = "Lavar o carro";
/** `fixed`, three hours whatever the afternoon lasted: nothing to time. */
export const FRIENDS = "Sair com os amigos";
/** Escola's one timed activity: a daily bucket, no cooldown, no return bonus. */
export const STUDY = "Estudo para prova";

/**
 * A world around an already migrated and seeded connection.
 *
 * Here rather than in the test files so both of them build the same one — a
 * matrix whose fixtures differ from the ordinary test's fixtures is a matrix
 * about a different program.
 */
/** The category an activity sits in, for the approved fixtures (D37). */
function categoryOfActivity(
  connection: Connection,
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

export function makeWorld(connection: Connection): World {
  const people = new Map(
    connection.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .all()
      .map((row) => [row.username, row.id] as const),
  );
  const kidId = people.get("kid1") ?? 0;
  const adminId = people.get("admin1") ?? 0;

  const activityId = (name: string) => {
    const row = connection.db
      .select({ id: activities.id })
      .from(activities)
      .where(eq(activities.name, name))
      .get();

    if (row === undefined) throw new Error(`no activity named ${name}`);

    return row.id;
  };

  /** Distinct, increasing `created_at` values, so D8's order is well defined. */
  let stamp = new Date("2026-09-10T12:00:00.000Z").getTime();

  return {
    connection,
    kidId,
    adminId,
    activityId,
    addPending: (entry) => {
      stamp += 1000;
      const minutes =
        entry.durationMinutes === undefined ? 60 : entry.durationMinutes;
      const row = connection.db
        .insert(activityLogs)
        .values({
          userId: kidId,
          activityId: activityId(entry.activity),
          status: "pending",
          source: "timer",
          occurredOn: entry.occurredOn ?? THAT_DAY,
          durationMinutes: minutes,
          durationSeconds:
            entry.durationSeconds === undefined
              ? minutes === null
                ? null
                : minutes * 60
              : entry.durationSeconds,
          quality: entry.quality ?? null,
          note: entry.note ?? null,
          createdBy: kidId,
          createdAt: new Date(entry.createdAtMs ?? stamp),
        })
        .returning({ id: activityLogs.id })
        .get();

      return row.id;
    },
    addApproved: (entry) => {
      stamp += 1000;
      const row = connection.db
        .insert(activityLogs)
        .values({
          userId: kidId,
          activityId: activityId(entry.activity),
          status: "approved",
          source: "admin",
          occurredOn: entry.occurredOn ?? THAT_DAY,
          durationMinutes:
            entry.durationMinutes === undefined ? 60 : entry.durationMinutes,
          quality: entry.quality ?? null,
          computedHours: entry.hours ?? 1,
          // D37: an approved row carries the bucket it counted under, and
          // `activity_logs_category_id_status_check` makes that an invariant.
          categoryId: categoryOfActivity(
            connection,
            activityId(entry.activity),
          ),
          createdBy: adminId,
          reviewedBy: adminId,
          reviewedAt: REVIEWED_AT,
          createdAt: new Date(entry.createdAtMs ?? stamp),
        })
        .returning({ id: activityLogs.id })
        .get();

      return row.id;
    },
    logRow: (id) => {
      const row = connection.db
        .select({
          status: activityLogs.status,
          computedHours: activityLogs.computedHours,
          durationMinutes: activityLogs.durationMinutes,
          durationSeconds: activityLogs.durationSeconds,
          activityName: activities.name,
          note: activityLogs.note,
          reviewedBy: activityLogs.reviewedBy,
        })
        .from(activityLogs)
        .innerJoin(activities, eq(activityLogs.activityId, activities.id))
        .where(eq(activityLogs.id, id))
        .get();

      if (row === undefined) throw new Error(`no log ${id}`);

      return row;
    },
    ledgerRows: () =>
      connection.db
        .select({
          userId: ledger.userId,
          kind: ledger.kind,
          hours: ledger.hours,
          occurredOn: ledger.occurredOn,
          activityLogId: ledger.activityLogId,
          createdBy: ledger.createdBy,
        })
        .from(ledger)
        .orderBy(asc(ledger.id))
        .all(),
  };
}

export type QueueCase = {
  /** Which acceptance criterion of #20 this case belongs to. */
  rule: string;
  name: string;
  run: (queue: QueueModule, world: World) => unknown;
  expected: unknown;
};

/** The ledger as one comparable line per row. */
function ledgerText(world: World): string {
  const rows = world.ledgerRows();

  return rows.length === 0
    ? "no ledger"
    : rows
        .map(
          (row) =>
            `${row.kind} ${row.hours} on ${row.occurredOn} for log ${row.activityLogId} by ${row.createdBy} to ${row.userId}`,
        )
        .join(" | ");
}

/** A log row as one comparable line. */
function logText(world: World, id: number): string {
  const row = world.logRow(id);

  return `${row.status} · ${row.computedHours} h · ${row.durationMinutes} min · ${row.activityName} · by ${row.reviewedBy} · ${row.note ?? "no note"}`;
}

/** Runs `body` and names the refusal instead of letting it escape. */
function refused(body: () => void): string {
  try {
    body();
  } catch (thrown) {
    return `refused: ${(thrown as Error).message}`;
  }

  return "not refused";
}

export const QUEUE_CASES: readonly QueueCase[] = [
  // --- aprovar congela computed_hours e grava o ledger na mesma transação ---
  {
    rule: "approving freezes the value and credits the ledger",
    name: "one hour of Ler livro is an hour and a half, and a debut has no return bonus",
    run: (queue, world) => {
      const id = world.addPending({ activity: BOOK });
      queue.approveLog(world.connection, id, world.adminId, {}, REVIEWED_AT);

      return logText(world, id);
    },
    // 1h × 1,5, and no bonus: nothing of Mente before it (D47).
    expected: `approved · 1.5 h · 60 min · ${BOOK} · by 1 · no note`,
  },
  {
    rule: "approving freezes the value and credits the ledger",
    name: "the ledger row carries the day the entry happened, not today",
    run: (queue, world) => {
      const id = world.addPending({ activity: BOOK });
      queue.approveLog(world.connection, id, world.adminId, {}, REVIEWED_AT);

      return ledgerText(world);
    },
    expected: `earn 1.5 on ${THAT_DAY} for log 1 by 1 to 3`,
  },
  {
    rule: "approving freezes the value and credits the ledger",
    name: "the entry leaves the queue and nothing else does",
    run: (queue, world) => {
      const id = world.addPending({ activity: BOOK });
      world.addPending({ activity: COMIC });
      queue.approveLog(world.connection, id, world.adminId, {}, REVIEWED_AT);

      return queue
        .listPendingLogs(world.connection)
        .map((entry) => entry.activityName)
        .join(", ");
    },
    expected: COMIC,
  },
  {
    rule: "approving freezes the value and credits the ledger",
    name: "the preview says what approving would pay",
    run: (queue, world) => {
      world.addPending({ activity: BOOK });

      return queue.listPendingLogs(world.connection)[0]?.preview?.hours;
    },
    expected: 1.5,
  },

  // --- aprovar usa o balde do dia em que o log ocorreu (D8) -----------------
  {
    rule: "the value comes from the day the entry happened",
    name: "a second entry of the same day is paid out of the first one's bucket",
    run: (queue, world) => {
      const first = world.addPending({ activity: BOOK });
      const second = world.addPending({ activity: BOOK });
      queue.approveLog(world.connection, first, world.adminId, {}, REVIEWED_AT);
      queue.approveLog(
        world.connection,
        second,
        world.adminId,
        {},
        REVIEWED_AT,
      );

      return ledgerText(world);
    },
    // The first is 1h × 1,5. The second reads an hour of Mente already in the
    // bucket, so it halves to 0,75h.
    expected: `earn 1.5 on ${THAT_DAY} for log 1 by 1 to 3 | earn 0.75 on ${THAT_DAY} for log 2 by 1 to 3`,
  },
  {
    rule: "the value comes from the day the entry happened",
    name: "today's hours do not fill the bucket of three days ago",
    run: (queue, world) => {
      // Four hours today, which would halve an entry twice over if the bucket
      // were read from the clock instead of from the day the entry happened.
      //
      // Escola and not Mente: D3's bucket is the one rule here that is per day
      // whatever the freeze order, and Escola has neither a cooldown nor a
      // return bonus — so this case answers about the bucket alone. With Mente
      // it would also be answering about D34's window, which is the case below.
      world.addApproved({
        activity: STUDY,
        occurredOn: TODAY,
        durationMinutes: 240,
      });
      const id = world.addPending({ activity: STUDY, occurredOn: THAT_DAY });
      queue.approveLog(world.connection, id, world.adminId, {}, REVIEWED_AT);

      // 1h × 1,0 on an empty day, and not the 0,25 h four hours in the bucket
      // would make it.
      return world.logRow(id).computedHours;
    },
    expected: 1,
  },
  {
    rule: "the value comes from the day the entry happened",
    name: "what was frozen first counts, whenever it happened (D34)",
    run: (queue, world) => {
      // An hour of the same day and the same category, already approved and so
      // already frozen, but created *after* this entry. Under D8's canonical
      // order it was invisible here and this entry read an empty bucket; under
      // D34 what decides is that it was frozen first, so it fills the bucket
      // and this entry is halved.
      const entry = world.addPending({ activity: BOOK });
      world.addApproved({ activity: BOOK });
      queue.approveLog(world.connection, entry, world.adminId, {}, REVIEWED_AT);

      return world.logRow(entry).computedHours;
    },
    expected: 0.75,
  },
  {
    rule: "the value comes from the day the entry happened",
    name: "a session that crossed midnight reads today, if today was frozen first (D31, D34)",
    run: (queue, world) => {
      // The hole round 1 found. D31 settles a session that began at 23:50 onto
      // the day it began, so this entry carries yesterday's `occurred_on` and
      // reaches the queue after today's entry is already frozen. Both used to
      // read an empty bucket and the boy was paid twice over for one afternoon
      // of Mente. The August hour makes it a return, so the bonus is at stake
      // (D47).
      world.addApproved({ activity: BOOK, occurredOn: "2026-08-01" });
      world.addApproved({ activity: BOOK, occurredOn: TODAY });

      const yesterday = world.addPending({
        activity: BOOK,
        occurredOn: shiftDay(TODAY, -1),
      });
      queue.approveLog(
        world.connection,
        yesterday,
        world.adminId,
        {},
        REVIEWED_AT,
      );

      // Not 2,25 h: today's hour of Mente was frozen first and it is inside this
      // entry's three-day return-bonus window, so the bonus is gone. The
      // bucket is untouched — D3 is per day, and these are two days.
      return world.logRow(yesterday).computedHours;
    },
    expected: 1.5,
  },

  // --- aprovar respeita a ordem canônica (D8, D15) --------------------------
  {
    rule: "an entry is not frozen while an earlier one is undecided",
    name: "the newer of two entries of one day cannot be approved first",
    run: (queue, world) => {
      const earlier = world.addPending({ activity: BOOK });
      const later = world.addPending({ activity: BOOK });

      return `${refused(() =>
        queue.approveLog(
          world.connection,
          later,
          world.adminId,
          {},
          REVIEWED_AT,
        ),
      )} — ${ledgerText(world)} — ${world.logRow(earlier).status}`;
    },
    expected: `refused: log 2 cannot be approved yet: log 1 (${BOOK}, ${THAT_DAY}) comes before it and is still waiting; decide that one first — no ledger — pending`,
  },
  {
    rule: "an entry is not frozen while an earlier one is undecided",
    name: "in order, the same two hours are two and a quarter and not three",
    run: (queue, world) => {
      const earlier = world.addPending({ activity: BOOK });
      const later = world.addPending({ activity: BOOK });
      queue.approveLog(
        world.connection,
        earlier,
        world.adminId,
        {},
        REVIEWED_AT,
      );
      queue.approveLog(world.connection, later, world.adminId, {}, REVIEWED_AT);

      return (
        (world.logRow(earlier).computedHours ?? 0) +
        (world.logRow(later).computedHours ?? 0)
      );
    },
    expected: 2.25,
  },
  {
    rule: "an entry is not frozen while an earlier one is undecided",
    name: "the cooldown's own window blocks across days too",
    run: (queue, world) => {
      // "Lavar o carro" repeats on a seven-day cooldown, so Monday is in
      // Tuesday's window: approving Tuesday first paid 3 h twice.
      world.addPending({
        activity: CAR,
        occurredOn: "2026-09-07",
        durationMinutes: null,
        quality: 1,
      });
      const tuesday = world.addPending({
        activity: CAR,
        occurredOn: "2026-09-08",
        durationMinutes: null,
        quality: 1,
      });

      return refused(() =>
        queue.approveLog(
          world.connection,
          tuesday,
          world.adminId,
          {},
          REVIEWED_AT,
        ),
      );
    },
    expected: `refused: log 2 cannot be approved yet: log 1 (${CAR}, 2026-09-07) comes before it and is still waiting; decide that one first`,
  },
  {
    rule: "an entry is not frozen while an earlier one is undecided",
    name: "in order, the two car washes are four and a half hours",
    run: (queue, world) => {
      const monday = world.addPending({
        activity: CAR,
        occurredOn: "2026-09-07",
        durationMinutes: null,
        quality: 1,
      });
      const tuesday = world.addPending({
        activity: CAR,
        occurredOn: "2026-09-08",
        durationMinutes: null,
        quality: 1,
      });
      queue.approveLog(
        world.connection,
        monday,
        world.adminId,
        {},
        REVIEWED_AT,
      );
      queue.approveLog(
        world.connection,
        tuesday,
        world.adminId,
        {},
        REVIEWED_AT,
      );

      return (
        (world.logRow(monday).computedHours ?? 0) +
        (world.logRow(tuesday).computedHours ?? 0)
      );
    },
    expected: 4.5,
  },
  {
    rule: "an entry is not frozen while an earlier one is undecided",
    name: "refusing the older one clears the way, since a refusal counts for nothing",
    run: (queue, world) => {
      const earlier = world.addPending({ activity: BOOK });
      const later = world.addPending({ activity: BOOK });
      queue.rejectLog(
        world.connection,
        earlier,
        world.adminId,
        null,
        REVIEWED_AT,
      );
      queue.approveLog(world.connection, later, world.adminId, {}, REVIEWED_AT);

      return world.logRow(later).computedHours;
    },
    expected: 1.5,
  },
  {
    rule: "an entry is not frozen while an earlier one is undecided",
    name: "an entry outside the calculation's window does not block anything",
    run: (queue, world) => {
      // Ler livro looks three days back for the return bonus and no further, so
      // a fortnight-old entry an adult has not decided is none of its business,
      // once Mente has an approved past it cannot be the debut of (D47).
      world.addApproved({ activity: BOOK, occurredOn: "2026-08-01" });
      world.addPending({ activity: BOOK, occurredOn: "2026-08-27" });
      const today = world.addPending({ activity: BOOK });
      queue.approveLog(world.connection, today, world.adminId, {}, REVIEWED_AT);

      return world.logRow(today).computedHours;
    },
    expected: 2.25,
  },
  {
    rule: "an entry is not frozen while an earlier one is undecided",
    name: "a pending debut blocks the category however old it is (D47)",
    run: (queue, world) => {
      // Approved first, it makes today a return; refused, today is the debut.
      world.addPending({ activity: BOOK, occurredOn: "2026-08-27" });
      const today = world.addPending({ activity: BOOK });

      return refused(() =>
        queue.approveLog(
          world.connection,
          today,
          world.adminId,
          {},
          REVIEWED_AT,
        ),
      );
    },
    expected: `refused: log 2 cannot be approved yet: log 1 (${BOOK}, 2026-08-27) comes before it and is still waiting; decide that one first`,
  },
  {
    rule: "an entry is not frozen while an earlier one is undecided",
    name: "another category's past does not make a return (D47)",
    run: (queue, world) => {
      world.addApproved({
        activity: CAR,
        occurredOn: "2026-08-01",
        quality: 1,
      });
      const today = world.addPending({ activity: BOOK });
      queue.approveLog(world.connection, today, world.adminId, {}, REVIEWED_AT);

      return world.logRow(today).computedHours;
    },
    expected: 1.5,
  },
  {
    rule: "an entry is not frozen while an earlier one is undecided",
    name: "a pending debut of another category blocks nothing",
    run: (queue, world) => {
      world.addPending({ activity: CAR, occurredOn: "2026-08-27", quality: 1 });
      const today = world.addPending({ activity: BOOK });
      queue.approveLog(world.connection, today, world.adminId, {}, REVIEWED_AT);

      return world.logRow(today).computedHours;
    },
    expected: 1.5,
  },
  {
    rule: "an entry is not frozen while an earlier one is undecided",
    name: "decided in order, the debut pays no bonus and the return does (D47)",
    run: (queue, world) => {
      const debut = world.addPending({
        activity: BOOK,
        occurredOn: "2026-08-27",
      });
      const today = world.addPending({ activity: BOOK });
      queue.approveLog(world.connection, debut, world.adminId, {}, REVIEWED_AT);
      queue.approveLog(world.connection, today, world.adminId, {}, REVIEWED_AT);

      return `${world.logRow(debut).computedHours} · ${world.logRow(today).computedHours}`;
    },
    expected: "1.5 · 2.25",
  },
  {
    rule: "an entry is not frozen while an earlier one is undecided",
    name: "the queue says which entry stands in the way",
    run: (queue, world) => {
      world.addPending({ activity: BOOK });
      world.addPending({ activity: COMIC });
      const entries = queue.listPendingLogs(world.connection);

      return entries
        .map(
          (entry) =>
            `${entry.activityName}: ${entry.blockedBy?.activityName ?? "free"}`,
        )
        .join(" | ");
    },
    expected: `${BOOK}: free | ${COMIC}: ${BOOK}`,
  },

  // --- D10: um valor de zero não gera linha no ledger -----------------------
  {
    rule: "a value of zero is a record with no ledger line",
    name: "a delivery graded zero is approved and credits nothing",
    run: (queue, world) => {
      const id = world.addPending({
        activity: CAR,
        durationMinutes: null,
        quality: 0,
      });
      queue.approveLog(world.connection, id, world.adminId, {}, REVIEWED_AT);

      return `${logText(world, id)} — ${ledgerText(world)}`;
    },
    expected: `approved · 0 h · null min · ${CAR} · by 1 · no note — no ledger`,
  },
  {
    rule: "a value of zero is a record with no ledger line",
    name: "six more minutes on a bucket twenty hours deep round to nothing",
    run: (queue, world) => {
      world.addApproved({ activity: BOOK, durationMinutes: 1200 });
      const id = world.addPending({ activity: BOOK, durationMinutes: 6 });
      queue.approveLog(world.connection, id, world.adminId, {}, REVIEWED_AT);

      return `${world.logRow(id).computedHours} — ${ledgerText(world)}`;
    },
    expected: "0 — no ledger",
  },
  {
    rule: "a value of zero is a record with no ledger line",
    name: "the approval says it credited nothing",
    run: (queue, world) => {
      const id = world.addPending({
        activity: CAR,
        durationMinutes: null,
        quality: 0,
      });

      const result = queue.approveLog(
        world.connection,
        id,
        world.adminId,
        {},
        REVIEWED_AT,
      );

      return `${result.hours} · ${result.creditedLedger}`;
    },
    expected: "0 · false",
  },

  // --- D19: rejeitar não cria nada e não conta para nada --------------------
  {
    rule: "a rejected entry creates nothing and counts for nothing",
    name: "it is rejected, reviewed, and has no value",
    run: (queue, world) => {
      const id = world.addPending({ activity: BOOK });
      queue.rejectLog(world.connection, id, world.adminId, null, REVIEWED_AT);

      return `${logText(world, id)} — ${ledgerText(world)}`;
    },
    expected: `rejected · null h · 60 min · ${BOOK} · by 1 · no note — no ledger`,
  },
  {
    rule: "a rejected entry creates nothing and counts for nothing",
    name: "it does not fill the day's bucket for the next entry",
    run: (queue, world) => {
      const refusedLog = world.addPending({ activity: BOOK });
      const kept = world.addPending({ activity: BOOK });
      queue.rejectLog(
        world.connection,
        refusedLog,
        world.adminId,
        "não foi isso",
        REVIEWED_AT,
      );
      queue.approveLog(world.connection, kept, world.adminId, {}, REVIEWED_AT);

      return world.logRow(kept).computedHours;
    },
    // Full value: the refused hour never happened as far as the bucket, the
    // cooldown and the return bonus are concerned.
    expected: 1.5,
  },
  {
    rule: "a rejected entry creates nothing and counts for nothing",
    name: "the reason is kept beside what the boy wrote",
    run: (queue, world) => {
      const id = world.addPending({
        activity: BOOK,
        note: "Li dois capítulos",
      });
      queue.rejectLog(
        world.connection,
        id,
        world.adminId,
        "Você estava no celular",
        REVIEWED_AT,
      );

      return world.logRow(id).note;
    },
    expected: "Li dois capítulos\nRecusado: Você estava no celular",
  },
  {
    rule: "a rejected entry creates nothing and counts for nothing",
    name: "a refusal with no reason keeps the boy's note alone",
    run: (queue) => queue.rejectionNote("Li dois capítulos", null) ?? "null",
    expected: "Li dois capítulos",
  },
  {
    rule: "a rejected entry creates nothing and counts for nothing",
    name: "a reason with no note stands on its own",
    run: (queue) => queue.rejectionNote(null, "Sem capacete") ?? "null",
    expected: "Recusado: Sem capacete",
  },
  {
    rule: "a rejected entry creates nothing and counts for nothing",
    name: "the reason is readable again on the boy's side (#72)",
    run: (queue) =>
      queue.rejectionReason(
        queue.rejectionNote("Li dois capítulos", "Você estava no celular"),
      ) ?? "null",
    expected: "Você estava no celular",
  },
  {
    rule: "a rejected entry creates nothing and counts for nothing",
    name: "a refusal with no reason has none to read back (#72)",
    run: (queue) =>
      queue.rejectionReason(queue.rejectionNote("Li dois capítulos", null)) ??
      "null",
    expected: "null",
  },
  {
    rule: "a rejected entry creates nothing and counts for nothing",
    name: "the boy's own words are not read back as the adult's (#72)",
    run: (queue) => queue.rejectionReason("Li dois capítulos") ?? "null",
    expected: "null",
  },
  {
    rule: "a rejected entry creates nothing and counts for nothing",
    name: "a reason that stands alone is read back too (#72)",
    // The other branch of `rejectionReason`: with no note of the boy's, the
    // marker opens the text instead of following a newline. Nothing exercised
    // it — every other round-trip case here hands it a note as well.
    run: (queue) =>
      queue.rejectionReason(queue.rejectionNote(null, "Sem capacete")) ??
      "null",
    expected: "Sem capacete",
  },
  {
    rule: "a rejected entry creates nothing and counts for nothing",
    name: "a reason carrying the marker itself comes back cut, which is known (#72)",
    // Not the behaviour anybody wants — it is the residual of holding two
    // voices in one text column, written down here so it is a measured fact
    // rather than a surprise. `queue.ts` names it beside the other one, and
    // the fix for both is a column of its own. This case is what an honest
    // fix deletes.
    run: (queue) =>
      queue.rejectionReason(
        queue.rejectionNote(
          "Li dois capítulos",
          "primeira linha\nRecusado: outra parte",
        ),
      ) ?? "null",
    expected: "outra parte",
  },
  {
    rule: "a rejected entry creates nothing and counts for nothing",
    name: "a reason with a line break in it is read back whole (#72)",
    // The case `rejectionReason` is written for: `rejectLogAction` trims a
    // reason but does not forbid a newline inside one, so the function reads
    // from the last marker to the end of the text rather than to the end of
    // the line. Explained in its docstring, and now watched — a "last line"
    // implementation would hand back "Você estava no celular" alone.
    run: (queue) =>
      queue.rejectionReason(
        queue.rejectionNote(
          "Li dois capítulos",
          "Você estava no celular\ne já tínhamos combinado",
        ),
      ) ?? "null",
    expected: "Você estava no celular\ne já tínhamos combinado",
  },

  // --- editar duração, nota ou atividade antes de aprovar -------------------
  {
    rule: "an edit applies before the value is computed",
    name: "half the duration is half the value",
    run: (queue, world) => {
      const id = world.addPending({ activity: BOOK });
      queue.approveLog(
        world.connection,
        id,
        world.adminId,
        { durationMinutes: 30 },
        REVIEWED_AT,
      );

      return logText(world, id);
    },
    // 0,5h × 1,5 = 0,75h.
    expected: `approved · 0.75 h · 30 min · ${BOOK} · by 1 · no note`,
  },
  {
    rule: "an edit applies before the value is computed",
    name: "another activity is another rate",
    run: (queue, world) => {
      // Since #110 the seed prices comics at Mente's rate, so they are moved
      // off it here: the number has to say which activity paid.
      world.connection.sqlite
        .prepare("update activities set value = 1 where name = ?")
        .run(COMIC);
      const id = world.addPending({ activity: BOOK });
      queue.approveLog(
        world.connection,
        id,
        world.adminId,
        { activityId: world.activityId(COMIC) },
        REVIEWED_AT,
      );

      return logText(world, id);
    },
    expected: `approved · 1 h · 60 min · ${COMIC} · by 1 · no note`,
  },
  {
    rule: "an edit applies before the value is computed",
    name: "the note an adult writes replaces the one that was there",
    run: (queue, world) => {
      const id = world.addPending({ activity: BOOK, note: "meia hora" });
      queue.approveLog(
        world.connection,
        id,
        world.adminId,
        { note: "conferido" },
        REVIEWED_AT,
      );

      return world.logRow(id).note;
    },
    expected: "conferido",
  },
  {
    rule: "an edit applies before the value is computed",
    name: "an entry approved untouched keeps every word of it",
    run: (queue, world) => {
      const id = world.addPending({ activity: BOOK, note: "meia hora" });
      queue.approveLog(world.connection, id, world.adminId, {}, REVIEWED_AT);

      return world.logRow(id).note;
    },
    expected: "meia hora",
  },
  {
    rule: "an edit applies before the value is computed",
    name: "an entry approved untouched keeps the seconds it was measured with",
    run: (queue, world) => {
      const id = world.addPending({
        activity: BOOK,
        durationMinutes: 2,
        durationSeconds: 100,
      });
      queue.approveLog(world.connection, id, world.adminId, {}, REVIEWED_AT);

      const row = world.logRow(id);

      return `${row.durationMinutes} min · ${row.durationSeconds}s`;
    },
    expected: "2 min · 100s",
  },
  {
    rule: "an edit applies before the value is computed",
    name: "a correction that sends the duration back unchanged keeps the seconds",
    run: (queue, world) => {
      const id = world.addPending({
        activity: BOOK,
        durationMinutes: 2,
        durationSeconds: 100,
      });
      // What the correction form sends when the adult opened it for the note
      // alone: every field it shows, the minutes among them and untouched.
      queue.approveLog(
        world.connection,
        id,
        world.adminId,
        { durationMinutes: 2, note: "conferido" },
        REVIEWED_AT,
      );

      const row = world.logRow(id);

      return `${row.durationMinutes} min · ${row.durationSeconds}s · ${row.note}`;
    },
    expected: "2 min · 100s · conferido",
  },
  {
    rule: "an edit applies before the value is computed",
    name: "a corrected duration rewrites the seconds beside it",
    run: (queue, world) => {
      const id = world.addPending({
        activity: BOOK,
        durationMinutes: 2,
        durationSeconds: 100,
      });
      queue.approveLog(
        world.connection,
        id,
        world.adminId,
        { durationMinutes: 30 },
        REVIEWED_AT,
      );

      const row = world.logRow(id);

      return `${row.durationMinutes} min · ${row.durationSeconds}s`;
    },
    expected: "30 min · 1800s",
  },
  {
    rule: "an edit applies before the value is computed",
    name: "a duration that is not a whole minute is refused before the database sees it",
    run: (queue, world) => {
      const id = world.addPending({ activity: BOOK });

      return refused(() =>
        queue.approveLog(
          world.connection,
          id,
          world.adminId,
          { durationMinutes: 0 },
          REVIEWED_AT,
        ),
      );
    },
    expected:
      "refused: a duration is a whole number of minutes, between 1 and 1000000; received 0",
  },

  {
    rule: "an edit applies before the value is computed",
    name: "a timed session cannot be moved to something with no duration",
    run: (queue, world) => {
      const id = world.addPending({ activity: BOOK });

      return `${refused(() =>
        queue.approveLog(
          world.connection,
          id,
          world.adminId,
          { activityId: world.activityId(FRIENDS) },
          REVIEWED_AT,
        ),
      )} — ${world.logRow(id).status} — ${ledgerText(world)}`;
    },
    expected: `refused: a timed session cannot be approved as ${FRIENDS}, which is not measured by duration — pending — no ledger`,
  },
  {
    rule: "an edit applies before the value is computed",
    name: "an entry cannot be moved to a deactivated activity (D14)",
    run: (queue, world) => {
      const id = world.addPending({ activity: BOOK });
      const comic = world.activityId(COMIC);
      world.connection.db
        .update(activities)
        .set({ active: false })
        .where(eq(activities.id, comic))
        .run();

      const answer = refused(() =>
        queue.approveLog(
          world.connection,
          id,
          world.adminId,
          { activityId: comic },
          REVIEWED_AT,
        ),
      ).replace(/activity \d+/, "activity N");

      return `${answer} — ${world.logRow(id).status}`;
    },
    expected:
      "refused: activity N is not active and cannot be chosen (D14) — pending",
  },
  {
    rule: "an edit applies before the value is computed",
    name: "an activity that does not exist is refused before the calculation",
    run: (queue, world) => {
      const id = world.addPending({ activity: BOOK });

      return refused(() =>
        queue.approveLog(
          world.connection,
          id,
          world.adminId,
          { activityId: 9999 },
          REVIEWED_AT,
        ),
      );
    },
    expected: "refused: there is no activity 9999",
  },
  {
    rule: "an edit applies before the value is computed",
    name: "a duration the column would refuse is refused in words",
    run: (queue, world) => {
      const id = world.addPending({ activity: BOOK });

      return refused(() =>
        queue.approveLog(
          world.connection,
          id,
          world.adminId,
          { durationMinutes: 1e9 },
          REVIEWED_AT,
        ),
      );
    },
    expected:
      "refused: a duration is a whole number of minutes, between 1 and 1000000; received 1000000000",
  },

  // --- uma decisão por entrada ----------------------------------------------
  {
    rule: "an entry is decided once",
    name: "approving twice is refused, and credits once",
    run: (queue, world) => {
      const id = world.addPending({ activity: BOOK });
      queue.approveLog(world.connection, id, world.adminId, {}, REVIEWED_AT);

      const second = refused(() =>
        queue.approveLog(world.connection, id, world.adminId, {}, REVIEWED_AT),
      );

      return `${second} — ${ledgerText(world)}`;
    },
    expected: `refused: log 1 has already been reviewed: it is approved — earn 1.5 on ${THAT_DAY} for log 1 by 1 to 3`,
  },
  {
    rule: "an entry is decided once",
    name: "rejecting something already approved is refused",
    run: (queue, world) => {
      const id = world.addPending({ activity: BOOK });
      queue.approveLog(world.connection, id, world.adminId, {}, REVIEWED_AT);

      return refused(() =>
        queue.rejectLog(world.connection, id, world.adminId, null, REVIEWED_AT),
      );
    },
    expected: "refused: log 1 has already been reviewed: it is approved",
  },
  {
    rule: "an entry is decided once",
    name: "an entry that does not exist is refused",
    run: (queue, world) =>
      refused(() =>
        queue.approveLog(world.connection, 999, world.adminId, {}, REVIEWED_AT),
      ),
    expected: "refused: there is no log 999",
  },
];

/**
 * The cases `queue` gets wrong, each run against a world of its own.
 *
 * A fresh database per case, because these cases write: sharing one would make
 * the answer depend on the order the table happens to be in.
 */
export function failingQueueCases(
  queue: QueueModule,
  worlds: () => World,
): QueueCase[] {
  return QUEUE_CASES.filter((queueCase) => {
    const world = worlds();

    try {
      return queueCase.run(queue, world) !== queueCase.expected;
    } catch (thrown) {
      // A mutant that throws where the table expects a value is caught, and
      // says so instead of taking the whole run down.
      return `threw: ${(thrown as Error).message}` !== queueCase.expected;
    } finally {
      world.connection.sqlite.close();
    }
  });
}
