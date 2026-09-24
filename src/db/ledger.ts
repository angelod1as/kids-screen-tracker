import { saoPauloDay } from "../engine/day";
import type { Connection } from "./client";
import { writeTransaction } from "./client";
import { requireCalendarDay, requireHours, requireText } from "./input";
import { requireActiveKid } from "./people";
import { ledger } from "./schema";

/**
 * Releasing (#23) and refunding (#24): unpriced, the adult's number is the
 * row's. `hours` is always positive; `kind` carries the sign.
 */

/** #23. */
export type Release = {
  userId: number;
  hours: number;
  /** Optional. */
  destination?: string | null;
};

/** #24. */
export type Refund = {
  userId: number;
  hours: number;
  /** D13: the day the refund is credited to. */
  occurredOn: string;
  /** Required: a refund nobody can explain costs the app its credibility. */
  reason: string;
};

/**
 * #23. No balance read: it may go below zero without limit. The day is today
 * (D13): a release is what the adult is doing now, at the device.
 */
export function releaseHours(
  connection: Connection,
  release: Release,
  adminId: number,
  now: Date,
): { hours: number; occurredOn: string } {
  const hours = requireHours(release.hours, "what is released");
  const destination =
    release.destination === undefined || release.destination === null
      ? null
      : release.destination.trim();

  requireText(destination, "a destination");

  const occurredOn = saoPauloDay(now);

  return writeTransaction(connection, (tx) => {
    requireActiveKid(tx, release.userId);

    tx.insert(ledger)
      .values({
        userId: release.userId,
        kind: "spend",
        hours,
        occurredOn,
        destination: destination === "" ? null : destination,
        createdBy: adminId,
        createdAt: now,
      })
      .run();

    return { hours, occurredOn };
  });
}

/** #24. Dated, unlike a release: it is about something that already happened. */
export function refundHours(
  connection: Connection,
  refund: Refund,
  adminId: number,
  now: Date,
): { hours: number } {
  const hours = requireHours(refund.hours, "what is refunded");
  const reason = refund.reason.trim();

  requireCalendarDay(refund.occurredOn, saoPauloDay(now));
  requireText(reason, "a reason");

  if (reason === "") {
    throw new Error("a refund needs a reason");
  }

  return writeTransaction(connection, (tx) => {
    requireActiveKid(tx, refund.userId);

    tx.insert(ledger)
      .values({
        userId: refund.userId,
        kind: "refund",
        hours,
        occurredOn: refund.occurredOn,
        note: reason,
        createdBy: adminId,
        createdAt: now,
      })
      .run();

    return { hours };
  });
}
