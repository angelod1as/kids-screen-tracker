import type { Calculation } from "../../../../engine/calculate";
import {
  calculateEarnedHours,
  historyWindowEnd,
  historyWindowStart,
  returnBonusWindowStart,
} from "../../../../engine/calculate";
import { shiftDate } from "../../../../engine/day";
import { asymptoteHours } from "../../../../engine/limits";
import type {
  HowItWorksActivity,
  HowItWorksCategory,
  HowItWorksData,
} from "../../../actions/how-it-works";

/** The session the owner asked about in #107: an input to the example, not a rule. */
export const SHORT_SESSION_MINUTES = 7;

export const DECAY_ROWS = 4;

export type Example = {
  activity: HowItWorksActivity & { value: number };
  category: HowItWorksCategory & { decayStepHours: number };
};

export type DecayRow = {
  /** Minutes of the activity since the day began. */
  minutes: number;
  /** What the last band added, already rounded (D9). */
  gain: number;
  /** What the day has paid so far, from the engine. */
  total: number;
};

/**
 * The activity the examples are about: the first timed one in a category that
 * decays, preferring one with a return bonus so both rules can be shown.
 */
export function exampleOf(data: HowItWorksData): Example | null {
  const candidates = data.categories.flatMap((category) => {
    const step = category.decayStepHours;
    if (step === null) return [];

    const activity = data.activities.find(
      (row) =>
        row.categoryId === category.id &&
        row.calcMode === "duration" &&
        !row.qualityGraded &&
        row.value !== null,
    );
    if (activity === undefined || activity.value === null) return [];

    return [
      {
        activity: { ...activity, value: activity.value },
        category: { ...category, decayStepHours: step },
      },
    ];
  });

  return (
    candidates.find((example) => example.category.returnBonusPct > 0) ??
    candidates[0] ??
    null
  );
}

function calculate(
  example: Example,
  category: HowItWorksCategory,
  minutes: number,
  occurredOn: string,
): Calculation {
  const { activity } = example;

  return calculateEarnedHours({
    // An empty history belongs to nobody; the id only has to match its rows.
    userId: 0,
    activity,
    category,
    occurredOn,
    durationMinutes: minutes,
    history: [],
    historyFrom: historyWindowStart(occurredOn, activity, category),
    historyTo: historyWindowEnd(occurredOn, activity, category),
    // The example is a return: the category was done before its window (D47).
    categoryFirstDay: shiftDate(
      returnBonusWindowStart(occurredOn, category),
      -1,
    ),
  });
}

/** A day of one activity, band by band, without the return bonus. */
export function decayRows(example: Example, occurredOn: string): DecayRow[] {
  const withoutBonus = { ...example.category, returnBonusPct: 0 };
  const rows: DecayRow[] = [];
  let previous = 0;

  for (let band = 1; band <= DECAY_ROWS; band += 1) {
    const minutes = Math.round(band * example.category.decayStepHours * 60);
    const total = calculate(example, withoutBonus, minutes, occurredOn).hours;

    rows.push({
      minutes,
      gain: Math.round((total - previous) * 100) / 100,
      total,
    });
    previous = total;
  }

  return rows;
}

/** The owner's case: a short session, first of its category in days. */
export function returnExample(
  example: Example,
  occurredOn: string,
): Calculation | null {
  if (example.category.returnBonusPct <= 0) return null;

  return calculate(
    example,
    example.category,
    SHORT_SESSION_MINUTES,
    occurredOn,
  );
}

/** What a whole day of the example activity approaches, bonus aside. */
export function exampleAsymptote(example: Example): number {
  return (
    asymptoteHours(example.activity.value, example.category.decayStepHours) ?? 0
  );
}

export function categoriesThatDecay(
  data: HowItWorksData,
): (HowItWorksCategory & { decayStepHours: number })[] {
  return data.categories.flatMap((category) =>
    category.decayStepHours === null
      ? []
      : [{ ...category, decayStepHours: category.decayStepHours }],
  );
}

export function activitiesOf(
  data: HowItWorksData,
  category: HowItWorksCategory,
): HowItWorksActivity[] {
  return data.activities.filter((row) => row.categoryId === category.id);
}

/** `0,5` is +50% (see `returnBonusMultiplier` in the engine). */
export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

export function formatDays(days: number): string {
  return days === 1 ? "1 dia" : `${days} dias`;
}
