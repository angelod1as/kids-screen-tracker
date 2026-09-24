import { and, desc, eq, inArray } from "drizzle-orm";

import { saoPauloDay } from "../engine/calculate";
import type { Reconciliation, TimerState } from "../engine/timer";
import {
  durationMinutes,
  durationSeconds,
  reachesMinimum,
  reconcileTimer,
} from "../engine/timer";
import type { Connection, Transaction } from "./client";
import { writeTransaction } from "./client";
import type { Timer } from "./schema";
import { activities, activityLogs, categories, timers } from "./schema";

/**
 * The database side of the timer: reading a session, settling it (D16) and
 * turning it into a proposed record.
 *
 * The arithmetic is not here — it is in `src/engine/timer.ts`, which has no I/O
 * and no clock. This module is the part that talks to SQLite, and it exists
 * separately from `src/app/actions/timer.ts` because a `"use server"` file may
 * export nothing but async functions: every helper the actions share has to
 * live outside one.
 *
 * **Every entry point takes `now` as an argument.** The clock is read once, in
 * the action, and handed down. That is what lets a test settle a twelve-hour
 * pause without waiting twelve hours, and it is what #19 asks to be proved: the
 * answer comes from the stamps, not from the moment of the read.
 */

/** The two states a session the boy still owns can be in. */
const OPEN_STATUSES = ["running", "paused"] as const;

/** The activity fields a running timer and its record need. */
export type TimerActivity = {
  id: number;
  name: string;
  categoryName: string;
  /** D16: where the timer stops itself. Null means it does not. */
  maxSessionMinutes: number | null;
  /** D44: the floor stamped when the session opened. */
  minSessionMinutes: number;
};

/** A session that is still the boy's to end. */
export type OpenTimer = {
  id: number;
  activity: TimerActivity;
  state: TimerState;
  /** Active seconds at the instant of the read (D17: pauses excluded). */
  activeSeconds: number;
};

/**
 * A session that ended without the boy filing it, said once.
 *
 * `null` on every other read, including the next one — the notice is a
 * consequence of settling, not a row. What survives the refresh is the record
 * itself, which the boy sees in his own list of pending entries, and which is
 * the thing that actually matters.
 *
 * Three of the four kinds are D16's automatic endings. `tooShort` is the one
 * the boy can cause himself: D44 refuses to file a session under its activity's
 * floor, and a refusal the boy is going to meet by tapping *Enviar* has
 * to arrive as a sentence rather than as a thrown error — in a production build
 * Next replaces a thrown message with a digest, and the screen could only say
 * "o servidor recusou o pedido" about something entirely ordinary.
 */
export type TimerSettlement = {
  kind: "autoStopped" | "dayEnded" | "abandoned" | "tooShort";
  activityName: string;
  /**
   * Null when the session produced no record: abandoned, or under the floor.
   */
  durationMinutes: number | null;
  /**
   * The seconds the session lasted.
   *
   * Null for an abandonment, which is told nothing about its length; set for
   * `tooShort`, because "não chegou a 5 minutos" is worth nothing to the boy
   * without the number that says how close he got.
   */
  durationSeconds: number | null;
  /** D44: set for `tooShort`, the floor it fell under; zero for a session opened before it. */
  minSessionMinutes?: number;
};

export type TimerRead = {
  open: OpenTimer | null;
  settlement: TimerSettlement | null;
};

type TimerRow = {
  id: number;
  startedAt: Date;
  pausedAt: Date | null;
  accumulatedSeconds: number;
  status: Timer["status"];
  activityId: number;
  activityName: string;
  categoryName: string;
  maxSessionMinutes: number | null;
  minSessionMinutes: number;
};

