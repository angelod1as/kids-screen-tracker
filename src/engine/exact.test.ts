import { describe, expect, it } from "vitest";

import {
  add,
  bandIndex,
  compare,
  decayedHours,
  divide,
  type Fraction,
  fraction,
  fromNumber,
  multiply,
  ONE,
  subtract,
  toCents,
} from "./exact";

/** D39. `fromNumber` reading the typed decimal is a choice nothing else would notice changing. */

const hours = (minutes: number): Fraction =>
  divide(fromNumber(minutes), fromNumber(60));

/** The decay as `decisions.md` states it: one band at a time, summed. */
function bandByBand(
  bucketHours: Fraction,
  activityHours: Fraction,
  step: Fraction,
): Fraction {
  const end = add(bucketHours, activityHours);
  let total = fraction(0n, 1n);
  let start = bucketHours;
  let index = bandIndex(bucketHours, step);

  while (subtract(end, start).n > 0n) {
    const boundary = multiply(step, fraction(index + 1n, 1n));
    const bandEnd = subtract(boundary, end).n < 0n ? boundary : end;

    total = add(
      total,
      multiply(subtract(bandEnd, start), { n: 1n, d: 1n << index }),
    );
    start = bandEnd;
    index += 1n;
  }

  return total;
}

describe("reading a double as the decimal it prints as", () => {
  it("takes 0,1 as a tenth, not as the binary fraction it is stored in", () => {
    expect(fromNumber(0.1)).toEqual({ n: 1n, d: 10n });
    expect(fromNumber(0.3)).toEqual({ n: 3n, d: 10n });
    expect(fromNumber(2.5)).toEqual({ n: 5n, d: 2n });
    expect(fromNumber(-1.25)).toEqual({ n: -5n, d: 4n });
  });

  it("takes whole numbers and zero without going through a string", () => {
    expect(fromNumber(0)).toEqual({ n: 0n, d: 1n });
    expect(fromNumber(3)).toEqual({ n: 3n, d: 1n });
    expect(fromNumber(-7)).toEqual({ n: -7n, d: 1n });
  });

  it("reads the exponent form `String` switches to on its own", () => {
    // A naive "split on the dot" would read "1e-7" as the integer 1.
    expect(fromNumber(1e-7)).toEqual({ n: 1n, d: 10_000_000n });
    expect(fromNumber(1.5e-7)).toEqual({ n: 3n, d: 20_000_000n });
    expect(fromNumber(1.5e21)).toEqual({
      n: 1_500_000_000_000_000_000_000n,
      d: 1n,
    });
  });

  it("refuses what has no decimal at all, rather than inventing one", () => {
    expect(() => fromNumber(Number.NaN)).toThrow(/exact fraction/);
    expect(() => fromNumber(Number.POSITIVE_INFINITY)).toThrow(
      /exact fraction/,
    );
  });
});

describe("D9's rounding, as the only rounding there is", () => {
  it("is half up, the way Math.round is", () => {
    expect(toCents(fromNumber(0.125))).toBe(13n);
    expect(toCents(fromNumber(0.135))).toBe(14n);
    expect(toCents(fromNumber(2))).toBe(200n);
  });

  it("rounds a negative half towards zero, the way Math.round does", () => {
    // Deltas of cents never reach this, but the rule stays `Math.round`'s.
    expect(toCents(fromNumber(-0.005))).toBe(0n);
    expect(toCents(fromNumber(-0.015))).toBe(-1n);
    expect(toCents(fromNumber(-1.235))).toBe(-123n);
  });

  it("does not round a value a hair under the half up", () => {
    // The float sum drifted over this boundary; the exact one never reaches it.
    expect(toCents(fraction(274_999n, 1_000_000n))).toBe(27n);
    expect(toCents(fraction(275_000n, 1_000_000n))).toBe(28n);
  });
});

