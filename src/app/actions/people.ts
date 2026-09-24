"use server";

import { and, asc, eq } from "drizzle-orm";

import { requireAdmin } from "../../auth/guard";
import { getDb } from "../../db";
import { users } from "../../db/schema";

export type Kid = {
  id: number;
  displayName: string;
};

/** Admin-only: this list is what hands out the brother's id a forged request needs. */
export async function listKidsAction(): Promise<Kid[]> {
  await requireAdmin();

  return getDb()
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.role, "kid"), eq(users.active, true)))
    .orderBy(asc(users.id))
    .all();
}
