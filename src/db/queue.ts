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
import { activities, activityLogs, categories, ledger, users } from "./schema";

/**
 * The approval queue (#20): what is waiting, what approving it would pay, and
 * the two things an adult can do about it.
 *
 * The rule this module exists to keep is one sentence long and easy to get
 * subtly wrong: **the value is computed from the day the entry happened, at the
 * moment of approval, inside the transaction that writes it.** Each clause of
 * that costs something if it is dropped.
 *
 * - *from the day it happened* — D8. An entry from Saturday approved on Monday
 *   reads Saturday's bucket and Saturday's cooldown window. Reading today's
 *   would pay a Saturday afternoon at Monday's rate, and the number would move
 *   depending on when the adult got round to it.
 * - *at the moment of approval* — the queue also shows a preview, and a preview
 *   is a number computed before the adult decided. Approving from the preview
 *   would freeze a value that was true when the screen was drawn: approve two
 *   entries of the same day and the second one would be paid as if the first
 *   had never happened.
 * - *inside the transaction* — the read of the day's bucket and the write of
 *   the ledger row are one operation. Computed outside and written inside, two
 *   admins approving at the same time both read an empty bucket and both pay
 *   the full rate; the engine's review measured exactly that, an hour too much.
 *
 * So `calculationFor` is the single implementation, `listPendingLogs` calls it
 * on a plain connection to draw the preview, and `approveLog` calls it again on
 * the transaction's own handle before writing. The preview is never an input to
 * the approval.
 */

/** One entry of the queue, ready to draw. */
export type QueueEntry = {
  id: number;
  userId: number;
  kidName: string;
  activityId: number;
  activityName: string;
  categoryName: string;
  /** D13: `YYYY-MM-DD`. */
  occurredOn: string;
  durationMinutes: number | null;
  /** The seconds measured, which is what the screen shows (D17, #71). */
  durationSeconds: number | null;
  note: string | null;
  /** D16: the boy did not end this session; the limit or the day did. */
  autoStopped: boolean;
  /**
   * Whether this entry's activity wants a grade, and the grade it carries.
   *
   * On the row because the screen has to know: the stopwatch never supplies a
   * grade, so an activity that gains one leaves entries the engine cannot price
   * until an adult gives it one at approval (`LogEdits.quality`).
   */
  qualityGraded: boolean;
  quality: number | null;
  /**
   * What approving it right now would credit, explanation included — or null
   * when the entry cannot be priced at all.
   *
   * Nullable because the queue must not be a page that can stop existing. The
   * engine refuses an entry it has no rule for, and #26/#27 made two such
   * states reachable: an activity that gains a quality grade, or becomes
   * `free`, while a session is running under it. D37 stops both once the entry
   * is waiting, but a session that is still **open** is not a waiting entry, so
   * the row can still arrive here unpriceable.
   *
   * Measured before this was nullable: one such entry returned **HTTP 500** for
   * `/admin/fila`, for both boys at once, with the generic error screen and the
   * pendency counter on the home page still saying one was waiting. There was
   * no path in the app to see it, explain it or undo it — and the one screen
   * that can reject it (D19) was the screen that had stopped existing.
   *
   * One entry the engine cannot price is one row with a sentence on it. It is
   * never a page that fails.
   */
  preview: Calculation | null;
  /**
   * Why it cannot be priced, in the engine's own words, or null.
   *
   * The engine's message names the activity and what is missing ("Ler livro: a
   * quality graded activity needs quality"), which is exactly what an adult
   * needs in order to choose between correcting the entry and refusing it.
   */
  unpriceable: string | null;
  /**
   * The entry that has to be decided before this one (D8), or null.
   *
   * Not a state of the entry but of the queue around it: it goes away the
   * moment the older entry is approved or rejected, which is what the screen
   * tells the adult to do.
   */
  blockedBy: BlockingEntry | null;
};

/** An entry that stands between another one and its approval (D8). */
export type BlockingEntry = {
  id: number;
  activityName: string;
  /** D13: `YYYY-MM-DD`. */
  occurredOn: string;
};

