"use server";

import { eq } from "drizzle-orm";

import { requireAccess } from "../../auth/guard";
import { getDb } from "../../db";
import { ledger } from "../../db/schema";

/**
 * Somebody's balance, in hours.
 *
 * This is the action #13 is about. "Kid nunca vê o saldo do outro" is not a
 * statement about what the interface draws — it is a statement about what
 * happens when a POST arrives carrying the brother's id, which is a thing
 * anyone with the app open can send. The first line of the function is the
 * answer, and `balance.test.ts` sends exactly that request and watches it be
 * refused.
 *
 * `targetUserId` is a parameter rather than being taken from the session
 * because an admin reads both boys with it, which is the other half of the same
 * rule.
 *
 * Balance is `earn` + `refund` − `spend` and may go negative without limit.
 * Summed in JavaScript rather than in SQL so the sign lives next to the `kind`
 * that carries it; there are a handful of rows a day.
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
