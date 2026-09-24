import { and, asc, eq, gte, lte } from "drizzle-orm";

import type { Calculation } from "../engine/calculate";
import {
  approvedOnly,
  calculateEarnedHours,
  historyWindowEnd,
  historyWindowStart,
  isEarlier,
  returnBonusWindowStart,
} from "../engine/calculate";
import type { Connection, Transaction } from "./client";
import { writeTransaction } from "./client";
import { categoryFirstDay, pendingDebutBefore } from "./debut";
import { requireHours } from "./input";
import { activities, activityLogs, categories, ledger, users } from "./schema";

/**
 * The approval queue (#20). An entry's value is computed from the day it
 * happened (D8), at approval, inside the transaction that writes it: the
 * preview is never an input to the approval.
 */

/** One entry of the queue, ready to draw. */
export type QueueEntry = {
  id: number;
  userId: number;
  kidName: string;
  activityId: number;
  activityName: string;
  categoryName: string;
  occurredOn: string;
  durationMinutes: number | null;
  /** What the screen shows (D17). */
  durationSeconds: number | null;
  note: string | null;
  /** D16: the boy did not end this session; the limit or the day did. */
  autoStopped: boolean;
  /** D49: the stopwatch or the boy's untimed request. */
  source: "timer" | "request" | "admin";
  /** A `free` activity needs the adult to type its value (D49). */
  calcMode: "duration" | "fixed" | "delivery" | "free";
  /** The stopwatch never grades, so an entry may need one at approval (D37). */
  qualityGraded: boolean;
  quality: number | null;
  /**
   * Null when the engine cannot price the entry: one such entry is one row with
   * a sentence on it, never a queue page that fails (D19).
   */
  preview: Calculation | null;
  /** The engine's own message, which names the activity and what is missing. */
  unpriceable: string | null;
  /** The entry to decide before this one (D32), or null. */
  blockedBy: BlockingEntry | null;
};

/** An entry that stands between another one and its approval (D8). */
export type BlockingEntry = {
  id: number;
  activityName: string;
  occurredOn: string;
};

/** What an adult may change before approving (#20). */
export type LogEdits = {
  activityId?: number;
  durationMinutes?: number;
  /** For a `quality_graded` entry the stopwatch could not grade (D37). */
  quality?: number | null;
  /** D49: the value of a `free` activity a boy requested; only an adult types it. */
  freeValue?: number;
  note?: string | null;
};

/** The columns a calculation reads off the entry being approved. */
type PendingLog = {
  id: number;
  userId: number;
  activityId: number;
  status: string;
  /** D18. */
  source: string;
  occurredOn: string;
  durationMinutes: number | null;
  quality: number | null;
  freeValue: number | null;
  note: string | null;
  createdAt: Date;
};

type Db = Connection["db"] | Transaction;

/** One read for the calculation and the settled-bucket check, so they agree. */
function activityFor(db: Db, log: PendingLog) {
  const found = db
    .select({
      activity: {
        id: activities.id,
        categoryId: activities.categoryId,
        name: activities.name,
        calcMode: activities.calcMode,
        value: activities.value,
        qualityGraded: activities.qualityGraded,
        repeatCooldownDays: activities.repeatCooldownDays,
      },
      category: {
        id: categories.id,
        name: categories.name,
        decayStepHours: categories.decayStepHours,
        returnBonusPct: categories.returnBonusPct,
        returnBonusAfterDays: categories.returnBonusAfterDays,
      },
    })
    .from(activities)
    .innerJoin(categories, eq(activities.categoryId, categories.id))
    .where(eq(activities.id, log.activityId))
    .get();

  if (found === undefined) {
    throw new Error(
      `log ${log.id} points at activity ${log.activityId}, which does not exist`,
    );
  }

  return found;
}

