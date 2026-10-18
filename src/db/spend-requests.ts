import { and, asc, eq } from "drizzle-orm";

import { saoPauloDay } from "../engine/day";
import type { Connection } from "./client";
import { writeTransaction } from "./client";
import { requireHours, requireString, requireText } from "./input";
import { requireActiveKid } from "./people";
import { ledger, spendRequests, users } from "./schema";

/**
 * D58: the boy's own request to spend screen time. Born pending, only for
 * himself (D33); on approval it writes the `ledger` spend and debits (D58). Not
 * an activity: no engine, no bucket, no window — closer to a queued Tirar.
 */

/** What the boy sends. Hours already come from `{hours, minutes}` (#48). */
export type SpendRequestInput = {
  hours: number;
  destination: string;
  note?: string | null;
};

/** One pending request as the queue offers it. */
export type PendingSpendRequest = {
  id: number;
  userId: number;
  userName: string;
  hours: number;
  destination: string;
  note: string | null;
  createdAt: Date;
};

/** The adult may change the amount on approval; nothing else is editable (D58). */
export type SpendRequestEdits = {
  hours?: number;
};

export function requestSpend(
  connection: Connection,
  userId: number,
  request: SpendRequestInput,
  now: Date,
): { requestId: number } {
  const hours = requireHours(request.hours, "the time requested");

  requireString(request.destination, "a destination");
  const destination = request.destination.trim();
  requireText(destination, "a destination");
  if (destination === "") {
    throw new Error("a spend request needs a destination (D58)");
  }

  const note = request.note == null ? null : request.note.trim();
  requireText(note, "a note");

  return writeTransaction(connection, (tx) => {
    requireActiveKid(tx, userId);

    const written = tx
      .insert(spendRequests)
      .values({
        userId,
        hours,
        destination,
        note: note === "" ? null : note,
        status: "pending",
        createdBy: userId,
        createdAt: now,
      })
      .returning({ id: spendRequests.id })
      .get();

    return { requestId: written.id };
  });
}

/** Pending requests with the boy's name, oldest first (the decide-first order). */
export function listPendingSpendRequests(
  connection: Connection,
): PendingSpendRequest[] {
  return connection.db
    .select({
      id: spendRequests.id,
      userId: spendRequests.userId,
      userName: users.displayName,
      hours: spendRequests.hours,
      destination: spendRequests.destination,
      note: spendRequests.note,
      createdAt: spendRequests.createdAt,
    })
    .from(spendRequests)
    .innerJoin(users, eq(spendRequests.userId, users.id))
    .where(eq(spendRequests.status, "pending"))
    .orderBy(asc(spendRequests.createdAt), asc(spendRequests.id))
    .all();
}

/** One pending request, for the approval preview (the resulting balance). */
export function pendingSpendRequest(
  connection: Connection,
  requestId: number,
): PendingSpendRequest | undefined {
  return connection.db
    .select({
      id: spendRequests.id,
      userId: spendRequests.userId,
      userName: users.displayName,
      hours: spendRequests.hours,
      destination: spendRequests.destination,
      note: spendRequests.note,
      createdAt: spendRequests.createdAt,
    })
    .from(spendRequests)
    .innerJoin(users, eq(spendRequests.userId, users.id))
    .where(
      and(eq(spendRequests.id, requestId), eq(spendRequests.status, "pending")),
    )
    .get();
}

/** The pending row, or a refusal naming it as the queue does (D32's manner). */
function takePending(
  tx: Parameters<Parameters<Connection["db"]["transaction"]>[0]>[0],
  requestId: number,
) {
  const request = tx
    .select()
    .from(spendRequests)
    .where(
      and(eq(spendRequests.id, requestId), eq(spendRequests.status, "pending")),
    )
    .get();

  if (request === undefined) {
    throw new Error(`there is no pending spend request ${requestId}`);
  }

  return request;
}

/**
 * Approving writes the `ledger` spend in the same transaction and links it back
 * (D58). The day is today (D13), as in Tirar: the time is used now. The adult
 * is the responsible name (`created_by`), the boy the requester (D50 emenda).
 */
export function approveSpendRequest(
  connection: Connection,
  requestId: number,
  reviewerId: number,
  edits: SpendRequestEdits,
  now: Date,
): { userId: number; hours: number; occurredOn: string } {
  const edited =
    edits.hours === undefined
      ? undefined
      : requireHours(edits.hours, "the time approved");

  const occurredOn = saoPauloDay(now);

  return writeTransaction(connection, (tx) => {
    const request = takePending(tx, requestId);
    requireActiveKid(tx, request.userId);

    const hours = edited ?? request.hours;

    const spend = tx
      .insert(ledger)
      .values({
        userId: request.userId,
        kind: "spend",
        hours,
        occurredOn,
        destination: request.destination,
        note: request.note,
        createdBy: reviewerId,
        createdAt: now,
      })
      .returning({ id: ledger.id })
      .get();

    tx.update(spendRequests)
      .set({
        status: "approved",
        ledgerId: spend.id,
        reviewedBy: reviewerId,
        reviewedAt: now,
      })
      .where(eq(spendRequests.id, requestId))
      .run();

    return { userId: request.userId, hours, occurredOn };
  });
}

/** D19: no ledger row, nothing moves. */
export function rejectSpendRequest(
  connection: Connection,
  requestId: number,
  reviewerId: number,
  now: Date,
): void {
  writeTransaction(connection, (tx) => {
    takePending(tx, requestId);

    tx.update(spendRequests)
      .set({
        status: "rejected",
        reviewedBy: reviewerId,
        reviewedAt: now,
      })
      .where(eq(spendRequests.id, requestId))
      .run();
  });
}
