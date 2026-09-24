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
 * The answer, and then the reason for it.
 *
 * "A explicação é o produto" — so the lines are not a footnote under the
 * number: they are the larger half of the block, each one an addend with its
 * own signed hours, closing on a total that repeats the headline. Showing the
 * total twice is the point of D9's "a soma tem que fechar": a boy who adds the
 * column up gets the number at the top, and the day he does not, he has caught
 * a real bug rather than a rounding artefact.
 */
export function Result({
  calculation,
  heading = "Você ganharia",
}: {
  calculation: Calculation;
  /**
   * Whose gain this is, in words.
   *
   * The boy's calculator says "você ganharia" to the boy who is holding the
   * phone; the admin's launch screen is one adult talking about a boy who is
   * not, so it names him. Same block, same arithmetic, one sentence apart —
   * which is the reason this is a prop and not a second copy of the list.
   */
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
