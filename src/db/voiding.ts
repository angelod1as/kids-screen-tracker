import { eq } from "drizzle-orm";

import type { Connection, Transaction } from "./client";
import { writeTransaction } from "./client";
import { RefusalError } from "./refusal";
import { activityLogs, ledger } from "./schema";

/**
 * D52: an entry launched by mistake stops counting, and stays. An activity is
 * voided on its log, which also takes it out of the engine; a release or
 * refund, which has no log, on its ledger row.
 */
export type VoidTarget = { kind: "log" | "ledger"; id: number };

export type Voided = {
  userId: number;
  /** What the balance moves by, signed: minus an earn or refund, plus a release. */
  balanceChange: number;
};

export function voidEntry(
  connection: Connection,
  target: VoidTarget,
  adminId: number,
  now: Date,
): Voided {
  if (!Number.isInteger(target.id) || target.id < 1) {
    throw new Error(`an entry id is a positive integer, received ${target.id}`);
  }

  return writeTransaction(connection, (tx) => {
    if (target.kind === "log") {
      return voidLog(tx, target.id, adminId, now);
    }

    const row = tx
      .select({
        userId: ledger.userId,
        kind: ledger.kind,
        hours: ledger.hours,
        activityLogId: ledger.activityLogId,
        voidedAt: ledger.voidedAt,
      })
      .from(ledger)
      .where(eq(ledger.id, target.id))
      .get();

    if (row === undefined) {
      throw new Error(`there is no ledger row ${target.id}`);
    }

    // One place per fact: the log is what the engine reads.
    if (row.activityLogId !== null) {
      return voidLog(tx, row.activityLogId, adminId, now);
    }

    if (row.voidedAt !== null) {
      throw new RefusalError("Esta movimentação já foi anulada.");
    }

    tx.update(ledger)
      .set({ voidedAt: now, voidedBy: adminId })
      .where(eq(ledger.id, target.id))
      .run();

    return {
      userId: row.userId,
      balanceChange: row.kind === "spend" ? row.hours : -row.hours,
    };
  });
}

function voidLog(
  tx: Transaction,
  logId: number,
  adminId: number,
  now: Date,
): Voided {
  const log = tx
    .select({
      userId: activityLogs.userId,
      status: activityLogs.status,
      voidedAt: activityLogs.voidedAt,
    })
    .from(activityLogs)
    .where(eq(activityLogs.id, logId))
    .get();

  if (log === undefined) {
    throw new Error(`there is no activity log ${logId}`);
  }

  // Pending is decided in the queue, and a refusal already moved nothing (D19).
  if (log.status !== "approved") {
    throw new Error(`activity log ${logId} is ${log.status}, not approved`);
  }

  if (log.voidedAt !== null) {
    throw new RefusalError(`A entrada ${logId} já foi anulada.`);
  }

  const credited = tx
    .select({ hours: ledger.hours })
    .from(ledger)
    .where(eq(ledger.activityLogId, logId))
    .get();

  tx.update(activityLogs)
    .set({ voidedAt: now, voidedBy: adminId })
    .where(eq(activityLogs.id, logId))
    .run();

  // D10: a zero has no ledger row, and voiding it moves no hours.
  return { userId: log.userId, balanceChange: -(credited?.hours ?? 0) };
}
