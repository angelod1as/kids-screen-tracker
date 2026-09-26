import { eq } from "drizzle-orm";

import type { Connection, Transaction } from "./client";
import { users } from "./schema";

/**
 * D33: an active kid, checked at the endpoint, since the picker is not a
 * guarantee. Role too: a ledger row for an admin is a number nothing reads back.
 * Returns the name, so the confirmation (D53) reads the row once.
 */
export function requireActiveKid(
  db: Connection["db"] | Transaction,
  userId: number,
): { displayName: string } {
  const found = db
    .select({
      role: users.role,
      active: users.active,
      displayName: users.displayName,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (found === undefined) {
    throw new Error(`there is no user ${userId}`);
  }

  if (found.role !== "kid" || !found.active) {
    throw new Error(
      `user ${userId} is not a boy this can be written for (D14, D33)`,
    );
  }

  return { displayName: found.displayName };
}
