import type { Reconciliation, TimerState } from "./timer";

/*
 * The rules of #18 and #19, one case at a time. `timer.test.ts` runs the table on
 * the real functions, and `timer.sabotage.test.ts` on mutants that must fail it.
 */

export type TimerRules = {
  activeSeconds: (timer: TimerState, now: Date) => number;
  autoStop: (
    timer: TimerState,
    maxSessionMinutes: number | null,
  ) => { at: Date; activeSeconds: number } | null;
  abandonAt: (timer: TimerState) => Date | null;
  dayEndsAt: (timer: TimerState) => Date;
  reconcileTimer: (
    timer: TimerState,
    maxSessionMinutes: number | null,
    now: Date,
  ) => Reconciliation;
  durationMinutes: (seconds: number) => number;
  durationSeconds: (seconds: number) => number;
};

export type TimerCase = {
  /** Which acceptance criterion of #18 or #19 this case belongs to. */
  rule: string;
  name: string;
  run: (rules: TimerRules) => unknown;
  expected: unknown;
};

/**
 * 10:00 in São Paulo. Not noon: a pause begun after midday is ended by midnight
 * (D31) before the twelve-hour abandonment is reached.
 */
export const START = new Date("2026-09-01T13:00:00.000Z");

/** The instant São Paulo's next day begins: fourteen hours after `START`. */
export const DAY_END = new Date("2026-09-02T03:00:00.000Z");

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

function at(offsetMs: number): Date {
  return new Date(START.getTime() + offsetMs);
}

/** A session that has been running since `START` and never paused. */
const RUNNING: TimerState = {
  startedAt: START,
  pausedAt: null,
  accumulatedSeconds: 0,
  status: "running",
};

/** Paused after half an hour, at 10:30. */
const PAUSED: TimerState = {
  startedAt: START,
  pausedAt: at(30 * MINUTE),
  accumulatedSeconds: 30 * 60,
  status: "paused",
};

/** Resumed at 11:00 with half an hour already banked. */
const RESUMED: TimerState = {
  startedAt: START,
  pausedAt: at(HOUR),
  accumulatedSeconds: 30 * 60,
  status: "running",
};

/**
 * The session a boy parks: started at 23:55 and paused a minute later, so that
 * midnight arrives long before the twelve hours of a pause do.
 */
const PARKED: TimerState = {
  startedAt: new Date("2026-09-02T02:55:00.000Z"),
  pausedAt: new Date("2026-09-02T02:56:00.000Z"),
  accumulatedSeconds: 60,
  status: "paused",
};

/**
 * Reported and stored seconds both, because they can disagree: a mutant froze the
 * row at the clock while reporting the limit, the screen right and the row wrong.
 */
export function summarise(reconciliation: Reconciliation): string {
  const settled = reconciliation.settledAt;

  return [
    reconciliation.state.status,
    reconciliation.activeSeconds,
    reconciliation.state.accumulatedSeconds,
    settled === null ? "open" : settled.toISOString(),
    reconciliation.autoStopped ? "auto" : "manual",
  ].join(" · ");
}

