"use server";

import { and, asc, eq, gte, min, ne } from "drizzle-orm";

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
 * Everything the calculator (#17) needs to answer "quanto eu ganharia agora",
 * for every activity, without asking the server again.
 *
 * The screen runs `calculateEarnedHours` itself, in the browser, on the same
 * module the admin's real entry will run on the server. That is what #17's
 * "nenhuma lógica de cálculo reimplementada aqui" means in practice, and the
 * engine is written to allow it: its only import is an `import type`, and the
 * client chunk it produces carries no database code (see the module docstring
 * of `src/engine/calculate.ts`, which measured it).
 *
 * The alternative — a server action per keystroke — would put a network round
 * trip between choosing an hour and seeing what it is worth, on a screen whose
 * whole purpose is that trying combinations is free. It would also be the one
 * place in this app with a real wait, and therefore the one place needing a
 * spinner. The data below is a few dozen rows.
 */
export type CalculatorData = {
  /**
   * Whose day this is, so the engine can refuse a history that is not his
   * (`assertOwnHistory`).
   *
   * It is the caller's own id and it reaches his own browser, which is not the
   * number #13 spends its argument on: forging a request needs the *brother's*
   * id, and the only endpoint that hands the pair out is admin-only
   * (`listKidsAction`). Knowing his own id buys nothing either — `isAllowed`
   * refuses a request for anybody else's whether or not the number was
   * guessable.
   */
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
 * How far back the calculator reads, beyond what the rules strictly need.
 *
 * `historyLookbackDays` gives the minimum: seven days for Casa's cooldown,
 * three for the return bonus. Fetching exactly that minimum is correct and
 * produces the wrong sentence. The engine's `awayText` will not claim a number
 * it cannot see, so inside the minimum window the return bonus can only ever
 * read "faz mais de 3 dias" — while #17's acceptance criterion asks for the
 * line to read "+50%, faz 4 dias que você não faz Corpo". Only a wider window
 * can name the day, and the engine says as much in `awayText`'s docstring.
 *
 * Thirty days, because that is the point past which "faz mais de 30 dias" says
 * everything the exact number would: a boy who has not touched Corpo in a month
 * does not need to know it was thirty-four days.
 */
const CALCULATOR_LOOKBACK_DAYS = 30;

/**
 * The activities, the categories and the boy's recent approved logs.
 *
 * Guarded with `simulate` and not `view`: it is the kind #13 created for this
 * screen, and running the calculator against the brother's day would tell you
 * his day — how many hours of Mente he has already read is not less private
 * than his balance. `calculator.test.ts` sends the forged request.
 *
 * `free` activities are left out on purpose. Curinga's "Atividade avulsa" is
 * D12's escape hatch for the admin, and its value does not exist until an adult
 * types it at launch time: there is no number the boy could simulate, and the
 * engine refuses a `free` calculation without one. Every other mode is in —
 * `duration` takes a duration, `delivery` takes a grade, `fixed` takes neither
 * — because a calculator that knows fifteen of the thirty-two activities
 * teaches fifteen thirty-seconds of the system.
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
    // D14 deactivates a category without touching its activities, so an active
    // activity can hang off a switched-off category. Offering it would ask the
    // engine for a category the picker does not have.
    .filter((row) => liveCategories.has(row.categoryId));

  // The window is the wider of the fixed lookback and what any offered
  // activity's own rules need, so a cooldown longer than 30 days configured
  // later cannot quietly shorten the history under the engine — which refuses
  // a short window rather than paying too much, but only if it is told the
  // truth about how far the rows reach.
  const byId = new Map(categoryRows.map((row) => [row.id, row]));
  const requiredDays = activityRows.reduce((widest, activity) => {
    const category = byId.get(activity.categoryId);

    return category === undefined
      ? widest
      : Math.max(widest, historyLookbackDays(activity, category));
  }, CALCULATOR_LOOKBACK_DAYS);

  const historyFrom = shiftDate(occurredOn, -requiredDays);
  // D34 gave the window a far end, and here it is today: the calculator
  // simulates an entry for today, nothing can be dated after today (the launch
  // refuses it), so the days beyond hold nothing. Declared rather than assumed,
  // because the engine refuses a window that stops short of what it reads and
  // this is the one caller whose far end is not the arithmetic's.
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
    // Not filtered to active activities or live categories: the daily bucket is
    // hours already spent (D3), and deactivating a category tomorrow does not
    // unspend them.
    .innerJoin(activities, eq(activityLogs.activityId, activities.id))
    .where(
      and(
        eq(activityLogs.userId, targetUserId),
        // D19: a pending or rejected log neither fills the bucket nor counts
        // for the cooldown.
        eq(activityLogs.status, "approved"),
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
    // D19, asserted and not filtered, by the engine's own `approvedOnly` — the
    // single place that rule is written. A copy of it here was the redundancy
    // the sabotage matrix caught: deleting it changed nothing anywhere,
    // because the `where` above already produced the same answer.
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
          ),
        )
        .groupBy(activityLogs.categoryId)
        .all()
        .map((row) => [row.categoryId, row.first]),
    ),
  };
}
