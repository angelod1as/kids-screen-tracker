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

/** Survives logout: it marks a browser that once logged in as its username (D48). */
export const DEVICE_COOKIE_NAME = "kst_device";
export const DEVICE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/** Its own key, so a device cookie never verifies as a session and vice versa. */
function deviceSecret(): string {
  return `${sessionSecret()}\0device`;
}

/**
 * `httpOnly` (#12) hides it from script. `lax` blocks the cross-site POST every
 * mutation is; `strict` would log out a link from WhatsApp. `secure` only in
 * production, or `http://localhost` cannot log in. `expiresAt` is what binds.
 */
function cookieOptions(ttlMs = SESSION_TTL_MS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(ttlMs / 1000),
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

/** The username this browser last logged in as, or `null` (D48). */
export async function readDeviceUsername(): Promise<string | null> {
  const cookie = (await cookies()).get(DEVICE_COOKIE_NAME);
  if (cookie === undefined) {
    return null;
  }

  const token = verifySessionToken(cookie.value, deviceSecret(), Date.now());

  return token === null ? null : token.username;
}

export async function rememberDevice(username: string): Promise<void> {
  const token = signSessionToken(
    { username, expiresAt: Date.now() + DEVICE_TTL_MS },
    deviceSecret(),
  );

  (await cookies()).set(
    DEVICE_COOKIE_NAME,
    token,
    cookieOptions(DEVICE_TTL_MS),
  );
}

/**
 * Not revocation: with no session table, a cookie copied before logout still
 * verifies until `expiresAt`. A stolen cookie calls for rotating the secret.
 */
export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE_NAME);
}
