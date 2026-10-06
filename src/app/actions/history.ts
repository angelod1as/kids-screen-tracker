"use server";

import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { requireAccess } from "../../auth/guard";
import { getDb } from "../../db";
import { rejectionReason } from "../../db/queue";
import { activities, activityLogs, ledger, users } from "../../db/schema";
import { saoPauloDay } from "../../engine/day";
import { HISTORY_LIMIT, MAX_HISTORY_DAYS } from "../../ui/entries";

/** `label` is resolved here so no two screens join the three tables differently. */
export type LedgerEntry = {
  id: number;
  kind: "earn" | "spend" | "refund";
  hours: number;
  /** D13: `YYYY-MM-DD`. Never a timestamp. */
  occurredOn: string;
  label: string;
  /** D50: null when the rule priced it. */
  override: AdultValue | null;
  /** D52: null while it counts. */
  voided: VoidMark | null;
  /** Who approved it (emenda à D50). Null on a spend or refund, which has no log. */
  decidedBy: string | null;
};

/** D52: shown, not hidden, so the boy can see why the balance moved. */
export type VoidMark = {
  /** D13: the São Paulo day it was voided. */
  on: string;
  by: string;
};

/** D50: what the boy is told about a value an adult decided. */
export type AdultValue = {
  /** What the rule would have paid; null where it could not price the entry. */
  ruleHours: number | null;
  reason: string | null;
};

/**
 * A separate member, not a fourth `kind`: a refusal moves no hours (D19), so
 * `signedHours` must have no answer for it. A null `reason` is drawn as nothing.
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
  /** Who refused it (emenda à D50). */
  decidedBy: string | null;
};

/** D10: an approved zero has no ledger row, so it is read off the log, like a refusal. */
export type ZeroEntry = {
  id: number;
  kind: "zero";
  /** D13: `YYYY-MM-DD`. Never a timestamp. */
  occurredOn: string;
  label: string;
  override: AdultValue | null;
  voided: VoidMark | null;
  /** Who approved it (emenda à D50). */
  decidedBy: string | null;
};

export type HistoryEntry = LedgerEntry | RejectedEntry | ZeroEntry;

/** Refusals are sorted into the ledger by D8's key; `id` across two tables is only a stable tiebreak. */
type Placed<Entry> = {
  occurredOn: string;
  createdAt: number;
  id: number;
  entry: Entry;
};

/** Last resort after activity, destination and a refund's note: an empty cell reads as a rendering bug. */
const NO_LABEL = "Sem descrição";

/**
 * D8 read backwards, so same-day rows never swap between visits. `requireAccess`
 * refuses the brother's id before the query runs.
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
 * Its own endpoint, not a flag, so the home screen (#15) is never one argument
 * away from showing refusals. `limit` bounds each side and the merge.
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
    ...zeroEntries(targetUserId, limit),
  ];

  return rows
    .sort(newestFirst)
    .slice(0, limit)
    .map((placed) => placed.entry);
}

/** One page of the history screen (#64): `days` counts days with an entry, not calendar days. */
export type HistoryDays = {
  entries: HistoryEntry[];
  /** An older day with an entry exists beyond the window. */
  more: boolean;
};

/**
 * #64: the newest `days` days that have an entry, so an empty day costs the
 * boy no tap. Paged in SQL; nothing older than the window leaves the database.
 */
export async function fetchHistoryDaysAction(
  targetUserId: number,
  days: number,
): Promise<HistoryDays> {
  await requireAccess({ kind: "view", targetUserId });
  requireDays(days);

  const found = entryDays(targetUserId, days + 1);
  const since = found.slice(0, days).at(-1);

  if (since === undefined) {
    return { entries: [], more: false };
  }

  const rows: Placed<HistoryEntry>[] = [
    ...ledgerEntries(targetUserId, HISTORY_LIMIT, since),
    ...rejectedEntries(targetUserId, HISTORY_LIMIT, since),
    ...zeroEntries(targetUserId, HISTORY_LIMIT, since),
  ];

  return {
    entries: rows
      .sort(newestFirst)
      .slice(0, HISTORY_LIMIT)
      .map((placed) => placed.entry),
    more: found.length > days,
  };
}

