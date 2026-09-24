import { eq } from "drizzle-orm";

import type { Connection, Transaction } from "./client";
import { users } from "./schema";

/**
 * Who an admin's screen may write about, checked at the endpoint (D33).
 *
 * The pickers on the admin's screens are built from `listKidsAction`, which
 * already returns the boys who are switched on. That is the list, and D33 is
 * the decision that a list is not a guarantee: every one of these endpoints is
 * a POST that takes a number, and the number does not have to have come from
 * the picker.
 *
 * Its own module because three of them need it — the launch, the release and
 * the refund (#22, #23, #24) — and a rule with three copies is a rule with
 * three chances to rot. `admin.rules.ts` has a case per operation, and the
 * sabotage matrix deletes this check to prove they can tell.
 *
 * **Role and not only existence.** An admin has no balance and no history; a
 * ledger row pointing at one would be a number nothing in this app can read
 * back. `active` is D14's deactivation: a boy who is switched off is
 * out of the pickers and out of the endpoints with them.
 */
export function requireActiveKid(
  db: Connection["db"] | Transaction,
  userId: number,
): void {
  const found = db
    .select({ role: users.role, active: users.active })
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
}
