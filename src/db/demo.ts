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
 * A plausible week of Kid1's and Kid2's, written so the screens of Phase 3
 * can be looked at with something in them.
 *
 * **This is not the seed.** `seed.ts` writes the seven
 * categories and the thirty-two activities: it is idempotent, it runs in
 * production, and no invented ledger row or log belongs in it. This
 * module is a separate path behind its own command (`pnpm db:demo`) that
 * nothing else calls, and every row it writes is stamped so the same command
 * can take them all back out again (`pnpm db:demo:clear`).
 *
 * **It is idempotent, like the seed beside it.** `seedDemoData` deletes the
 * stamped rows before writing, so running the command twice leaves one week
 * rather than two. It used to leave two — Kid1's balance doubled and Kid2's
 * spends counted twice — and the only warning was a sentence in a docstring,
 * while `docs/demo-data.md`, the file `CLAUDE.md` links to, said nothing.
 *
 * **The empty screens are still the deliverable.** Nothing writes to the
 * ledger before Phase 4 and Phase 5, so a real installation on its first day
 * shows exactly the empty states #16 asks for. This exists because an empty
 * screen cannot demonstrate a screen: the sort order of the history, the five
 * that "os últimos cinco" picks out of eleven and the ink of a negative
 * balance are all invisible until there are rows. Both states are verified,
 * and each one is named where it is.
 *
 * **The numbers are the engine's.** Every `computed_hours` below comes out of
 * `calculateEarnedHours`, run over the history built so far, exactly as the
 * admin's approval will run it in Phase 5. Typing plausible-looking numbers by
 * hand would produce a demo whose ledger disagrees with the calculator on the
 * same screen, which is worse than no demo at all.
 */

/**
 * The stamp every demo row carries, in the `note` column the three tables
 * already have.
 *
 * `clearDemoData` deletes by this and by nothing else, so the removal is
 * surgical rather than a `delete from ledger`: it takes back what this module
 * wrote and leaves a real approval from Phase 5 alone. Whoever removes the demo
 * before launch will not have this context, so the removal has to be safe
 * without it.
 */
export const DEMO_NOTE =
  "[demo] dado de demonstração — remover antes do uso real";

/** The `like` pattern that finds the stamp. */
const DEMO_NOTE_PATTERN = "[demo]%";

type DemoLog = {
  username: string;
  /** The seed's activity id (`SEED_CATEGORIES` writes them out). */
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

/**
 * Kid1's week, ending on the Saturday the demo calls today.
 *
 * It is a week rather than a pile of rows because the screens answer questions
 * about *sequence*: today's second hour of Mente is worth half of the first
 * (D1–D3) only if the first one is there; today's football pays the return
 * bonus (D7) only because the last Corpo was six days ago; and "os últimos
 * cinco lançamentos" only means something when there are eleven.
 */
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

/**
 * Kid2's, which is the other state the boy's home screen has: a balance below
 * zero, which a seeded database has no way of showing.
 */
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

/**
 * Midday São Paulo on `day`, as the `created_at` of a demo log.
 *
 * The canonical order is `(occurred_on, created_at, id)` (D8), so two logs on
 * the same day need distinct stamps or the order they are read back in is the
 * order SQLite happens to return. `index` spaces them a minute apart, which is
 * also what makes the decay land on the second hour of Mente and not the first.
 */
function demoCreatedAt(day: string, index: number): Date {
  return new Date(Date.parse(`${day}T15:00:00Z`) + index * 60_000);
}

/**
 * Writes the demo week, with every `computed_hours` computed by the engine.
 *
 * `today` is a parameter and not `saoPauloDay(new Date())` so the tests can
 * pin a day; the CLI passes the real one, because a demo dated last March
 * shows an empty "hoje" on every screen.
 *
 * Idempotent: the stamped rows of any previous run go first, in this same
 * transaction. Running it twice writes one week, not two.
 *
 * One `IMMEDIATE` transaction, so an interrupted run leaves nothing behind.
 */
export function seedDemoData(
  connection: Connection,
  today: string,
): DemoResult {
  return writeTransaction(connection, (tx) => {
    // Idempotent, like `db:seed` next to it in the same table of commands.
    // Running `pnpm db:demo` twice used to write the week twice — measured at
    // 22 logs and 36 ledger rows, with Kid1's balance doubled — and the only
    // warning was a sentence in this file's docstring, which is not where
    // anybody looks. The stamp makes taking the previous run back out exact,
    // so the second run starts from the state the first one did.
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

    // What the engine sees as it goes: each log is calculated against the ones
    // already written, which is the same thing an approval does in D8's order.
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
        // D34: the demo writes its week in order, so `own` holds exactly what
        // was frozen before this entry — which is what the engine counts.
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
        // D37: born approved is born frozen, so the bucket comes with it.
        categoryId: activity.categoryId,
        status: "approved",
        // D18: an admin's entry is born approved, with the review stamps on it.
        source: "admin",
        occurredOn,
        // The demo writes round minutes, so its seconds are those minutes
        // exactly (D17, #71).
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

      // D10: a calculation that comes to zero is an approved log with no line
      // in the ledger. `ledger_hours_check` is exclusive of zero anyway.
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

/**
 * Takes every demo row back out, and nothing else.
 *
 * The order is the foreign keys' order: `ledger` points at `activity_logs`
 * with `onDelete: "restrict"`, so the ledger rows go first or the delete is
 * refused. Which is the right shape of failure — a half-removed demo leaving a
 * credit behind with no log under it is the state nobody would notice.
 *
 * Matching on the stamp rather than emptying the tables is what makes this safe
 * to run after Phase 4 and Phase 5 have written real rows next to these.
 */
export function clearDemoData(connection: Connection): DemoResult {
  return writeTransaction(connection, deleteDemoRows);
}

/**
 * The deletes themselves, inside somebody else's transaction.
 *
 * `seedDemoData` runs them first so that writing the week twice leaves one
 * week, and it has to be the same code: two copies of "which rows are the
 * demo's" is how a demo half survives its own removal. SQLite has no nested
 * `BEGIN IMMEDIATE`, so this takes the open transaction rather than opening
 * one.
 */
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

/** How many demo rows the database holds right now. */
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
