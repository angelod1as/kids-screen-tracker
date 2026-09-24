"use server";

import { requireAccess } from "../../auth/guard";
import { getConnection } from "../../db";
import type { Refund, Release } from "../../db/ledger";
import { refundHours, releaseHours } from "../../db/ledger";
import { fetchBalanceAction } from "./balance";

/** `write` (#13): refused to a kid whichever boy's id the request carries. */

export type Movement = {
  hours: number;
  /** May be negative, without limit (#23). */
  balance: number;
};

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
