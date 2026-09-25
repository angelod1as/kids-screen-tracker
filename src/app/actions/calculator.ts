"use server";

import { and, asc, eq, gte, isNull, min, ne } from "drizzle-orm";

import { requireAccess } from "../../auth/guard";
import { getDb } from "../../db";
import { activities, activityLogs, categories } from "../../db/schema";
import type {
  ApprovedLog,
  EngineActivity,
  EngineCategory,
} from "../../engine/calculate";
import {
  approvedOnly,
  historyLookbackDays,
  saoPauloDay,
  shiftDate,
} from "../../engine/calculate";

/**
 * The screen runs the engine itself, in the browser, so no calculation logic is
 * reimplemented (#17) and trying combinations costs no round trip.
 */
export type CalculatorData = {
  /** Whose day this is, so the engine can refuse a history that is not his (`assertOwnHistory`). */
  userId: number;
  /** D13: today in São Paulo, decided on the server. */
  occurredOn: string;
  /** The first day `history` covers, for `CalculationInput.historyFrom`. */
  historyFrom: string;
  /** The last day it covers, for `CalculationInput.historyTo` (D34). */
  historyTo: string;
  categories: EngineCategory[];
  activities: EngineActivity[];
  history: ApprovedLog[];
  /** `CalculationInput.categoryFirstDay` per category id; absent is null (D47). */
  categoryFirstDays: Record<number, string>;
};

/**
 * Wider than `historyLookbackDays` needs: inside the minimum window `awayText`
 * can only say "faz mais de 3 dias", and #17 asks for the day to be named.
 */
const CALCULATOR_LOOKBACK_DAYS = 30;

/**
 * `simulate`, not `view` (#13): the brother's calculator would tell you his day.
 * `free` is left out: its value only exists once an adult types it (D12).
 */
export async function fetchCalculatorDataAction(
  targetUserId: number,
): Promise<CalculatorData> {
  await requireAccess({ kind: "simulate", targetUserId });

  const db = getDb();
  const occurredOn = saoPauloDay(new Date());

  const categoryRows = db
    .select({
      id: categories.id,
      name: categories.name,
      decayStepHours: categories.decayStepHours,
      returnBonusPct: categories.returnBonusPct,
      returnBonusAfterDays: categories.returnBonusAfterDays,
    })
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(asc(categories.sortOrder), asc(categories.id))
    .all();

  const liveCategories = new Set(categoryRows.map((row) => row.id));

  const activityRows = db
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
    .where(and(eq(activities.active, true), ne(activities.calcMode, "free")))
    .orderBy(asc(activities.sortOrder), asc(activities.id))
    .all()
    // D14 deactivates a category without touching its activities.
    .filter((row) => liveCategories.has(row.categoryId));

  // Never narrower than what an offered activity's rules need, so a long
  // cooldown configured later cannot shorten the history under the engine.
  const byId = new Map(categoryRows.map((row) => [row.id, row]));
  const requiredDays = activityRows.reduce((widest, activity) => {
    const category = byId.get(activity.categoryId);

    return category === undefined
      ? widest
      : Math.max(widest, historyLookbackDays(activity, category));
  }, CALCULATOR_LOOKBACK_DAYS);

  const historyFrom = shiftDate(occurredOn, -requiredDays);
  // D34's far end. Nothing is dated after today, but the engine refuses a
  // window that stops short of what it reads.
  const historyTo = shiftDate(occurredOn, requiredDays);

  const historyRows = db
    .select({
      id: activityLogs.id,
      userId: activityLogs.userId,
      occurredOn: activityLogs.occurredOn,
      activityId: activityLogs.activityId,
      durationMinutes: activityLogs.durationMinutes,
      createdAt: activityLogs.createdAt,
      status: activityLogs.status,
      categoryId: activities.categoryId,
      calcMode: activities.calcMode,
    })
    .from(activityLogs)
    // Not filtered to active items: hours already spent stay spent (D3).
    .innerJoin(activities, eq(activityLogs.activityId, activities.id))
    .where(
      and(
        eq(activityLogs.userId, targetUserId),
        // D19.
        eq(activityLogs.status, "approved"),
        // D52.
        isNull(activityLogs.voidedAt),
        gte(activityLogs.occurredOn, historyFrom),
      ),
    )
    .all();

  return {
    userId: targetUserId,
    occurredOn,
    historyFrom,
    historyTo,
    categories: categoryRows,
    activities: activityRows,
    // D19 is asserted by the engine's `approvedOnly`, the single place it is written.
    history: approvedOnly(historyRows),
    categoryFirstDays: Object.fromEntries(
      db
        .select({
          categoryId: activityLogs.categoryId,
          first: min(activityLogs.occurredOn),
        })
        .from(activityLogs)
        .where(
          and(
            eq(activityLogs.userId, targetUserId),
            eq(activityLogs.status, "approved"),
            isNull(activityLogs.voidedAt),
          ),
        )
        .groupBy(activityLogs.categoryId)
        .all()
        .map((row) => [row.categoryId, row.first]),
    ),
  };
}
