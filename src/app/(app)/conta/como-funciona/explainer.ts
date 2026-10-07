import type { ApprovedLog, Calculation } from "../../../../engine/calculate";
import {
  calculateEarnedHours,
  historyWindowEnd,
  historyWindowStart,
} from "../../../../engine/calculate";
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
 * decays, preferring one that takes the alternation bonus so both rules show.
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
    candidates.find((example) => example.category.alternationBonusPct > 0) ??
    candidates[0] ??
    null
  );
}

function calculate(
  example: Example,
  category: HowItWorksCategory,
  minutes: number,
  occurredOn: string,
  history: ApprovedLog[] = [],
  participatingCategoryIds: number[] = [],
): Calculation {
  const { activity } = example;

  return calculateEarnedHours({
    // History belongs to nobody; the id only has to match its rows.
    userId: 0,
    activity,
    category,
    occurredOn,
    durationMinutes: minutes,
    history,
    historyFrom: historyWindowStart(occurredOn, activity),
    historyTo: historyWindowEnd(occurredOn, activity),
    participatingCategoryIds,
  });
}

/** A day of one activity, band by band, without the alternation bonus. */
export function decayRows(example: Example, occurredOn: string): DecayRow[] {
  const withoutBonus = { ...example.category, alternationBonusPct: 0 };
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

/** A short session of the example category, right after a different one (D56). */
export function alternationExample(
  data: HowItWorksData,
  example: Example,
  occurredOn: string,
): (Calculation & { unlockedBy: string }) | null {
  if (example.category.alternationBonusPct <= 0) return null;

  const other = data.categories.find(
    (category) =>
      category.alternationBonusPct > 0 && category.id !== example.category.id,
  );
  const unlockingActivity =
    other === undefined
      ? undefined
      : data.activities.find((activity) => activity.categoryId === other.id);
  if (other === undefined || unlockingActivity === undefined) return null;

  // An earlier entry of a different participating category: what unlocks C.
  const earlier: ApprovedLog = {
    id: 1,
    userId: 0,
    status: "approved",
    occurredOn,
    activityId: unlockingActivity.id,
    durationMinutes: null,
    createdAt: new Date(`${occurredOn}T12:00:00Z`),
    categoryId: other.id,
  };

  return {
    ...calculate(
      example,
      example.category,
      SHORT_SESSION_MINUTES,
      occurredOn,
      [earlier],
      [example.category.id, other.id],
    ),
    unlockedBy: other.name,
  };
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

/** `0,5` is +50% (see `alternationBonusMultiplier` in the engine). */
export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

export function formatDays(days: number): string {
  return days === 1 ? "1 dia" : `${days} dias`;
}
