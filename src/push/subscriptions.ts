import { eq, inArray } from "drizzle-orm";

import type { Connection } from "../db/client";
import { pushSubscriptions } from "../db/schema";

/** What `PushSubscription.toJSON()` carries, and all the sender needs. */
export type PushKeys = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** Far above any push service's endpoint or key; only a bound on what a client can store. */
const MAX_FIELD_LENGTH = 2048;

function field(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.length > MAX_FIELD_LENGTH
  ) {
    throw new Error(`a push subscription needs ${name}`);
  }

  return value;
}

/** D51: the server posts to this URL, so any other host would let a login aim it anywhere. */
const PUSH_HOSTS = [
  "fcm.googleapis.com",
  "web.push.apple.com",
  "updates.push.services.mozilla.com",
];
const PUSH_HOST_SUFFIX = ".notify.windows.com";

function isPushService(endpoint: string): boolean {
  let url: URL;

  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  return (
    url.protocol === "https:" &&
    url.port === "" &&
    (PUSH_HOSTS.includes(url.hostname) ||
      url.hostname.endsWith(PUSH_HOST_SUFFIX))
  );
}

/** The body comes from the browser, so its shape is checked here and not trusted (D33). */
export function parseSubscription(input: unknown): PushKeys {
  const body = (input ?? {}) as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  const endpoint = field(body.endpoint, "an endpoint");

  if (!isPushService(endpoint)) {
    throw new Error("a push endpoint is an https URL of a known push service");
  }

  return {
    endpoint,
    p256dh: field(body.keys?.p256dh, "a p256dh key"),
    auth: field(body.keys?.auth, "an auth secret"),
  };
}

/** Keyed by endpoint: the same browser saved under another login moves to it (D51). */
export function saveSubscription(
  connection: Connection,
  userId: number,
  keys: PushKeys,
  now: Date,
): void {
  connection.db
    .insert(pushSubscriptions)
    .values({ userId, ...keys, createdAt: now })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: keys.p256dh, auth: keys.auth, createdAt: now },
    })
    .run();
}

export function subscriptionsOf(
  connection: Connection,
  userIds: number[],
): PushKeys[] {
  if (userIds.length === 0) {
    return [];
  }

  return connection.db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds))
    .all();
}

/** D51: deleted, not deactivated. D14 is about rows the history points at. */
export function deleteSubscription(
  connection: Connection,
  endpoint: string,
): void {
  connection.db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .run();
}
