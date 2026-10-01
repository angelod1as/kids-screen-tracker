"use server";

import { requireAccess } from "../../auth/guard";
import { getConnection, getDb } from "../../db";
import type { HoursMinutes } from "../../db/input";
import { hoursFromTime, requireHours } from "../../db/input";
import type { Refund, Release } from "../../db/ledger";
import { refundHours, releaseHours } from "../../db/ledger";
import { requireActiveKid } from "../../db/people";
import { fetchBalanceAction } from "./balance";

/** `write` (#13): refused to a kid whichever boy's id the request carries. */

export type Movement = {
  hours: number;
  /** May be negative, without limit (#23). */
  balance: number;
};

/** #48: typed as hours and minutes; converted here, at the edge. */
export type ReleaseRequest = Omit<Release, "hours"> & { time: HoursMinutes };

export type RefundRequest = Omit<Refund, "hours"> & { time: HoursMinutes };

/** What the confirmation shows (D53). */
export type MovementPreview = {
  displayName: string;
  hours: number;
  before: number;
  after: number;
};

export async function releaseHoursAction({
  time,
  ...release
}: ReleaseRequest): Promise<Movement> {
  const session = await requireAccess({
    kind: "write",
    targetUserId: release.userId,
  });

  const { hours } = releaseHours(
    getConnection(),
    { ...release, hours: hoursFromTime(time, "what is released") },
    session.userId,
    new Date(),
  );

  return { hours, balance: await fetchBalanceAction(release.userId) };
}

export async function refundHoursAction({
  time,
  ...refund
}: RefundRequest): Promise<Movement> {
  const session = await requireAccess({
    kind: "write",
    targetUserId: refund.userId,
  });

  const { hours } = refundHours(
    getConnection(),
    { ...refund, hours: hoursFromTime(time, "what is refunded") },
    session.userId,
    new Date(),
  );

  return { hours, balance: await fetchBalanceAction(refund.userId) };
}

/**
 * D53: both balances read now, on the server, and nothing written. The hours
 * are rounded as the write rounds them; the other fields are the write's to refuse.
 */
async function previewMovement(
  userId: number,
  signedHours: number,
): Promise<MovementPreview> {
  const { displayName } = requireActiveKid(getDb(), userId);
  const before = await fetchBalanceAction(userId);

  return {
    displayName,
    hours: Math.abs(signedHours),
    before,
    after: Math.round((before + signedHours) * 100) / 100,
  };
}

export async function previewReleaseAction(
  release: ReleaseRequest,
): Promise<MovementPreview> {
  await requireAccess({ kind: "write", targetUserId: release.userId });

  return previewMovement(
    release.userId,
    -requireHours(
      hoursFromTime(release.time, "what is released"),
      "what is released",
    ),
  );
}

export async function previewRefundAction(
  refund: RefundRequest,
): Promise<MovementPreview> {
  await requireAccess({ kind: "write", targetUserId: refund.userId });

  return previewMovement(
    refund.userId,
    requireHours(
      hoursFromTime(refund.time, "what is refunded"),
      "what is refunded",
    ),
  );
}
