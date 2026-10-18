"use server";

import { requireAccess, requireAdmin } from "../../auth/guard";
import { getConnection, getDb } from "../../db";
import type { HoursMinutes } from "../../db/input";
import { hoursFromTime, requireHours } from "../../db/input";
import { requireActiveKid } from "../../db/people";
import type { PendingSpendRequest } from "../../db/spend-requests";
import {
  approveSpendRequest,
  countPendingSpendRequests,
  listPendingSpendRequests,
  pendingSpendRequest,
  rejectSpendRequest,
  requestSpend,
} from "../../db/spend-requests";
import { notifySpendRequested, notifySpendReviewed } from "../../push/notify";
import { fetchBalanceAction } from "./balance";
import type { Movement, MovementPreview } from "./ledger";

/**
 * D58: the boy's third write and its admin decision. Hours arrive as hours and
 * minutes (#48) and are converted here, at the edge; the id of the boy never
 * comes from the caller on a kid write — the guard refuses a forged target.
 */

/** #48: typed as hours and minutes; converted at the edge. */
export type SpendRequestEntry = {
  time: HoursMinutes;
  destination: string;
  note?: string | null;
};

/** The boy's third write (D58): refused for any id but his own. */
export async function requestSpendAction(
  targetUserId: number,
  { time, ...request }: SpendRequestEntry,
): Promise<void> {
  await requireAccess({ kind: "requestSpend", targetUserId });

  const connection = getConnection();

  const { requestId } = requestSpend(
    connection,
    targetUserId,
    { ...request, hours: hoursFromTime(time, "the time requested") },
    new Date(),
  );
  // D51 emenda: a reminder, not awaited, and it never rejects.
  void notifySpendRequested(connection, requestId);
}

export async function fetchSpendRequestsAction(): Promise<
  PendingSpendRequest[]
> {
  await requireAdmin();

  return listPendingSpendRequests(getConnection());
}

/** Its own endpoint, beside `countPendingLogsAction`: the home sums the two. */
export async function countPendingSpendRequestsAction(): Promise<number> {
  await requireAdmin();

  return countPendingSpendRequests(getConnection());
}

/** #48: the adult's corrected amount, if any, as hours and minutes (D58). */
export type SpendApproval = { time?: HoursMinutes };

export async function approveSpendRequestAction(
  requestId: number,
  { time }: SpendApproval = {},
): Promise<Movement> {
  const session = await requireAdmin();
  const connection = getConnection();

  const { userId, hours } = approveSpendRequest(
    connection,
    requestId,
    session.userId,
    time === undefined
      ? {}
      : { hours: hoursFromTime(time, "the time approved") },
    new Date(),
  );
  void notifySpendReviewed(connection, requestId);

  return { hours, balance: await fetchBalanceAction(userId) };
}

const MAX_REASON_LENGTH = 500;

export async function rejectSpendRequestAction(
  requestId: number,
  reason = "",
): Promise<void> {
  const session = await requireAdmin();
  const connection = getConnection();

  const trimmed = reason.trim();
  if (trimmed.length > MAX_REASON_LENGTH) {
    throw new Error(
      `a reason is at most ${MAX_REASON_LENGTH} characters, received ${trimmed.length}`,
    );
  }

  rejectSpendRequest(
    connection,
    requestId,
    session.userId,
    trimmed === "" ? null : trimmed,
    new Date(),
  );
  void notifySpendReviewed(connection, requestId);
}

/**
 * D53's manner: both balances read now, on the server, nothing written. The
 * adult sees the balance go red (D42) before confirming (D58, Q2 of the grill).
 */
export type SpendApprovalPreview = MovementPreview & { destination: string };

export async function previewSpendApprovalAction(
  requestId: number,
  { time }: SpendApproval = {},
): Promise<SpendApprovalPreview> {
  await requireAdmin();

  const request = pendingSpendRequest(getConnection(), requestId);
  if (request === undefined) {
    throw new Error(`there is no pending spend request ${requestId}`);
  }

  const { displayName } = requireActiveKid(getDb(), request.userId);
  const hours =
    time === undefined
      ? request.hours
      : requireHours(
          hoursFromTime(time, "the time approved"),
          "the time approved",
        );
  const before = await fetchBalanceAction(request.userId);

  return {
    displayName,
    destination: request.destination,
    hours,
    before,
    after: Math.round((before - hours) * 100) / 100,
  };
}
