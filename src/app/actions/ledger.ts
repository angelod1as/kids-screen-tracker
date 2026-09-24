"use server";

import { requireAccess } from "../../auth/guard";
import { getConnection } from "../../db";
import type { Refund, Release } from "../../db/ledger";
import { refundHours, releaseHours } from "../../db/ledger";
import { fetchBalanceAction } from "./balance";

/**
 * The two movements an adult writes straight into the ledger (#23, #24).
 *
 * **Both are admin-only, and the guard names the boy.** `write` is the kind #13
 * created for this list — "aprovar, lançar, liberar, estornar,
 * configuração" — and `isAllowed` gives it to nobody but an admin, whichever
 * boy's id the request carries. `ledger.test.ts` sends both forged requests.
 *
 * Each answers with the balance the movement left behind, so the screen says
 * what the adult is about to act on at the device without a second round trip.
 * It may be below zero, without limit (#23).
 */

/** What the screen shows after a movement lands (#23, #24). */
export type Movement = {
  hours: number;
  /** The boy's balance once the movement is in. May be negative (#23). */
  balance: number;
};

/**
 * Debits what the adult has just turned on somewhere (#23).
 *
 * The balance comes back with it because the screen says what the balance now
 * is, and it is the number the adult is about to act on at the device. It may
 * be below zero, without limit.
 */
export async function releaseHoursAction(release: Release): Promise<Movement> {
  const session = await requireAccess({
    kind: "write",
    targetUserId: release.userId,
  });

  const { hours } = releaseHours(
    getConnection(),
    release,
    session.userId,
    new Date(),
  );

  return { hours, balance: await fetchBalanceAction(release.userId) };
}

/** Gives hours back, with the day and the reason they are coming back (#24). */
export async function refundHoursAction(refund: Refund): Promise<Movement> {
  const session = await requireAccess({
    kind: "write",
    targetUserId: refund.userId,
  });

  const { hours } = refundHours(
    getConnection(),
    refund,
    session.userId,
    new Date(),
  );

  return { hours, balance: await fetchBalanceAction(refund.userId) };
}
