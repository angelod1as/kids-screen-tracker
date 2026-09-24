import { cookies } from "next/headers";

import { sessionSecret } from "./env";
import {
  issuedAt,
  SESSION_TTL_MS,
  signSessionToken,
  verifySessionToken,
} from "./token";

/*
 * Server-side only (reads Varlock). Apart from `guard.ts` so tests can mock the
 * cookie while the guard's checks run for real.
 */

/** Not `session`, which collides with other apps on the same dev host. */
export const SESSION_COOKIE_NAME = "kst_session";

/**
 * `httpOnly` (#12) hides it from script. `lax` blocks the cross-site POST every
 * mutation is; `strict` would log out a link from WhatsApp. `secure` only in
 * production, or `http://localhost` cannot log in. `expiresAt` is what binds.
 */
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/** One `null` for every failure: missing, forged, edited or expired. */
export async function readSessionUsername(): Promise<string | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME);
  if (cookie === undefined) {
    return null;
  }

  const token = verifySessionToken(cookie.value, sessionSecret(), Date.now());

  return token === null ? null : token.username;
}

export async function startSession(username: string): Promise<void> {
  const token = signSessionToken(
    issuedAt(username, Date.now()),
    sessionSecret(),
  );

  (await cookies()).set(SESSION_COOKIE_NAME, token, cookieOptions());
}

/**
 * Not revocation: with no session table, a cookie copied before logout still
 * verifies until `expiresAt`. A stolen cookie calls for rotating the secret.
 */
export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE_NAME);
}