/** What an adult may change before approving (#20). */
export type LogEdits = {
  activityId?: number;
  durationMinutes?: number;
  /**
   * The grade, for an entry whose activity is `quality_graded` (D10).
   *
   * The stopwatch cannot supply one — it measures time, and a grade is a
   * judgement — so a `duration` activity that gains a grade produces entries
   * the engine has no rule for. Before this existed the adult had no way out of
   * that: the entry could not be priced, and D37 refuses to take the grade back
   * off while it waits, so the only exits were to refuse the boy's real
   * afternoon or to move it onto some other activity that happened to be priced
   * right — which is, word for word, the harm D37 cites to reject stamping.
   *
   * The correction belongs here for the same reason `activityId` does: the
   * queue is where an adult decides what an entry really was, with the boy
   * beside him (D32, D33). It closes the last state a config edit can leave
   * unfixable.
   */
  quality?: number | null;
  note?: string | null;
};

/** The columns a calculation reads off the entry being approved. */
type PendingLog = {
  id: number;
  userId: number;
  activityId: number;
  status: string;
  /** D18: where the entry came from, which is what an edit has to stay inside. */
  source: string;
  occurredOn: string;
  durationMinutes: number | null;
  quality: number | null;
  freeValue: number | null;
  note: string | null;
  createdAt: Date;
};

type Db = Connection["db"] | Transaction;

/**
 * What one entry is worth, by D8's rules, on the day it happened.
 *
 * The bucket, the cooldown and the return bonus all come out of the approved
 * history of that boy in the window the engine says it needs — `historyWindowStart`
 * and `historyLookbackDays` are exported from the engine precisely so the query
 * and the calculation cannot disagree about how far back to look (D13).
 *
 * **What counts is what was frozen first (D34), not what is earlier in the
 * canonical order.** The entry being priced is pending, so every approved row
 * in its window was frozen before it and every one of them counts — including
 * rows of a later day, which is what closes the hole D31 opened: a session that
 * crossed midnight carries yesterday's `occurred_on` and can reach the queue
 * after today's entry is already frozen. Under the old rule those two both read
 * an empty bucket.
 */
/**
 * The activity and category an entry is priced by, read from the same place
 * twice over: the calculation and the check that the bucket it reads is settled
 * have to be looking at the same row.
 */
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

function calculationFor(db: Db, log: PendingLog): Calculation {
  const found = activityFor(db, log);

  const historyFrom = historyWindowStart(
    log.occurredOn,
    found.activity,
    found.category,
  );
  // D34: as far forward as the entry's own rules reach. An entry is priced
  // against what was frozen before it, and since D31 settles a session that
  // crossed midnight onto the day it began, what was frozen before it can sit
  // on a later day than its own — a session of Sunday 23:50 read on Monday,
  // approved after Monday's own entry. Fetching only up to `occurredOn` made
  // that pair pay twice over.
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
      // D37: the bucket each row counted under, off the row itself rather than
      // through a live join. See `src/db/admin.ts` for the measurement.
      categoryId: activityLogs.categoryId,
    })
    .from(activityLogs)
    // Still joined, because the row is still needed; the category is not.
    .innerJoin(activities, eq(activityLogs.activityId, activities.id))
    .where(
      and(
        eq(activityLogs.userId, log.userId),
        // D19: only an approved entry fills the bucket, feeds a cooldown or
        // breaks a return bonus. A rejected one counts for nothing, and a
        // pending one has not happened yet as far as the balance is concerned.
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
    // D19, asserted rather than filtered, by the engine's own single
    // implementation of that rule. D34: an approved row is a frozen row, and
    // this entry is still pending, so every row here was frozen before it.
    history: approvedOnly(history),
    historyFrom,
    historyTo,
    categoryFirstDay: categoryFirstDay(db, log.userId, found.category.id),
  });
}

