import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Signed, not encrypted: the username is visible to its own holder. Only
 * username and expiry, never role or id, which `currentSession` reads per call.
 */

/**
 * Varlock checks the secret exists, not that it is unguessable. Length, not
 * entropy: a hurried placeholder is short, and an estimator blocks good ones.
 */
export const MIN_SESSION_SECRET_LENGTH = 32;

/**
 * Throws on every session path so a bad deploy fails closed instead of signing
 * forgeable cookies. Reports the length, never the value. `typeof` despite the
 * type: Varlock can hand over `undefined`.
 */
export function assertUsableSecret(secret: string): void {
  if (
    typeof secret === "string" &&
    secret.length >= MIN_SESSION_SECRET_LENGTH
  ) {
    return;
  }

  const found =
    typeof secret === "string" ? `length ${secret.length}` : "not set";

  throw new Error(
    `SESSION_SECRET is unusable (${found}); it must be a string of at least ` +
      `${MIN_SESSION_SECRET_LENGTH} characters. Every session cookie is ` +
      "signed with it, and a short one is guessable. Generate one with: " +
      "openssl rand -base64 48",
  );
}

/** #12: "validade longa (30 dias) — ninguém quer relogar toda hora no celular." */
export const SESSION_TTL_DAYS = 30;
export const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export type SessionToken = {
  username: string;
  /** Epoch milliseconds. The token is refused from this instant on. */
  expiresAt: number;
};

/** HMAC-SHA256 produces 32 bytes, always. */
const SIGNATURE_BYTES = 32;

/** base64url, since `+`, `/` and `=` need escaping in a cookie value. */
export function signSessionToken(token: SessionToken, secret: string): string {
  assertUsableSecret(secret);

  const payload = encode(JSON.stringify(token));

  return `${payload}.${sign(payload, secret)}`;
}

/**
 * One `null` for forged, malformed or expired. A short secret throws instead,
 * or "log in again" would hide a broken deploy. `timingSafeEqual`, never `===`,
 * which would tell a forger how many signature bytes are right.
 */
export function verifySessionToken(
  value: string,
  secret: string,
  nowMs: number,
): SessionToken | null {
  assertUsableSecret(secret);

  const parts = value.split(".");
  const payload = parts[0];
  const signature = parts[1];
  if (parts.length !== 2 || payload === undefined || signature === undefined) {
    return null;
  }

  const presented = decodeToBuffer(signature);
  // HMAC length is public, so this leaks nothing; timingSafeEqual would throw.
  if (presented === null || presented.length !== SIGNATURE_BYTES) {
    return null;
  }

  const expected = Buffer.from(sign(payload, secret), "base64url");
  if (!timingSafeEqual(presented, expected)) {
    return null;
  }

  const token = parsePayload(payload);
  if (token === null || token.expiresAt <= nowMs) {
    return null;
  }

  return token;
}

/** Builds a token that expires `SESSION_TTL_MS` after `nowMs`. */
export function issuedAt(username: string, nowMs: number): SessionToken {
  return { username, expiresAt: nowMs + SESSION_TTL_MS };
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("base64url");
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeToBuffer(value: string): Buffer | null {
  const decoded = Buffer.from(value, "base64url");

  // Buffer.from skips undecodable input silently; the round-trip rejects it.
  return decoded.toString("base64url") === value ? decoded : null;
}

function parsePayload(payload: string): SessionToken | null {
  const decoded = decodeToBuffer(payload);
  if (decoded === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded.toString("utf8"));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const { username, expiresAt } = parsed as Record<string, unknown>;
  if (typeof username !== "string" || typeof expiresAt !== "number") {
    return null;
  }

  return { username, expiresAt };
}
