import { and, eq } from "drizzle-orm";

import { getDb } from "../db";
import { users } from "../db/schema";
import type { AccessRequest, Session } from "./access";
import { isAllowed } from "./access";
import type { StoredAccount } from "./accounts";
import { readSessionUsername } from "./session";

/*
 * Server-side only. Every server action calls in here (`guarded.test.ts`): a
 * hidden link stops nobody, the action is a POST taking a number. No
 * `middleware.ts` on purpose: it runs on edge, where SQLite cannot load (D22).
 */

export type DenialReason = "unauthenticated" | "forbidden";

/**
 * Thrown, so an unchecked result is not a way past it. The message is fixed: it
 * can reach the browser, and naming the target would answer a forged request.
 */
export class AccessDeniedError extends Error {
  readonly reason: DenialReason;

  constructor(reason: DenialReason) {
    super("Acesso negado.");
    this.name = "AccessDeniedError";
    this.reason = reason;
  }
}

/**
 * The cookie proves only a username; id and role are read per call, so a
 * deactivation (D14) bites on the next request and a reseed cannot remap a cookie.
 */
export async function currentSession(): Promise<Session | null> {
  const username = await readSessionUsername();
  if (username === null) {
    return null;
  }

  const row = getDb()
    .select({
      id: users.id,
      displayName: users.displayName,
      role: users.role,
    })
    .from(users)
    .where(and(eq(users.username, username), eq(users.active, true)))
    .get();

  if (row === undefined) {
    return null;
  }

  return {
    userId: row.id,
    username,
    displayName: row.displayName,
    role: row.role,
  };
}

/**
 * The login's only read of `users` (D45). Inactive rows are invisible (D14),
 * so a deactivated person fails exactly like an unknown name.
 */
export function findLoginAccount(username: string): StoredAccount | undefined {
  return getDb()
    .select({
      username: users.username,
      role: users.role,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(and(eq(users.username, username), eq(users.active, true)))
    .get();
}

export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (session === null) {
    throw new AccessDeniedError("unauthenticated");
  }

  return session;
}

export async function requireAccess(request: AccessRequest): Promise<Session> {
  const session = await requireSession();
  if (!isAllowed(session, request)) {
    throw new AccessDeniedError("forbidden");
  }

  return session;
}

/** For actions that concern no single user, such as the queue and CRUD. */
export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (session.role !== "admin") {
    throw new AccessDeniedError("forbidden");
  }

  return session;
}
