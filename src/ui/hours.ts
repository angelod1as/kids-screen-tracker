import { durationMinutes, durationSeconds } from "../engine/timer";

/**
 * An amount of screen time as it is said out loud: `18 min`, `1h26`, `−1h30`
 * (#105). Rounded to the nearest minute for display only; the stored hours keep
 * D9's two decimals. The minus is U+2212, which the extract writes too.
 */
export function formatHours(hours: number): string {
  const minutes = Math.round(Math.abs(hours) * MINUTES_PER_HOUR);

  return `${hours < 0 && minutes > 0 ? "−" : ""}${formatDuration(minutes)}`;
}

/**
 * A per-hour quantity of the Configuration screen — rate, decay step,
 * asymptote — which is not a duration and keeps D9's two decimals (#105).
 */
export function formatDecimalHours(hours: number): string {
  return `${hours
    .toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .replace("-", "−")} h`;
}

/** Minutes in an hour, so the arithmetic below is not a bare 60. */
const MINUTES_PER_HOUR = 60;

/**
 * Whole minutes as somebody says them out loud: `45 min`, `1h`, `1h30`. The
 * one duration format, which `formatHours` also writes through (#105).
 *
 * This is a *label*, and never a factor in a calculation — the engine writes
 * its own duration into the explanation line, in the unit that keeps that
 * line's multiplication true (`durationText`, in `calculate.ts`). The number
 * that reaches the engine is always the minutes themselves.
 */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;

  if (hours === 0) return `${rest} min`;

  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, "0")}`;
}

/**
 * A duration the stopwatch measured, said in the unit that is true of it.
 *
 * Since #71 removed D17's floor from the *rounding*, a session can round to no
 * minutes at all, and `formatDuration` alone would put `0 min` on the screen for
 * every session shorter than half a minute — which tells the boy who ran the
 * stopwatch for ten seconds the same nothing that the old floor's `1 min` told
 * him wrongly. Under the threshold the seconds are the honest unit.
 *
 * **The threshold is the engine's, not sixty.** Asking `durationMinutes` rather
 * than comparing against `SECONDS_PER_MINUTE` is the whole point: half a minute
 * already rounds up, so a 45-second session is filed — and paid — as one full
 * minute, and a screen that answered `45s` there would be showing a number that
 * looks negligible beside a value charged as a whole minute. That gap between
 * what the screen says and what the balance moves by is the exact defect #71
 * exists to close, so the two ask the same function the same question.
 *
 * Which leaves the seconds branch saying only what it can say truthfully: this
 * session was not filed at all. Below the threshold nothing is ever recorded
 * (`stopTimer`), so `9s` is the live clock, or the notice that a session was
 * too short to send — never a record's duration.
 */
export function formatRecordedDuration(seconds: number): string {
  // Both numbers are the engine's own and neither is a second copy of it: a
  // screen that floored, clamped or rounded on its own would be free to
  // disagree with the record it is describing (D17, #71).
  const whole = durationSeconds(seconds);
  const minutes = durationMinutes(whole);

  if (minutes === 0) return `${whole}s`;

  return formatDuration(minutes);
}

/** Seconds in a minute, for the clock below. */
const SECONDS_PER_MINUTE = 60;

/**
 * A running stopwatch, the way one reads: `12:05`, and `1:04:30` past the hour.
 *
 * Not `formatDuration`, which is a label on a button and says `1h04`: this is a
 * clock the boy watches move, so the seconds have to be there and the digits
 * have to keep their places. The hour is dropped while there is none, because
 * `00:12:05` puts the two digits that are not changing where the eye lands.
 *
 * Floored rather than rounded: a stopwatch that shows `01:00` while it is at
 * 59,6 seconds is a stopwatch that reaches a minute before a minute has passed.
 * Negative input is clamped to zero — a phone whose clock jumped backwards is
 * not a session that un-happened.
 */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR));
  const minutes = Math.floor(total / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
  const rest = total % SECONDS_PER_MINUTE;
  const pad = (value: number) => String(value).padStart(2, "0");

  return hours === 0
    ? `${pad(minutes)}:${pad(rest)}`
    : `${hours}:${pad(minutes)}:${pad(rest)}`;
}

/**
 * A number of hours as an adult types it, or `null` when it is not one yet.
 *
 * The comma is the decimal separator everywhere else on these screens, so a
 * field that only took `1.5` would be a field that disagrees with every number
 * printed beside it. Both are taken, and nothing else is: `Number("")` is 0 and
 * `Number(" ")` is 0, which is how a blank field becomes a movement of zero
 * hours that the database then refuses with a constraint name.
 *
 * Written here, once, because three screens read a typed number — what to
 * release, what to refund, and what a `free` activity is worth (#22, #23, #24)
 * — and a parser with three copies is three chances for one of them to accept
 * `1,5,0`.
 *
 * Null and not zero for "not a number yet": a parser that answers the same
 * thing for "nothing typed" and for "zero typed" cannot tell an empty field
 * from a number an adult meant.
 */
export function parseTypedHours(text: string): number | null {
  const typed = text.trim().replace(",", ".");

  if (!/^\d+(\.\d+)?$/.test(typed)) return null;

  const hours = Number(typed);

  return Number.isFinite(hours) ? hours : null;
}

/**
 * A whole number as an adult types it, or `null` when it is not one yet.
 *
 * Beside `parseTypedHours` because it is the same job for the other kind of
 * number the Configuration screen takes — days of cooldown, minutes of session,
 * a position in a list (#26, #27) — and splitting the two across modules would
 * put one parser where the next person looks for both.
 *
 * No decimal separator is accepted at all, which is the whole difference: every
 * column this feeds is an `integer` with a `typeof (column) = 'integer'` CHECK
 * behind it, so "3,5 dias de cooldown" is not a value to be rounded into shape
 * — it is a field that has not been filled in correctly yet, and rounding it
 * silently would store a cooldown nobody typed.
 *
 * Null and not zero for "nothing typed", for the reason `parseTypedHours`
 * gives: zero is a legitimate thing to mean in every one of these fields, and a
 * parser that answers the same for "nothing" and for "none" cannot be used in
 * any of them.
 */
export function parseTypedCount(text: string): number | null {
  const typed = text.trim();

  if (!/^\d+$/.test(typed)) return null;

  const count = Number(typed);

  return Number.isSafeInteger(count) ? count : null;
}
