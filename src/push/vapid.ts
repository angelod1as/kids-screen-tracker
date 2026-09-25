import { createECDH } from "node:crypto";

import { ENV } from "varlock/env";
import webpush from "web-push";

import type { PushKeys } from "./subscriptions";

/*
 * Server-side only, and the only Varlock reader in `src/push/` (D23). Both
 * variables are optional: without them push is off and nothing else changes (D51).
 */

export type PushSender = (keys: PushKeys, payload: string) => Promise<unknown>;

/** A push service that never answers must not hold a promise open for good. */
const SEND_TIMEOUT_MS = 10_000;

/** D51: derived, not a variable, so it can neither disagree with the private key nor be inlined at build (D40). */
export function publicKeyOf(privateKey: string): string {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(privateKey, "base64url"));

  return ecdh.getPublicKey("base64url");
}

function details() {
  const privateKey = ENV.VAPID_PRIVATE_KEY;
  const subject = ENV.VAPID_SUBJECT;

  if (!privateKey || !subject) {
    return null;
  }

  try {
    return { subject, privateKey, publicKey: publicKeyOf(privateKey) };
  } catch {
    // A malformed key is push switched off, not a screen that fails to render.
    return null;
  }
}

export function vapidPublicKey(): string | null {
  return details()?.publicKey ?? null;
}

export function pushSender(): PushSender | null {
  const vapidDetails = details();

  if (vapidDetails === null) {
    return null;
  }

  return (keys, payload) =>
    webpush.sendNotification(
      {
        endpoint: keys.endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
      },
      payload,
      { vapidDetails, timeout: SEND_TIMEOUT_MS },
    );
}
