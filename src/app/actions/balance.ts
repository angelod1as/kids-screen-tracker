"use server";

import { and, eq, isNull } from "drizzle-orm";

import { requireAccess } from "../../auth/guard";
import { getDb } from "../../db";
import { activityLogs, ledger } from "../../db/schema";

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
    // D52: a release or refund is voided on its row, an activity on its log.
    .leftJoin(activityLogs, eq(ledger.activityLogId, activityLogs.id))
    .where(
      and(
        eq(ledger.userId, targetUserId),
        isNull(ledger.voidedAt),
        isNull(activityLogs.voidedAt),
      ),
    )
    .all();

  const total = rows.reduce(
    (sum, row) => sum + (row.kind === "spend" ? -row.hours : row.hours),
    0,
  );

  // D9: two decimals, once, at the end.
  return Math.round(total * 100) / 100;
}
