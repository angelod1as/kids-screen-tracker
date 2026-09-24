"use server";

import { and, desc, eq } from "drizzle-orm";

import { requireAccess } from "../../auth/guard";
import { getDb } from "../../db";
import { rejectionReason } from "../../db/queue";
import { activities, activityLogs, ledger } from "../../db/schema";
import { HISTORY_LIMIT } from "../../ui/entries";

/**
 * One line of the extract, ready to draw (#16).
 *
 * `label` is "atividade ou destino" already resolved, because which of the two
 * it is depends on the `kind` and on three tables, and a screen that joins is a
 * screen that can join differently from the next one. The list on the home
 * screen (#15) and the full history (#16) are the same five columns, so they
 * are the same query with a different limit.
 */
export type LedgerEntry = {
  id: number;
  kind: "earn" | "spend" | "refund";
  hours: number;
  /** D13: `YYYY-MM-DD`. Never a timestamp. */
  occurredOn: string;
  label: string;
};

/**
 * An entry an adult refused, as the boy's history shows it (#72).
 *
 * It is not a ledger row and never will be: D19 says a rejected entry creates
 * nothing, counts for nothing and stays in `activity_logs` as the record of the
 * refusal. So it comes from the other table, carries no hours at all, and is a
 * separate member of the union rather than a fourth `kind` of `LedgerEntry` —
 * `signedHours` must not have an answer for it.
 *
 * `reason` is what the adult wrote, or null when he refused without writing
 * anything, which #20 makes a normal thing to do. Null is drawn as nothing:
 * the row already says it was refused, and a sentence invented here would be
 * the app putting words in the adult's mouth.
 */
export type RejectedEntry = {
  id: number;
  kind: "rejected";
  /** D13: `YYYY-MM-DD`. Never a timestamp. */
  occurredOn: string;
  /** The activity, which D14 keeps readable even after it is switched off. */
  label: string;
  durationMinutes: number | null;
  reason: string | null;
};

/** One line of the history screen: something that moved the balance, or a refusal. */
export type HistoryEntry = LedgerEntry | RejectedEntry;

/**
 * Where a row goes in the list: the canonical order of D8, read backwards.
 *
 * The two tables are ordered against each other and not merely concatenated,
 * because a refusal belongs on the day it happened and not at the end of the
 * list. `id` is the last resort and compares ids from two different tables,
 * which is meaningless as a fact but is what keeps the order of a tie stable
 * between two visits — the property #16 asks for.
 */
type Placed<Entry> = {
  occurredOn: string;
  createdAt: number;
  id: number;
  entry: Entry;
};

/**
 * What is written on the label of an entry that names nothing else.
 *
 * `destination` is nullable and an `earn` row can have no activity behind it
 * (D10 keeps the zero-graded delivery out of the ledger, but an admin's manual
 * credit has no log either). An empty cell would read as a rendering bug, and
 * repeating the kind would not add anything: `EntryList` already writes
 * "Ganho", "Gasto" or "Estorno" beside the date on every row.
 *
 * It is the last resort of three and not of two, because a refund carries its
 * reason in `note` (#24) — see the label below.
 */
const NO_LABEL = "Sem descrição";

/**
 * Somebody's ledger, most recent first.
 *
 * The order is the reverse of D8's canonical `(occurred_on, created_at, id)`,
 * which matters for more than tidiness: two entries on the same day have no
 * other order, and a list whose rows swap between two visits is a list a boy
 * stops believing. Reversing the canonical order is also the order the entries
 * were credited in, read backwards.
 *
 * "Não vaza nenhum dado do outro menino" (#16) is two things here, and the
 * screen is neither of them. The `where` is on `targetUserId`, so the other
 * boy's rows are not in the answer; and `requireAccess` refuses the request
 * before the query runs, so a POST carrying the brother's id gets an error and
 * not a list. `history.test.ts` sends that request.
 */
export async function fetchLedgerEntriesAction(
  targetUserId: number,
  limit: number,
): Promise<LedgerEntry[]> {
  await requireAccess({ kind: "view", targetUserId });
  requireLimit(limit);

  return ledgerEntries(targetUserId, limit).map((placed) => placed.entry);
}

/**
 * The history screen's list: the ledger and the refusals, in one order (#72).
 *
 * Its own endpoint rather than a flag on the one above, because the two
 * screens are asking different questions. The boy's home shows the last five
 * things that moved his balance (#15); the history shows what happened,
 * and what happened includes the afternoon an adult said no to. A flag would
 * have made the home screen one argument away from answering the other
 * question.
 *
 * The guard is the same guard and it is the one that matters: this is a POST
 * endpoint taking a number, so `/admin/historico/4` is not what keeps Kid1
 * out of Kid2's history — `requireAccess` is, and `history.test.ts` sends the
 * forged call.
 *
 * `limit` bounds each side and then the merge, so the answer is the most recent
 * `limit` rows of the two tables together and never twice that.
 */
