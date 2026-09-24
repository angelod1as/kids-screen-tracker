import { durationMinutes, durationSeconds } from "../engine/timer";

/**
 * `18 min`, `1h26`, `−1h30` (#105). Rounded to the minute for display only; the
 * stored hours keep D9's two decimals. The minus is U+2212, as in the extract.
 */
export function formatHours(hours: number): string {
  const minutes = Math.round(Math.abs(hours) * MINUTES_PER_HOUR);

  return `${hours < 0 && minutes > 0 ? "−" : ""}${formatDuration(minutes)}`;
}

/** Rate, decay step, asymptote: per-hour quantities, not durations, so D9's two decimals. */
export function formatDecimalHours(hours: number): string {
  return `${hours
    .toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .replace("-", "−")} h`;
}

const MINUTES_PER_HOUR = 60;

/**
 * A label, never a factor: the engine writes its own duration into the
 * explanation (`durationText`), in the unit that keeps that line's arithmetic true.
 */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;

  if (hours === 0) return `${rest} min`;

  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, "0")}`;
}

/**
 * The threshold is the engine's, not sixty: 45 s is filed and paid as a minute,
 * so `45s` on screen would disagree with the balance (D17, #71). Seconds only
 * ever show a session that was not filed.
 */
export function formatRecordedDuration(seconds: number): string {
  const whole = durationSeconds(seconds);
  const minutes = durationMinutes(whole);

  if (minutes === 0) return `${whole}s`;

  return formatDuration(minutes);
}

const SECONDS_PER_MINUTE = 60;

/**
 * Floored, not rounded: `01:00` at 59.6 s reaches a minute early. Negative input
 * is clamped: a clock that jumped back is not a session that un-happened.
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
 * Comma or dot, nothing else: `Number("")` is 0, and a blank field would become
 * a zero-hour movement. Null, not zero, so an empty field is not a typed zero.
 */
export function parseTypedHours(text: string): number | null {
  const typed = text.trim().replace(",", ".");

  if (!/^\d+(\.\d+)?$/.test(typed)) return null;

  const hours = Number(typed);

  return Number.isFinite(hours) ? hours : null;
}

/**
 * No decimal separator at all: every column it feeds has an integer CHECK, and
 * rounding "3,5 dias" would store a value nobody typed. Null, not zero, as above.
 */
export function parseTypedCount(text: string): number | null {
  const typed = text.trim();

  if (!/^\d+$/.test(typed)) return null;

  const count = Number(typed);

  return Number.isSafeInteger(count) ? count : null;
}
