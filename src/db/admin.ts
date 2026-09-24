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
 * Launching an activity in a boy's name, on the adult's own authority (#22).
 *
 * Two things about it are worth reading once. **Nothing here goes through the
 * queue.** D18 says an admin's own entry is born `approved`, with
 * `reviewed_by` filled, and its ledger row written in the same transaction —
 * making an adult approve himself would cost a tap on one of the three
 * operations of the day, and the design rule is that more than two taps is the
 * wrong drawing.
 *
 * And the value is computed **inside** `writeTransaction`. The launch screen shows
 * what an entry would be worth before the adult confirms it, and that preview is
 * never an input to the write: two entries launched onto the same day have to
 * pay the second one out of the bucket the first one filled, and a value
 * computed while the screen was being drawn cannot know about the first one. The
 * approval queue learnt this the expensive way — see the module docstring of
 * `src/db/queue.ts`, where computing outside and writing inside was measured at
 * an hour too much.
 *
 * The rules the launch has to keep beyond that are D8's and D33's:
 *
 * - **the bucket is the day the activity happened**, not today. An entry the
 *   adult types on Monday for Saturday reads Saturday's bucket, Saturday's
 *   cooldown window and Saturday's return bonus;
 * - **the order is not the adult's to choose.** A pending entry earlier in
 *   `(occurred_on, created_at, id)` blocks the launch exactly as it blocks an
 *   approval (D32). What a launch onto a past day *reads*, on the other hand,
 *   is settled by D34: it is frozen last, so it counts everything its window
 *   has already spent, including days after its own. A wash launched onto
 *   Monday after Tuesday's was approved pays the halved rate, and Tuesday does
 *   not move (D15);
 * - **the guard is here and not in the picker** (D33). An activity that is
 *   switched off, a category that is switched off, a boy who is switched off:
 *   the screen hides all three and the endpoint refuses all three.
 */

type Db = Connection["db"] | Transaction;

/**
 * The ceiling `activity_logs_duration_minutes_check` puts on a duration, said
 * here so an adult who types a number with too many zeros reads a sentence
 * instead of a constraint name.
 */
const MAX_MINUTES = 1_000_000;

/** Seconds in a minute, for the duration an adult types (D17, #71). */
const SECONDS_PER_MINUTE = 60;

/** What an adult is launching, before anything has been checked (#22). */
export type NewEntry = {
  /** The boy the entry belongs to. */
  userId: number;
  activityId: number;
  /** D13: `YYYY-MM-DD` in `America/Sao_Paulo`. */
  occurredOn: string;
  /** Required by a `duration` activity, ignored by every other mode. */
  durationMinutes?: number | null;
  /** Required when the activity is `quality_graded`: 0 · 0,3 · 0,5 · 0,7 · 1,0. */
  quality?: number | null;
  /** Required by a `free` activity: the value the adult typed (D11, D12). */
  freeValue?: number | null;
  note?: string | null;
};

/** What the launch screen draws before the adult confirms (#22). */
export type EntryPreview = {
  /** What launching it right now would credit, explanation included. */
  calculation: Calculation;
  /** D32: the pending entry that has to be decided first, or null. */
  blockedBy: BlockingEntry | null;
};

export type LaunchResult = {
  logId: number;
  hours: number;
  /**
   * The explanation of the number that was written, line by line (D9).
   *
   * The screen showed a preview before the tap and the write computed the
   * value again, so the two can legitimately differ — approve two entries onto
   * one day and the second is paid out of the first one's bucket. What the
   * adult must not be shown is the second number with the first number's
   * reasons, or with no reasons at all: "a soma tem que fechar" is about the
   * number on the screen, and after the tap the number on the screen is this
   * one.
   */
  calculation: Calculation;
  /** False when the entry is worth exactly zero (D10). */
  creditedLedger: boolean;
};

// ---------------------------------------------------------------------------
// #22 — launching an activity
// ---------------------------------------------------------------------------

/**
 * The activity and its category, whether or not either is switched on.
 *
 * Used for pricing an entry that already exists, where D14 and D15 together say
 * a three-month-old log still knows where it came from. The check that an adult
 * may *choose* it is `requireLaunchableActivity`, and it is deliberately a
 * different question.
 */
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

/**
 * The activity an adult is launching, checked before it is priced (D33).
 *
 * The picker offers only what is switched on, which is what D14 asks of a
 * screen. The endpoint is a POST that takes a number, and the queue's own
 * review measured what that is worth: an entry was approved as an activity
 * somebody had deactivated, because the list was doing the whole job. The list
 * is not a guarantee.
 */
function requireLaunchableActivity(db: Db, activityId: number) {
  const found = activityFor(db, activityId);

  if (!found.active || !found.categoryActive) {
    throw new Error(
      `activity ${activityId} is not active and cannot be chosen (D14)`,
    );
  }

  return found;
}

/** The approved history one calculation reads, across its whole window. */
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
      // D37: the bucket each row counted under, off the row itself. Read
      // through a live join to `activities.category_id`, moving an activity
      // took its already-approved logs out of the bucket they had been paid
      // from, and the same afternoon was paid twice — measured at 7,88 h in a
      // category whose calibrated asymptote is 4,00 h.
      categoryId: activityLogs.categoryId,
    })
    .from(activityLogs)
    // Still joined, because `approvedOnly` and the window need the row; the
    // category no longer comes from here.
    .innerJoin(activities, eq(activityLogs.activityId, activities.id))
    .where(
      and(
        eq(activityLogs.userId, userId),
        // D19: only an approved entry fills the bucket, feeds a cooldown or
        // breaks a return bonus.
        eq(activityLogs.status, "approved"),
        gte(activityLogs.occurredOn, historyFrom),
        // D34: as far forward as the rules reach, not as far as this entry's
        // own day. A retroactive launch is frozen last and reads what the days
        // after it have already spent.
        lte(activityLogs.occurredOn, historyTo),
      ),
    )
    .all();

  // D19, asserted rather than filtered, by the engine's own single
  // implementation of that rule.
  return approvedOnly(rows);
}