/**
 * The open timer of one user, with everything a settlement needs to decide.
 *
 * **`max_session_minutes` is read from the timer's own row, not from
 * `activities` (D38).** This docstring used to declare the opposite, in the
 * same block whose `select` now says otherwise, and it is replaced rather than
 * left standing: two opposite declarations in one place, with the wrong one
 * formatted as the normative statement and read first.
 *
 * What the old text argued was that an open session has nothing credited, so
 * letting the live limit reach it is the present being told what it is worth
 * rather than the past being rewritten. Half of that survives and holds up
 * D37's residue; the other half did not, because *raising* the limit walks
 * backwards in time — the reconciliation is lazy, so a session that stopped
 * itself hours ago comes back if nobody has read it yet. D16 says the cut comes
 * out of the stamps and cannot depend on when somebody opened the app, so the
 * limit is a stamp too.
 *
 * The old text also closed by calling the limit "the only piece of
 * configuration a running session reads", and that was never true: a running
 * session is also priced by the activity's `value`, its `calc_mode` and its
 * category, live, when it is filed. That is what `refuseWhileWaiting` now
 * refuses to let move — see `src/db/pending.ts` — which is the other half of
 * the same rule this one carries.
 */
function selectOpenTimer(
  db: Connection["db"] | Transaction,
  userId: number,
): TimerRow | undefined {
  return (
    db
      .select({
        id: timers.id,
        startedAt: timers.startedAt,
        pausedAt: timers.pausedAt,
        accumulatedSeconds: timers.accumulatedSeconds,
        status: timers.status,
        activityId: timers.activityId,
        activityName: activities.name,
        categoryName: categories.name,
        // D38: the session's own stamp, not the activity's current setting.
        // Read live, an adult who raises the limit before anybody opens the app
        // brings back a session that had already stopped itself hours earlier —
        // measured at 120 min / 4,50 h against 600 min / 8,99 h — and D16 says
        // the cut cannot depend on when somebody opened the app.
        maxSessionMinutes: timers.maxSessionMinutes,
        minSessionMinutes: timers.minSessionMinutes,
      })
      .from(timers)
      .innerJoin(activities, eq(timers.activityId, activities.id))
      .innerJoin(categories, eq(activities.categoryId, categories.id))
      .where(
        and(
          eq(timers.userId, userId),
          inArray(timers.status, [...OPEN_STATUSES]),
        ),
      )
      // Newest first: `startTimerAction` refuses to open a second session while
      // one is open, so there is one — but a `select` that would return two rows
      // and takes the first has to say which first it means.
      .orderBy(desc(timers.id))
      .limit(1)
      .get()
  );
}

function stateOf(row: TimerRow): TimerState {
  return {
    startedAt: row.startedAt,
    pausedAt: row.pausedAt,
    accumulatedSeconds: row.accumulatedSeconds,
    status: row.status,
  };
}

function activityOf(row: TimerRow): TimerActivity {
  return {
    id: row.activityId,
    name: row.activityName,
    categoryName: row.categoryName,
    maxSessionMinutes: row.maxSessionMinutes,
    minSessionMinutes: row.minSessionMinutes,
  };
}

/**
 * Reads the boy's session and settles it first (D16).
 *
 * The read happens outside a transaction and the write only starts when there
 * is something to settle, which is almost never: an ordinary open of the screen
 * takes no write lock at all. When there is, the row is read again *inside* the
 * transaction and reconciled again from what it says there — the first read is
 * only what decided that a transaction was worth opening, and treating it as
 * the truth would let two tabs settle the same session twice.
 */
export function readTimer(
  connection: Connection,
  userId: number,
  now: Date,
): TimerRead {
  const row = selectOpenTimer(connection.db, userId);

  if (row === undefined) {
    return { open: null, settlement: null };
  }

  const reconciliation = reconcileTimer(
    stateOf(row),
    row.maxSessionMinutes,
    now,
  );

  if (reconciliation.settledAt === null) {
    return { open: openOf(row, reconciliation), settlement: null };
  }

  return writeTransaction(connection, (tx) => {
    const fresh = selectOpenTimer(tx, userId);

    if (fresh === undefined) {
      // Another tab settled it between the two reads. Its record — if the
      // settlement produced one — is already written; writing a second one here
      // is the double credit this re-read exists to prevent.
      return { open: null, settlement: null };
    }

    const settled = reconcileTimer(
      stateOf(fresh),
      fresh.maxSessionMinutes,
      now,
    );

    if (settled.settledAt === null) {
      return { open: openOf(fresh, settled), settlement: null };
    }

    return {
      open: null,
      settlement: settle(tx, userId, fresh, settled),
    };
  });
}

