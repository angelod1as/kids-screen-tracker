import { like } from "drizzle-orm";
import type { ApprovedLog } from "../engine/calculate";
import {
  calculateEarnedHours,
  historyWindowEnd,
  historyWindowStart,
  shiftDate,
} from "../engine/calculate";
import type { Connection, Transaction } from "./client";
import { writeTransaction } from "./client";
import type { NewActivityLog, NewLedgerEntry } from "./schema";
import { activities, activityLogs, categories, ledger, users } from "./schema";

/**
 * A demo week for the boys' screens (`docs/demo-data.md`). Not the seed: its
 * own command, every row stamped so `pnpm db:demo:clear` takes it back out.
 * Every `computed_hours` comes from the engine, so the ledger agrees with the
 * calculator.
 */

/** `clearDemoData` deletes by this stamp alone, so real rows beside it survive. */
export const DEMO_NOTE =
  "[demo] dado de demonstração — remover antes do uso real";

const DEMO_NOTE_PATTERN = "[demo]%";

type DemoLog = {
  username: string;
  /** The seed's activity id. */
  activityId: number;
  daysAgo: number;
  durationMinutes?: number;
  quality?: number;
};

type DemoSpend = {
  username: string;
  daysAgo: number;
  hours: number;
  destination: string;
  kind: "spend" | "refund";
};

/** A week, not a pile: decay (D1–D3), return bonus (D7) and "últimos cinco" need sequence. */
const KID1_LOGS: readonly DemoLog[] = [
  // A week ago: football, so today's football has a gap to come back from.
  { username: "kid1", activityId: 1, daysAgo: 6, durationMinutes: 90 },
  { username: "kid1", activityId: 5, daysAgo: 5, durationMinutes: 45 },
  { username: "kid1", activityId: 23, daysAgo: 5, quality: 0.7 },
  // Casa carries a seven-day cooldown, so this one is inside it from today.
  { username: "kid1", activityId: 26, daysAgo: 4, quality: 1 },
  { username: "kid1", activityId: 10, daysAgo: 3, durationMinutes: 60 },
  { username: "kid1", activityId: 5, daysAgo: 2, durationMinutes: 60 },
  { username: "kid1", activityId: 23, daysAgo: 1, quality: 1 },
  // Today: two hours of football that pay in full (Corpo's step is 2h) and
  // take the return bonus, then two hours of Mente where the second is halved.
  { username: "kid1", activityId: 1, daysAgo: 0, durationMinutes: 120 },
  { username: "kid1", activityId: 5, daysAgo: 0, durationMinutes: 60 },
  { username: "kid1", activityId: 6, daysAgo: 0, durationMinutes: 60 },
];

const KID1_SPENDS: readonly DemoSpend[] = [
  {
    username: "kid1",
    daysAgo: 3,
    hours: 2,
    destination: "Xbox",
    kind: "spend",
  },
  {
    username: "kid1",
    daysAgo: 2,
    hours: 1.5,
    destination: "WhatsApp",
    kind: "spend",
  },
  {
    username: "kid1",
    daysAgo: 1,
    hours: 3,
    destination: "PlayStation",
    kind: "spend",
  },
  {
    username: "kid1",
    daysAgo: 1,
    hours: 0.5,
    destination: "PlayStation",
    kind: "refund",
  },
  {
    username: "kid1",
    daysAgo: 0,
    hours: 1,
    destination: "TV",
    kind: "spend",
  },
];

/** Kid2 is the negative balance a seeded database cannot show. */
const KID2_LOGS: readonly DemoLog[] = [
  { username: "kid2", activityId: 3, daysAgo: 5, durationMinutes: 30 },
];

const KID2_SPENDS: readonly DemoSpend[] = [
  {
    username: "kid2",
    daysAgo: 4,
    hours: 4,
    destination: "Xbox",
    kind: "spend",
  },
  {
    username: "kid2",
    daysAgo: 2,
    hours: 3,
    destination: "PlayStation",
    kind: "spend",
  },
];

export type DemoResult = {
  logs: number;
  ledger: number;
};

/** Midday São Paulo, a minute apart per `index`, so D8's order is defined. */
function demoCreatedAt(day: string, index: number): Date {
  return new Date(Date.parse(`${day}T15:00:00Z`) + index * 60_000);
}

/**
 * `today` is a parameter so tests can pin a day. Idempotent: the previous
 * run's stamped rows go first, in this same transaction.
 */
