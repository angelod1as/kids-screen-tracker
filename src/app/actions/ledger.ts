"use server";

import { eq } from "drizzle-orm";

import { requireAccess } from "../../auth/guard";
import { getConnection, getDb } from "../../db";
import { requireHours } from "../../db/input";
import type { Refund, Release } from "../../db/ledger";
import { refundHours, releaseHours } from "../../db/ledger";
import { requireActiveKid } from "../../db/people";
import { users } from "../../db/schema";
import { fetchBalanceAction } from "./balance";

/** `write` (#13): refused to a kid whichever boy's id the request carries. */

export type Movement = {
  hours: number;
  /** May be negative, without limit (#23). */
  balance: number;
};

/** What the confirmation shows (D52). */
export type MovementPreview = {
  displayName: string;
  hours: number;
  before: number;
  after: number;
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

/**
 * D52: both balances read now, on the server, and nothing written. The hours
 * are rounded as the write rounds them; the other fields are the write's to refuse.
 */
async function previewMovement(
  userId: number,
  signedHours: number,
): Promise<MovementPreview> {
  const db = getDb();

  requireActiveKid(db, userId);

  const { displayName } = db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .get() ?? { displayName: "" };
  const before = await fetchBalanceAction(userId);

  return {
    displayName,
    hours: Math.abs(signedHours),
    before,
    after: Math.round((before + signedHours) * 100) / 100,
  };
}

export async function previewReleaseAction(
  release: Release,
): Promise<MovementPreview> {
  await requireAccess({ kind: "write", targetUserId: release.userId });

  return previewMovement(
    release.userId,
    -requireHours(release.hours, "what is released"),
  );
}

export async function previewRefundAction(
  refund: Refund,
): Promise<MovementPreview> {
  await requireAccess({ kind: "write", targetUserId: refund.userId });

  return previewMovement(
    refund.userId,
    requireHours(refund.hours, "what is refunded"),
  );
}
