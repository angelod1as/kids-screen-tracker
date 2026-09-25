import { SEED_CATEGORIES } from "../db/seed";
import type {
  ApprovedLog,
  CalculationInput,
  EngineActivity,
  EngineCategory,
} from "./calculate";

/*
 * Fixtures for the case table of #11. Expected numbers come from `decisions.md`,
 * never from the engine: only its types are imported, never a value or helper.
 */

export type SeedRow = {
  category: EngineCategory;
  activity: EngineActivity;
};

/** Not `!`: a broken assumption has to name itself, not throw three frames away. */
export function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`the case table expected ${what}, and there is none`);
  }

  return value;
}

const MS_PER_DAY = 86_400_000;

/** Duplicated from the engine's `shiftDate` on purpose: that one is under test. */
export function day(date: string, offset = 0): string {
  const shifted = new Date(
    Date.parse(`${date}T00:00:00Z`) + offset * MS_PER_DAY,
  );
  const year = String(shifted.getUTCFullYear()).padStart(4, "0");
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(shifted.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${dayOfMonth}`;
}

/** The fallbacks are the schema's column defaults, not a guess. */
export const SEED_ROWS: readonly SeedRow[] = SEED_CATEGORIES.flatMap(
  (seedCategory) => {
    const category: EngineCategory = {
      id: seedCategory.id,
      name: seedCategory.name,
      decayStepHours: seedCategory.decayStepHours ?? null,
      returnBonusPct: seedCategory.returnBonusPct ?? 0,
      returnBonusAfterDays: seedCategory.returnBonusAfterDays ?? 0,
    };

    return seedCategory.activities.map((seedActivity) => ({
      category,
      activity: {
        id: seedActivity.id,
        categoryId: seedCategory.id,
        name: seedActivity.name,
        calcMode: seedActivity.calcMode,
        value: seedActivity.value ?? null,
        qualityGraded: seedActivity.qualityGraded ?? false,
        repeatCooldownDays: seedActivity.repeatCooldownDays ?? 0,
      } satisfies EngineActivity,
    }));
  },
);

export function seedRow(activityId: number): SeedRow {
  const row = SEED_ROWS.find(({ activity }) => activity.id === activityId);

  if (row === undefined) {
    throw new Error(`no seeded activity with id ${activityId}`);
  }

  return row;
}

/**
 * One hour, the unit of the decay table in `decisions.md`; full marks, so the
 * grade is a no-op and what is left is the base value.
 */
export const ONE_HOUR_MINUTES = 60;
export const FULL_MARKS = 1;
export const TYPED_FREE_VALUE = 2.5;

export function modeInputs(activity: EngineActivity): {
  durationMinutes?: number;
  quality?: number;
  freeValue?: number;
} {
  return {
    ...(activity.calcMode === "duration"
      ? { durationMinutes: ONE_HOUR_MINUTES }
      : {}),
    ...(activity.qualityGraded ? { quality: FULL_MARKS } : {}),
    ...(activity.calcMode === "free" ? { freeValue: TYPED_FREE_VALUE } : {}),
  };
}

/** `createdAt` follows `id`, so D8's canonical order is the order of the calls. */
export function approved(log: {
  id: number;
  occurredOn: string;
  activity: EngineActivity;
  durationMinutes?: number | null;
  userId?: number;
}): ApprovedLog {
  return {
    id: log.id,
    userId: log.userId ?? KID1,
    status: "approved",
    occurredOn: log.occurredOn,
    activityId: log.activity.id,
    categoryId: log.activity.categoryId,
    durationMinutes: log.durationMinutes ?? null,
    createdAt: new Date(Date.parse(`${log.occurredOn}T12:00:00Z`) + log.id),
  };
}

export const KID1 = 3;
export const KID2 = 4;

/**
 * A month either side is further than any rule reaches (D34 reads later days);
 * computing the minimum would use the engine's own helper. Empty history: debut (D47).
 */
export function input(
  overrides: Partial<CalculationInput> &
    Pick<CalculationInput, "activity" | "category" | "occurredOn">,
): CalculationInput {
  return {
    userId: KID1,
    durationMinutes: null,
    quality: null,
    freeValue: null,
    history: [],
    historyFrom: day(overrides.occurredOn, -30),
    historyTo: day(overrides.occurredOn, 30),
    categoryFirstDay:
      (overrides.history ?? [])
        .filter((log) => log.categoryId === overrides.category.id)
        .map((log) => log.occurredOn)
        .sort()[0] ?? null,
    ...overrides,
  };
}