function openOf(row: TimerRow, reconciliation: Reconciliation): OpenTimer {
  return {
    id: row.id,
    activity: activityOf(row),
    state: reconciliation.state,
    activeSeconds: reconciliation.activeSeconds,
  };
}

/**
 * Writes a settlement down: the timer's new state, and the record unless the
 * session was abandoned.
 *
 * D16 draws the line here — the limit and the turn of the day produce a record
 * marked as ended by itself, the twelve-hour pause produces none — and this is
 * the only place any of it happens, so they cannot drift apart.
 *
 * `accumulated_seconds` is whole seconds, which is what the column takes. The
 * fraction is dropped on the way into the column and never on the way into the
 * record: the minutes are rounded once, from the unrounded seconds the
 * reconciliation reports (D9, D17).
 */
function settle(
  tx: Transaction,
  userId: number,
  row: TimerRow,
  reconciliation: Reconciliation,
): TimerSettlement {
  tx.update(timers)
    .set({
      status: reconciliation.state.status,
      pausedAt: reconciliation.state.pausedAt,
      accumulatedSeconds: Math.floor(reconciliation.state.accumulatedSeconds),
    })
    .where(eq(timers.id, row.id))
    .run();

  if (!reconciliation.autoStopped) {
    return {
      kind: "abandoned",
      activityName: row.activityName,
      durationMinutes: null,
      durationSeconds: null,
    };
  }

  // D44: a settlement under the floor files nothing, for the same reason a
  // manual stop does not. The turn of the day lands here (a session begun at
  // 23:59 has a minute at midnight); the limit does not, since the schema
  // keeps it at or above the floor. The session is over either way.
  if (!reachesMinimum(reconciliation.activeSeconds, row.minSessionMinutes)) {
    return {
      kind: "tooShort",
      activityName: row.activityName,
      durationMinutes: null,
      durationSeconds: durationSeconds(reconciliation.activeSeconds),
      minSessionMinutes: row.minSessionMinutes,
    };
  }

  const written = insertProposedLog(tx, {
    userId,
    activityId: row.activityId,
    startedAt: row.startedAt,
    endedAt: reconciliation.settledAt ?? row.startedAt,
    activeSeconds: reconciliation.activeSeconds,
    note: null,
    autoStopped: true,
  });

  return {
    kind: reconciliation.reason === "dayEnd" ? "dayEnded" : "autoStopped",
    activityName: row.activityName,
    durationMinutes: written.durationMinutes,
    durationSeconds: written.durationSeconds,
  };
}

/**
 * The one write a kid makes: a `pending` record proposed by the timer.
 *
 * Everything about it comes from the stamps and never from the browser. The
 * duration in particular: a client that could hand over its own minutes is a
 * client that can hand over four hundred of them, and the whole reason the
 * clock lives on the server is that its output is not the boy's to type.
 *
 * `occurred_on` is the São Paulo day of `started_at` (D13), and that choice is
 * load-bearing rather than cosmetic. Taking it from the moment of the read
 * would make an automatic stop land on a different day depending on when
 * somebody opened the app, which is exactly what #19 forbids; taking it from
 * the start is a stamp, and stamps do not move.
 *
 * Returns what it wrote — seconds and minutes both — so the screen quotes the
 * numbers that are in the database rather than ones it worked out again.
 */
