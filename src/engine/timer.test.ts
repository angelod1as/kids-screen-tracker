import { describe, expect, it } from "vitest";

import {
  ABANDON_AFTER_HOURS,
  abandonAt,
  activeSeconds,
  autoStop,
  dayEndsAt,
  durationMinutes,
  durationSeconds,
  reconcileTimer,
} from "./timer";
import type { TimerRules } from "./timer.rules";
import {
  failingTimerCases,
  START,
  summarise,
  TIMER_CASES,
} from "./timer.rules";

const REAL: TimerRules = {
  activeSeconds,
  autoStop,
  abandonAt,
  dayEndsAt,
  reconcileTimer,
  durationMinutes,
  durationSeconds,
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

describe("the timer as written", () => {
  it("answers every case of the table correctly", () => {
    expect(failingTimerCases(REAL)).toEqual([]);
  });

  it("has a table with something in it", () => {
    // A matrix run against an empty table proves nothing, loudly.
    expect(TIMER_CASES.length).toBeGreaterThan(20);
  });

  it("covers each rule with more than one case", () => {
    const perRule = new Map<string, number>();

    for (const timerCase of TIMER_CASES) {
      perRule.set(timerCase.rule, (perRule.get(timerCase.rule) ?? 0) + 1);
    }

    for (const [rule, count] of perRule) {
      expect(count, rule).toBeGreaterThan(1);
    }
  });

  it("counts twelve hours, and says so in a number D16 can be read against", () => {
    expect(ABANDON_AFTER_HOURS).toBe(12);
  });
});

/** D16 as a property: the same answer at a few hundred instants over a year, not three. */
describe("the result does not depend on when the app was opened", () => {
  const RUNNING = {
    startedAt: START,
    pausedAt: null,
    accumulatedSeconds: 0,
    status: "running" as const,
  };

  const PAUSED = {
    startedAt: START,
    pausedAt: new Date(START.getTime() + 30 * MINUTE),
    accumulatedSeconds: 30 * 60,
    status: "paused" as const,
  };

  function instantsFrom(cutMs: number): Date[] {
    const offsets = [
      0,
      1,
      999,
      SECOND,
      37 * SECOND,
      MINUTE,
      59 * MINUTE,
      HOUR,
      5 * HOUR,
      23 * HOUR,
      24 * HOUR,
      7 * 24 * HOUR,
      30 * 24 * HOUR,
      365 * 24 * HOUR,
    ];
    const spread = Array.from(
      { length: 200 },
      (_, index) => index * 1_000_037 + 13,
    );

    return [...offsets, ...spread].map((offset) => new Date(cutMs + offset));
  }

  it("settles a session that passed its limit at the limit, whenever it is read", () => {
    const cut = START.getTime() + 2 * HOUR;
    const answers = new Set(
      instantsFrom(cut).map((now) =>
        summarise(reconcileTimer(RUNNING, 120, now)),
      ),
    );

    expect([...answers]).toEqual([
      `stopped · 7200 · 7200 · ${new Date(cut).toISOString()} · auto`,
    ]);
  });

  it("abandons a pause at the twelfth hour, whenever it is read", () => {
    const cut = START.getTime() + 30 * MINUTE + ABANDON_AFTER_HOURS * HOUR;
    const answers = new Set(
      instantsFrom(cut).map((now) =>
        summarise(reconcileTimer(PAUSED, 120, now)),
      ),
    );

    expect([...answers]).toEqual([
      `abandoned · 1800 · 1800 · ${new Date(cut).toISOString()} · manual`,
    ]);
  });

  it("gives a longer session no less than a shorter one, up to the cut", () => {
    // Not a rule anybody wrote down, and the one thing a clock may never do.
    let previous = -1;

    for (let offset = 0; offset <= 2 * HOUR; offset += 7 * SECOND) {
      const seconds = reconcileTimer(
        RUNNING,
        120,
        new Date(START.getTime() + offset),
      ).activeSeconds;

      expect(seconds).toBeGreaterThanOrEqual(previous);
      previous = seconds;
    }
  });
});

describe("a session that is already over its allowance", () => {
  it("stops the moment it is resumed, and freezes at the allowance", () => {
    const banked = {
      startedAt: START,
      pausedAt: new Date(START.getTime() + 3 * HOUR),
      accumulatedSeconds: 3 * 60 * 60,
      status: "running" as const,
    };

    expect(
      summarise(
        reconcileTimer(banked, 60, new Date(START.getTime() + 3 * HOUR + 1)),
      ),
    ).toBe(
      `stopped · 3600 · 3600 · ${new Date(START.getTime() + 3 * HOUR).toISOString()} · auto`,
    );
  });
});