/**
 * The pending entry that has to be decided before `log` can be, or undefined.
 *
 * D8 says an entry is priced from the entries **already approved** strictly
 * before it in `(occurred_on, created_at, id)`, and D15 says the number is
 * frozen once. Together they have a hole an adult walks into by tapping in the
 * wrong order: approve the newer of two entries first and it reads an empty
 * bucket, then approve the older one and it reads an empty bucket too, because
 * the one already approved is *after* it. Measured, two hours of Ler livro on
 * one day paid 6 h instead of 4 h, and a pair of car washes a day apart paid
 * 6 h instead of 4,5 h — the boy needs nothing but "pai, aprova a que eu acabei
 * de mandar".
 *
 * So an entry may not be frozen while something the freeze would have to read
 * is still undecided. The window is the calculation's own — the days
 * `historyWindowStart` says feed the bucket, the cooldown and the return bonus
 * — so an ancient entry an adult is still thinking about does not block
 * today's, and an entry that really would change the number does. Rejecting the
 * older one unblocks it too (D19), which is the other honest way out.
 *
 * The window is read off the *edited* activity, because an adult who changes
 * the activity changes the window with it.
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
 * Everything waiting for an adult, oldest first.
 *
 * Oldest first and not newest: a queue is worked from the front, and the entry
 * a boy has been waiting on longest is the one an adult should see at the top.
 * The order is D8's canonical `(occurred_on, created_at, id)` read forwards,
 * which is also the order the entries would be credited in.
 */
/**
 * The preview, or the reason there is none.
 *
 * The only `catch` in this module, and deliberately narrow: it wraps the
 * pricing of **one row of a list**, where the alternative is that the list stops
 * existing. Every other path through the engine keeps throwing, because every
 * other path is a single answer to a single question — `approveLog` still
 * refuses loudly, which is what D33 wants of the endpoint.
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
      // Not in `PENDING_COLUMNS`: a calculation reads minutes and nothing else
      // (D39), so the seconds are drawn for the screen alone (D17, #71).
      durationSeconds: activityLogs.durationSeconds,
      autoStopped: activityLogs.autoStopped,
      qualityGraded: activities.qualityGraded,
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
    qualityGraded: row.qualityGraded,
    quality: row.quality,
    ...priceOrExplain(connection.db, row),
    blockedBy: pendingBefore(connection.db, row) ?? null,
  }));
}

/**
 * How many entries are waiting for an adult (#21).
 *
 * Not `listPendingLogs(connection).length`: that one prices every entry and
 * asks, for each, what stands in front of it — a dozen calculations to draw one
 * number on the home screen. The count is the same `where` and nothing else, so
 * the two cannot disagree about what "waiting" means.
 */
export function countPendingLogs(connection: Connection): number {
  return connection.db
    .select({ id: activityLogs.id })
    .from(activityLogs)
    .where(eq(activityLogs.status, "pending"))
    .all().length;
}

/**
 * The entry, as it is right now, or an error naming why it cannot be reviewed.
 *
 * Read inside the caller's transaction, always. "Still pending" is the check
 * that makes a double tap harmless, and a check performed outside the
 * transaction that acts on it is not a check — two approvals would both read
 * `pending` and both write a ledger row. The unique index on
 * `ledger.activity_log_id` is the last line of defence, not this one.
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

/**
 * The minutes an adult typed, checked before they reach the database.
 *
 * The schema's `activity_logs_duration_minutes_check` is the backstop and would
 * refuse a zero or a fraction anyway — with `SQLITE_CONSTRAINT` and a
 * constraint name, on a screen where somebody is trying to correct an entry.
 * This is the same rule stated where it can say what went wrong, and
 * `queue.test.ts` asserts the message rather than leaving the two to cover for
 * each other.
 */
function requireDuration(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
    throw new Error(
      `a duration is a whole number of minutes, between 1 and ${MAX_MINUTES}; received ${minutes}`,
    );
  }
}

/**
 * The ceiling `activity_logs_duration_minutes_check` puts on the column.
 *
 * Written here so the adult who types a number with too many zeros gets a
 * sentence instead of `CHECK constraint failed:
 * activity_logs_duration_minutes_check`, which is what a billion minutes used
 * to put on his screen.
 */
const MAX_MINUTES = 1_000_000;

/** Seconds in a minute, for the duration a correction rewrites (D17, #71). */
const SECONDS_PER_MINUTE = 60;