/**
 * What one entry is worth, by the rules of the day it happened on (D8) and the
 * allowance those days have already spent (D34).
 *
 * A launch is frozen last, by definition — it is being written now — so every
 * approved row in its window was frozen before it and every one of them counts.
 * That is the whole of D34 here, and it is why a wash launched onto Monday
 * after Tuesday's was approved pays the halved rate: Tuesday spent the
 * seven-day allowance first, and nothing about Tuesday moves (D15).
 */
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
 * The pending entry that has to be decided before this launch may be frozen
 * (D32), or undefined.
 *
 * The same rule the queue keeps, asked about an entry that does not exist yet.
 * D8 prices an entry from what is **already approved** before it and D15
 * freezes the answer; an entry frozen while something its own calculation would
 * have read is still undecided is an entry frozen at a number that depends on
 * the order an adult happened to tap in. Measured on the queue: two hours of
 * "Ler livro" on one day paid 6 h instead of 4 h.
 *
 * A launch is always last inside its own day, so **every row this query returns
 * is earlier than it**: a row of an earlier day by the first comparison, and a
 * row of the same day because the launch is created now. That is what the
 * engine's `isEarlier` answers for the position `"new"`, and it is why the
 * first row in canonical order is the answer rather than the first row that
 * passes a second filter — asking `isEarlier` here as well would be a predicate
 * that cannot return false, which is the mutual redundancy this project keeps
 * finding: neither half could then be broken visibly while the other stood.
 *
 * So the window is the whole rule, and `an entry of a later day does not block`
 * in `admin.rules.ts` is the case that holds the bound.
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

/**
 * The whole of an entry, checked before anything is computed from it.
 *
 * Every one of these is also a CHECK on a column, which is the backstop; this
 * is the same rule said where it can name what went wrong, on a screen where an
 * adult is standing beside a boy. `admin.test.ts` asserts the sentences rather
 * than leaving the two to cover for each other.
 */
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

  // The answer, not only the throw: `requireHours` rounds to the two decimals
  // this app holds an hour in, and a guard called for its side effect is a
  // guard whose other half does nothing. `0,005` clears the floor by rounding
  // up to `0,01` and would otherwise be stored — and priced — as `0,005`.
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

/**
 * What launching this entry would credit, and what stands in the way (#22).
 *
 * A preview and never an input: `launchEntry` computes the number again inside
 * its own transaction. What this is for is the acceptance criterion — the value
 * is on screen before the adult confirms — and for saying, before the tap
 * rather than after it, which of the two order rules refuses the launch.
 */
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
 * Launches an entry: born approved, priced and credited in one transaction
 * (D18).
 *
 * The value is computed here and not taken from the preview, for the reason the
 * module docstring gives. The ledger row carries the day the activity happened
 * (D13) and not the day it was typed, so the extract reads as the boy's week.
 *
 * D10 is the whole reason for the `if` at the end: an entry can be worth
 * exactly zero — a `delivery` graded zero, or twenty hours of Mente already in
 * the bucket plus six more minutes — and `ledger_hours_check` is `> 0`
 * exclusive. The record exists and says zero; there is no ledger line.
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
        // D37: the bucket this entry counts under, frozen with it. Born
        // approved means born frozen, so the category is written here and never
        // re-read from `activities` afterwards.
        categoryId: found.activity.categoryId,
        // D18: born approved, with the review stamps the adult's own entry
        // gets for free. `activity_logs_review_check` holds the three together.
        status: "approved",
        source: "admin",
        occurredOn: entry.occurredOn,
        durationMinutes:
          found.activity.calcMode === "duration"
            ? (entry.durationMinutes ?? null)
            : null,
        // The adult typed minutes, so the seconds beside them are those minutes
        // exactly: nothing measured this entry, and the row still says one
        // thing rather than two (D17, #71).
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
        // D15: written once, here, and never recomputed afterwards.
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
