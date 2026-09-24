"use server";

import { and, asc, eq } from "drizzle-orm";

import { requireAdmin } from "../../auth/guard";
import { getDb } from "../../db";
import { users } from "../../db/schema";

export type Kid = {
  id: number;
  displayName: string;
};

/**
 * The two boys, for the screens that show both of them side by side.
 *
 * `requireAdmin` rather than `requireAccess`: the answer is not about one
 * person, so there is no `targetUserId` to check — the rule is simply that a
 * kid has no business holding a list that includes his brother's id. Refusing
 * here is what keeps the id needed to forge a balance request from being handed
 * out by the app itself.
 */
export async function listKidsAction(): Promise<Kid[]> {
  await requireAdmin();

  return getDb()
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.role, "kid"), eq(users.active, true)))
    .orderBy(asc(users.id))
    .all();
}