export async function fetchHistoryAction(
  targetUserId: number,
  limit: number,
): Promise<HistoryEntry[]> {
  await requireAccess({ kind: "view", targetUserId });
  requireLimit(limit);

  const rows: Placed<HistoryEntry>[] = [
    ...ledgerEntries(targetUserId, limit),
    ...rejectedEntries(targetUserId, limit),
  ];

  return rows
    .sort(newestFirst)
    .slice(0, limit)
    .map((placed) => placed.entry);
}

/** D8 read backwards: most recent first, and the same order on every visit. */
function newestFirst(
  left: Placed<HistoryEntry>,
  right: Placed<HistoryEntry>,
): number {
  if (left.occurredOn !== right.occurredOn) {
    return left.occurredOn < right.occurredOn ? 1 : -1;
  }

  if (left.createdAt !== right.createdAt) {
    return right.createdAt - left.createdAt;
  }

  return right.id - left.id;
}

/**
 * The ledger half of the list.
 *
 * Not exported: every export of a `"use server"` file is an endpoint, and this
 * one checks nothing.
 */
function ledgerEntries(
  targetUserId: number,
  limit: number,
): Placed<LedgerEntry>[] {
  const rows = getDb()
    .select({
      id: ledger.id,
      kind: ledger.kind,
      hours: ledger.hours,
      occurredOn: ledger.occurredOn,
      destination: ledger.destination,
      note: ledger.note,
      createdAt: ledger.createdAt,
      activityName: activities.name,
    })
    .from(ledger)
    // Left joins throughout: `activity_log_id` is null on every `spend` and
    // `refund` (D10), and an inner join would drop exactly the rows #16 calls
    // "gasto".
    .leftJoin(activityLogs, eq(ledger.activityLogId, activityLogs.id))
    .leftJoin(activities, eq(activityLogs.activityId, activities.id))
    .where(eq(ledger.userId, targetUserId))
    .orderBy(desc(ledger.occurredOn), desc(ledger.createdAt), desc(ledger.id))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    occurredOn: row.occurredOn,
    createdAt: row.createdAt.getTime(),
    id: row.id,
    entry: {
      id: row.id,
      kind: row.kind,
      hours: row.hours,
      occurredOn: row.occurredOn,
      // The activity first, because an `earn` that came from a log is the one
      // case where both could be filled in and the activity is what was actually
      // done. D14 is why this still reads: the activity was deactivated, not
      // deleted, so a log from three months ago still knows where it came from.
      //
      // Then the destination, and then the reason — which is what names a refund
      // (#24). A refund has no activity and no destination: what it has is why
      // the hours came back, and a row reading "Sem descrição" beside "Estorno"
      // would be the app declining to answer the only question that row raises.
      label: row.activityName ?? row.destination ?? row.note ?? NO_LABEL,
    },
  }));
}

/**
 * The refusals half of the list (#72, D19).
 *
 * `status = 'rejected'` and nothing else: an entry still waiting is not history
 * yet, and an approved one is already in the ledger under the hours it paid.
 * The join is an inner join and can be — a log always names an activity, and
 * D14 keeps that row readable after the activity is switched off.
 */
function rejectedEntries(
  targetUserId: number,
  limit: number,
): Placed<RejectedEntry>[] {
  const rows = getDb()
    .select({
      id: activityLogs.id,
      occurredOn: activityLogs.occurredOn,
      durationMinutes: activityLogs.durationMinutes,
      note: activityLogs.note,
      createdAt: activityLogs.createdAt,
      activityName: activities.name,
    })
    .from(activityLogs)
    .innerJoin(activities, eq(activityLogs.activityId, activities.id))
    .where(
      and(
        eq(activityLogs.userId, targetUserId),
        eq(activityLogs.status, "rejected"),
      ),
    )
    .orderBy(
      desc(activityLogs.occurredOn),
      desc(activityLogs.createdAt),
      desc(activityLogs.id),
    )
    .limit(limit)
    .all();

  return rows.map((row) => ({
    occurredOn: row.occurredOn,
    createdAt: row.createdAt.getTime(),
    id: row.id,
    entry: {
      id: row.id,
      kind: "rejected" as const,
      occurredOn: row.occurredOn,
      label: row.activityName,
      durationMinutes: row.durationMinutes,
      // The boy's own note stays out: what #72 asks for is the sentence the
      // adult wrote, and the rest of the column is what the boy already knows
      // he typed.
      reason: rejectionReason(row.note),
    },
  }));
}

/**
 * The ceiling is a ceiling, including for a request nobody's screen sent.
 *
 * SQLite reads a negative `LIMIT` as "no limit", so a forged
 * `fetchLedgerEntriesAction(id, -1)` came back with the whole ledger — measured.
 * The `where` is still on `targetUserId`, so it was never a way to read the
 * other boy's rows; it was the one bound on the size of the answer quietly
 * ceasing to be one for anybody not using the screen.
 *
 * It throws rather than clamping, for the same reason the engine throws on a
 * missing duration: every value outside `1..HISTORY_LIMIT` is a call-site bug,
 * never something a boy can type, and a silently clamped 500 is a caller that
 * believes it asked for 500.
 */
function requireLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_LIMIT) {
    throw new Error(
      `a ledger page is between 1 and ${HISTORY_LIMIT} entries, received ${limit}`,
    );
  }
}
