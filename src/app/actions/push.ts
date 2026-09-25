"use server";

import { requireSession } from "../../auth/guard";
import { getConnection } from "../../db";
import { parseSubscription, saveSubscription } from "../../push/subscriptions";

/**
 * `requireSession` alone: the subscription is saved for the caller, and no
 * user id travels from the browser (D33, D51).
 */
export async function savePushSubscriptionAction(
  subscription: unknown,
): Promise<void> {
  const session = await requireSession();

  saveSubscription(
    getConnection(),
    session.userId,
    parseSubscription(subscription),
    new Date(),
  );
}
