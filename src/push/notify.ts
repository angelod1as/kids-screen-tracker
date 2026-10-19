import { and, eq, inArray } from "drizzle-orm";

import type { Connection } from "../db/client";
import {
  activities,
  activityLogs,
  ledger,
  spendRequests,
  users,
} from "../db/schema";
import { formatHours } from "../ui/hours";
import { deleteSubscription, subscriptionsOf } from "./subscriptions";
import type { PushSender } from "./vapid";
import { pushSender } from "./vapid";

/*
 * D51: the two triggers and nothing else. Neither function ever rejects: the
 * record is the truth and the push only a reminder, so a failure is dropped.
 */

export type PushMessage = { title: string; body: string; url: string };

async function deliver(
  connection: Connection,
  userIds: number[],
  message: PushMessage,
  send: PushSender | null,
): Promise<void> {
  if (send === null) {
    return;
  }

  const payload = JSON.stringify(message);

  await Promise.all(
    subscriptionsOf(connection, userIds).map(async (keys) => {
      try {
        await send(keys, payload);
      } catch (error) {
        if (isGone(error)) {
          deleteSubscription(connection, keys.endpoint);
        }
      }
    }),
  );
}

/** 404 and 410 are the push service saying the subscription will never work again. */
function isGone(error: unknown): boolean {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;

  return status === 404 || status === 410;
}

/** Trigger 1: a boy's entry was just born pending, by stopwatch or request (D49). */
export async function notifyPending(
  connection: Connection,
  kidId: number,
  activityNames: string[],
): Promise<void> {
  try {
    if (activityNames.length === 0) {
      return;
    }

    const kid = connection.db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, kidId))
      .get();
    const admins = connection.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.active, true)))
      .all();

    await deliver(
      connection,
      admins.map((admin) => admin.id),
      {
        title: "Para aprovar",
        body: `${kid?.name ?? "Menino"}: ${activityNames.join(", ")}`,
        url: "/admin/fila",
      },
      pushSender(),
    );
  } catch {
    // D51.
  }
}

/** Trigger 1, for the spend request (D58, emenda à D51): both adults. */
export async function notifySpendRequested(
  connection: Connection,
  requestId: number,
): Promise<void> {
  try {
    const request = connection.db
      .select({
        kidName: users.displayName,
        destination: spendRequests.destination,
      })
      .from(spendRequests)
      .innerJoin(users, eq(spendRequests.userId, users.id))
      .where(eq(spendRequests.id, requestId))
      .get();

    if (request === undefined) {
      return;
    }

    const admins = connection.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.active, true)))
      .all();

    await deliver(
      connection,
      admins.map((admin) => admin.id),
      {
        title: "Para aprovar",
        body: `${request.kidName}: usar ${request.destination}`,
        url: "/admin/fila",
      },
      pushSender(),
    );
  } catch {
    // D51.
  }
}

/** Trigger 2, for the spend request (D58): the boy who asked, about it alone. */
export async function notifySpendReviewed(
  connection: Connection,
  requestId: number,
): Promise<void> {
  try {
    const request = connection.db
      .select({
        userId: spendRequests.userId,
        status: spendRequests.status,
        hours: ledger.hours,
      })
      .from(spendRequests)
      .leftJoin(ledger, eq(spendRequests.ledgerId, ledger.id))
      .where(
        and(
          eq(spendRequests.id, requestId),
          inArray(spendRequests.status, ["approved", "rejected"]),
        ),
      )
      .get();

    if (request === undefined) {
      return;
    }

    await deliver(
      connection,
      [request.userId],
      request.status === "approved"
        ? {
            title: "Aprovado",
            body: `Usado: ${formatHours(request.hours ?? 0)}`,
            url: "/menino",
          }
        : { title: "Recusado", body: "Pedido de uso", url: "/menino" },
      pushSender(),
    );
  } catch {
    // D51.
  }
}

/** Trigger 2: to the boy who owns the entry, and only about it (D51). */
export async function notifyReviewed(
  connection: Connection,
  logId: number,
): Promise<void> {
  try {
    const log = connection.db
      .select({
        userId: activityLogs.userId,
        status: activityLogs.status,
        hours: activityLogs.computedHours,
        activityName: activities.name,
      })
      .from(activityLogs)
      .innerJoin(activities, eq(activityLogs.activityId, activities.id))
      .where(
        and(
          eq(activityLogs.id, logId),
          inArray(activityLogs.status, ["approved", "rejected"]),
        ),
      )
      .get();

    if (log === undefined) {
      return;
    }

    await deliver(
      connection,
      [log.userId],
      log.status === "approved"
        ? {
            title: "Aprovado",
            body: `${log.activityName}: ${formatHours(log.hours ?? 0)}`,
            url: "/menino",
          }
        : { title: "Recusado", body: log.activityName, url: "/menino" },
      pushSender(),
    );
  } catch {
    // D51.
  }
}
