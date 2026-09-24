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

/**
 * The two floors the Configuration screen puts in front of the engine (#26).
 *
 * The cases at the bottom are the ones that matter, and they are not assertions
 * about the floors — they are assertions about the **engine**, swept. A floor
 * justified only by a constant equal to itself is a floor nobody can argue with
 * and nobody can trust: what makes 0,25 the right number is that the engine
 * inverts below it and does not at or above it, and that is a thing to measure
 * rather than to declare.
 *
 * Both sweeps are bounded so the suite stays fast. The wide grids that chose
 * the number are in the pull request; what is kept here is the narrow pair that
 * fails if either half of the claim stops being true.
 */

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

/** A bucket of `minutes` already done in the category, on the same day (D3). */
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

/** What an entry of `minutes` pays, at `rate` and `step`, on that bucket. */
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

/** Every pair of neighbouring durations where a longer entry paid less. */
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
    // The four decaying rows of the seed, against the table in `decisions.md`.
    expect(asymptoteHours(2, 2)).toBe(8); // Corpo, ~8h a day
    expect(asymptoteHours(2, 1)).toBe(4); // Mente, ~4h
    expect(asymptoteHours(1, 2)).toBe(4); // Escola, ~4h
  });

  it("is nothing at all for a category that never decays (D2)", () => {
    expect(asymptoteHours(2, null)).toBeNull();
  });

  it("is nothing at all for a category that declares no rate (D11)", () => {
    // Convívio, Casa and Curinga. Guessing a rate here would put a number on
    // screen that the engine will never read.
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

  /**
   * The floor pinned by its consequence, not by a copy of itself.
   *
   * The previous version of this file asserted `isUsableDecayStep(0.24) ===
   * false`, which is the constant compared with itself: lowering the floor to
   * 0,15 failed that one case and nothing else, and the sweep that was supposed
   * to justify the number stayed green.
   *
   * D35's argument is about the *shape* of the table: at the seed's rate the
   * floor is the step at which a category is worth `taxa × 0,5` a day — 0,75 h
   * at 1,5 since #110 — and it is the largest such step. Both halves
   * are asserted, so the constant cannot move in either direction without a
   * case failing for the reason the decision gives.
   */
  it("is the step at which the seed's rate yields half of itself a day", () => {
    expect(asymptoteHours(SEED_RATE, MIN_DECAY_STEP_HOURS)).toBe(0.75);
  });

  it("is the largest step for which that is true", () => {
    // One hundredth lower — the finest the field can express — already pays
    // less, so nothing between here and the floor is a category worth
    // configuring rather than switching off.
    const finer = Math.round((MIN_DECAY_STEP_HOURS - 0.01) * 100) / 100;

    expect(asymptoteHours(SEED_RATE, finer)).toBeLessThan(0.75);
    expect(isUsableDecayStep(finer)).toBe(false);
  });

  /**
   * The property the floor used to be justified by, now held by the engine
   * itself — at every step, including the ones the floor refuses.
   *
   * This is the case that fails if D39's exact arithmetic is ever reverted, and
   * it is deliberately swept *below* the floor as well: the guarantee is not
   * "the values we allow happen to be safe", it is "the engine is monotone".
   * Under the old float chain these grids produced inversions at 0,05, 0,1,
   * 0,15 and 0,25 alike.
   */
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
    // Measured on the float engine: 0,25 first inverted at 771 min, 0,5 at
    // 1.587, 1 at 3.107 and 2 at 6.275 — always around 53 halvings. Nothing
    // caps a duration at 1.440 minutes: `requireDurationMinutes` accepts up to
    // a million, and D31 lets a session reach a full day.
    const offenders: string[] = [
      ...inversions(3, 0.25, [22], 900),
      ...inversions(3, 0.5, [0], 1700),
      ...inversions(3, 1, [0], 3200),
      ...inversions(3, 2, [0], 6400),
    ];

    expect(offenders).toEqual([]);
  });

  it("still pays the named pairs the same or more, never less", () => {
    // The two pairs the review named, and the one from the original report.
    // Each used to drop a cent; each is now flat or rising.
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
    // The pair the seed writes for the four categories with no bonus, D12's
    // Curinga among them.
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

  /**
   * The measurement the threshold exists for, reproduced.
   *
   * D6's window is `[day − n, day]` and D34 made it two-sided, so at `n = 0` it
   * is the day itself. The first entry of the category on any day finds nothing
   * in that window and is paid as a return — every day, for ever.
   */
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
        // Wide enough for both ends of the contrast. Pinned to the day itself,
        // `pay(3)` threw — the engine refuses a window shorter than the rules
        // it is about to apply — so the comparison the case is named for was
        // not merely missing, it was unreachable.
        historyFrom: "2026-09-10",
        historyTo: "2026-09-16",
        categoryFirstDay: "2026-09-12",
      }).hours;

    // Done yesterday, so this is not a return by any reading. At zero days it
    // is paid as one anyway — 2 h becomes 3 h — and at the seed's three days
    // it is not. That contrast is the whole measurement, and it is why the
    // threshold exists.
    expect(pay(0)).toBe(3);
    expect(pay(3)).toBe(2);
  });
});