/** Worth on the day it happened (D8), against what was frozen before it (D34). */
function calculationFor(db: Db, log: PendingLog): Calculation {
  const found = activityFor(db, log);

  const historyFrom = historyWindowStart(
    log.occurredOn,
    found.activity,
    found.category,
  );
  // D34: what was frozen before this entry can sit on a later day (D31).
  const historyTo = historyWindowEnd(
    log.occurredOn,
    found.activity,
    found.category,
  );

  const history = db
    .select({
      id: activityLogs.id,
      userId: activityLogs.userId,
      occurredOn: activityLogs.occurredOn,
      activityId: activityLogs.activityId,
      durationMinutes: activityLogs.durationMinutes,
      createdAt: activityLogs.createdAt,
      status: activityLogs.status,
      // D37: the bucket each row counted under, off the row itself.
      categoryId: activityLogs.categoryId,
    })
    .from(activityLogs)
    .innerJoin(activities, eq(activityLogs.activityId, activities.id))
    .where(
      and(
        eq(activityLogs.userId, log.userId),
        // D19: only an approved entry counts.
        eq(activityLogs.status, "approved"),
        gte(activityLogs.occurredOn, historyFrom),
        lte(activityLogs.occurredOn, historyTo),
      ),
    )
    .all();

  return calculateEarnedHours({
    userId: log.userId,
    activity: found.activity,
    category: found.category,
    occurredOn: log.occurredOn,
    durationMinutes: log.durationMinutes,
    quality: log.quality,
    freeValue: log.freeValue,
    // D34: every approved row was frozen before this pending entry.
    history: approvedOnly(history),
    historyFrom,
    historyTo,
    categoryFirstDay: categoryFirstDay(db, log.userId, found.category.id),
  });
}

/**
 * The pending entry that has to be decided before `log` can be (D32, D47).
 * The window is read off the edited activity, which may move it.
 */
function pendingBefore(db: Db, log: PendingLog): BlockingEntry | undefined {
  const found = activityFor(db, log);
  const historyFrom = historyWindowStart(
    log.occurredOn,
    found.activity,
    found.category,
  );

  const blocking = db
    .select({
      id: activityLogs.id,
      activityName: activities.name,
      occurredOn: activityLogs.occurredOn,
      createdAt: activityLogs.createdAt,
    })
    .from(activityLogs)
    .innerJoin(activities, eq(activityLogs.activityId, activities.id))
    .where(
      and(
        eq(activityLogs.userId, log.userId),
        eq(activityLogs.status, "pending"),
        gte(activityLogs.occurredOn, historyFrom),
        lte(activityLogs.occurredOn, log.occurredOn),
      ),
    )
    .orderBy(
      asc(activityLogs.occurredOn),
      asc(activityLogs.createdAt),
      asc(activityLogs.id),
    )
    .all()
    .find((candidate) =>
      isEarlier(candidate, log.occurredOn, {
        createdAt: log.createdAt,
        id: log.id,
      }),
    );

  return blocking === undefined
    ? pendingDebutBefore(
        db,
        {
          userId: log.userId,
          categoryId: found.category.id,
          returnBonusPct: found.category.returnBonusPct,
        },
        returnBonusWindowStart(log.occurredOn, found.category),
      )
    : {
        id: blocking.id,
        activityName: blocking.activityName,
        occurredOn: blocking.occurredOn,
      };
}

const PENDING_COLUMNS = {
  id: activityLogs.id,
  userId: activityLogs.userId,
  activityId: activityLogs.activityId,
  status: activityLogs.status,
  source: activityLogs.source,
  occurredOn: activityLogs.occurredOn,
  durationMinutes: activityLogs.durationMinutes,
  quality: activityLogs.quality,
  freeValue: activityLogs.freeValue,
  note: activityLogs.note,
  createdAt: activityLogs.createdAt,
} as const;

/**
 * The only `catch` here: one unpriceable row must not take the list down.
 * Every other path keeps throwing (D33).
 */
function priceOrExplain(
  db: Db,
  log: PendingLog,
): { preview: Calculation | null; unpriceable: string | null } {
  try {
    return { preview: calculationFor(db, log), unpriceable: null };
  } catch (thrown) {
    return { preview: null, unpriceable: (thrown as Error).message };
  }
}

