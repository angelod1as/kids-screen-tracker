"use server";

import { requireAdmin } from "../../auth/guard";
import { getConnection } from "../../db";
import type { LogEdits, QueueEntry } from "../../db/queue";
import {
  approveLog,
  countPendingLogs,
  listPendingLogs,
  rejectLog,
} from "../../db/queue";
import type { TimedActivity } from "../../db/timers";
import { listTimedActivities } from "../../db/timers";

/**
 * `requireAdmin`: the queue holds both boys, so there is no `targetUserId`.
 * `reviewed_by` comes from the session the guard returns, never from the caller.
 * Nothing is revalidated: every screen reads the cookie, so none is cached.
 */

const MAX_REASON_LENGTH = 500;

/** The activities travel with the entries so a correction needs no second round trip. */
export type QueueData = {
  entries: QueueEntry[];
  activities: TimedActivity[];
};

export async function fetchQueueAction(): Promise<QueueData> {
  await requireAdmin();

  return queue();
}

/** Its own endpoint: the queue prices every entry, a dozen calculations for one number. */
export async function countPendingLogsAction(): Promise<number> {
  await requireAdmin();

  return countPendingLogs(getConnection());
}

export async function approveLogAction(
  logId: number,
  edits: LogEdits = {},
): Promise<QueueData> {
  const session = await requireAdmin();

  approveLog(getConnection(), logId, session.userId, edits, new Date());

  return queue();
}

/** D19: nothing is credited or created. */
export async function rejectLogAction(
  logId: number,
  reason: string = "",
): Promise<QueueData> {
  const session = await requireAdmin();

  const trimmed = reason.trim();

  if (trimmed.length > MAX_REASON_LENGTH) {
    throw new Error(
      `a reason is at most ${MAX_REASON_LENGTH} characters, received ${trimmed.length}`,
    );
  }

  rejectLog(
    getConnection(),
    logId,
    session.userId,
    trimmed === "" ? null : trimmed,
    new Date(),
  );

  return queue();
}

/** Not exported: every export of a `"use server"` file is an endpoint, and this one checks nothing. */
function queue(): QueueData {
  const connection = getConnection();

  return {
    entries: listPendingLogs(connection),
    activities: listTimedActivities(connection),
  };
}
