/**
 * D13's calendar day. Apart from `calculate.ts` so the stopwatch screen does
 * not ship the whole engine to get a date. Pure: every function takes its
 * moment.
 */

/**
 * Where `occurredOn` comes from (D13). `formatToParts` with a fixed locale, so
 * the machine's locale cannot reorder or renumber the result.
 */
export function saoPauloDay(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * The one place a calendar date legitimately becomes an instant (D13, D31).
 * The offset is read from the zone, not hardcoded as −03:00, in case daylight
 * saving returns; two passes settle it on the day that contains the midnight.
 */
export function saoPauloDayStart(day: string): Date {
  const midnightUtc = parseDate(day);
  let instant = midnightUtc;

  for (let pass = 0; pass < 2; pass += 1) {
    instant = midnightUtc - zoneOffsetMs(new Date(instant));
  }

  return new Date(instant);
}

/** Negative, since the zone is behind UTC. */
function zoneOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? "0");
  const wallClock = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );

  // The formatter has no milliseconds.
  return wallClock - (instant.getTime() - instant.getMilliseconds());
}

/**
 * UTC arithmetic and formatted by hand, so the machine's time zone cannot move
 * the date (D13).
 */
export function shiftDate(date: string, days: number): string {
  const shifted = new Date(parseDate(date) + days * 86_400_000);
  const year = String(shifted.getUTCFullYear()).padStart(4, "0");
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/** For comparing calendar dates, never for treating one as an instant. */
export function parseDate(date: string): number {
  const parsed = Date.parse(`${date}T00:00:00Z`);

  if (Number.isNaN(parsed)) {
    throw new Error(`a date must be YYYY-MM-DD, received ${date}`);
  }

  return parsed;
}

/** Negative when `to` is before `from`; the caller decides what that means. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to) - parseDate(from)) / 86_400_000);
}
