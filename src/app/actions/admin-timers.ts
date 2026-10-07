"use server";

import { requireAdmin } from "../../auth/guard";
import { getConnection } from "../../db";
import type { TimerSettlement } from "../../db/timers";
import { cancelTimer, readTimer, stopTimer } from "../../db/timers";
import { listKidsAction } from "./people";

/**
 * The admin's side of the stopwatch (#84). Admin-only, so a kid is refused here
 * and not only in the navigation (D33). "Parar" reuses the kid's `stopTimer`, so
 * the floor (D44) and the queue order (D32) cannot drift between the two.
 */

const MAX_NOTE_LENGTH = 500;

export type RunningTimer = {
  userId: number;
  kidName: string;
  activityId: number;
  activityName: string;
  categoryName: string;
  /** D17: active seconds when the server answered. */
  activeSeconds: number;
  status: "running" | "paused";
  /** #44: Parar waits for a note on these, as the boy's screen does. */
  noteRequired: boolean;
};

/** Every boy's open session, each settled first on read (D16). */
export async function fetchRunningTimersAction(): Promise<RunningTimer[]> {
  await requireAdmin();

  const connection = getConnection();
  const now = new Date();
  const kids = await listKidsAction();

  const running: RunningTimer[] = [];

  for (const kid of kids) {
    const { open } = readTimer(connection, kid.id, now);

    if (
      open === null ||
      open.state.status === "stopped" ||
      open.state.status === "abandoned"
    ) {
      continue;
    }

    running.push({
      userId: kid.id,
      kidName: kid.displayName,
      activityId: open.activity.id,
      activityName: open.activity.name,
      categoryName: open.activity.categoryName,
      activeSeconds: open.activeSeconds,
      status: open.state.status,
      noteRequired: open.activity.noteRequired,
    });
  }

  return running;
}

/**
 * Ends it as the boy would: to the normal queue, honoring D44 and D32. The
 * settlement comes back so the admin screen can say when nothing was filed and
 * why (D44), as the boy's own screen does; a filed record settles to `null`.
 */
export async function adminStopTimerAction(
  userId: number,
  note: string,
): Promise<TimerSettlement | null> {
  await requireAdmin();

  const trimmed = note.trim();

  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw new Error(
      `a note is at most ${MAX_NOTE_LENGTH} characters, received ${trimmed.length}`,
    );
  }

  return stopTimer(
    getConnection(),
    userId,
    trimmed === "" ? null : trimmed,
    new Date(),
  ).read.settlement;
}

/**
 * Kills it (#84): the session is discarded, nothing reaches the queue. Returns
 * the settlement so the screen does not promise "nada vai para a fila" when the
 * session had already auto-ended and `mutateOpenTimer` filed a record (D16); a
 * real discard settles to `null`.
 */
export async function adminCancelTimerAction(
  userId: number,
): Promise<TimerSettlement | null> {
  await requireAdmin();

  return cancelTimer(getConnection(), userId, new Date()).read.settlement;
}