function insertProposedLog(
  tx: Transaction,
  entry: {
    userId: number;
    activityId: number;
    startedAt: Date;
    endedAt: Date;
    activeSeconds: number;
    note: string | null;
    autoStopped: boolean;
  },
): { durationSeconds: number; durationMinutes: number } {
  // The minutes are the rounding of the seconds this row is about to store,
  // and the second line says so rather than starting over from the raw active
  // time. The two answers are identical either way — `durationSeconds` is
  // idempotent — but written this way the invariant the migration and the tests
  // both lean on, `duration_minutes === durationMinutes(duration_seconds)`,
  // holds by construction instead of by the two derivations happening to begin
  // from the same number (D17, #71).
  const seconds = durationSeconds(entry.activeSeconds);
  const minutes = durationMinutes(seconds);

  tx.insert(activityLogs)
    .values({
      userId: entry.userId,
      activityId: entry.activityId,
      // The record enters the queue and nothing else happens to it: no ledger
      // row, no `computed_hours`, no reviewer (D18 is the admin's own entry,
      // which is the other path).
      status: "pending",
      source: "timer",
      occurredOn: saoPauloDay(entry.startedAt),
      startedAt: entry.startedAt,
      // The schema requires `ended_at > started_at`, and a session started and
      // stopped inside the same millisecond would otherwise be refused by the
      // database rather than by anything that could explain itself. A double
      // tap never gets this far — since #71 a session that rounds to zero
      // minutes is turned away by `stopTimer` and filed nowhere — so the clamp
      // answers for two stamps landing in the same millisecond, not for the
      // shape a session of no length is stored in.
      endedAt: new Date(
        Math.max(entry.endedAt.getTime(), entry.startedAt.getTime() + 1),
      ),
      durationSeconds: seconds,
      durationMinutes: minutes,
      note: entry.note,
      autoStopped: entry.autoStopped,
      createdBy: entry.userId,
    })
    .run();

  return { durationSeconds: seconds, durationMinutes: minutes };
}

/** What a timer operation answers with, once it has done its work. */
export type TimerWrite = {
  read: TimerRead;
  /** The record the boy just proposed by stopping, if he stopped one. */
  proposed: {
    activityName: string;
    durationMinutes: number;
    durationSeconds: number;
  } | null;
};

/**
 * Opens a session (#18).
 *
 * The read and the insert share one transaction because "one open session per
 * boy" is the invariant being kept, and a rule that reads before it writes is a
 * rule two taps can walk straight through when the two are apart. There is no
 * unique index behind it: `timers` has no column that could carry one — a
 * partial `UNIQUE(user_id) WHERE status in (...)` would be the schema's way to
 * say it, and adding a column to a table Phase 1 designed for exactly this is
 * not a thing to do quietly. So the transaction is the guarantee, and
 * `timer.test.ts` starts two sessions at once and watches the second be
 * refused.
 */
export function startTimer(
  connection: Connection,
  userId: number,
  activityId: number,
  now: Date,
): TimerWrite {
  return writeTransaction(connection, (tx) => {
    const open = selectOpenTimer(tx, userId);

    if (open !== undefined) {
      throw new Error(
        `user ${userId} already has an open timer; stop it before starting another`,
      );
    }

    const activity = tx
      .select({
        id: activities.id,
        calcMode: activities.calcMode,
        active: activities.active,
        categoryActive: categories.active,
        maxSessionMinutes: activities.maxSessionMinutes,
        minSessionMinutes: activities.minSessionMinutes,
      })
      .from(activities)
      .innerJoin(categories, eq(activities.categoryId, categories.id))
      .where(eq(activities.id, activityId))
      .get();

    // A timer measures time, so only a `duration` activity has anything for it
    // to measure (D5): "Sair com os amigos" is worth three hours whether the
    // afternoon lasted two or six. And D14 deactivates rather than deletes, so
    // an id that used to be startable can stop being one — on both sides, which
    // is what `listTimedActivities` offers and what this used to disagree with:
    // switching the category off took the activity out of the picker and left
    // it startable by id.
    if (
      activity === undefined ||
      !activity.active ||
      !activity.categoryActive ||
      activity.calcMode !== "duration"
    ) {
      throw new Error(
        `activity ${activityId} cannot be timed: it must be active and measured by duration`,
      );
    }

    tx.insert(timers)
      .values({
        userId,
        activityId,
        startedAt: now,
        pausedAt: null,
        accumulatedSeconds: 0,
        // D38: stamped here, once, and never re-read from `activities`. The
        // limit is one of the numbers the cut is computed from, and D16 requires
        // the cut to come out of the stamps alone.
        maxSessionMinutes: activity.maxSessionMinutes,
        // D44, for D38's reason: the floor is a stamp too.
        minSessionMinutes: activity.minSessionMinutes,
        status: "running",
      })
      .run();

    const started = selectOpenTimer(tx, userId);

    if (started === undefined) {
      throw new Error("the timer that was just inserted cannot be read back");
    }

    return {
      read: {
        open: openOf(started, reconcileTimer(stateOf(started), null, now)),
        settlement: null,
      },
      proposed: null,
    };
  });
}