export function listPendingLogs(connection: Connection): QueueEntry[] {
  const rows = connection.db
    .select({
      ...PENDING_COLUMNS,
      kidName: users.displayName,
      activityName: activities.name,
      categoryName: categories.name,
      // Screen only: the engine reads minutes (D39, D17).
      durationSeconds: activityLogs.durationSeconds,
      autoStopped: activityLogs.autoStopped,
      qualityGraded: activities.qualityGraded,
      calcMode: activities.calcMode,
    })
    .from(activityLogs)
    .innerJoin(users, eq(activityLogs.userId, users.id))
    .innerJoin(activities, eq(activityLogs.activityId, activities.id))
    .innerJoin(categories, eq(activities.categoryId, categories.id))
    .where(eq(activityLogs.status, "pending"))
    .orderBy(
      asc(activityLogs.occurredOn),
      asc(activityLogs.createdAt),
      asc(activityLogs.id),
    )
    .all();

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    kidName: row.kidName,
    activityId: row.activityId,
    activityName: row.activityName,
    categoryName: row.categoryName,
    occurredOn: row.occurredOn,
    durationMinutes: row.durationMinutes,
    durationSeconds: row.durationSeconds,
    note: row.note,
    autoStopped: row.autoStopped,
    source: row.source,
    calcMode: row.calcMode,
    qualityGraded: row.qualityGraded,
    quality: row.quality,
    ...priceOrExplain(connection.db, row),
    blockedBy: pendingBefore(connection.db, row) ?? null,
  }));
}

/** A plain count, not `listPendingLogs().length`, which prices every entry. */
export function countPendingLogs(connection: Connection): number {
  return connection.db
    .select({ id: activityLogs.id })
    .from(activityLogs)
    .where(eq(activityLogs.status, "pending"))
    .all().length;
}

/**
 * Read inside the caller's transaction: a "still pending" check outside it
 * lets two approvals both write a ledger row.
 */
function takePending(tx: Transaction, logId: number): PendingLog {
  const log = tx
    .select(PENDING_COLUMNS)
    .from(activityLogs)
    .where(eq(activityLogs.id, logId))
    .get();

  if (log === undefined) {
    throw new Error(`there is no log ${logId}`);
  }

  if (log.status !== "pending") {
    throw new Error(
      `log ${logId} has already been reviewed: it is ${log.status}`,
    );
  }

  return log;
}

/** The column's CHECK, said as a sentence rather than a constraint name. */
function requireDuration(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
    throw new Error(
      `a duration is a whole number of minutes, between 1 and ${MAX_MINUTES}; received ${minutes}`,
    );
  }
}

/** The ceiling `activity_logs_duration_minutes_check` puts on the column. */
const MAX_MINUTES = 1_000_000;

const SECONDS_PER_MINUTE = 60;

/** Asked only at freeze time; the answer goes on the row, never re-read (D37). */
function categoryOf(db: Db, activityId: number): number {
  const found = db
    .select({ categoryId: activities.categoryId })
    .from(activities)
    .where(eq(activities.id, activityId))
    .get();

  if (found === undefined) {
    throw new Error(`there is no activity ${activityId}`);
  }

  return found.categoryId;
}

/**
 * Refuses an inactive activity (D14, D33), or pricing a timed entry by one not
 * measured in time. Asked of every approval, not only a correction: the
 * configuration screen can change the activity under a waiting entry.
 */
function requireEditableActivity(
  db: Db,
  log: PendingLog,
  activityId: number,
): void {
  const target = db
    .select({
      name: activities.name,
      calcMode: activities.calcMode,
      active: activities.active,
      categoryActive: categories.active,
    })
    .from(activities)
    .innerJoin(categories, eq(activities.categoryId, categories.id))
    .where(eq(activities.id, activityId))
    .get();

  if (target === undefined) {
    throw new Error(`there is no activity ${activityId}`);
  }

  if (!target.active || !target.categoryActive) {
    throw new Error(
      `activity ${activityId} is not active and cannot be chosen (D14)`,
    );
  }

  if (log.durationMinutes !== null && target.calcMode !== "duration") {
    throw new Error(
      `a timed session cannot be approved as ${target.name}, which is not measured by duration`,
    );
  }
}

/**
 * Freezes an entry's value and credits the ledger in one transaction (#20).
 * Edits apply before the calculation. The note is overwritten here and
 * appended on refusal (the Phase 4 `note` rule in decisions.md). A zero-hour
 * entry gets no ledger row: `ledger_hours_check` is `> 0` (D10).
 */
