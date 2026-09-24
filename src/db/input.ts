import { shiftDate } from "../engine/day";

/**
 * What an adult typed, checked before it reaches a column.
 *
 * Every rule here is also a CHECK on the column it protects, and the CHECK is
 * the backstop. This is the same rule said where it can name what went wrong:
 * `CHECK constraint failed: ledger_hours_check` is what an adult used to get on
 * a screen where he is standing beside a boy, and it says neither which field
 * nor what would have been acceptable.
 *
 * Its own module because the admin's four write paths — launching, releasing,
 * refunding and the devices' own limits (#22, #23, #24, #25) — need the same
 * three questions answered, and three copies of "a date is a real day, and not
 * a day that has not happened" is three chances for one of them to rot. The
 * sabotage matrix in `admin.sabotage.test.ts` mutates this file too.
 */

/** How long a note, a destination, a reason or a label may be. */
export const MAX_TEXT_LENGTH = 500;

/** The ceiling every `hours` column carries: `1e6` hours is 114 years. */
export const MAX_HOURS = 1_000_000;

/**
 * The ceiling every counter column carries — minutes, days, a sort order.
 *
 * The same `1e6` the schema's `COUNT` uses, said here so a refusal can name it
 * in a sentence instead of leaving an adult with a constraint name.
 */
export const MAX_COUNT = 1_000_000;

/**
 * The smallest amount of screen time this app holds.
 *
 * D9 rounds a calculation to two decimals, and an hour typed by an adult is
 * held to the same precision — a ledger of hundredths beside a balance rounded
 * to hundredths is one number written two ways.
 */
export const SMALLEST_HOURS = 0.01;

/**
 * A date an adult typed: `YYYY-MM-DD`, a real day, and never after today.
 *
 * The retroactive direction is the one #22 asks for — an entry typed on Monday
 * for the Saturday it happened on. The other direction has no use, and it has a
 * different reason on each of the two tables this is used for, so both are
 * written down:
 *
 * - on a **log**, an entry dated tomorrow is frozen today, and anything
 *   launched afterwards onto a day before it would read a bucket that entry is
 *   not in — the ordering problem D32 exists to prevent, reachable on purpose;
 * - on a **limit switched on at a device** (#25), a limit that starts tomorrow
 *   is not switched on. The table is the record of what is configured right
 *   now, so "desde amanhã" is a plan and not a state, and "ligado há −1 dias"
 *   is a sentence no screen should be asked to write.
 *
 * `decisions.md` does not settle either of them. Both are declared here and in
 * the pull request that introduced them.
 *
 * The shape is checked with `shiftDate(day, 0)`, which parses the date and
 * writes it back: it is the one place in this repository that turns a calendar
 * date into arithmetic and back (D13), so `2026-02-30` — which the regular
 * expression is happy with — comes back as `2026-03-02` and is refused.
 */
export function requireCalendarDay(day: string, today: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || shiftDate(day, 0) !== day) {
    throw new Error(`a date must be a real day in YYYY-MM-DD, received ${day}`);
  }

  // Both are `YYYY-MM-DD`, so the lexical order is the calendar order (D13).
  if (day > today) {
    throw new Error(
      `${day} has not happened yet: the date is today or earlier`,
    );
  }
}

/** Free text, at the length the fields on screen already stop at. */
export function requireText(text: string | null, what: string): void {
  if (text !== null && text.length > MAX_TEXT_LENGTH) {
    throw new Error(
      `${what} is at most ${MAX_TEXT_LENGTH} characters, received ${text.length}`,
    );
  }
}

