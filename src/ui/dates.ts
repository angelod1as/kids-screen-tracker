import { formatHours } from "./hours";

/**
 * A `YYYY-MM-DD` as a Brazilian reader writes it: `02/09/2026`.
 *
 * By slicing the string, and never by building a `Date` out of it. That is D13
 * on the rendering side: `new Date("2026-09-02").toLocaleDateString("pt-BR")`
 * parses the date as midnight UTC and formats it in the machine's zone, which
 * in São Paulo is three hours earlier — so every entry in the history reads as
 * the day before. The value on its way to the screen is a calendar date, the
 * same as it is in the column, and nothing in between turns it into an instant.
 *
 * The year is shown rather than dropped: the history goes back as far as the
 * ledger does, and `02/09` is two different days a year apart.
 */
export function formatDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);

  if (match === null) {
    throw new Error(`a date must be YYYY-MM-DD, received ${day}`);
  }

  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Hours with their sign in front, the way a bank statement writes them:
 * `+2h`, `−1h30`.
 *
 * The minus is U+2212, not a hyphen: at the size these rows are set, a hyphen
 * beside a digit is nearly invisible, and the one thing a line of the extract
 * has to answer at a glance is which way it moved.
 */
export function formatSignedHours(hours: number): string {
  const text = formatHours(hours);

  return text.startsWith("−") ? text : `+${text}`;
}