/**
 * Pauses a running session, or leaves an already paused one alone (#18).
 *
 * Idempotent on purpose: *Parar* pauses first so the duration is frozen at the
 * moment the boy said he was finished rather than at the moment he finishes
 * typing a note, and a boy who was already paused when he tapped it must not
 * lose the pause he was in — the twelve hours of D16 are counted from it.
 *
 * Pausing banks the stretch that just ended and stamps `paused_at`. Time spent
 * paused never enters `accumulated_seconds`, which is D17 in one assignment.
 *
 * The banked seconds are **truncated, not rounded**. The column is whole
 * seconds, so something has to happen to the fraction, and rounding it is the
 * one thing that must not: `Math.round` breaks ties upward, every pause is a
 * new tie, and the boy decides how many pauses there are. Measured with the
 * rounding in place, two hundred taps of half a second each — a hundred seconds
 * of reading — were banked as three minutes, eighty per cent more than they
 * were. Truncating costs less than a second per pause and costs it in the
 * direction that cannot be farmed; the record's minutes are still rounded once,
 * at the end, from the seconds the reconciliation reports (D9, D17).
 */
export function pauseTimer(
  connection: Connection,
  userId: number,
  now: Date,
): TimerWrite {
  return mutateOpenTimer(connection, userId, now, (tx, row, reconciliation) => {
    if (reconciliation.state.status === "paused") {
      return {
        read: { open: openOf(row, reconciliation), settlement: null },
        proposed: null,
      };
    }

    const paused: TimerState = {
      startedAt: reconciliation.state.startedAt,
      pausedAt: now,
      accumulatedSeconds: Math.floor(reconciliation.activeSeconds),
      status: "paused",
    };

    tx.update(timers)
      .set({
        status: paused.status,
        pausedAt: paused.pausedAt,
        accumulatedSeconds: paused.accumulatedSeconds,
      })
      .where(eq(timers.id, row.id))
      .run();

    return {
      read: {
        open: {
          id: row.id,
          activity: activityOf(row),
          state: paused,
          activeSeconds: paused.accumulatedSeconds,
        },
        settlement: null,
      },
      proposed: null,
    };
  });
}

/**
 * Resumes a paused session (#18).
 *
 * `paused_at` becomes the boundary of the new stretch — see the module
 * docstring of `src/engine/timer.ts` — and `accumulated_seconds` keeps
 * everything that came before it, so the pause itself is never paid for.
 */
export function resumeTimer(
  connection: Connection,
  userId: number,
  now: Date,
): TimerWrite {
  return mutateOpenTimer(connection, userId, now, (tx, row, reconciliation) => {
    if (reconciliation.state.status === "running") {
      return {
        read: { open: openOf(row, reconciliation), settlement: null },
        proposed: null,
      };
    }

    const running: TimerState = {
      startedAt: reconciliation.state.startedAt,
      pausedAt: now,
      accumulatedSeconds: reconciliation.state.accumulatedSeconds,
      status: "running",
    };

    tx.update(timers)
      .set({ status: running.status, pausedAt: running.pausedAt })
      .where(eq(timers.id, row.id))
      .run();

    return {
      read: {
        open: {
          id: row.id,
          activity: activityOf(row),
          state: running,
          activeSeconds: running.accumulatedSeconds,
        },
        settlement: null,
      },
      proposed: null,
    };
  });
}

/**
 * Ends a session and proposes the record (#18).
 *
 * The active seconds are whatever the stamps say at `now` — which for a session
 * paused a moment ago by *Parar* is the frozen number, and for one still
 * running is the number up to this instant. Either way the boy never supplies
 * it.
 *
 * **A session under its floor ends without a record (D44).** The session is
 * closed either way: the boy asked for it to end, and the screen has already
 * told him, before the tap, that nothing will be sent (#86).
 *
 * The refusal comes back as a `tooShort` settlement rather than as a throw. See
 * `TimerSettlement`: a thrown message becomes a digest in production, and this
 * is an ordinary thing for a boy to do, not a refusal to explain away.
 */