/** The same three sources as the history, reduced to their days, newest first. D13: text compares as dates. */
function entryDays(targetUserId: number, limit: number): string[] {
  const db = getDb();
  const ledgerDays = db
    .select({ day: ledger.occurredOn })
    .from(ledger)
    .where(eq(ledger.userId, targetUserId));
  const logDays = db
    .select({ day: activityLogs.occurredOn })
    .from(activityLogs)
    .where(
      and(
        eq(activityLogs.userId, targetUserId),
        or(
          eq(activityLogs.status, "rejected"),
          and(
            eq(activityLogs.status, "approved"),
            eq(activityLogs.computedHours, 0),
          ),
        ),
      ),
    );

  return ledgerDays
    .union(logDays)
    .orderBy(sql`1 desc`)
    .limit(limit)
    .all()
    .map((row) => row.day);
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

/** Not exported: every export of a `"use server"` file is an endpoint, and this one checks nothing. */
function ledgerEntries(
  targetUserId: number,
  limit: number,
  since?: string,
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
      ...ADULT_VALUE_COLUMNS,
      // D52: an activity is voided on its log, a movement on its own row.
      voidedAt: sql<
        number | null
      >`coalesce(${ledger.voidedAt}, ${activityLogs.voidedAt})`,
      voidedBy: voider.displayName,
      reviewedBy: reviewer.displayName,
    })
    .from(ledger)
    // Left joins: `activity_log_id` is null on every `spend` and `refund` (D10).
    .leftJoin(activityLogs, eq(ledger.activityLogId, activityLogs.id))
    .leftJoin(activities, eq(activityLogs.activityId, activities.id))
    .leftJoin(reviewer, eq(reviewer.id, activityLogs.reviewedBy))
    .leftJoin(
      voider,
      eq(
        voider.id,
        sql`coalesce(${ledger.voidedBy}, ${activityLogs.voidedBy})`,
      ),
    )
    .where(
      and(
        eq(ledger.userId, targetUserId),
        since === undefined ? undefined : gte(ledger.occurredOn, since),
      ),
    )
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
      // Activity first (D14 keeps a deactivated one readable), then the
      // destination, then the note that names a refund (#24).
      label: row.activityName ?? row.destination ?? row.note ?? NO_LABEL,
      override: adultValue(row),
      voided: voidMark(row.voidedAt, row.voidedBy),
      decidedBy: row.reviewedBy,
    },
  }));
}

/** Only `rejected`: a pending entry is not history yet, an approved one is in the ledger (D19). */
function rejectedEntries(
  targetUserId: number,
  limit: number,
  since?: string,
): Placed<RejectedEntry>[] {
  const rows = getDb()
    .select({
      id: activityLogs.id,
      occurredOn: activityLogs.occurredOn,
      durationMinutes: activityLogs.durationMinutes,
      note: activityLogs.note,
      createdAt: activityLogs.createdAt,
      activityName: activities.name,
      reviewedBy: reviewer.displayName,
    })
    .from(activityLogs)
    .innerJoin(activities, eq(activityLogs.activityId, activities.id))
    .leftJoin(reviewer, eq(reviewer.id, activityLogs.reviewedBy))
    .where(
      and(
        eq(activityLogs.userId, targetUserId),
        eq(activityLogs.status, "rejected"),
        since === undefined ? undefined : gte(activityLogs.occurredOn, since),
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
      // The boy's own note stays out: #72 asks for the adult's sentence.
      reason: rejectionReason(row.note),
      decidedBy: row.reviewedBy,
    },
  }));
}

const voider = alias(users, "voider");
const reviewer = alias(users, "reviewer");

/** D52. `at` is epoch ms: the `coalesce` above comes back unmapped. */
function voidMark(at: number | null, by: string | null): VoidMark | null {
  return at === null ? null : { on: saoPauloDay(new Date(at)), by: by ?? "" };
}

const ADULT_VALUE_COLUMNS = {
  overridden: activityLogs.overridden,
  ruleHours: activityLogs.ruleHours,
  overrideReason: activityLogs.overrideReason,
} as const;

/** `overridden` is null on a spend or refund, which has no log (left join). */
function adultValue(row: {
  overridden: boolean | null;
  ruleHours: number | null;
  overrideReason: string | null;
}): AdultValue | null {
  return row.overridden === true
    ? { ruleHours: row.ruleHours, reason: row.overrideReason }
    : null;
}

function zeroEntries(
  targetUserId: number,
  limit: number,
  since?: string,
): Placed<ZeroEntry>[] {
  const rows = getDb()
    .select({
      id: activityLogs.id,
      occurredOn: activityLogs.occurredOn,
      createdAt: activityLogs.createdAt,
      activityName: activities.name,
      ...ADULT_VALUE_COLUMNS,
      voidedAt: activityLogs.voidedAt,
      voidedBy: voider.displayName,
      reviewedBy: reviewer.displayName,
    })
    .from(activityLogs)
    .innerJoin(activities, eq(activityLogs.activityId, activities.id))
    .leftJoin(voider, eq(voider.id, activityLogs.voidedBy))
    .leftJoin(reviewer, eq(reviewer.id, activityLogs.reviewedBy))
    .where(
      and(
        eq(activityLogs.userId, targetUserId),
        eq(activityLogs.status, "approved"),
        eq(activityLogs.computedHours, 0),
        since === undefined ? undefined : gte(activityLogs.occurredOn, since),
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
      kind: "zero" as const,
      occurredOn: row.occurredOn,
      label: row.activityName,
      override: adultValue(row),
      voided: voidMark(row.voidedAt?.getTime() ?? null, row.voidedBy),
      decidedBy: row.reviewedBy,
    },
  }));
}

/**
 * SQLite reads a negative `LIMIT` as "no limit". Throws rather than clamps: any
 * value outside the range is a call-site bug.
 */
function requireLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_LIMIT) {
    throw new Error(
      `a ledger page is between 1 and ${HISTORY_LIMIT} entries, received ${limit}`,
    );
  }
}

function requireDays(days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > MAX_HISTORY_DAYS) {
    throw new Error(
      `a history page is between 1 and ${MAX_HISTORY_DAYS} days, received ${days}`,
    );
  }
}
