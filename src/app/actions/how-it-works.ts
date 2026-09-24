"use server";

import { asc, eq } from "drizzle-orm";

import { requireSession } from "../../auth/guard";
import { getDb } from "../../db";
import { activities, categories } from "../../db/schema";
import type { EngineActivity, EngineCategory } from "../../engine/calculate";
import { saoPauloDay } from "../../engine/calculate";

export type HowItWorksCategory = EngineCategory & {
  baseRate: number | null;
};

export type HowItWorksActivity = EngineActivity & {
  maxSessionMinutes: number | null;
  minSessionMinutes: number;
};

export type HowItWorksData = {
  /** D13: the day the examples are calculated on. */
  occurredOn: string;
  categories: HowItWorksCategory[];
  activities: HowItWorksActivity[];
};

/** `requireSession`: this is the table both boys are measured by, not one person's data. */
export async function fetchHowItWorksAction(): Promise<HowItWorksData> {
  await requireSession();

  const db = getDb();

  const categoryRows = db
    .select({
      id: categories.id,
      name: categories.name,
      baseRate: categories.baseRate,
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
      maxSessionMinutes: activities.maxSessionMinutes,
      minSessionMinutes: activities.minSessionMinutes,
    })
    .from(activities)
    .where(eq(activities.active, true))
    .orderBy(asc(activities.sortOrder), asc(activities.id))
    .all()
    // D14 switches a category off without touching its activities.
    .filter((row) => liveCategories.has(row.categoryId));

  return {
    occurredOn: saoPauloDay(new Date()),
    categories: categoryRows,
    activities: activityRows,
  };
}