export function stopTimer(
  connection: Connection,
  userId: number,
  note: string | null,
  now: Date,
): TimerWrite {
  return mutateOpenTimer(connection, userId, now, (tx, row, reconciliation) => {
    const endedAt =
      reconciliation.state.status === "paused"
        ? (reconciliation.state.pausedAt ?? now)
        : now;

    tx.update(timers)
      .set({
        status: "stopped",
        pausedAt: endedAt,
        // Whole seconds, like every other write of this column. The record's
        // own minutes come from the unrounded seconds below.
        accumulatedSeconds: Math.floor(reconciliation.activeSeconds),
      })
      .where(eq(timers.id, row.id))
      .run();

    // D44: under the floor there is no record to propose. The session is
    // closed above either way, and the boy is told why nothing was sent.
    if (!reachesMinimum(reconciliation.activeSeconds, row.minSessionMinutes)) {
      return {
        read: {
          open: null,
          settlement: {
            kind: "tooShort",
            activityName: row.activityName,
            durationMinutes: null,
            durationSeconds: durationSeconds(reconciliation.activeSeconds),
            minSessionMinutes: row.minSessionMinutes,
          },
        },
        proposed: null,
      };
    }

    const written = insertProposedLog(tx, {
      userId,
      activityId: row.activityId,
      startedAt: row.startedAt,
      endedAt,
      activeSeconds: reconciliation.activeSeconds,
      note,
      autoStopped: false,
    });

    return {
      read: { open: null, settlement: null },
      proposed: { activityName: row.activityName, ...written },
    };
  });
}

/**
 * The shape every mutation shares: settle first (D16), then act.
 *
 * Settling before acting is what keeps a boy from resuming a session that ran
 * past its limit an hour ago, or pausing one that was abandoned overnight. It
 * is the same reconciliation `readTimer` performs, in the same transaction as
 * the change, so a read and a write can never disagree about which state the
 * timer was in.
 */
function mutateOpenTimer(
  connection: Connection,
  userId: number,
  now: Date,
  body: (
    tx: Transaction,
    row: TimerRow,
    reconciliation: Reconciliation,
  ) => TimerWrite,
): TimerWrite {
  return writeTransaction(connection, (tx) => {
    const row = selectOpenTimer(tx, userId);

    if (row === undefined) {
      throw new Error(`user ${userId} has no open timer`);
    }

    const reconciliation = reconcileTimer(
      stateOf(row),
      row.maxSessionMinutes,
      now,
    );

    if (reconciliation.settledAt !== null) {
      return {
        read: {
          open: null,
          settlement: settle(tx, userId, row, reconciliation),
        },
        proposed: null,
      };
    }

    return body(tx, row, reconciliation);
  });
}

/**
 * A `duration` activity, as the two pickers that offer them need it: the boy's
 * timer (#18) and the adult's correction in the queue (#20).
 */
export type TimedActivity = {
  id: number;
  name: string;
  categoryId: number;
  categoryName: string;
  maxSessionMinutes: number | null;
};

/**
 * What the two pickers offer: the active `duration` activities, in the order
 * Configuração puts them in.
 *
 * `duration` only, and active only. The timer measures time, so only an
 * activity that is measured by time can be pointed at it (D5); and D14's
 * deactivated rows stay in the database so old records keep their meaning —
 * they do not stay in the pickers.
 *
 * One function for both screens rather than two queries that agree today: the
 * queue's "trocar a atividade" has to offer what the timer could have produced,
 * or an adult correcting an entry can turn a timed session into something with
 * no duration at all.
 */
export function listTimedActivities(connection: Connection): TimedActivity[] {
  return connection.db
    .select({
      id: activities.id,
      name: activities.name,
      categoryId: categories.id,
      categoryName: categories.name,
      maxSessionMinutes: activities.maxSessionMinutes,
    })
    .from(activities)
    .innerJoin(categories, eq(activities.categoryId, categories.id))
    .where(
      and(
        eq(activities.active, true),
        eq(categories.active, true),
        eq(activities.calcMode, "duration"),
      ),
    )
    .orderBy(categories.sortOrder, categories.id, activities.sortOrder)
    .all();
}
