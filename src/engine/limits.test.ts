import { describe, expect, it } from "vitest";

import type { ApprovedLog } from "./calculate";
import { calculateEarnedHours } from "./calculate";
import {
  asymptoteHours,
  isUsableDecayStep,
  isUsableReturnBonus,
  MIN_DECAY_STEP_HOURS,
  MIN_RETURN_BONUS_AFTER_DAYS,
  SEED_RATE,
} from "./limits";

/** The sweeps are bounded to stay fast; the wide grids are in D35 and D39. */

const DAY = "2026-09-13";

const ACTIVITY = {
  id: 1,
  categoryId: 1,
  name: "Probe",
  calcMode: "duration" as const,
  value: 3,
  qualityGraded: false,
  repeatCooldownDays: 0,
};

function bucket(minutes: number): ApprovedLog[] {
  if (minutes === 0) return [];

  return [
    {
      id: 1,
      userId: 3,
      occurredOn: DAY,
      activityId: 1,
      categoryId: 1,
      durationMinutes: minutes,
      createdAt: new Date("2026-09-13T09:00:00.000Z"),
      status: "approved",
    },
  ];
}

function paid(
  bucketMinutes: number,
  minutes: number,
  rate: number,
  step: number,
): number {
  return calculateEarnedHours({
    userId: 3,
    activity: { ...ACTIVITY, value: rate },
    category: {
      id: 1,
      name: "Probe",
      decayStepHours: step,
      returnBonusPct: 0,
      returnBonusAfterDays: 0,
    },
    occurredOn: DAY,
    durationMinutes: minutes,
    history: bucket(bucketMinutes),
    historyFrom: DAY,
    historyTo: DAY,
    categoryFirstDay: null,
  }).hours;
}

function inversions(
  rate: number,
  step: number,
  buckets: readonly number[],
  upToMinutes: number,
): string[] {
  const found: string[] = [];

  for (const bucketMinutes of buckets) {
    let previous = Number.NEGATIVE_INFINITY;

    for (let minutes = 1; minutes <= upToMinutes; minutes += 1) {
      const hours = paid(bucketMinutes, minutes, rate, step);

      if (hours < previous) {
        found.push(
          `bucket ${bucketMinutes}min: ${minutes - 1}min paid ${previous}h, ${minutes}min paid ${hours}h`,
        );
      }

      previous = hours;
    }
  }

  return found;
}

describe("the asymptote a category is calibrated by", () => {
  it("is the identity decisions.md opens with: rate × step × 2", () => {
    expect(asymptoteHours(2, 2)).toBe(8);
    expect(asymptoteHours(2, 1)).toBe(4);
    expect(asymptoteHours(1, 2)).toBe(4);
  });

  it("is nothing at all for a category that never decays (D2)", () => {
    expect(asymptoteHours(2, null)).toBeNull();
  });

  it("is nothing at all for a category that declares no rate (D11)", () => {
    // A guessed rate would put a number on screen the engine never reads.
    expect(asymptoteHours(null, 1)).toBeNull();
    expect(asymptoteHours(null, null)).toBeNull();
  });
});

