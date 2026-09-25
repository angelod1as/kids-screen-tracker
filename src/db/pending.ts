import { and, asc, eq, inArray } from "drizzle-orm";

import type { Connection, Transaction } from "./client";
import { RefusalError } from "./refusal";
import { activities, activityLogs, timers } from "./schema";

/**
 * D37: an edit that would reprice a waiting entry or an open session is
 * refused, naming the entry as D32 does. The line starts at `startTimer`.
 */

type Db = Connection["db"] | Transaction;

/** A queued entry or an open session: time already spent, not yet priced. */
export type WaitingEntry = {
  /** Null while the session is still open. */
  id: number | null;
  activityName: string;
  /** D13. Null for a session not yet filed. */
  occurredOn: string | null;
  kind: "queued" | "running";
};

/** The oldest, in D8's order: the one the adult would decide first. */
export function waitingOn(
  db: Db,
  activityIds: readonly number[],
): WaitingEntry | undefined {
  if (activityIds.length === 0) return undefined;

  const queued = db
    .select({
      id: activityLogs.id,
      activityName: activities.name,
      occurredOn: activityLogs.occurredOn,
    })
    .from(activityLogs)
    .innerJoin(activities, eq(activityLogs.activityId, activities.id))
    .where(
      and(
        eq(activityLogs.status, "pending"),
        inArray(activityLogs.activityId, [...activityIds]),
      ),
    )
    .orderBy(
      asc(activityLogs.occurredOn),
      asc(activityLogs.createdAt),
      asc(activityLogs.id),
    )
    .get();

  if (queued !== undefined) {
    return { ...queued, kind: "queued" };
  }

  // Open only: `stopped` is covered above, `abandoned` files nothing (D16). A
  // session past its limit is still `running` until read, on purpose (D37).
  const open = db
    .select({ id: timers.id, activityName: activities.name })
    .from(timers)
    .innerJoin(activities, eq(timers.activityId, activities.id))
    .where(
      and(
        inArray(timers.status, ["running", "paused"]),
        inArray(timers.activityId, [...activityIds]),
      ),
    )
    .orderBy(asc(timers.startedAt), asc(timers.id))
    .get();

  return open === undefined
    ? undefined
    : {
        id: null,
        activityName: open.activityName,
        occurredOn: null,
        kind: "running",
      };
}

/**
 * For the screen (#26, #27), fetched with the list so it can explain the lock
 * before the tap instead of after a failed save.
 */
export type Locks = {
  activityIds: number[];
  categoryIds: number[];
  queued: number;
  running: number;
};

export function currentLocks(connection: Connection): Locks {
  const db = connection.db;

  const waiting = db
    .select({
      activityId: activityLogs.activityId,
      categoryId: activities.categoryId,
    })
    .from(activityLogs)
    .innerJoin(activities, eq(activityLogs.activityId, activities.id))
    .where(eq(activityLogs.status, "pending"))
    .all();

  const open = db
    .select({
      activityId: timers.activityId,
      categoryId: activities.categoryId,
    })
    .from(timers)
    .innerJoin(activities, eq(timers.activityId, activities.id))
    .where(inArray(timers.status, ["running", "paused"]))
    .all();

  return {
    activityIds: [
      ...new Set([...waiting, ...open].map((row) => row.activityId)),
    ],
    categoryIds: [
      ...new Set([...waiting, ...open].map((row) => row.categoryId)),
    ],
    queued: waiting.length,
    running: open.length,
  };
}

/** Switched on or not. */
export function activityIdsOf(db: Db, categoryId: number): number[] {
  return db
    .select({ id: activities.id })
    .from(activities)
    .where(eq(activities.categoryId, categoryId))
    .all()
    .map((row) => row.id);
}

/** D37, naming the entry the way D32 does. */
export function refuseWhileWaiting(
  db: Db,
  activityIds: readonly number[],
  what: string,
): void {
  const waiting = waitingOn(db, activityIds);

  if (waiting === undefined) return;

  throw new RefusalError(refusalText(what, waiting));
}

/** pt-BR, not English: the screen shows the same sentence the endpoint throws. */
export function refusalText(what: string, waiting: WaitingEntry): string {
  const about =
    waiting.kind === "running"
      ? `${waiting.activityName} está com o cronômetro aberto`
      : `a entrada ${waiting.id} (${waiting.activityName}, ${waiting.occurredOn}) está esperando na fila`;

  return `${what}: não dá para mudar taxa, modo, nota, cooldown ou categoria agora, porque ${about} e seria paga pelo valor novo. Decida essa primeiro.`;
}
