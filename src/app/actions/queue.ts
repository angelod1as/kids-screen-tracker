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
 * The approval queue's endpoints (#20).
 *
 * `requireAdmin` and not `requireAccess`: the queue is not about one person —
 * it holds both boys — so there is no `targetUserId` for a rule to be stated
 * about. What the rule is here is simply that a kid has no business reading his
 * brother's proposals, let alone approving his own. `queue.test.ts` sends both
 * requests with a kid's cookie and watches them be refused.
 *
 * The session's own id becomes `reviewed_by`, which is why the guard's return
 * value is used rather than discarded: the record has to say who decided, and
 * the only trustworthy source for that is the cookie the request arrived with.
 *
 * Approving and rejecting answer with the queue as it now stands, so the screen
 * never has to ask again to find out what is left. Nothing is revalidated:
 * every screen in this app reads the session cookie and is therefore dynamic —
 * there is no cached render of the queue for a stale copy to survive in.
 */

/** How long a refusal's reason may be. */
const MAX_REASON_LENGTH = 500;

/**
 * The queue and what an adult may change an entry into.
 *
 * The activities travel with the entries rather than being fetched by a second
 * endpoint: the correction is meant to cost one tap more than the approval, and
 * a round trip to populate a picker is a wait in the middle of it.
 */
export type QueueData = {
  entries: QueueEntry[];
  activities: TimedActivity[];
};

export async function fetchQueueAction(): Promise<QueueData> {
  await requireAdmin();

  return queue();
}

/**
 * How many entries are waiting, for the counter on the admin's home (#21).
 *
 * Its own endpoint rather than `fetchQueueAction().entries.length`: the queue
 * prices every entry it lists and asks what stands in front of each one, which
 * is a dozen calculations to draw one number on the screen an adult opens
 * first.
 */
export async function countPendingLogsAction(): Promise<number> {
  await requireAdmin();

  return countPendingLogs(getConnection());
}

/**
 * Approves one entry, with whatever the adult corrected first (#20).
 *
 * One tap in the ordinary case: the screen sends `{ logId }` and nothing else,
 * and the entry is credited exactly as it was proposed. The edits exist for the
 * afternoon the boy forgot to stop the clock.
 */
export async function approveLogAction(
  logId: number,
  edits: LogEdits = {},
): Promise<QueueData> {
  const session = await requireAdmin();

  approveLog(getConnection(), logId, session.userId, edits, new Date());

  return queue();
}

/**
 * Rejects one entry, with an optional reason (#20, D19).
 *
 * Nothing is credited and nothing is created: the entry keeps its place in the
 * table as the record of the refusal, and every calculation from here on reads
 * past it.
 */
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

/**
 * The screen, assembled once.
 *
 * Not exported: every export of a `"use server"` file is an endpoint, and this
 * one checks nothing.
 */
function queue(): QueueData {
  const connection = getConnection();

  return {
    entries: listPendingLogs(connection),
    activities: listTimedActivities(connection),
  };
}
