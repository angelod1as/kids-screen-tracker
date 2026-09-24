import { and, asc, eq, gte, lte } from "drizzle-orm";

import type { ApprovedLog, Calculation } from "../engine/calculate";
import {
  approvedOnly,
  calculateEarnedHours,
  historyWindowEnd,
  historyWindowStart,
  returnBonusWindowStart,
  saoPauloDay,
} from "../engine/calculate";
import type { Connection, Transaction } from "./client";
import { writeTransaction } from "./client";
import { categoryFirstDay, pendingDebutBefore } from "./debut";
import { requireCalendarDay, requireHours, requireText } from "./input";
import { requireActiveKid } from "./people";
import type { BlockingEntry } from "./queue";
import { activities, activityLogs, categories, ledger } from "./schema";

/**
 * Launching an activity in a boy's name (#22). It skips the queue (D18), and
 * the value is computed inside the write transaction, never taken from the
 * preview. It reads the entry's own day (D8, D34) and refuses in the endpoint (D33).
 */

type Db = Connection["db"] | Transaction;

/** The column's CHECK ceiling, said as a sentence rather than a constraint name. */
const MAX_MINUTES = 1_000_000;

const SECONDS_PER_MINUTE = 60;

/** Unchecked input (#22). */
export type NewEntry = {
  userId: number;
  activityId: number;
  /** D13. */
  occurredOn: string;
  /** Required by a `duration` activity, ignored by every other mode. */
  durationMinutes?: number | null;
  /** Required when `quality_graded`. */
  quality?: number | null;
  /** Required by `free` (D11, D12). */
  freeValue?: number | null;
  note?: string | null;
};

/** Drawn before the adult confirms (#22). */
export type EntryPreview = {
  calculation: Calculation;
  /** D32. */
  blockedBy: BlockingEntry | null;
};

export type LaunchResult = {
  logId: number;
  hours: number;
  /** The explanation of the number written, which may differ from the preview's (D9). */
  calculation: Calculation;
  /** False for a zero-hour entry (D10). */
  creditedLedger: boolean;
};

/** Active or not: pricing a log that exists must not depend on it (D14, D15). */
function activityFor(db: Db, activityId: number) {
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
      active: activities.active,
      categoryActive: categories.active,
    })
    .from(activities)
    .innerJoin(categories, eq(activities.categoryId, categories.id))
    .where(eq(activities.id, activityId))
    .get();

  if (found === undefined) {
    throw new Error(`there is no activity ${activityId}`);
  }

  return found;
}

/** D33: the picker offering only active items is not a guarantee. */
function requireLaunchableActivity(db: Db, activityId: number) {
  const found = activityFor(db, activityId);

  if (!found.active || !found.categoryActive) {
    throw new Error(
      `activity ${activityId} is not active and cannot be chosen (D14)`,
    );
  }

  return found;
}

function historyFor(
  db: Db,
  userId: number,
  historyFrom: string,
  historyTo: string,
): ApprovedLog[] {
  const rows = db
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
        eq(activityLogs.userId, userId),
        // D19.
        eq(activityLogs.status, "approved"),
        gte(activityLogs.occurredOn, historyFrom),
        // D34: a retroactive launch is frozen last and reads the later days too.
        lte(activityLogs.occurredOn, historyTo),
      ),
    )
    .all();

  // D19, asserted rather than filtered.
  return approvedOnly(rows);
}

/** Priced by the rules of its own day (D8); a launch is frozen last (D34). */
function price(
  db: Db,
  entry: {
    userId: number;
    activityId: number;
    occurredOn: string;
    durationMinutes: number | null;
    quality: number | null;
    freeValue: number | null;
  },
): Calculation {
  const found = activityFor(db, entry.activityId);
  const historyFrom = historyWindowStart(
    entry.occurredOn,
    found.activity,
    found.category,
  );
  const historyTo = historyWindowEnd(
    entry.occurredOn,
    found.activity,
    found.category,
  );

  return calculateEarnedHours({
    userId: entry.userId,
    activity: found.activity,
    category: found.category,
    occurredOn: entry.occurredOn,
    durationMinutes: entry.durationMinutes,
    quality: entry.quality,
    freeValue: entry.freeValue,
    history: historyFor(db, entry.userId, historyFrom, historyTo),
    historyFrom,
    historyTo,
    categoryFirstDay: categoryFirstDay(db, entry.userId, found.category.id),
  });
}

/**
 * D32, for an entry that does not exist yet. A launch is last in its own day,
 * so every row returned is earlier and the first is the answer: an `isEarlier`
 * filter here could never return false.
 */