/**
 * The category an activity belongs to right now (D37).
 *
 * Called at the moment an entry is frozen, and only then: what it answers is
 * written onto the row and never asked again. That is the whole of D37 — the
 * live table decides which bucket an entry *enters*, and the row decides which
 * bucket it has already been paid from.
 */
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
 * The activity an entry is about to be priced as, checked before it is priced.
 *
 * The picker offers `listTimedActivities` and only that, which is why the
 * queue's correction cannot turn a timed session into something with no
 * duration — on the screen. The server had no such rule: measured, a one-minute
 * session was approved as "Sair com os amigos" (`fixed`, three hours) and as an
 * activity somebody had deactivated. D14 takes an inactive item out of the
 * lists; it has to take it out of the endpoint too.
 *
 * The `duration` requirement is stated against **what the entry carries**
 * rather than absolutely: a record that measured time has to be priced by
 * something measured in time, because a `fixed` activity ignores the duration
 * outright — which is how one minute became three hours. D18's own entries
 * never come through here; an admin's log is born approved.
 *
 * It used to be stated against the entry's *origin* — `source === "timer"` —
 * and on every state this system can actually produce the two say the same
 * thing: the stopwatch is the only thing that files a pending entry, it only
 * ever runs a `duration` activity, and since #71 took D17's floor away it
 * refuses to file a session that rounds to no minutes at all. The data form is
 * preferred because it also answers for an entry whose minutes an adult
 * supplies in the correction, and because it says what the rule is about
 * instead of where the row came from.
 *
 * **Asked of every approval, not only of a correction.** It used to run only
 * when `edits.activityId` was set, and that was sound for exactly as long as an
 * activity's `calc_mode` was fixed at seed time. #26 and #27 make the table
 * editable without a deploy, which is the whole point of that phase — and it
 * re-opened this exploit from the other end. Measured on the seeded database:
 * the boy runs the stopwatch on "Ler livro" for one minute; an adult, on the
 * Configuration screen, switches "Ler livro" to `fixed` at 3h; the pending
 * session is approved with no correction at all and pays **4,5 h** — three
 * fixed hours and the return bonus, for one minute of reading, with the
 * duration ignored.
 *
 * Nobody forges anything and nobody edits the entry. The guard was about
 * whether the adult retyped an id, and it needed to be about what is being
 * frozen. A pending entry whose activity has since been switched off, or has
 * stopped measuring time, is now refused by name until an adult moves it to
 * something live or rejects it (D19) — which is the decision D33 says a person
 * has to make rather than a screen.
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
 * Approves an entry: freezes its value and credits the ledger, in one
 * transaction (#20).
 *
 * The edits are applied to the row *before* the calculation, so an adult who
 * corrects the duration from 90 to 60 minutes credits sixty minutes' worth and
 * the entry says sixty. Changing the activity changes the category, the rate,
 * the decay step and the cooldown window with it — which is why the engine is
 * handed the edited row rather than being told about a change.
 *
 * **The order is not the adult's to choose.** An entry whose bucket still holds
 * an undecided entry is refused rather than frozen at a number tapping in a
 * different order would have changed — see `pendingBefore`. The queue lists
 * oldest first, so working it from the front never meets the rule.
 *
 * **The note is written over here and appended to on a refusal**, and the two
 * are deliberate rather than an oversight. A correction is the adult saying
 * what happened — he is standing beside the boy, and leaving the wrong sentence
 * under the right one would make the record say both. A refusal is a second
 * voice about the same entry, and erasing what the boy wrote to make room for
 * it would be the adult deciding what the boy said.
 *
 * D10 is the whole reason for the `if` at the end: an entry can be worth
 * exactly zero — a `delivery` graded zero, or twenty hours of Mente already in
 * the bucket plus six more minutes — and `ledger_hours_check` is `> 0`
 * exclusive. The record exists and says zero; there is no ledger line. Writing
 * one would be refused by the database, and a rounding artefact would take the
 * whole approval down with it.
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

  return writeTransaction(connection, (tx) => {
    const log = takePending(tx, logId);

    const edited: PendingLog = {
      ...log,
      activityId: edits.activityId ?? log.activityId,
      durationMinutes: edits.durationMinutes ?? log.durationMinutes,
      quality: edits.quality === undefined ? log.quality : edits.quality,
    };

    // The activity this entry is about to be frozen as, whether the adult chose
    // it now or the boy chose it three days ago, and the minutes it will be
    // frozen with. See `requireEditableActivity`: asking only about a
    // correction was worth 4,5 h for one minute of reading once the
    // Configuration screen could change how an activity counts.
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
        // D37: the bucket is frozen with the value, and it follows a correction
        // — an entry moved to another activity genuinely counts elsewhere.
        categoryId: categoryOf(tx, edited.activityId),
        durationMinutes: edited.durationMinutes,
        // The measured seconds are only overwritten when the adult actually
        // corrected the duration: then the row's own number is the correction,
        // not what the stopwatch saw. Left out of the `set` otherwise, so an
        // entry approved untouched keeps the seconds it was measured with
        // instead of having them rebuilt from its rounded minutes (D17, #71).
        //
        // The test is against the row and not only against `undefined`: the
        // correction form sends every field it shows, so an adult who opened it
        // to write a note sends the minutes back unchanged. Measured: a session
        // of 58 s, corrected in the note alone, was stored as 60 s — the value
        // was right and the measurement was gone.
        ...(edits.durationMinutes === undefined ||
        edits.durationMinutes === log.durationMinutes
          ? {}
          : {
              durationSeconds: edits.durationMinutes * SECONDS_PER_MINUTE,
            }),
        note: edits.note === undefined ? log.note : edits.note,
        status: "approved",
        // D15: written once, here, and never recomputed afterwards.
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
        // D13: the day the activity happened, not the day it was approved. The
        // extract has to read as the boy's week, not as the adult's.
        occurredOn: log.occurredOn,
        activityLogId: logId,
        createdBy: reviewerId,
      })
      .run();

    return { hours: calculation.hours, creditedLedger: true };
  });
}

