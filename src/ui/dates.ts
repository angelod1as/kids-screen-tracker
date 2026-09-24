import { formatHours } from "./hours";

/**
 * By slicing, never through a `Date` (D13): `new Date("2026-09-02")` is midnight
 * UTC, which São Paulo formats as the day before.
 */
export function formatDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);

  if (match === null) {
    throw new Error(`a date must be YYYY-MM-DD, received ${day}`);
  }

  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** U+2212, not a hyphen: at row size a hyphen beside a digit nearly vanishes. */
export function formatSignedHours(hours: number): string {
  const text = formatHours(hours);

  return text.startsWith("−") ? text : `+${text}`;
}