describe("the decay step floor (D35)", () => {
  it("lets a category with no decay through, because that is the off switch", () => {
    expect(isUsableDecayStep(null)).toBe(true);
  });

  it("accepts the floor itself and everything above it", () => {
    expect(isUsableDecayStep(MIN_DECAY_STEP_HOURS)).toBe(true);
    expect(isUsableDecayStep(0.5)).toBe(true);
    expect(isUsableDecayStep(2)).toBe(true);
  });

  it("refuses a step of zero and a negative one", () => {
    expect(isUsableDecayStep(0)).toBe(false);
    expect(isUsableDecayStep(-1)).toBe(false);
  });

  /** Pinned by D35's consequence, not by a copy of the constant, in both directions. */
  it("is the step at which the seed's rate yields half of itself a day", () => {
    expect(asymptoteHours(SEED_RATE, MIN_DECAY_STEP_HOURS)).toBe(0.75);
  });

  it("is the largest step for which that is true", () => {
    // A hundredth is the finest the field can express.
    const finer = Math.round((MIN_DECAY_STEP_HOURS - 0.01) * 100) / 100;

    expect(asymptoteHours(SEED_RATE, finer)).toBeLessThan(0.75);
    expect(isUsableDecayStep(finer)).toBe(false);
  });

  /** Fails if D39 is reverted. Swept below the floor too: the engine is monotone, not the floor. */
  it("never pays less for more, at any step the field can express", () => {
    const offenders: string[] = [];

    for (const step of [0.05, 0.1, 0.15, MIN_DECAY_STEP_HOURS, 0.5, 1, 2]) {
      for (const rate of [1, 1.37, 2, 3]) {
        offenders.push(...inversions(rate, step, [0, 7, 22, 47], 400));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("holds past the durations where every float step used to break", () => {
    // Just past where the float engine first inverted (D35). Nothing caps a
    // duration at 1.440 min: `requireDurationMinutes` accepts up to a million.
    const offenders: string[] = [
      ...inversions(3, 0.25, [22], 900),
      ...inversions(3, 0.5, [0], 1700),
      ...inversions(3, 1, [0], 3200),
      ...inversions(3, 2, [0], 6400),
    ];

    expect(offenders).toEqual([]);
  });

  it("still pays the named pairs the same or more, never less", () => {
    // Each of these used to drop a cent in float.
    for (const [bucket, at, rate, step] of [
      [22, 785, 3, 0.25],
      [7, 815, 1.5, 0.25],
      [7, 325, 3, 0.1],
    ] as const) {
      expect(
        paid(bucket, at, rate, step),
        `${at}min at rate ${rate}, step ${step}`,
      ).toBeGreaterThanOrEqual(paid(bucket, at - 1, rate, step));
    }
  });
});

describe("the return bonus threshold", () => {
  it("lets a category with no bonus keep any threshold, including zero", () => {
    // The seed's pair for the categories with no bonus.
    expect(isUsableReturnBonus(0, 0)).toBe(true);
    expect(isUsableReturnBonus(0, 7)).toBe(true);
  });

  it("refuses a bonus with a threshold of zero", () => {
    expect(isUsableReturnBonus(0.5, 0)).toBe(false);
  });

  it("accepts a bonus from one day, and from the seed's three", () => {
    expect(isUsableReturnBonus(0.5, MIN_RETURN_BONUS_AFTER_DAYS)).toBe(true);
    expect(isUsableReturnBonus(0.5, 3)).toBe(true);
  });

  /** D36's measurement, reproduced. */
  it("is what stops a return bonus from being a permanent one", () => {
    const fixed = {
      id: 2,
      categoryId: 1,
      name: "Probe fixo",
      calcMode: "fixed" as const,
      value: 2,
      qualityGraded: false,
      repeatCooldownDays: 0,
    };
    const yesterday: ApprovedLog[] = [
      {
        id: 1,
        userId: 3,
        occurredOn: "2026-09-12",
        activityId: 2,
        categoryId: 1,
        durationMinutes: null,
        createdAt: new Date("2026-09-12T12:00:00.000Z"),
        status: "approved",
      },
    ];

    const pay = (afterDays: number) =>
      calculateEarnedHours({
        userId: 3,
        activity: fixed,
        category: {
          id: 1,
          name: "Probe",
          decayStepHours: null,
          returnBonusPct: 0.5,
          returnBonusAfterDays: afterDays,
        },
        occurredOn: DAY,
        history: yesterday,
        // Wide enough for `pay(3)`: the engine refuses a shorter window.
        historyFrom: "2026-09-10",
        historyTo: "2026-09-16",
        categoryFirstDay: "2026-09-12",
      }).hours;

    // Done yesterday, so not a return; at zero days it is paid as one anyway.
    expect(pay(0)).toBe(3);
    expect(pay(3)).toBe(2);
  });
});