export function approveLog(
  connection: Connection,
  logId: number,
  reviewerId: number,
  edits: LogEdits,
  now: Date,
): { hours: number; creditedLedger: boolean } {
  if (edits.durationMinutes !== undefined) {
    requireDuration(edits.durationMinutes);
  }

  const freeValue =
    edits.freeValue === undefined
      ? undefined
      : requireHours(edits.freeValue, "a free activity's value");

  return writeTransaction(connection, (tx) => {
    const log = takePending(tx, logId);

    const edited: PendingLog = {
      ...log,
      activityId: edits.activityId ?? log.activityId,
      durationMinutes: edits.durationMinutes ?? log.durationMinutes,
      quality: edits.quality === undefined ? log.quality : edits.quality,
      freeValue: freeValue ?? log.freeValue,
    };

    requireEditableActivity(tx, edited, edited.activityId);

    const blocking = pendingBefore(tx, edited);

    if (blocking !== undefined) {
      throw new Error(
        `log ${logId} cannot be approved yet: log ${blocking.id} (${blocking.activityName}, ${blocking.occurredOn}) comes before it and is still waiting; decide that one first`,
      );
    }

    const calculation = calculationFor(tx, edited);

    tx.update(activityLogs)
      .set({
        activityId: edited.activityId,
        quality: edited.quality,
        freeValue: edited.freeValue,
        // D37: the bucket is frozen with the value, and follows a correction.
        categoryId: categoryOf(tx, edited.activityId),
        durationMinutes: edited.durationMinutes,
        // Seconds change only when the minutes did: the form resends them (D17).
        ...(edits.durationMinutes === undefined ||
        edits.durationMinutes === log.durationMinutes
          ? {}
          : {
              durationSeconds: edits.durationMinutes * SECONDS_PER_MINUTE,
            }),
        note: edits.note === undefined ? log.note : edits.note,
        status: "approved",
        // D15.
        computedHours: calculation.hours,
        reviewedBy: reviewerId,
        reviewedAt: now,
      })
      .where(eq(activityLogs.id, logId))
      .run();

    if (calculation.hours <= 0) {
      return { hours: calculation.hours, creditedLedger: false };
    }

    tx.insert(ledger)
      .values({
        userId: log.userId,
        kind: "earn",
        hours: calculation.hours,
        // D13: the day the activity happened, not the day it was approved.
        occurredOn: log.occurredOn,
        activityLogId: logId,
        createdBy: reviewerId,
      })
      .run();

    return { hours: calculation.hours, creditedLedger: true };
  });
}

/** Appended, not written over: the boy's words and the adult's both stay. */
const REJECTION_PREFIX = "Recusado:";

export function rejectionNote(
  note: string | null,
  reason: string | null,
): string | null {
  if (reason === null || reason.trim() === "") {
    return note;
  }

  const written = `${REJECTION_PREFIX} ${reason.trim()}`;

  return note === null || note.trim() === "" ? written : `${note}\n${written}`;
}

/**
 * The inverse of `rejectionNote` (#72): everything after the last marker.
 * One column holds two voices, so a boy's own "Recusado: " or a marker inside
 * the reason is misread; the fix is a separate column, not a guess here.
 */
export function rejectionReason(note: string | null): string | null {
  if (note === null) return null;

  const marker = `${REJECTION_PREFIX} `;
  const appended = note.lastIndexOf(`\n${marker}`);
  const at =
    appended === -1 ? (note.startsWith(marker) ? 0 : -1) : appended + 1;

  if (at === -1) return null;

  const reason = note.slice(at + marker.length).trim();

  return reason === "" ? null : reason;
}

/** D19: no ledger row, no `computed_hours`. The reason is optional (#20). */
export function rejectLog(
  connection: Connection,
  logId: number,
  reviewerId: number,
  reason: string | null,
  now: Date,
): void {
  writeTransaction(connection, (tx) => {
    const log = takePending(tx, logId);

    tx.update(activityLogs)
      .set({
        status: "rejected",
        note: rejectionNote(log.note, reason),
        reviewedBy: reviewerId,
        reviewedAt: now,
      })
      .where(eq(activityLogs.id, logId))
      .run();
  });
}
