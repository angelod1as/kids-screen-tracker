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
 * The timer's SQLite side; the arithmetic is in `src/engine/timer.ts`. Not in
 * the actions file because `"use server"` exports only async functions. Every
 * entry point takes `now`, so the answer comes from the stamps (#19).
 */

const OPEN_STATUSES = ["running", "paused"] as const;

export type TimerActivity = {
  id: number;
  name: string;
  categoryName: string;
  /** D16. Null means it does not stop itself. */
  maxSessionMinutes: number | null;
  /** D44, stamped when the session opened. */
  minSessionMinutes: number;
};

export type OpenTimer = {
  id: number;
  activity: TimerActivity;
  state: TimerState;
  /** D17. */
  activeSeconds: number;
};

/**
 * Said once; the next read is `null`. `tooShort` is a value, not a throw: in
 * production Next turns a thrown message into a digest.
 */
export type TimerSettlement = {
  kind: "autoStopped" | "dayEnded" | "abandoned" | "tooShort";
  activityName: string;
  /** Null when no record was filed. */
  durationMinutes: number | null;
  /** Null for an abandonment; set for `tooShort` so the boy sees how close he got. */
  durationSeconds: number | null;
  /** D44: the floor `tooShort` fell under; zero for a session opened before it. */
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

/** The open timer of one user. The limit is the row's own stamp (D38). */
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
        // D38.
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
      // `startTimer` keeps it to one; the order says which first.
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
 * Reads and settles first (D16). Only a settlement opens a transaction, and it
 * re-reads inside it so two tabs cannot settle the same session twice.
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
      // Another tab settled it; a second record here would be a double credit.
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
 * The one place D16's endings are written: a record for the limit and the day,
 * none for the abandonment. Minutes come from the unrounded seconds (D9, D17).
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

  // D44. The day's turn can land here; the limit cannot (schema: min ≤ max).
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
 * The one write a kid makes. Everything comes from the stamps, never the
 * browser. `occurred_on` is the day of `started_at` (D13), so it cannot move
 * with the read (#19).
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
  // From the stored seconds, so `duration_minutes` equals
  // `durationMinutes(duration_seconds)` by construction (D17).
  const seconds = durationSeconds(entry.activeSeconds);
  const minutes = durationMinutes(seconds);

  tx.insert(activityLogs)
    .values({
      userId: entry.userId,
      activityId: entry.activityId,
      status: "pending",
      source: "timer",
      occurredOn: saoPauloDay(entry.startedAt),
      startedAt: entry.startedAt,
      // `ended_at > started_at` is a CHECK; two stamps can share a millisecond.
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

export type TimerWrite = {
  read: TimerRead;
  proposed: {
    activityName: string;
    durationMinutes: number;
    durationSeconds: number;
  } | null;
};

/**
 * Opens a session (#18). One transaction is the only guarantee of one open
 * session per boy: `timers` has no column a unique index could use.
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

    // D5, D14, D33.
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
        // D38.
        maxSessionMinutes: activity.maxSessionMinutes,
        // D44, D38.
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
 * Pauses, or leaves a paused session alone: *Parar* pauses first, and the D16
 * twelve hours count from the pause the boy was already in. Banked seconds are
 * truncated, not rounded: the boy controls the number of ties.
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

/** Resumes (#18): `paused_at` becomes the new stretch's boundary. */
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
 * Ends a session and proposes the record (#18). Under its floor (D44) the
 * session still ends, with a `tooShort` settlement and no record.
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
        accumulatedSeconds: Math.floor(reconciliation.activeSeconds),
      })
      .where(eq(timers.id, row.id))
      .run();

    // D44.
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

/** Settle first (D16), then act, in the same transaction. */
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

/** A `duration` activity, for the timer (#18) and the queue's correction (#20). */
export type TimedActivity = {
  id: number;
  name: string;
  categoryId: number;
  categoryName: string;
  maxSessionMinutes: number | null;
};

/**
 * Active `duration` activities (D5, D14). One query for both pickers, so the
 * queue cannot correct a timed session into something without a duration.
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
