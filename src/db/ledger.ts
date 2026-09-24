import { saoPauloDay } from "../engine/day";
import type { Connection } from "./client";
import { writeTransaction } from "./client";
import { requireCalendarDay, requireHours, requireText } from "./input";
import { requireActiveKid } from "./people";
import { ledger } from "./schema";

/**
 * The two movements an adult writes straight into the ledger: releasing hours
 * onto the devices (#23) and giving them back (#24).
 *
 * Neither touches the calculation engine, and that is the difference between
 * this module and `./admin.ts` next to it. A launch is priced — it reads the
 * day it happened, the bucket, the cooldown — and everything delicate about it
 * is in that pricing. These two are not priced at all: the adult says how many
 * hours, and the row says how many hours. What they need instead is the same
 * three questions asked of everything an adult types (`./input.ts`) and the
 * same guard on who it is being written for (`./people.ts`).
 *
 * The sign lives in `kind`, never in the column: `ledger_hours_check` is `> 0`
 * exclusive, so `hours` is always positive and `spend` is what makes it
 * subtract. `fetchBalanceAction` and the extract on the boy's screen read the
 * sign the same way, off the same column, which is what keeps the list under
 * the balance adding up to the balance.
 */

/** What an adult is releasing onto the devices (#23). */
export type Release = {
  userId: number;
  hours: number;
  /** Free text: "WhatsApp", "Xbox", "TV". Optional. */
  destination?: string | null;
};

/** What an adult is giving back (#24). */
export type Refund = {
  userId: number;
  hours: number;
  /** D13: `YYYY-MM-DD`. The day the refund is credited to. */
  occurredOn: string;
  /** Why. Required: a refund with no reason is a number nobody can explain. */
  reason: string;
};

// ---------------------------------------------------------------------------
// #23 — releasing hours onto the devices
// ---------------------------------------------------------------------------

/**
 * Debits hours the adult has just turned on somewhere (#23).
 *
 * **The balance may go below zero, without limit**, which is the one thing this
 * function is careful not to do: there is no read of the balance here, and
 * therefore nothing to compare against. An adult who releases three hours to a
 * boy who has one is describing something that happened on a console; refusing
 * it would make the app disagree with the world it is the record of, and the
 * boy's screen already draws a negative balance in the one colour it is allowed
 * to spend on it.
 *
 * The day is today (D13) and not a date the adult types: a release is the adult
 * saying what he is doing now, at the device, and #23 asks for a quantity and a
 * destination and nothing else.
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
        // The column is always positive and `kind` carries the sign, which is
        // how `fetchBalanceAction` and the extract both read it.
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

// ---------------------------------------------------------------------------
// #24 — refunding hours
// ---------------------------------------------------------------------------

/**
 * Gives hours back (#24).
 *
 * A `refund` row: it adds to the balance exactly as an `earn` does — the sign
 * lives in `kind`, and `signedHours` and `fetchBalanceAction` are the two
 * places that read it — and the extract names it "Estorno" so the boy can tell
 * the two apart on the screen where both appear.
 *
 * It carries a date, unlike a release, because a refund is about something that
 * already happened: the console was down all Saturday, so Saturday's hours come
 * back. The reason is required for the same purpose — a movement in the ledger
 * that nobody can explain is the one thing that costs the app its credibility.
 */
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
