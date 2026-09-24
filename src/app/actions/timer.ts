"use server";

import { and, desc, eq } from "drizzle-orm";

import { requireAccess } from "../../auth/guard";
import { getConnection, getDb } from "../../db";
import type { NewRequest, RequestableActivity } from "../../db/requests";
import { listRequestableActivities, requestLog } from "../../db/requests";
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
import { saoPauloDay } from "../../engine/calculate";

/**
 * Even the read is guarded with `proposeTimerLog`: D16 makes a read a write;
 * `requestLogAction` is the boy's other write, with its own kind (D49).
 * The clock is read once per action and passed down, so the answer is
 * arithmetic over stamps and not when the app was opened (D16).
 */

const MAX_NOTE_LENGTH = 500;

/** Bounded: twenty pending entries is already a different problem. */
const PENDING_LIMIT = 20;

export type OpenSessionView = {
  activityId: number;
  activityName: string;
  categoryName: string;
  status: "running" | "paused";
  /**
   * Active seconds when the server answered (D17). The screen counts only the
   * difference between its own clock readings, so a wrong phone clock is harmless.
   */
  activeSeconds: number;
  /** D16: where this session would stop by itself. Null means it does not. */
  maxSessionMinutes: number | null;
  /** D44: under this the session is not filed, and the screen says so first. */
  minSessionMinutes: number;
};

export type PendingProposal = {
  id: number;
  activityName: string;
  /** D13: `YYYY-MM-DD`. */
  occurredOn: string;
  durationMinutes: number | null;
  /** The seconds measured, which is what the screen shows (D17). */
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
  /** D49: what the boy may request without the stopwatch. */
  requestable: RequestableActivity[];
  /** D13: today in São Paulo, where the request's date field starts. */
  today: string;
  /** Set only when this very call filed a request (D49). */
  requested: { activityName: string; occurredOn: string } | null;
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
 * The duration is never sent: it comes off the stamps, because a client that
 * could name its own minutes could name four hundred of them.
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

/** The boy's second write (D49); the read after it settles the timer (D16). */
export async function requestLogAction(
  targetUserId: number,
  request: NewRequest,
): Promise<TimerScreenData> {
  await requireAccess({ kind: "requestLog", targetUserId });

  const now = new Date();
  const connection = getConnection();

  requestLog(connection, targetUserId, request, now);

  const requested = getDb()
    .select({ name: activities.name })
    .from(activities)
    .where(eq(activities.id, request.activityId))
    .get();

  return screen(
    targetUserId,
    readTimer(connection, targetUserId, now),
    null,
    requested === undefined
      ? null
      : { activityName: requested.name, occurredOn: request.occurredOn },
  );
}

/** Not exported: every export of a `"use server"` file is an endpoint, and this one trusts its user id. */
async function screen(
  userId: number,
  read: TimerRead,
  proposed: {
    activityName: string;
    durationMinutes: number;
    durationSeconds: number;
  } | null,
  requested: TimerScreenData["requested"] = null,
): Promise<TimerScreenData> {
  const connection = getConnection();

  return {
    userId,
    activities: listTimedActivities(connection),
    open: viewOf(read),
    settlement: read.settlement,
    proposed,
    pending: pendingProposals(userId),
    requestable: listRequestableActivities(connection),
    today: saoPauloDay(new Date()),
    requested,
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

/** The only lasting evidence that a session became something: the settlement notice is gone on refresh. */
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
      // D8 read backwards, so rows never swap between visits.
      .orderBy(
        desc(activityLogs.occurredOn),
        desc(activityLogs.createdAt),
        desc(activityLogs.id),
      )
      .limit(PENDING_LIMIT)
      .all()
  );
}
