"use server";

import { and, desc, eq } from "drizzle-orm";

import { requireAccess } from "../../auth/guard";
import { getConnection, getDb } from "../../db";
import { activities, activityLogs } from "../../db/schema";
import type {
  TimedActivity,
  TimerRead,
  TimerSettlement,
} from "../../db/timers";
import {
  listTimedActivities,
  pauseTimer,
  readTimer,
  resumeTimer,
  startTimer,
  stopTimer,
} from "../../db/timers";

/**
 * The timer's endpoints (#18, #19).
 *
 * Every one of them is guarded with `proposeTimerLog`, including the read. That
 * is not an oversight: D16 makes a read of a timer a write — settling a session
 * that ran past its limit inserts the record — so the kind that names "the one
 * write a kid may make" is the honest one for all five. For a kid the two kinds
 * answer the same anyway (`access.rules.ts`), and for an admin every kind does;
 * what the choice buys is that nothing here claims to be a read that is not.
 *
 * **The clock is read once per request**, at the top of each action, and passed
 * down. Everything below it — the cut, the abandonment, the record's day — is
 * arithmetic over stamps, which is #19's criterion: the answer does not depend
 * on when the app was opened, and `timer.test.ts` proves it by asking at
 * instants a month apart.
 *
 * Each action answers with the whole screen rather than with an acknowledgement,
 * so the boy's page never has to make a second round trip to find out what it
 * now shows. Nothing here revalidates a path: this screen owns its own state
 * and no other screen changes when a timer does.
 */

/** How much text the boy may attach to a record. */
const MAX_NOTE_LENGTH = 500;

/**
 * How many of his own pending records the boy is shown.
 *
 * An unbounded select is a query whose cost is decided by how long the family
 * keeps using the app. Twenty is more than the queue should ever hold — an
 * admin who has let twenty entries pile up has a different problem.
 */
const PENDING_LIMIT = 20;

/** An open session, flattened for the browser. */
export type OpenSessionView = {
  activityId: number;
  activityName: string;
  categoryName: string;
  status: "running" | "paused";
  /**
   * Active seconds when the server answered (D17: pauses excluded).
   *
   * This is the whole of what the browser is told about the clock, and the
   * screen counts up from it using the *difference* between two readings of its
   * own `Date.now()` — never the absolute value. A phone whose clock is an hour
   * out shows the right duration anyway, and the number that ends up in the
   * record is not this one: it is recomputed from the stamps when the session
   * stops.
   */
  activeSeconds: number;
  /** D16: where this session would stop by itself. Null means it does not. */
  maxSessionMinutes: number | null;
  /** D44: under this the session is not filed, and the screen says so first. */
  minSessionMinutes: number;
};

/** One record the boy has proposed and nobody has reviewed yet. */
export type PendingProposal = {
  id: number;
  activityName: string;
  /** D13: `YYYY-MM-DD`. */
  occurredOn: string;
  durationMinutes: number | null;
  /** The seconds measured, which since #71 is what the screen shows. */
  durationSeconds: number | null;
  autoStopped: boolean;
};

export type TimerScreenData = {
  userId: number;
  /** What the picker offers: the active `duration` activities. */
  activities: TimedActivity[];
  open: OpenSessionView | null;
  /** Set only when this very call settled a session (D16). */
  settlement: TimerSettlement | null;
  /** Set only when this very call proposed a record. */
  proposed: {
    activityName: string;
    durationMinutes: number;
    durationSeconds: number;
  } | null;
  pending: PendingProposal[];
};

export async function fetchTimerScreenAction(
  targetUserId: number,
): Promise<TimerScreenData> {
  await requireAccess({ kind: "proposeTimerLog", targetUserId });

  const now = new Date();

  const read = readTimer(getConnection(), targetUserId, now);

  return screen(targetUserId, read, null);
}

export async function startTimerAction(
  targetUserId: number,
  activityId: number,
): Promise<TimerScreenData> {
  await requireAccess({ kind: "proposeTimerLog", targetUserId });

  const now = new Date();
  const written = startTimer(getConnection(), targetUserId, activityId, now);

  return screen(targetUserId, written.read, written.proposed);
}

