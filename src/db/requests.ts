import { and, asc, eq } from "drizzle-orm";

import { shiftDate } from "../engine/day";
import type { Connection } from "./client";
import { writeTransaction } from "./client";
import { requireText } from "./input";
import { requireActiveKid } from "./people";
import { activities, activityLogs, categories } from "./schema";

/**
 * A boy's request for an activity nobody timed (D49): born pending, in the same
 * queue as the stopwatch's records, and priced only when an adult approves it.
 */

/** One activity as the request picker offers it. */
export type RequestableActivity = {
  id: number;
  categoryId: number;
  categoryName: string;
  name: string;
  calcMode: "duration" | "fixed" | "delivery" | "free";
  /** #18: what the minutes field starts from, for a `duration` activity. */
  presumedMinutes: number | null;
};

/** What the boy sends. No value, no grade: those are the adult's (D49). */
export type NewRequest = {
  activityId: number;
  /** D13: `YYYY-MM-DD` in `America/Sao_Paulo`. Any day (D49). */
  occurredOn: string;
  /** Only read for a `duration` activity; falls back to the presumed minutes. */
  durationMinutes?: number | null;
  note?: string | null;
};

/** The ceiling `activity_logs_duration_minutes_check` puts on the column. */
const MAX_MINUTES = 1_000_000;

const SECONDS_PER_MINUTE = 60;

/** Every live activity under a live category, in the pickers' order (D14). */
export function listRequestableActivities(
  connection: Connection,
): RequestableActivity[] {
  return connection.db
    .select({
      id: activities.id,
      categoryId: activities.categoryId,
      categoryName: categories.name,
      name: activities.name,
      calcMode: activities.calcMode,
      presumedMinutes: activities.presumedMinutes,
    })
    .from(activities)
    .innerJoin(categories, eq(activities.categoryId, categories.id))
    .where(and(eq(activities.active, true), eq(categories.active, true)))
    .orderBy(
      asc(categories.sortOrder),
      asc(categories.id),
      asc(activities.sortOrder),
      asc(activities.id),
    )
    .all();
}

/**
 * Files the request as the boy's own pending entry. The guard is D33's alone:
 * no limit on how many or on which day (D49); D32 orders them.
 */
export function requestLog(
  connection: Connection,
  userId: number,
  request: NewRequest,
  now: Date,
): { logId: number } {
  // `shiftDate(day, 0)` writes a parsed day back, so `2026-02-30` is refused.
  if (
    typeof request.occurredOn !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(request.occurredOn) ||
    shiftDate(request.occurredOn, 0) !== request.occurredOn
  ) {
    throw new Error(
      `a date must be a real day in YYYY-MM-DD, received ${request.occurredOn}`,
    );
  }

  const note = request.note == null ? null : request.note.trim();
  requireText(note, "a note");

  return writeTransaction(connection, (tx) => {
    requireActiveKid(tx, userId);

    const found = tx
      .select({
        name: activities.name,
        calcMode: activities.calcMode,
        presumedMinutes: activities.presumedMinutes,
        active: activities.active,
        categoryActive: categories.active,
      })
      .from(activities)
      .innerJoin(categories, eq(activities.categoryId, categories.id))
      .where(eq(activities.id, request.activityId))
      .get();

    if (found === undefined) {
      throw new Error(`there is no activity ${request.activityId}`);
    }

    if (!found.active || !found.categoryActive) {
      throw new Error(
        `activity ${request.activityId} is not active and cannot be chosen (D14)`,
      );
    }

    let minutes: number | null = null;

    if (found.calcMode === "duration") {
      minutes = request.durationMinutes ?? found.presumedMinutes;

      if (
        minutes == null ||
        !Number.isInteger(minutes) ||
        minutes < 1 ||
        minutes > MAX_MINUTES
      ) {
        throw new Error(
          `${found.name} is measured by duration: a duration is a whole number of minutes, between 1 and ${MAX_MINUTES}; received ${minutes}`,
        );
      }
    }

    const written = tx
      .insert(activityLogs)
      .values({
        userId,
        activityId: request.activityId,
        status: "pending",
        source: "request",
        occurredOn: request.occurredOn,
        durationMinutes: minutes,
        // Nothing measured it, so the row says the minutes and nothing finer
        // (D17, resíduo 3).
        durationSeconds: minutes === null ? null : minutes * SECONDS_PER_MINUTE,
        note: note === "" ? null : note,
        createdBy: userId,
        createdAt: now,
      })
      .returning({ id: activityLogs.id })
      .get();

    return { logId: written.id };
  });
}