/**
 * An amount of hours an adult typed, rounded to two decimals.
 *
 * **An extension of D9, not D9 itself**: that decision rounds `computed_hours`,
 * and nothing in `decisions.md` says what precision a number an adult types is
 * held to. Two decimals because the balance is summed and shown to two, and a
 * ledger row carrying a third is one number written two ways.
 *
 * Refused rather than clamped when it rounds to nothing: `ledger_hours_check`
 * is `> 0` exclusive, and a movement of zero hours is not a movement. Refused
 * rather than accepted when it is not finite: `Infinity > 0` is true, and an
 * infinite balance is the failure the schema's own `numeric` guard was written
 * about.
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
 * That what arrived is a number at all, before any arithmetic is done to it.
 *
 * `Math.round(x * 100)` coerces rather than refuses, so every guard in this
 * module used to *convert* whatever it was handed. Measured through a forged
 * admin POST, which is the only way to reach it — the screens send `null` for an
 * empty field, never a string:
 *
 * | sent | stored |
 * |---|---|
 * | `""` | `0` |
 * | `true` | `1` |
 * | `[1]` | `1` |
 * | `{ valueOf: () => 5 }` | `5` |
 *
 * `""` reaching a `duration` activity's `value` is the one that matters: the
 * activity silently starts paying nothing, and nothing anywhere says so. A
 * value that is not a number is a bug in whatever sent it, and the answer to a
 * bug is a sentence, not a guess.
 *
 * `typeof` and not `Number.isFinite`, because the two questions are different:
 * `NaN` and `Infinity` *are* numbers and are refused below, by the bound that
 * knows what an acceptable one looks like.
 */
function requireNumber(value: number, what: string): void {
  if (typeof value !== "number") {
    throw new Error(
      `${what} is a number, received ${typeof value} (${String(value)})`,
    );
  }
}

/**
 * A rate, a step or any other quantity of hours that is allowed to be zero,
 * rounded to the two decimals of `requireHours`.
 *
 * Not `requireHours`, and the difference is the floor rather than the ceiling:
 * that one refuses anything under a hundredth because a ledger movement of zero
 * hours is not a movement, and the Configuration screen has three numbers where
 * zero is a legitimate thing to mean. A `base_rate` of zero is a category that
 * suggests nothing, and a `return_bonus_pct` of zero is how the seed spells "no
 * bonus" for four of its seven categories (D12 among them).
 *
 * Infinity is refused rather than clamped, for the reason the schema's own
 * `numeric` guard was written about: `Infinity >= 0` is true, and an infinite
 * rate is an infinite balance.
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
 * The precision a return bonus is held to: a hundredth of a percentage point.
 *
 * The column stores a fraction — `0,5` is +50% — and the field an adult types
 * into is in percentage points, so two decimals *of the fraction* is a whole
 * percentage point. Borrowing `requireNonNegativeHours` for it, which is what
 * this used to do, quantized the bonus to whole points without saying so: a
 * typed `12,5` was stored as `13`, and a typed `0,4` was stored as **no bonus
 * at all** — the category silently lost the bonus the adult had just given it,
 * and nothing on any screen said so.
 *
 * Four decimals of the fraction is two decimals of a percent, which is the
 * precision the field itself offers.
 */
const BONUS_DECIMALS = 10_000;

/**
 * A return bonus as an adult typed it, as the fraction the column holds.
 *
 * Its own guard and not `requireNonNegativeHours`, because it is not an amount
 * of hours and the refusal has to stop saying it is. The ceiling stays the
 * column's (`categories_return_bonus_pct_check`): nothing in `decisions.md`
 * says a bonus has a smaller sensible maximum, and an absurd-but-deliberate
 * bonus is the adult's call — the same latitude a `free` activity's value gets.
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

/**
 * A whole number of things: days of cooldown, minutes of session, a position in
 * a list.
 *
 * Whole because every column it protects is an `integer` with a `typeof
 * (column) = 'integer'` CHECK behind it, and SQLite would otherwise store 2,5
 * days of cooldown as a real and let the arithmetic run on it. `Number.isInteger`
 * refuses NaN and both infinities on its own, which is the rest of what the
 * CHECK is about.
 */
export function requireCount(
  count: number,
  what: string,
  { min = 0 }: { min?: number } = {},
): number {
  // `Number.isInteger` already refuses a non-number, so this one needs no
  // `requireNumber` in front of it — and adding one would be the fifth mutual
  // redundancy this project has found. What it buys is the sentence: without
  // it, `"3"` reads as "not a whole number" rather than "not a number".
  requireNumber(count, what);

  if (!Number.isInteger(count) || count < min || count > MAX_COUNT) {
    throw new Error(
      `${what} is a whole number between ${min} and ${MAX_COUNT}, received ${count}`,
    );
  }

  return count;
}