export async function pauseTimerAction(
  targetUserId: number,
): Promise<TimerScreenData> {
  await requireAccess({ kind: "proposeTimerLog", targetUserId });

  const now = new Date();
  const written = pauseTimer(getConnection(), targetUserId, now);

  return screen(targetUserId, written.read, written.proposed);
}

export async function resumeTimerAction(
  targetUserId: number,
): Promise<TimerScreenData> {
  await requireAccess({ kind: "proposeTimerLog", targetUserId });

  const now = new Date();
  const written = resumeTimer(getConnection(), targetUserId, now);

  return screen(targetUserId, written.read, written.proposed);
}

/**
 * Ends the session and proposes the record (#18).
 *
 * The note is the only thing the browser contributes, and it is trimmed to
 * nothing or capped. The duration is never sent: it comes off the stamps in the
 * database, because a client that could name its own minutes could name four
 * hundred of them.
 */
export async function stopTimerAction(
  targetUserId: number,
  note: string,
): Promise<TimerScreenData> {
  await requireAccess({ kind: "proposeTimerLog", targetUserId });

  const trimmed = note.trim();

  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw new Error(
      `a note is at most ${MAX_NOTE_LENGTH} characters, received ${trimmed.length}`,
    );
  }

  const now = new Date();
  const written = stopTimer(
    getConnection(),
    targetUserId,
    trimmed === "" ? null : trimmed,
    now,
  );

  return screen(targetUserId, written.read, written.proposed);
}

/**
 * Everything the screen draws, assembled from a settled read.
 *
 * Not exported: a `"use server"` file's every export is an endpoint, and this
 * takes a user id it does not check.
 */
async function screen(
  userId: number,
  read: TimerRead,
  proposed: {
    activityName: string;
    durationMinutes: number;
    durationSeconds: number;
  } | null,
): Promise<TimerScreenData> {
  const connection = getConnection();

  return {
    userId,
    activities: listTimedActivities(connection),
    open: viewOf(read),
    settlement: read.settlement,
    proposed,
    pending: pendingProposals(userId),
  };
}

function viewOf(read: TimerRead): OpenSessionView | null {
  const open = read.open;

  if (
    open === null ||
    open.state.status === "stopped" ||
    open.state.status === "abandoned"
  ) {
    return null;
  }

  return {
    activityId: open.activity.id,
    activityName: open.activity.name,
    categoryName: open.activity.categoryName,
    status: open.state.status,
    activeSeconds: open.activeSeconds,
    maxSessionMinutes: open.activity.maxSessionMinutes,
    minSessionMinutes: open.activity.minSessionMinutes,
  };
}

/**
 * The boy's own records that are still waiting for an adult.
 *
 * It is the screen's only lasting evidence that a session became something: the
 * "sua sessão fechou no limite" notice belongs to the read that settled it and
 * is gone on the next refresh, and a record nobody can see afterwards is a
 * record the boy has no reason to believe in.
 */
function pendingProposals(userId: number): PendingProposal[] {
  return (
    getDb()
      .select({
        id: activityLogs.id,
        activityName: activities.name,
        occurredOn: activityLogs.occurredOn,
        durationMinutes: activityLogs.durationMinutes,
        durationSeconds: activityLogs.durationSeconds,
        autoStopped: activityLogs.autoStopped,
      })
      .from(activityLogs)
      .innerJoin(activities, eq(activityLogs.activityId, activities.id))
      .where(
        and(
          eq(activityLogs.userId, userId),
          eq(activityLogs.status, "pending"),
        ),
      )
      // The reverse of D8's canonical order, like the ledger: newest first, and
      // never two rows that swap places between two visits.
      .orderBy(
        desc(activityLogs.occurredOn),
        desc(activityLogs.createdAt),
        desc(activityLogs.id),
      )
      .limit(PENDING_LIMIT)
      .all()
  );
}