/**
 * How a refusal is written onto the entry.
 *
 * `activity_logs` has one text column and the boy's own words are already in
 * it, so the reason is appended rather than written over: what he said he did
 * and what an adult said about it are both worth keeping, and the record is the
 * only place either exists.
 */
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
 * The reason an adult wrote, read back off the note (#72).
 *
 * The inverse of `rejectionNote`, and it has to be an inverse rather than a
 * second column because that is where the reason already is: the refusal was
 * being recorded and never shown, which is the whole of #72.
 *
 * It reads from the *last* marker to the end of the text, rather than the last
 * line of it. `rejectLogAction` trims a reason but does not forbid a newline in
 * one, and a reason that arrived with a line break would otherwise reach the
 * boy's screen cut in half — the marker is appended last, so everything after
 * it belongs to it.
 *
 * **What it cannot tell apart, and why that is accepted here.** One text column
 * holds two voices, so the marker is a convention and not a boundary. Two cases
 * come out of that, both measured:
 *
 * - the boy writes the note himself when he stops the stopwatch
 *   (`stopTimerAction`), so a boy who types "Recusado: ..." into his own note
 *   and is then refused *without* a reason sees his own sentence back, labelled
 *   as the adult's;
 * - the adult's own reason may contain a line beginning with the marker —
 *   `rejectLogAction` bounds its length and nothing else — and then the last
 *   marker is the one inside it, so the beginning of what he wrote is dropped:
 *
 *       rejectionNote(null, "primeira linha\nRecusado: outra parte")
 *         -> "Recusado: primeira linha\nRecusado: outra parte"
 *       rejectionReason(that) -> "outra parte"
 *
 * Neither leaks anything and neither moves a number — D19 keeps a rejected entry
 * out of every calculation. Both have the same fix, and it is a column of its
 * own in its own diff, not a guess made here about which half of one text column
 * belongs to whom. Refusing the adult's sentence instead was considered and
 * dropped: "Recusado: " is a plausible thing to paste, and the refusal would
 * reach him in the middle of a decision he is trying to record.
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

/**
 * Rejects an entry (D19).
 *
 * No ledger row, no `computed_hours`, and nothing that any later calculation
 * will read: every query that feeds the engine filters on `status = 'approved'`,
 * so a rejected entry stops counting for the day's bucket and for the cooldown
 * the moment it is rejected. It stays in the table because the record of the
 * refusal is the point.
 *
 * The reason is optional (#20). Rejecting without one is a normal thing to do —
 * the boy is standing there — and demanding a sentence would make the common
 * case slower than the rare one.
 */
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
