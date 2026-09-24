import { SEED_CATEGORIES } from "../db/seed";
import type {
  ApprovedLog,
  CalculationInput,
  EngineActivity,
  EngineCategory,
} from "./calculate";

/**
 * The fixtures of the case table of issue #11, kept out of the test file so
 * that the table itself reads as a table.
 *
 * The rule that governs everything here: **the expected numbers are derived
 * from `docs/decisions.md`, never from `src/engine/calculate.ts`.** The engine
 * was written under issue #10 by someone else; #11 exists so that the person
 * who imagined the implementation is not the person who says what the
 * specification asks for. So nothing in this file imports a value, a formula or
 * a helper from the engine — only its types, which are the contract and not the
 * arithmetic.
 *
 * In particular the date arithmetic is written out by hand rather than taken
 * from the engine's exported `shiftDate`: a table that measures the engine with
 * the engine's own ruler measures nothing.
 */

/** The seed's own rows, as the engine reads them. */
export type SeedRow = {
  category: EngineCategory;
  activity: EngineActivity;
};

/**
 * Narrows away a null the table knows cannot happen, and says so out loud.
 *
 * A `!` would do the same and say nothing: when the assumption stops holding —
 * a seeded row that loses its `value`, a calculation that comes back with no
 * lines — the test that breaks has to name the assumption rather than throw
 * "cannot read properties of undefined" three frames away from it.
 */
export function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`the case table expected ${what}, and there is none`);
  }

  return value;
}

const MS_PER_DAY = 86_400_000;

/**
 * `YYYY-MM-DD` shifted by whole days, written here rather than imported.
 *
 * Deliberately duplicated from the engine: the engine's version is one of the
 * things under test, and a test that shifts its dates with the code it is
 * checking cannot see the day the two disagree.
 */
export function day(date: string, offset = 0): string {
  const shifted = new Date(
    Date.parse(`${date}T00:00:00Z`) + offset * MS_PER_DAY,
  );
  const year = String(shifted.getUTCFullYear()).padStart(4, "0");
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(shifted.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${dayOfMonth}`;
}

/**
 * Every seed row, flattened: seven categories and thirty-two activities, with
 * the same ids the database carries.
 *
 * `NewCategory` and `NewActivity` make the columns with a schema default
 * optional, so the fallbacks below are the schema's defaults and not a guess —
 * `return_bonus_pct` and `repeat_cooldown_days` default to 0, `quality_graded`
 * to false.
 */
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
 * The inputs a mode needs, so a table can walk all four without a special case.
 *
 * One hour for `duration`, because one hour is the unit the decay table of
 * `decisions.md` is written in; full marks for `delivery`, so the grade is a
 * no-op and what is left is the base value; and a typed value for `free`.
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

/**
 * An approved log of the user, as the engine's history type wants it.
 *
 * `createdAt` is derived from the sequence number so that the canonical order
 * `(occurred_on, created_at, id)` of D8 is the order of the calls.
 */
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

/** Kid1. Any id would do; a named one keeps the assertions readable. */
export const KID1 = 3;
export const KID2 = 4;

/**
 * Builds a calculation input with the boilerplate filled in.
 *
 * `historyFrom` and `historyTo` default to a month either side, which is
 * further than any rule in `decisions.md` reaches in either direction: the
 * engine refuses a window that is too short, and a table that has to compute
 * the minimum window per row would be computing it with the engine's own
 * helper. The far end exists because of D34 — an entry counts what was frozen
 * before it, and that can sit on a later day than its own. `categoryFirstDay`
 * defaults to what the history shows, so an empty history is a debut (D47).
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
