import type { Timer } from "../db/schema";
import { saoPauloDay, saoPauloDayStart, shiftDate } from "./day";

/**
 * The timer as pure arithmetic over its stamps; `now` is always a parameter, so
 * the cut depends on the stamps and not on when the app was opened (#19). D16
 * forbids a background process, so every read reconciles instead.
 */

/*
 * `paused_at` is the boundary of the current stretch: the pause start while
 * paused, the pause end while running. `started_at` never moves, so the log
 * keeps the session's true beginning.
 */

export type TimerStatus = Timer["status"];

/** `Pick`, so a schema column that changes shape breaks this at compile time. */
export type TimerState = Pick<
  Timer,
  "startedAt" | "pausedAt" | "accumulatedSeconds" | "status"
>;

const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;

/** D16's twelve hours: "put the book down to eat" versus "went to bed". */
export const ABANDON_AFTER_HOURS = 12;

const ABANDON_AFTER_MS = ABANDON_AFTER_HOURS * 60 * 60 * MS_PER_SECOND;

/** The one place that reads the overloaded `paused_at`. Only meaningful while running. */
function stretchStartedAt(timer: TimerState): Date {
  return timer.pausedAt ?? timer.startedAt;
}

/**
 * D17: pauses excluded. Floored at zero: a clock that moved backwards must not
 * shrink the day's bucket.
 */
export function activeSeconds(timer: TimerState, now: Date): number {
  if (timer.status !== "running") {
    return timer.accumulatedSeconds;
  }

  const elapsed =
    (now.getTime() - stretchStartedAt(timer).getTime()) / MS_PER_SECOND;

  return timer.accumulatedSeconds + Math.max(0, elapsed);
}

/**
 * #19 measures the limit in active time, so a pause defers the cut. The
 * allowance comes back with the instant so no caller recomputes it.
 */
export function autoStop(
  timer: TimerState,
  maxSessionMinutes: number | null,
): { at: Date; activeSeconds: number } | null {
  if (timer.status !== "running" || maxSessionMinutes === null) {
    return null;
  }

  const limitSeconds = maxSessionMinutes * SECONDS_PER_MINUTE;
  const remaining = limitSeconds - timer.accumulatedSeconds;

  return {
    at: new Date(
      stretchStartedAt(timer).getTime() +
        Math.max(0, remaining) * MS_PER_SECOND,
    ),
    activeSeconds: limitSeconds,
  };
}

/** Twelve hours after the pause began (D16), not after anybody looked. */
export function abandonAt(timer: TimerState): Date | null {
  return timer.status === "paused" && timer.pausedAt !== null
    ? new Date(timer.pausedAt.getTime() + ABANDON_AFTER_MS)
    : null;
}

/**
 * A session does not cross midnight (D31): its hours would land in a day that
 * is over, at that day's rate. Also the only bound on `accumulated_seconds`.
 */
export function dayEndsAt(timer: TimerState): Date {
  return saoPauloDayStart(shiftDate(saoPauloDay(timer.startedAt), 1));
}

/** How a session ended without the boy ending it. */
export type SettlementReason = "limit" | "dayEnd" | "abandoned";

export type Reconciliation = {
  state: TimerState;
  /** When the session ended by itself, or null while it is still the boy's. */
  settledAt: Date | null;
  reason: SettlementReason | null;
  /** D16: marks the record of an automatic stop. An abandonment has none. */
  autoStopped: boolean;
  /** Active seconds at `now`, or frozen at the cut when the session ended. */
  activeSeconds: number;
};

type Settlement = {
  reason: SettlementReason;
  at: Date;
  activeSeconds: number;
};

/**
 * The day's end applies to both states, so the clock picks the rule. Ties go to
 * the earlier entry: twelve hours at midnight is the boy who went to bed.
 */
function settlements(
  timer: TimerState,
  maxSessionMinutes: number | null,
): Settlement[] {
  const found: Settlement[] = [];
  const cut = autoStop(timer, maxSessionMinutes);
  const abandoned = abandonAt(timer);
  const dayEnd = dayEndsAt(timer);

  if (cut !== null) {
    // "Para no limite exato": the allowance itself, never the clock.
    found.push({
      reason: "limit",
      at: cut.at,
      activeSeconds: cut.activeSeconds,
    });
  }

  if (abandoned !== null) {
    found.push({
      reason: "abandoned",
      at: abandoned,
      activeSeconds: timer.accumulatedSeconds,
    });
  }

  found.push({
    reason: "dayEnd",
    at: dayEnd,
    activeSeconds: activeSeconds(timer, dayEnd),
  });

  return found;
}

/** Earliest, not first: a late read must not change which rule fired (#19). */
function firstSettlement(
  candidates: readonly Settlement[],
  now: Date,
): Settlement | null {
  let earliest: Settlement | null = null;

  for (const candidate of candidates) {
    if (candidate.at > now) continue;

    if (earliest === null || candidate.at < earliest.at) {
      earliest = candidate;
    }
  }

  return earliest;
}

/**
 * D16's lazy reconciliation. `now` decides only *whether* a rule fired, never
 * *where*, so a read one second or one month late gives the same record (#19).
 */
export function reconcileTimer(
  timer: TimerState,
  maxSessionMinutes: number | null,
  now: Date,
): Reconciliation {
  const settled = firstSettlement(settlements(timer, maxSessionMinutes), now);

  if (settled === null) {
    return {
      state: timer,
      settledAt: null,
      reason: null,
      autoStopped: false,
      activeSeconds: activeSeconds(timer, now),
    };
  }

  if (settled.reason === "abandoned") {
    return {
      // D16: no record; only the status changes.
      state: { ...timer, status: "abandoned" },
      settledAt: settled.at,
      reason: settled.reason,
      autoStopped: false,
      activeSeconds: settled.activeSeconds,
    };
  }

  return {
    state: {
      startedAt: timer.startedAt,
      // Read back the same way a paused row is.
      pausedAt: settled.at,
      accumulatedSeconds: settled.activeSeconds,
      status: "stopped",
    },
    settledAt: settled.at,
    reason: settled.reason,
    autoStopped: true,
    activeSeconds: settled.activeSeconds,
  };
}

/**
 * D17 as amended by #71: nearest minute, no floor. Integer arithmetic on
 * floored seconds, so no float enters the chain (D39).
 */
export function durationMinutes(seconds: number): number {
  return Math.floor(
    (durationSeconds(seconds) + SECONDS_PER_MINUTE / 2) / SECONDS_PER_MINUTE,
  );
}

/** Floored, so the column holds an integer and `durationMinutes` rounds the stored number. */
export function durationSeconds(seconds: number): number {
  return Math.max(0, Math.floor(seconds));
}

/** The floor a new activity starts with, in minutes (D44). */
export const DEFAULT_MIN_SESSION_MINUTES = 5;

/**
 * Whether a session is long enough to be filed (D44): at least the floor it
 * was opened under, and never one that rounds to zero minutes (D17).
 */
export function reachesMinimum(
  seconds: number,
  minSessionMinutes: number,
): boolean {
  const whole = durationSeconds(seconds);

  return (
    whole >= minSessionMinutes * SECONDS_PER_MINUTE &&
    durationMinutes(whole) > 0
  );
}
