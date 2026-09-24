"use server";

import { eq } from "drizzle-orm";

import { requireAccess } from "../../auth/guard";
import { getDb } from "../../db";
import { ledger } from "../../db/schema";

/**
 * #13: a forged POST with the brother's id is refused by the first line.
 * Summed in JavaScript so the sign lives next to the `kind` that carries it.
 */
export async function fetchBalanceAction(
  targetUserId: number,
): Promise<number> {
  await requireAccess({ kind: "view", targetUserId });

  const rows = getDb()
    .select({ kind: ledger.kind, hours: ledger.hours })
    .from(ledger)
    .where(eq(ledger.userId, targetUserId))
    .all();

  const total = rows.reduce(
    (sum, row) => sum + (row.kind === "spend" ? -row.hours : row.hours),
    0,
  );

  // D9: two decimals, once, at the end.
  return Math.round(total * 100) / 100;
}
