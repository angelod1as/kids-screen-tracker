import { and, asc, eq, lt, min } from "drizzle-orm";

import type { Connection, Transaction } from "./client";
import type { BlockingEntry } from "./queue";
import { activities, activityLogs } from "./schema";

type Db = Connection["db"] | Transaction;

/**
 * `CalculationInput.categoryFirstDay`: the earliest approved entry of the
 * category, off the bucket stamped on the row (D37). Every approved row is
 * frozen before whatever is being priced now (D34).
 */
export function categoryFirstDay(
  db: Db,
  userId: number,
  categoryId: number,
): string | null {
  const row = db
    .select({ first: min(activityLogs.occurredOn) })
    .from(activityLogs)
    .where(
      and(
        eq(activityLogs.userId, userId),
        eq(activityLogs.status, "approved"),
        eq(activityLogs.categoryId, categoryId),
      ),
    )
    .get();

  return row?.first ?? null;
}

/**
 * A pending entry of the category older than the return bonus's window, while
 * no approved one is: deciding it first would turn this entry into a return
 * (D47), so the order of the taps would set the price (D32).
 */
export function pendingDebutBefore(
  db: Db,
  entry: { userId: number; categoryId: number; returnBonusPct: number },
  bonusWindowStart: string,
): BlockingEntry | undefined {
  if (entry.returnBonusPct <= 0) return undefined;

  const first = categoryFirstDay(db, entry.userId, entry.categoryId);
  if (first !== null && first < bonusWindowStart) return undefined;

  return (
    db
      .select({
        id: activityLogs.id,
        activityName: activities.name,
        occurredOn: activityLogs.occurredOn,
      })
      .from(activityLogs)
      // A pending row has no stamped category yet (D37), and D37 keeps the
      // activity's live one from moving while it waits.
      .innerJoin(activities, eq(activityLogs.activityId, activities.id))
      .where(
        and(
          eq(activityLogs.userId, entry.userId),
          eq(activityLogs.status, "pending"),
          eq(activities.categoryId, entry.categoryId),
          lt(activityLogs.occurredOn, bonusWindowStart),
        ),
      )
      .orderBy(
        asc(activityLogs.occurredOn),
        asc(activityLogs.createdAt),
        asc(activityLogs.id),
      )
      .get()
  );
}
