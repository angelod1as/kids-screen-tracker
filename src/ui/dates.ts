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

/** #77: the time of a real audit instant, in São Paulo. The day still comes from occurred_on (D13). */
export function formatTime(instant: number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

/** U+2212, not a hyphen: at row size a hyphen beside a digit nearly vanishes. */
export function formatSignedHours(hours: number): string {
  const text = formatHours(hours);

  return text.startsWith("−") ? text : `+${text}`;
}