export const TIMER_CASES: readonly TimerCase[] = [
  {
    rule: "a pause does not count time",
    name: "a running session counts the seconds since it started",
    run: (rules) => rules.activeSeconds(RUNNING, at(90 * SECOND)),
    expected: 90,
  },
  {
    rule: "a pause does not count time",
    name: "a paused session counts nothing more, five hours later",
    run: (rules) => rules.activeSeconds(PAUSED, at(5 * HOUR)),
    expected: 30 * 60,
  },
  {
    rule: "a pause does not count time",
    name: "a resumed session keeps what it had and counts on from the resume",
    run: (rules) => rules.activeSeconds(RESUMED, at(HOUR + 10 * MINUTE)),
    expected: 30 * 60 + 10 * 60,
  },
  {
    rule: "a pause does not count time",
    name: "the half hour spent paused is nowhere in the total",
    // Started at 10:00, paused 10:30 to 11:00, read at 11:10. Ninety minutes of
    // wall clock, forty of activity.
    run: (rules) => rules.activeSeconds(RESUMED, at(90 * MINUTE)),
    expected: 60 * 60,
  },
  {
    rule: "a pause does not count time",
    name: "a clock that ran backwards does not un-count seconds",
    run: (rules) => rules.activeSeconds(RUNNING, at(-5 * MINUTE)),
    expected: 0,
  },

  {
    rule: "the limit is on active time and the cut is exact",
    name: "a session with no pause stops at started_at plus the limit",
    run: (rules) => rules.autoStop(RUNNING, 120)?.at.getTime() ?? "none",
    expected: at(2 * HOUR).getTime(),
  },
  {
    rule: "the limit is on active time and the cut is exact",
    name: "a session that paused gets the rest of its allowance afterwards",
    // Half an hour banked, so ninety minutes of the two-hour allowance are left
    // from the 11:00 resume.
    run: (rules) => rules.autoStop(RESUMED, 120)?.at.getTime() ?? "none",
    expected: at(HOUR + 90 * MINUTE).getTime(),
  },
  {
    rule: "the limit is on active time and the cut is exact",
    name: "the cut freezes the allowance itself, not the clock",
    run: (rules) => rules.autoStop(RESUMED, 120)?.activeSeconds ?? "none",
    expected: 2 * 60 * 60,
  },
  {
    rule: "the limit is on active time and the cut is exact",
    name: "a paused session is not on its way to a limit",
    run: (rules) => rules.autoStop(PAUSED, 120) ?? "none",
    expected: "none",
  },
  {
    rule: "the limit is on active time and the cut is exact",
    name: "an activity with no limit never stops by itself",
    run: (rules) => rules.autoStop(RUNNING, null) ?? "none",
    expected: "none",
  },
  {
    rule: "the limit is on active time and the cut is exact",
    name: "read a second past the limit, the session ended at the limit",
    run: (rules) =>
      summarise(rules.reconcileTimer(RUNNING, 120, at(2 * HOUR + SECOND))),
    expected: `stopped · 7200 · 7200 · ${at(2 * HOUR).toISOString()} · auto`,
  },
  {
    rule: "the limit is on active time and the cut is exact",
    name: "read at the limit exactly, the session ended at the limit",
    run: (rules) => summarise(rules.reconcileTimer(RUNNING, 120, at(2 * HOUR))),
    expected: `stopped · 7200 · 7200 · ${at(2 * HOUR).toISOString()} · auto`,
  },
  {
    rule: "the limit is on active time and the cut is exact",
    name: "read a second before it, the session is still the boy's",
    run: (rules) =>
      summarise(rules.reconcileTimer(RUNNING, 120, at(2 * HOUR - SECOND))),
    expected: "running · 7199 · 0 · open · manual",
  },

  {
    rule: "the answer comes from the stamps, not from the read",
    name: "opened one hour after the limit",
    run: (rules) => summarise(rules.reconcileTimer(RUNNING, 120, at(3 * HOUR))),
    expected: `stopped · 7200 · 7200 · ${at(2 * HOUR).toISOString()} · auto`,
  },
  {
    rule: "the answer comes from the stamps, not from the read",
    name: "opened thirty days after the limit, to the same answer",
    run: (rules) =>
      summarise(rules.reconcileTimer(RUNNING, 120, at(30 * 24 * HOUR))),
    expected: `stopped · 7200 · 7200 · ${at(2 * HOUR).toISOString()} · auto`,
  },
  {
    rule: "the answer comes from the stamps, not from the read",
    name: "a session that paused before the limit lands on the same cut, whenever it is read",
    run: (rules) =>
      summarise(rules.reconcileTimer(RESUMED, 120, at(90 * 24 * HOUR))),
    expected: `stopped · 7200 · 7200 · ${at(HOUR + 90 * MINUTE).toISOString()} · auto`,
  },

  {
    rule: "a pause of twelve hours is abandoned and produces no record",
    name: "the twelve hours are counted from the pause",
    run: (rules) => rules.abandonAt(PAUSED)?.toISOString() ?? "none",
    expected: at(30 * MINUTE + 12 * HOUR).toISOString(),
  },
  {
    rule: "a pause of twelve hours is abandoned and produces no record",
    name: "a running session is not on its way to being abandoned",
    run: (rules) => rules.abandonAt(RUNNING) ?? "none",
    expected: "none",
  },
  {
    rule: "a pause of twelve hours is abandoned and produces no record",
    name: "a session that was paused and resumed is not on its way either",
    // `paused_at` is filled on a running session too, so the status decides.
    run: (rules) => rules.abandonAt(RESUMED) ?? "none",
    expected: "none",
  },
  {
    rule: "a pause of twelve hours is abandoned and produces no record",
    name: "eleven hours and fifty-nine minutes is still a pause",
    run: (rules) =>
      summarise(
        rules.reconcileTimer(PAUSED, 120, at(30 * MINUTE + 12 * HOUR - MINUTE)),
      ),
    expected: "paused · 1800 · 1800 · open · manual",
  },
  {
    rule: "a pause of twelve hours is abandoned and produces no record",
    name: "at twelve hours it is abandoned, and never marked auto-stopped",
    run: (rules) =>
      summarise(rules.reconcileTimer(PAUSED, 120, at(30 * MINUTE + 12 * HOUR))),
    expected: `abandoned · 1800 · 1800 · ${at(30 * MINUTE + 12 * HOUR).toISOString()} · manual`,
  },
  {
    rule: "a pause of twelve hours is abandoned and produces no record",
    name: "a week later it is the same abandonment, at the same instant",
    run: (rules) =>
      summarise(rules.reconcileTimer(PAUSED, 120, at(7 * 24 * HOUR))),
    expected: `abandoned · 1800 · 1800 · ${at(30 * MINUTE + 12 * HOUR).toISOString()} · manual`,
  },

  {
    rule: "a session ends with the day it began on",
    name: "the day ends at the São Paulo midnight after the session started",
    run: (rules) => rules.dayEndsAt(RUNNING).toISOString(),
    expected: DAY_END.toISOString(),
  },
  {
    rule: "a session ends with the day it began on",
    name: "a pause does not move the day the session has to end on",
    run: (rules) => rules.dayEndsAt(PAUSED).toISOString(),
    expected: DAY_END.toISOString(),
  },
  {
    rule: "a session ends with the day it began on",
    name: "a session with no limit still ends at midnight, with what it counted",
    run: (rules) =>
      summarise(rules.reconcileTimer(RUNNING, null, at(20 * HOUR))),
    expected: `stopped · ${14 * 60 * 60} · ${14 * 60 * 60} · ${DAY_END.toISOString()} · auto`,
  },
  {
    rule: "a session ends with the day it began on",
    name: "a second before midnight it is still the boy's",
    run: (rules) =>
      summarise(rules.reconcileTimer(RUNNING, null, at(14 * HOUR - SECOND))),
    expected: `running · ${14 * 60 * 60 - 1} · 0 · open · manual`,
  },
  {
    rule: "a session ends with the day it began on",
    name: "a session parked paused overnight ends at midnight with what it counted",
    run: (rules) => summarise(rules.reconcileTimer(PARKED, 120, at(30 * HOUR))),
    expected: `stopped · 60 · 60 · ${DAY_END.toISOString()} · auto`,
  },
  {
    rule: "a session ends with the day it began on",
    name: "the day's end says why it ended, so the boy is told the right thing",
    run: (rules) =>
      rules.reconcileTimer(RUNNING, null, at(20 * HOUR)).reason ?? "open",
    expected: "dayEnd",
  },
  {
    rule: "a session ends with the day it began on",
    name: "a limit reached before midnight is still the limit",
    run: (rules) =>
      rules.reconcileTimer(RUNNING, 120, at(20 * HOUR)).reason ?? "open",
    expected: "limit",
  },
  {
    rule: "a session ends with the day it began on",
    name: "a pause abandoned before midnight is still abandoned",
    run: (rules) =>
      rules.reconcileTimer(PAUSED, 120, at(30 * HOUR)).reason ?? "open",
    expected: "abandoned",
  },
  {
    rule: "a session ends with the day it began on",
    name: "a session still running says nothing ended it",
    run: (rules) =>
      rules.reconcileTimer(RUNNING, 120, at(HOUR)).reason ?? "open",
    expected: "open",
  },

  {
    rule: "the duration is the active minutes, rounded to the nearest, no floor",
    name: "a session of no length is worth no minutes",
    run: (rules) => rules.durationMinutes(0),
    expected: 0,
  },
  {
    rule: "the duration is the active minutes, rounded to the nearest, no floor",
    name: "ten seconds is nothing, which is the case that opened #71",
    run: (rules) => rules.durationMinutes(10),
    expected: 0,
  },
  {
    rule: "the duration is the active minutes, rounded to the nearest, no floor",
    name: "twenty-nine seconds rounds down to nothing",
    run: (rules) => rules.durationMinutes(29),
    expected: 0,
  },
  {
    rule: "the duration is the active minutes, rounded to the nearest, no floor",
    name: "thirty seconds is the first minute: half rounds up",
    run: (rules) => rules.durationMinutes(30),
    expected: 1,
  },
  {
    rule: "the duration is the active minutes, rounded to the nearest, no floor",
    name: "thirty-one seconds rounds up to a minute",
    run: (rules) => rules.durationMinutes(31),
    expected: 1,
  },
  {
    rule: "the duration is the active minutes, rounded to the nearest, no floor",
    name: "eighty-nine seconds is a minute",
    run: (rules) => rules.durationMinutes(89),
    expected: 1,
  },
  {
    rule: "the duration is the active minutes, rounded to the nearest, no floor",
    name: "ninety seconds is two",
    run: (rules) => rules.durationMinutes(90),
    expected: 2,
  },
  {
    rule: "the duration is the active minutes, rounded to the nearest, no floor",
    name: "an hour is sixty",
    run: (rules) => rules.durationMinutes(3600),
    expected: 60,
  },
  {
    rule: "the duration is the active minutes, rounded to the nearest, no floor",
    name: "a three-hour limit is a hundred and eighty",
    run: (rules) => rules.durationMinutes(3 * 60 * 60),
    expected: 180,
  },
  {
    rule: "the duration is the active minutes, rounded to the nearest, no floor",
    name: "a fraction of a second never rounds a session up on its own",
    run: (rules) => rules.durationMinutes(29.999),
    expected: 0,
  },
  {
    rule: "the duration is the active minutes, rounded to the nearest, no floor",
    name: "a clock that ran backwards is no minutes, not a negative one",
    run: (rules) => rules.durationMinutes(-90),
    expected: 0,
  },
  {
    rule: "the duration is the active minutes, rounded to the nearest, no floor",
    // Stopped at 11:00:10: thirty minutes and ten seconds of activity.
    name: "a session with a pause is priced on its active seconds alone",
    run: (rules) =>
      rules.durationMinutes(
        rules.activeSeconds(RESUMED, at(HOUR + 10 * SECOND)),
      ),
    expected: 30,
  },
  {
    rule: "the duration is the whole active seconds, as measured",
    name: "the seconds a record is written with are floored, never rounded up",
    run: (rules) => rules.durationSeconds(29.999),
    expected: 29,
  },
  {
    rule: "the duration is the whole active seconds, as measured",
    name: "ten seconds are kept as ten, which the minutes alone could not say",
    run: (rules) => rules.durationSeconds(10),
    expected: 10,
  },
  {
    rule: "the duration is the whole active seconds, as measured",
    name: "a clock that ran backwards banks no seconds",
    run: (rules) => rules.durationSeconds(-90),
    expected: 0,
  },
];

/** The cases `rules` gets wrong. Empty means it agrees with #18 and #19. */
export function failingTimerCases(rules: TimerRules): TimerCase[] {
  return TIMER_CASES.filter(
    (timerCase) => timerCase.run(rules) !== timerCase.expected,
  );
}
