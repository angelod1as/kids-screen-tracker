import { and, asc, count, eq, notExists, sql } from "drizzle-orm";

import type { Connection } from "./client";
import { writeTransaction } from "./client";
import { activities, activityLogs, timers } from "./schema";

/**
 * #83. Kept out of `activities.ts` so D15's source scan stays true there: this
 * module reads logs and timers, which that file must never touch.
 */

/** #83: a switched-off activity with how many logs and timers still point at it. */
export type DisabledActivityAudit = {
  id: number;
  categoryId: number;
  name: string;
  logCount: number;
  timerCount: number;
};

/**
 * #83: every switched-off activity with its reference counts. Zero logs and zero
 * timers is the only safe delete (D14 emenda): no FK, no frozen log to strand.
 */
export function auditDisabledActivities(
  connection: Connection,
): DisabledActivityAudit[] {
  const logByActivity = new Map(
    connection.db
      .select({
        activityId: activityLogs.activityId,
        logCount: count(activityLogs.id),
      })
      .from(activityLogs)
      .groupBy(activityLogs.activityId)
      .all()
      .map((row) => [row.activityId, row.logCount] as const),
  );

  const timerByActivity = new Map(
    connection.db
      .select({
        activityId: timers.activityId,
        timerCount: count(timers.id),
      })
      .from(timers)
      .groupBy(timers.activityId)
      .all()
      .map((row) => [row.activityId, row.timerCount] as const),
  );

  return connection.db
    .select({
      id: activities.id,
      categoryId: activities.categoryId,
      name: activities.name,
    })
    .from(activities)
    .where(eq(activities.active, false))
    .orderBy(asc(activities.name), asc(activities.id))
    .all()
    .map((row) => ({
      ...row,
      logCount: logByActivity.get(row.id) ?? 0,
      timerCount: timerByActivity.get(row.id) ?? 0,
    }));
}

/**
 * #83: hard-deletes the switched-off activities nothing points at (D14 emenda).
 * The zero-reference guard is the DELETE's own WHERE (D33), not a caller's list,
 * so a concurrent insert cannot slip a reference under a row mid-delete.
 */
export function deleteNeverUsedActivities(
  connection: Connection,
): { id: number; name: string }[] {
  return writeTransaction(connection, (tx) =>
    tx
      .delete(activities)
      .where(
        and(
          eq(activities.active, false),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(activityLogs)
              .where(eq(activityLogs.activityId, activities.id)),
          ),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(timers)
              .where(eq(timers.activityId, activities.id)),
          ),
        ),
      )
      .returning({ id: activities.id, name: activities.name })
      .all(),
  );
}
