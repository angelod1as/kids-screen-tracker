import type { Calculation } from "../engine/calculate";
import { formatSignedHours } from "./dates";
import { formatHours } from "./hours";
import { BORDER_CLASS, HEADING_CLASS } from "./style";

/**
 * Each line in whole minutes, as the step between the running totals rounded:
 * rounding every line alone would let the column miss the total (D9).
 */
export function lineMinutes(lines: readonly { hours: number }[]): number[] {
  let before = 0;
  let cents = 0;

  return lines.map((line) => {
    // Summed in whole cents, which a double holds exactly (D9's two decimals).
    cents += Math.round(line.hours * 100);
    const after = Math.round((cents * 60) / 100);
    const minutes = after - before;
    before = after;

    return minutes;
  });
}

/**
 * The total is shown twice so the column must add up to it (D9): a boy whose sum
 * misses has found a real bug, not a rounding artefact.
 */
export function Result({
  calculation,
  heading = "Você ganharia",
}: {
  calculation: Calculation;
  /** A prop, not a copy: the launch screen names the boy instead of "você". */
  heading?: string;
}) {
  const minutes = lineMinutes(calculation.lines);

  return (
    <section className="flex flex-col gap-2">
      <h2 className={HEADING_CLASS}>{heading}</h2>
      <p
        className={`${BORDER_CLASS} bg-white p-4 text-5xl font-bold tabular-nums text-black`}
      >
        {formatHours(calculation.hours)}
      </p>

      <ul className={`${BORDER_CLASS} flex flex-col bg-white`}>
        {calculation.lines.map((line, index) => (
          <li
            className="flex items-baseline justify-between gap-3 border-b-2 border-black p-3"
            key={`${line.step}-${line.text}`}
          >
            <span className="min-w-0 break-words text-lg text-black">
              {line.text}
            </span>
            <span className="shrink-0 text-lg font-bold tabular-nums text-black">
              {formatSignedHours((minutes[index] ?? 0) / 60)}
            </span>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-3 p-3">
          <span className="text-lg font-bold text-black">Total</span>
          <span className="shrink-0 text-lg font-bold tabular-nums text-black">
            {formatHours(calculation.hours)}
          </span>
        </li>
      </ul>
    </section>
  );
}