export function seedDemoData(
  connection: Connection,
  today: string,
): DemoResult {
  return writeTransaction(connection, (tx) => {
    deleteDemoRows(tx);

    const userIds = new Map(
      tx
        .select({ id: users.id, username: users.username })
        .from(users)
        .all()
        .map((row) => [row.username, row.id] as const),
    );

    const idOf = (username: string): number => {
      const id = userIds.get(username);
      if (id === undefined) {
        throw new Error(
          `no user named ${username}; write the people with SQL (D45) before \`pnpm db:demo\``,
        );
      }

      return id;
    };

    const admin = idOf("admin1");

    const activityRows = tx
      .select({
        id: activities.id,
        categoryId: activities.categoryId,
        name: activities.name,
        calcMode: activities.calcMode,
        value: activities.value,
        qualityGraded: activities.qualityGraded,
        repeatCooldownDays: activities.repeatCooldownDays,
      })
      .from(activities)
      .all();
    const activityById = new Map(activityRows.map((row) => [row.id, row]));

    const categoryRows = tx
      .select({
        id: categories.id,
        name: categories.name,
        decayStepHours: categories.decayStepHours,
        returnBonusPct: categories.returnBonusPct,
        returnBonusAfterDays: categories.returnBonusAfterDays,
      })
      .from(categories)
      .all();
    const categoryById = new Map(categoryRows.map((row) => [row.id, row]));

    // Each log is calculated against the ones already written, in D8's order.
    const history = new Map<string, ApprovedLog[]>();
    let logs = 0;
    let ledgerRows = 0;

    const ordered = [...KID1_LOGS, ...KID2_LOGS].sort(
      (left, right) => right.daysAgo - left.daysAgo,
    );

    for (const [index, entry] of ordered.entries()) {
      const activity = activityById.get(entry.activityId);
      const category =
        activity === undefined
          ? undefined
          : categoryById.get(activity.categoryId);

      if (activity === undefined || category === undefined) {
        throw new Error(
          `the demo names activity ${entry.activityId}, which the seed does not have`,
        );
      }

      const userId = idOf(entry.username);
      const occurredOn = shiftDate(today, -entry.daysAgo);
      const own = history.get(entry.username) ?? [];

      const calculation = calculateEarnedHours({
        userId,
        activity,
        category,
        occurredOn,
        durationMinutes: entry.durationMinutes,
        quality: entry.quality,
        // D34: written in order, so `own` is exactly what was frozen before.
        history: own.filter(
          (log) =>
            log.occurredOn >=
              historyWindowStart(occurredOn, activity, category) &&
            log.occurredOn <= historyWindowEnd(occurredOn, activity, category),
        ),
        historyFrom: historyWindowStart(occurredOn, activity, category),
        historyTo: historyWindowEnd(occurredOn, activity, category),
        categoryFirstDay:
          own
            .filter((log) => log.categoryId === category.id)
            .map((log) => log.occurredOn)
            .sort()[0] ?? null,
      });

      const createdAt = demoCreatedAt(occurredOn, index);
      const log: NewActivityLog = {
        userId,
        activityId: activity.id,
        // D37.
        categoryId: activity.categoryId,
        status: "approved",
        // D18.
        source: "admin",
        occurredOn,
        // D17.
        durationSeconds:
          entry.durationMinutes === undefined
            ? null
            : entry.durationMinutes * 60,
        durationMinutes: entry.durationMinutes ?? null,
        quality: entry.quality ?? null,
        computedHours: calculation.hours,
        note: DEMO_NOTE,
        createdBy: admin,
        reviewedBy: admin,
        reviewedAt: createdAt,
        createdAt,
      };

      const inserted = tx
        .insert(activityLogs)
        .values(log)
        .returning({ id: activityLogs.id })
        .get();
      logs += 1;

      own.push({
        id: inserted.id,
        userId,
        occurredOn,
        activityId: activity.id,
        durationMinutes: entry.durationMinutes ?? null,
        createdAt,
        status: "approved",
        categoryId: activity.categoryId,
      });
      history.set(entry.username, own);

      // D10.
      if (calculation.hours > 0) {
        tx.insert(ledger)
          .values({
            userId,
            kind: "earn",
            hours: calculation.hours,
            occurredOn,
            activityLogId: inserted.id,
            note: DEMO_NOTE,
            createdBy: admin,
            createdAt,
          } satisfies NewLedgerEntry)
          .run();
        ledgerRows += 1;
      }
    }

    for (const [index, spend] of [...KID1_SPENDS, ...KID2_SPENDS].entries()) {
      const occurredOn = shiftDate(today, -spend.daysAgo);

      tx.insert(ledger)
        .values({
          userId: idOf(spend.username),
          kind: spend.kind,
          hours: spend.hours,
          occurredOn,
          destination: spend.destination,
          note: DEMO_NOTE,
          createdBy: admin,
          createdAt: demoCreatedAt(occurredOn, ordered.length + index),
        } satisfies NewLedgerEntry)
        .run();
      ledgerRows += 1;
    }

    return { logs, ledger: ledgerRows };
  });
}

/** Only the stamped rows. Ledger first: it references the logs with `restrict`. */
export function clearDemoData(connection: Connection): DemoResult {
  return writeTransaction(connection, deleteDemoRows);
}

/** One copy of "which rows are the demo's", run inside the caller's transaction. */
function deleteDemoRows(tx: Transaction): DemoResult {
  const removedLedger = tx
    .delete(ledger)
    .where(like(ledger.note, DEMO_NOTE_PATTERN))
    .run();
  const removedLogs = tx
    .delete(activityLogs)
    .where(like(activityLogs.note, DEMO_NOTE_PATTERN))
    .run();

  return {
    logs: removedLogs.changes,
    ledger: removedLedger.changes,
  };
}

export function countDemoRows(connection: Connection): DemoResult {
  const db = connection.db;

  return {
    logs: db
      .select({ id: activityLogs.id })
      .from(activityLogs)
      .where(like(activityLogs.note, DEMO_NOTE_PATTERN))
      .all().length,
    ledger: db
      .select({ id: ledger.id })
      .from(ledger)
      .where(like(ledger.note, DEMO_NOTE_PATTERN))
      .all().length,
  };
}