describe("the decay, exactly", () => {
  it("is the table decisions.md opens with", () => {
    const step = fromNumber(1);

    expect(decayedHours(hours(0), hours(60), step)).toEqual(fromNumber(1));
    expect(decayedHours(hours(0), hours(120), step)).toEqual(fromNumber(1.5));
    expect(decayedHours(hours(0), hours(180), step)).toEqual(fromNumber(1.75));
    expect(decayedHours(hours(0), hours(240), step)).toEqual(fromNumber(1.875));
  });

  it("never reaches the asymptote of 2 × passo, and never has a floor (D2)", () => {
    const step = fromNumber(2);
    const reached = decayedHours(hours(0), hours(100 * 60), step);

    expect(subtract(fromNumber(4), reached).n > 0n).toBe(true);
    expect(reached.n > 0n).toBe(true);
    expect(decayedHours(hours(20_000 * 60), hours(60), fromNumber(1)).n).toBe(
      0n,
    );
  });

  it("agrees with the band-by-band sum it stands in for", () => {
    for (const stepMinutes of [3, 6, 15, 30, 60, 120]) {
      const step = hours(stepMinutes);

      for (const bucketMinutes of [0, 7, 22, 45, 90, 300]) {
        for (const minutes of [1, 13, 60, 137, 480, 1440]) {
          expect(
            decayedHours(hours(bucketMinutes), hours(minutes), step),
            `bucket ${bucketMinutes}min + ${minutes}min at a step of ${stepMinutes}min`,
          ).toEqual(bandByBand(hours(bucketMinutes), hours(minutes), step));
        }
      }
    }
  });

  /** No tail bound at all: what the closed form stands in for, affordable once. */
  function trueDecayedHours(
    bucket: Fraction,
    activity: Fraction,
    step: Fraction,
  ): Fraction {
    const end = add(bucket, activity);
    let total = fraction(0n, 1n);
    let at = bucket;
    let index = bandIndex(bucket, step);

    while (compare(at, end) < 0) {
      const boundary = multiply(step, fraction(index + 1n, 1n));
      const stop = compare(boundary, end) < 0 ? boundary : end;

      total = add(
        total,
        multiply(subtract(stop, at), fraction(1n, 2n ** index)),
      );
      at = stop;
      index += 1n;
    }

    return total;
  }

  it("agrees with the unbounded truth to the cent, where the bound bites", () => {
    // Measured, not argued: a prose proof of this once ran backwards.
    for (const stepHours of [0.25, 0.5]) {
      const step = fromNumber(stepHours);
      // Where band 8.192 begins, in minutes, from an empty bucket.
      const atBound = Math.round(8192 * stepHours * 60);

      for (const minutes of [
        atBound - 1,
        atBound,
        atBound + 1,
        atBound + 977,
      ]) {
        const value = decayedHours(hours(0), hours(minutes), step);
        const truth = trueDecayedHours(hours(0), hours(minutes), step);

        expect(
          compare(value, truth) <= 0,
          `step ${stepHours}, ${minutes} min: the bound must not overpay`,
        ).toBe(true);

        for (const rate of [
          fraction(1n, 100n),
          ONE,
          fraction(1_000_000n, 1n),
        ]) {
          expect(
            toCents(multiply(value, rate)),
            `step ${stepHours}, ${minutes} min, rate ${rate.n}/${rate.d}`,
          ).toBe(toCents(multiply(truth, rate)));
        }
      }
    }
  }, 120_000);

  it("never falls across the band the tail bound stops at", () => {
    // The sweep below steps over the `limit` band (D39); this walks through it
    // at the 0,25h floor, where a step-shaped clamp fell at 122.894 → 122.895.
    const step = fromNumber(0.25);
    const bucket = hours(0);
    let previous = fraction(-1n, 1n);
    const drops: string[] = [];

    for (let minutes = 122_870; minutes <= 122_910; minutes += 1) {
      const now = decayedHours(bucket, hours(minutes), step);

      if (compare(now, previous) < 0) drops.push(`${minutes - 1} → ${minutes}`);

      previous = now;
    }

    expect(drops).toEqual([]);
  });

  it("never falls as the duration grows, which is the whole point", () => {
    // Do not trim 0,001h as unreachable: only below the floor does the tail bound
    // bite inside this sweep, and a sweep stopping at the floor missed it (D39).
    // Non-decreasing, not strict: past the bound two durations can come back equal.
    for (const stepHours of [0.001, 0.05, 0.1, 0.25, 1, 2]) {
      const step = fromNumber(stepHours);

      for (const bucketMinutes of [0, 7, 22]) {
        let previous = fraction(-1n, 1n);

        for (let minutes = 1; minutes <= 600; minutes += 1) {
          const now = decayedHours(hours(bucketMinutes), hours(minutes), step);

          expect(
            subtract(now, previous).n >= 0n,
            `${minutes}min at a step of ${stepHours}h, bucket ${bucketMinutes}min`,
          ).toBe(true);

          previous = now;
        }
      }
    }
  });

  it("is strictly increasing wherever it is exact, which is everywhere real", () => {
    // The clamp needs 8192 bands; the 0,25h floor puts a whole day at 96.
    for (const stepHours of [0.05, 0.25, 1, 2]) {
      const step = fromNumber(stepHours);
      let previous = fraction(-1n, 1n);

      for (let minutes = 1; minutes <= 1440; minutes += 1) {
        const now = decayedHours(hours(22), hours(minutes), step);

        expect(
          subtract(now, previous).n > 0n,
          `${minutes}min at a step of ${stepHours}h`,
        ).toBe(true);

        previous = now;
      }
    }
  });

  it("costs the same on a step no loop over bands could survive", () => {
    // A band-by-band port would hang the boy's calculator on a keystroke here.
    const started = Date.now();

    expect(decayedHours(hours(0), hours(1440), fromNumber(0.001)).n > 0n).toBe(
      true,
    );
    expect(decayedHours(hours(0), hours(1440), fromNumber(1e-9)).n > 0n).toBe(
      true,
    );
    expect(decayedHours(hours(6000), hours(1440), fromNumber(1e-9))).toEqual(
      fraction(0n, 1n),
    );

    expect(Date.now() - started).toBeLessThan(500);
  });

  it("refuses a step of zero rather than dividing by it", () => {
    expect(() => decayedHours(hours(0), hours(60), fromNumber(0))).toThrow(
      /above zero/,
    );
  });
});
