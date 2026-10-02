import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";

import type { ApprovedLog, EngineCategory } from "../engine/calculate";
import {
  approvedOnly,
  calculateEarnedHours,
  daysBetween,
  historyWindowEnd,
  historyWindowStart,
  shiftDate,
} from "../engine/calculate";
import type { Connection } from "./client";
import { activities, activityLogs, categories, ledger, users } from "./schema";

/**
 * #9: read-only, for calibrating the table (#54). Approved and not voided only
 * (D19, D52); nothing here writes, and no frozen number is recomputed (D15).
 */

export type DashboardFilter = {
  kidIds: readonly number[];
  /** Null is "everything": from the first day any of these kids has a row. */
  from: string | null;
  to: string;
};

/** Where the engine's own lines put the hours of the entries it reproduces. */
export type Split = {
  /** Base, grade and cooldown: what the table pays before the day and the gap. */
  rule: number;
  decay: number;
  bonus: number;
};

export type CategoryStats = {
  id: number;
  name: string;
  active: boolean;
  decayStepHours: number | null;
  returnBonusPct: number;
  returnBonusAfterDays: number;
  /** Earned per day of `Dashboard.days`. */
  earnedPerDay: number[];
  earned: number;
  entries: number;
  activityMinutes: number;
  /** Earned by the entries that have minutes: a `fixed` hour has no time to divide by. */
  activityEarned: number;
  split: Split;
  /** Kid-days with any entry here, and those whose bucket passed one step (D3). */
  kidDays: number;
  kidDaysPastStep: number;
  /** Days without the category before each return in the period (D6's count). */
  gapsBeforeReturn: number[];
  returnsWithBonus: number;
  /** Overridden or unreproduced here: out of `split` and `returnsWithBonus`. */
  excluded: number;
};

export type BalancePoint = { day: string; balance: number };

export type KidBalance = {
  id: number;
  displayName: string;
  /** End of each day of `Dashboard.days`. */
  points: BalancePoint[];
  earned: number;
  spent: number;
  refunded: number;
};

export type ActivityUse = {
  id: number;
  name: string;
  categoryName: string;
  entries: number;
  earned: number;
};

export type Dashboard = {
  days: string[];
  categories: CategoryStats[];
  balances: KidBalance[];
  /** Used in the period, most entries first. */
  used: ActivityUse[];
  /** Active, and not used in the period. */
  unused: ActivityUse[];
  /** Entries left out of `Split`: an adult's number (D50), or one today's table does not give. */
  overridden: number;
  unreproduced: number;
};

type LogRow = {
  id: number;
  userId: number;
  activityId: number;
  categoryId: number;
  status: "approved";
  occurredOn: string;
  durationMinutes: number | null;
  quality: number | null;
  freeValue: number | null;
  computedHours: number | null;
  overridden: boolean;
  createdAt: Date;
  reviewedAt: Date | null;
};

const MINUTES_PER_HOUR = 60;

function round2(hours: number): number {
  return Math.round(hours * 100) / 100;
}

export function daysFrom(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = shiftDate(day, 1)) {
    days.push(day);
  }

  return days;
}

/** D34: frozen earlier is reviewed earlier; the id breaks a tie in one write. */
function frozenBefore(a: LogRow, b: LogRow): boolean {
  const at = a.reviewedAt?.getTime() ?? 0;
  const bt = b.reviewedAt?.getTime() ?? 0;

  return at < bt || (at === bt && a.id < b.id);
}

/**
 * The engine's lines for `log` under today's table, against what was frozen
 * before it (D34, D47). Null when they do not add up to the frozen number.
 */
function replay(
  log: LogRow,
  logs: readonly LogRow[],
  activity: typeof activities.$inferSelect,
  category: EngineCategory,
): Split | null {
  const historyFrom = historyWindowStart(log.occurredOn, activity, category);
  const historyTo = historyWindowEnd(log.occurredOn, activity, category);
  const before = logs.filter(
    (other) => other.userId === log.userId && frozenBefore(other, log),
  );
  const history: ApprovedLog[] = before.filter(
    (other) => other.occurredOn >= historyFrom && other.occurredOn <= historyTo,
  );
  const sameCategory = before
    .filter((other) => other.categoryId === category.id)
    .map((other) => other.occurredOn)
    .sort();

  try {
    const calculation = calculateEarnedHours({
      userId: log.userId,
      activity,
      category,
      occurredOn: log.occurredOn,
      durationMinutes: log.durationMinutes,
      quality: log.quality,
      freeValue: log.freeValue,
      history,
      historyFrom,
      historyTo,
      categoryFirstDay: sameCategory[0] ?? null,
    });

    if (calculation.hours !== log.computedHours) return null;

    const sum = (step: string) =>
      calculation.lines
        .filter((line) => line.step === step)
        .reduce((total, line) => total + line.hours, 0);
    const decay = round2(sum("decay"));
    const bonus = round2(sum("bonus"));

    return {
      rule: round2(calculation.hours - decay - bonus),
      decay,
      bonus,
    };
  } catch {
    // A table that can no longer price it (a `free` now, a grade it lacks).
    return null;
  }
}

