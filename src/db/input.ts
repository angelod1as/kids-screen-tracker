import { shiftDate } from "../engine/day";

/**
 * What an adult typed, checked before it reaches a column. Each rule is also
 * a CHECK; this one names the field instead of `CHECK constraint failed`.
 */

export const MAX_TEXT_LENGTH = 500;

/** `1e6` hours is 114 years. */
export const MAX_HOURS = 1_000_000;

/** The schema's `COUNT`, said here so a refusal can name it. */
export const MAX_COUNT = 1_000_000;

/** An adult's hour is held to D9's two decimals. */
export const SMALLEST_HOURS = 0.01;

/**
 * `YYYY-MM-DD`, a real day, never after today (#22); `decisions.md` does not
 * settle the future. `shiftDate(day, 0)` refuses `2026-02-30`, which the
 * regex allows (D13).
 */
export function requireCalendarDay(day: string, today: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || shiftDate(day, 0) !== day) {
    throw new Error(`a date must be a real day in YYYY-MM-DD, received ${day}`);
  }

  // D13: lexical order is calendar order.
  if (day > today) {
    throw new Error(
      `${day} has not happened yet: the date is today or earlier`,
    );
  }
}

export function requireText(text: string | null, what: string): void {
  if (text !== null && text.length > MAX_TEXT_LENGTH) {
    throw new Error(
      `${what} is at most ${MAX_TEXT_LENGTH} characters, received ${text.length}`,
    );
  }
}

/**
 * Two decimals, an extension of D9 to what an adult types. Refused, not
 * clamped, when it rounds to zero (`ledger_hours_check` is `> 0`) or is infinite.
 */
export function requireHours(hours: number, what: string): number {
  const rounded = Math.round(hours * 100) / 100;

  if (!Number.isFinite(rounded) || rounded < SMALLEST_HOURS) {
    throw new Error(
      `${what} is a number of hours of ${SMALLEST_HOURS} or more, received ${hours}`,
    );
  }

  if (rounded > MAX_HOURS) {
    throw new Error(`${what} is at most ${MAX_HOURS} hours, received ${hours}`);
  }

  return rounded;
}

/**
 * `Math.round` coerces: a forged POST stored `""` as `0`, `true` as `1`.
 * `typeof`, not `Number.isFinite`: NaN and Infinity are refused by the bound.
 */
function requireNumber(value: number, what: string): void {
  if (typeof value !== "number") {
    throw new Error(
      `${what} is a number, received ${typeof value} (${String(value)})`,
    );
  }
}

/**
 * Like `requireHours` but zero is allowed: a `base_rate` or `return_bonus_pct`
 * of zero means something (D12). Infinity is refused.
 */
export function requireNonNegativeHours(hours: number, what: string): number {
  requireNumber(hours, what);

  const rounded = Math.round(hours * 100) / 100;

  if (!Number.isFinite(rounded) || rounded < 0 || rounded > MAX_HOURS) {
    throw new Error(
      `${what} is a number of hours between 0 and ${MAX_HOURS}, received ${hours}`,
    );
  }

  return rounded;
}

/**
 * A hundredth of a percentage point. Two decimals of the fraction stored `12,5`
 * as `13` and `0,4` as no bonus at all.
 */
const BONUS_DECIMALS = 10_000;

/**
 * Not hours, so not `requireNonNegativeHours`. The ceiling is the column's:
 * `decisions.md` sets no smaller one, and an absurd bonus is the adult's call.
 */
export function requireBonusFraction(pct: number, what: string): number {
  requireNumber(pct, what);

  const rounded = Math.round(pct * BONUS_DECIMALS) / BONUS_DECIMALS;

  if (!Number.isFinite(rounded) || rounded < 0 || rounded > MAX_HOURS) {
    throw new Error(
      `${what} is a fraction between 0 and ${MAX_HOURS}, received ${pct}`,
    );
  }

  return rounded;
}

/** Whole, because each column is an `integer` CHECK; `isInteger` refuses NaN too. */
export function requireCount(
  count: number,
  what: string,
  { min = 0 }: { min?: number } = {},
): number {
  // Redundant with `isInteger`, kept for the sentence: `"3"` is "not a number".
  requireNumber(count, what);

  if (!Number.isInteger(count) || count < min || count > MAX_COUNT) {
    throw new Error(
      `${what} is a whole number between ${min} and ${MAX_COUNT}, received ${count}`,
    );
  }

  return count;
}