function pendingBefore(
  db: Db,
  entry: { userId: number; activityId: number; occurredOn: string },
): BlockingEntry | undefined {
  const found = activityFor(db, entry.activityId);
  const historyFrom = historyWindowStart(
    entry.occurredOn,
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
        eq(activityLogs.userId, entry.userId),
        eq(activityLogs.status, "pending"),
        gte(activityLogs.occurredOn, historyFrom),
        lte(activityLogs.occurredOn, entry.occurredOn),
      ),
    )
    .orderBy(
      asc(activityLogs.occurredOn),
      asc(activityLogs.createdAt),
      asc(activityLogs.id),
    )
    .all()[0];

  return blocking === undefined
    ? pendingDebutBefore(
        db,
        {
          userId: entry.userId,
          categoryId: found.category.id,
          returnBonusPct: found.category.returnBonusPct,
        },
        returnBonusWindowStart(entry.occurredOn, found.category),
      )
    : {
        id: blocking.id,
        activityName: blocking.activityName,
        occurredOn: blocking.occurredOn,
      };
}

/** Each check is also a column CHECK; this one can name what went wrong. */
function requireEntry(
  entry: NewEntry,
  activity: { calcMode: string; name: string },
  today: string,
): NewEntry {
  requireCalendarDay(entry.occurredOn, today);
  requireText(entry.note ?? null, "a note");

  if (activity.calcMode === "duration") {
    const minutes = entry.durationMinutes;

    if (
      minutes == null ||
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > MAX_MINUTES
    ) {
      throw new Error(
        `${activity.name} is measured by duration: a duration is a whole number of minutes, between 1 and ${MAX_MINUTES}; received ${minutes}`,
      );
    }
  }

  // The rounded answer, not only the throw: `0,005` would otherwise be stored.
  return activity.calcMode === "free"
    ? {
        ...entry,
        freeValue: requireHours(
          entry.freeValue ?? Number.NaN,
          "a free activity's value",
        ),
      }
    : entry;
}

/** A preview, never an input: `launchEntry` computes again in its transaction. */
export function previewEntry(
  connection: Connection,
  entry: NewEntry,
  now: Date,
): EntryPreview {
  const db = connection.db;
  const today = saoPauloDay(now);

  requireActiveKid(db, entry.userId);

  const found = requireLaunchableActivity(db, entry.activityId);
  const checked = requireEntry(entry, found.activity, today);

  return {
    calculation: price(db, {
      userId: checked.userId,
      activityId: checked.activityId,
      occurredOn: checked.occurredOn,
      durationMinutes: checked.durationMinutes ?? null,
      quality: checked.quality ?? null,
      freeValue: checked.freeValue ?? null,
    }),
    blockedBy: pendingBefore(db, entry) ?? null,
  };
}

/**
 * Born approved, priced and credited in one transaction (D18). A zero-hour
 * entry gets no ledger row: `ledger_hours_check` is `> 0` (D10).
 */
export function launchEntry(
  connection: Connection,
  entry: NewEntry,
  adminId: number,
  now: Date,
): LaunchResult {
  const today = saoPauloDay(now);

  return writeTransaction(connection, (tx) => {
    requireActiveKid(tx, entry.userId);

    const found = requireLaunchableActivity(tx, entry.activityId);
    const checked = requireEntry(entry, found.activity, today);

    const blocking = pendingBefore(tx, entry);

    if (blocking !== undefined) {
      throw new Error(
        `this entry cannot be launched yet: log ${blocking.id} (${blocking.activityName}, ${blocking.occurredOn}) comes before it and is still waiting; decide that one first`,
      );
    }

    const calculation = price(tx, {
      userId: checked.userId,
      activityId: checked.activityId,
      occurredOn: checked.occurredOn,
      durationMinutes: checked.durationMinutes ?? null,
      quality: checked.quality ?? null,
      freeValue: checked.freeValue ?? null,
    });

    const written = tx
      .insert(activityLogs)
      .values({
        userId: entry.userId,
        activityId: entry.activityId,
        // D37: born approved means born frozen.
        categoryId: found.activity.categoryId,
        // D18.
        status: "approved",
        source: "admin",
        occurredOn: entry.occurredOn,
        durationMinutes:
          found.activity.calcMode === "duration"
            ? (entry.durationMinutes ?? null)
            : null,
        // Typed minutes: the seconds are exactly those minutes (D17).
        durationSeconds:
          found.activity.calcMode === "duration" &&
          entry.durationMinutes != null
            ? entry.durationMinutes * SECONDS_PER_MINUTE
            : null,
        quality: found.activity.qualityGraded ? (entry.quality ?? null) : null,
        freeValue:
          found.activity.calcMode === "free"
            ? (checked.freeValue ?? null)
            : null,
        // D15.
        computedHours: calculation.hours,
        note: entry.note ?? null,
        createdBy: adminId,
        reviewedBy: adminId,
        reviewedAt: now,
        createdAt: now,
      })
      .returning({ id: activityLogs.id })
      .get();

    if (calculation.hours <= 0) {
      return {
        logId: written.id,
        hours: calculation.hours,
        calculation,
        creditedLedger: false,
      };
    }

    tx.insert(ledger)
      .values({
        userId: entry.userId,
        kind: "earn",
        hours: calculation.hours,
        occurredOn: entry.occurredOn,
        activityLogId: written.id,
        createdBy: adminId,
        createdAt: now,
      })
      .run();

    return {
      logId: written.id,
      hours: calculation.hours,
      calculation,
      creditedLedger: true,
    };
  });
}