export function readDashboard(
  connection: Connection,
  filter: DashboardFilter,
): Dashboard {
  const { db } = connection;
  const kidIds = [...filter.kidIds];

  const kids = db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, kidIds))
    .orderBy(asc(users.id))
    .all();

  // Every approved row up to `to`, before the period too: the replay needs them.
  const logs: LogRow[] = approvedOnly(
    db
      .select({
        id: activityLogs.id,
        userId: activityLogs.userId,
        activityId: activityLogs.activityId,
        categoryId: activityLogs.categoryId,
        status: activityLogs.status,
        occurredOn: activityLogs.occurredOn,
        durationMinutes: activityLogs.durationMinutes,
        quality: activityLogs.quality,
        freeValue: activityLogs.freeValue,
        computedHours: activityLogs.computedHours,
        overridden: activityLogs.overridden,
        createdAt: activityLogs.createdAt,
        reviewedAt: activityLogs.reviewedAt,
      })
      .from(activityLogs)
      .where(
        and(
          inArray(activityLogs.userId, kidIds),
          eq(activityLogs.status, "approved"),
          isNull(activityLogs.voidedAt),
          lte(activityLogs.occurredOn, filter.to),
        ),
      )
      .all(),
  );

  const ledgerRows = db
    .select({
      userId: ledger.userId,
      kind: ledger.kind,
      hours: ledger.hours,
      occurredOn: ledger.occurredOn,
    })
    .from(ledger)
    .leftJoin(activityLogs, eq(ledger.activityLogId, activityLogs.id))
    .where(
      and(
        inArray(ledger.userId, kidIds),
        isNull(ledger.voidedAt),
        isNull(activityLogs.voidedAt),
        lte(ledger.occurredOn, filter.to),
      ),
    )
    .all();

  const firstDay = [
    ...logs.map((log) => log.occurredOn),
    ...ledgerRows.map((row) => row.occurredOn),
  ].sort()[0];
  const from = filter.from ?? firstDay ?? filter.to;
  const days = daysFrom(from, filter.to);
  const dayIndex = new Map(days.map((day, index) => [day, index]));

  const activityRows = db
    .select()
    .from(activities)
    .orderBy(asc(activities.sortOrder), asc(activities.id))
    .all();
  const activityById = new Map(activityRows.map((row) => [row.id, row]));
  const categoryRows = db
    .select()
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.id))
    .all();
  const categoryById = new Map(categoryRows.map((row) => [row.id, row]));

  const inPeriod = logs.filter((log) => dayIndex.has(log.occurredOn));

  const stats = new Map<number, CategoryStats>(
    categoryRows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        active: row.active,
        decayStepHours: row.decayStepHours,
        returnBonusPct: row.returnBonusPct,
        returnBonusAfterDays: row.returnBonusAfterDays,
        earnedPerDay: days.map(() => 0),
        earned: 0,
        entries: 0,
        activityMinutes: 0,
        activityEarned: 0,
        split: { rule: 0, decay: 0, bonus: 0 },
        kidDays: 0,
        kidDaysPastStep: 0,
        gapsBeforeReturn: [],
        returnsWithBonus: 0,
        excluded: 0,
      },
    ]),
  );

  let overridden = 0;
  let unreproduced = 0;
  const bucketMinutes = new Map<string, number>();

  for (const log of inPeriod) {
    const entry = stats.get(log.categoryId);
    const activity = activityById.get(log.activityId);
    const category = categoryById.get(log.categoryId);
    if (entry === undefined || activity === undefined || category === undefined)
      continue;

    const hours = log.computedHours ?? 0;
    entry.earned += hours;
    const index = dayIndex.get(log.occurredOn) ?? 0;
    entry.earnedPerDay[index] = (entry.earnedPerDay[index] ?? 0) + hours;
    entry.entries += 1;
    entry.activityMinutes += log.durationMinutes ?? 0;
    if (log.durationMinutes !== null) entry.activityEarned += hours;

    // D3: the bucket counts the row's minutes, whatever its value (D50).
    const key = `${log.userId}|${log.categoryId}|${log.occurredOn}`;
    bucketMinutes.set(
      key,
      (bucketMinutes.get(key) ?? 0) + (log.durationMinutes ?? 0),
    );

    if (log.overridden) {
      overridden += 1;
      entry.excluded += 1;
      continue;
    }

    const split = replay(log, logs, activity, category);
    if (split === null) {
      unreproduced += 1;
      entry.excluded += 1;
      continue;
    }

    entry.split.rule += split.rule;
    entry.split.decay += split.decay;
    entry.split.bonus += split.bonus;
    if (split.bonus > 0) entry.returnsWithBonus += 1;
  }

  for (const [key, minutes] of bucketMinutes) {
    const categoryId = Number(key.split("|")[1]);
    const entry = stats.get(categoryId);
    if (entry === undefined) continue;

    entry.kidDays += 1;
    if (
      entry.decayStepHours !== null &&
      minutes / MINUTES_PER_HOUR > entry.decayStepHours
    ) {
      entry.kidDaysPastStep += 1;
    }
  }

  // A return is a day with the category after a day without it (D6, D47).
  for (const kid of kids) {
    for (const entry of stats.values()) {
      const kidDays = [
        ...new Set(
          logs
            .filter(
              (log) => log.userId === kid.id && log.categoryId === entry.id,
            )
            .map((log) => log.occurredOn),
        ),
      ].sort();

      for (const [index, day] of kidDays.entries()) {
        const previous = kidDays[index - 1];
        if (previous === undefined || !dayIndex.has(day)) continue;

        const without = daysBetween(previous, day) - 1;
        if (without > 0) entry.gapsBeforeReturn.push(without);
      }
    }
  }

  const categoriesOut = [...stats.values()]
    .filter((entry) => entry.active || entry.entries > 0)
    .map((entry) => ({
      ...entry,
      earned: round2(entry.earned),
      activityEarned: round2(entry.activityEarned),
      earnedPerDay: entry.earnedPerDay.map(round2),
      split: {
        rule: round2(entry.split.rule),
        decay: round2(entry.split.decay),
        bonus: round2(entry.split.bonus),
      },
      gapsBeforeReturn: entry.gapsBeforeReturn.sort((a, b) => a - b),
    }));

  const balances: KidBalance[] = kids.map((kid) => {
    const rows = ledgerRows.filter((row) => row.userId === kid.id);
    const signed = (row: (typeof rows)[number]) =>
      row.kind === "spend" ? -row.hours : row.hours;
    let running = rows
      .filter((row) => row.occurredOn < from)
      .reduce((sum, row) => sum + signed(row), 0);
    const points = days.map((day) => {
      running += rows
        .filter((row) => row.occurredOn === day)
        .reduce((sum, row) => sum + signed(row), 0);

      return { day, balance: round2(running) };
    });
    const total = (kind: string) =>
      round2(
        rows
          .filter((row) => row.kind === kind && dayIndex.has(row.occurredOn))
          .reduce((sum, row) => sum + row.hours, 0),
      );

    return {
      id: kid.id,
      displayName: kid.displayName,
      points,
      earned: total("earn"),
      spent: total("spend"),
      refunded: total("refund"),
    };
  });

  const usage = new Map<number, { entries: number; earned: number }>();
  for (const log of inPeriod) {
    const use = usage.get(log.activityId) ?? { entries: 0, earned: 0 };
    use.entries += 1;
    use.earned += log.computedHours ?? 0;
    usage.set(log.activityId, use);
  }

  const toUse = (row: (typeof activityRows)[number]): ActivityUse => {
    const use = usage.get(row.id);

    return {
      id: row.id,
      name: row.name,
      categoryName: categoryById.get(row.categoryId)?.name ?? "",
      entries: use?.entries ?? 0,
      earned: round2(use?.earned ?? 0),
    };
  };

  const used = activityRows
    .filter((row) => usage.has(row.id))
    .map(toUse)
    .sort((a, b) => b.entries - a.entries || b.earned - a.earned);
  const unused = activityRows
    .filter(
      (row) =>
        row.active &&
        categoryById.get(row.categoryId)?.active === true &&
        !usage.has(row.id),
    )
    .map(toUse);

  return {
    days,
    categories: categoriesOut,
    balances,
    used,
    unused,
    overridden,
    unreproduced,
  };
}
