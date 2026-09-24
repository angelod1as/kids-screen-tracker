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

/**
 * The arithmetic the engine's monotonicity rests on (D39).
 *
 * Two of these cases are the ones that would rot silently. `fromNumber` reading
 * a `double` as the decimal an adult typed is a *choice*, not a conversion, and
 * nothing else in the suite would notice it changing. And `decayedHours` is a
 * closed form standing in for a sum nobody can afford to compute — so it is
 * checked against that sum, band by band, wherever the sum is small enough to
 * run.
 */

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
    // The whole point. `0.1` is really 3602879701896397/36028797018963968 in
    // memory, and reading it that way would be arithmetic about a rounding
    // error rather than about the number the adult typed into the field.
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
    // Under 1e-6 a double prints as "1e-7", which the naive "split on the dot"
    // reading would have taken as the integer 1.
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
    // The lines that take hours away are deltas of cents and never reach this,
    // but the rule is `floor(100x + ½)` and it has to be the same rule the
    // engine has always applied, not a tidier one. `Math.round(-0.5)` is `-0`,
    // which is `0` once it is a count of cents.
    expect(toCents(fromNumber(-0.005))).toBe(0n);
    expect(toCents(fromNumber(-0.015))).toBe(-1n);
    expect(toCents(fromNumber(-1.235))).toBe(-123n);
  });

  it("does not round a value a hair under the half up", () => {
    // 0,274999…h is the pair the floor used to be justified by: the float sum
    // drifted over the boundary, the exact one never reaches it.
    expect(toCents(fraction(274_999n, 1_000_000n))).toBe(27n);
    expect(toCents(fraction(275_000n, 1_000_000n))).toBe(28n);
  });
});

describe("the decay, exactly", () => {
  it("is the table decisions.md opens with", () => {
    const step = fromNumber(1);

    // An empty bucket: the first hour whole, the second halved, and so on.
    expect(decayedHours(hours(0), hours(60), step)).toEqual(fromNumber(1));
    expect(decayedHours(hours(0), hours(120), step)).toEqual(fromNumber(1.5));
    expect(decayedHours(hours(0), hours(180), step)).toEqual(fromNumber(1.75));
    expect(decayedHours(hours(0), hours(240), step)).toEqual(fromNumber(1.875));
  });

  it("never reaches the asymptote of 2 × passo, and never has a floor (D2)", () => {
    const step = fromNumber(2);
    const reached = decayedHours(hours(0), hours(100 * 60), step);

    // Below `2 × passo` — which is `4` hours of activity here — but above
    // everything short of it: no ceiling that is ever touched, and no band
    // worth exactly nothing however deep the day goes.
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

  /**
   * The decay summed band by band with **no** tail bound at all.
   *
   * D2's sentence, taken literally, and deliberately not the closed form: this
   * is what the closed form stands in for, so it is what the closed form has to
   * be checked against. Only usable for a bounded number of bands, which is why
   * the closed form exists — but the cases below cross about 8.192, and that is
   * perfectly computable once.
   */
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
    // The bound's own claim, checked against the thing it approximates rather
    // than argued in prose.
    //
    // An earlier docstring proved "no cent moves" from a minimum distance to a
    // half cent of `1/(200·den)`, with `den < 2^(nB+5608)`. That is false in
    // exactly the regime that matters: the denominator carries `2^n_fim`, and
    // where the clamp bites `n_fim > nB + 8192`, so the inequality runs
    // backwards. The conclusion held; the argument did not — so the argument is
    // replaced by a measurement against the truth.
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

        // The bound only ever takes value away, never adds it.
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
    // The case the sweep below cannot reach, and the reason it cannot.
    //
    // That sweep runs 1..600 min. At 0,001h it does cross the bound, but one
    // minute is about 16,7 bands there, so the index jumps over the `limit`
    // band without ever landing inside it with a remainder — it steps over the
    // defect. At 0,25h, the floor this screen imposes, the bound sits at
    // 122.880 min, far past 600. The grid went past the bug on both sides.
    //
    // So this walks minute by minute *through* the `limit` band, at the legal
    // floor and at a duration the column accepts. With the clamp written as a
    // step on the band index instead of a minimum on the value, 122.894 →
    // 122.895 fell by `7/(60 · 2^8192)` h — no cent anywhere, and the whole
    // claim of the module.
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
    // The property `calculate.ts` inherits: `round2` of a non-decreasing
    // function is non-decreasing, so no longer session can ever pay less. Swept
    // below the configuration floor as well, because the guarantee is about the
    // arithmetic and not about the values the screen allows.
    //
    // **Do not trim 0,001h out of that list as dead weight.** D35 floors the
    // step at 0,25h, so it looks like a value nothing can reach — and that is
    // exactly why it is here. The tail bound only bites past 8192 bands, which
    // no step a category can actually be given ever reaches, so a sweep that
    // stopped at the floor would pass over a broken bound for ever. It did:
    // the first version of that bound clamped the halving exponent while still
    // subtracting the true remainder, which made this function non-monotone
    // past 8192 bands (72 drops between 1 and 600 minutes at 0,001h, the first
    // at 494), and every test in the repository stayed green because they all
    // ran at 0,05h and above. The bug was in the bound written to make the
    // arithmetic safe, and the proof beside it was sound about cents and silent
    // about monotonicity — the half this file exists for.
    //
    // Non-decreasing rather than strictly increasing, because of the one place
    // the answer is bounded rather than exact: past `EXACT_TAIL_HALVINGS` bands
    // — 10 hours of activity at a step of 0,001h — the entry is clamped and two
    // neighbouring durations can come back equal. Equal is all monotonicity
    // asks for, and they differ by less than `2^-8192` hours in truth.
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
    // The clamp needs more than 8192 bands to bite, and the Configuration
    // screen's floor of 0,25h puts a whole day at 96. So on every step a
    // category can actually be given, one more minute is always worth strictly
    // more than none.
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
    // 0,001h over a day is 24.000 bands, and a step of 1e-9 is 10^13 of them.
    // The closed form does not care, and the guard on the starting band answers
    // the second one without building the shift at all. A band-by-band port
    // would hang the boy's calculator on a keystroke here.
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
