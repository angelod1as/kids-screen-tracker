import type {
  HistoryEntry,
  LedgerEntry,
  RejectedEntry,
} from "../app/actions/history";
import { formatDay, formatSignedHours } from "./dates";
import { formatDuration, formatHours } from "./hours";
import { PanelText } from "./panel";
import { META_CLASS, READOUT_CLASS, ROW_CLASS } from "./style";

/**
 * How many entries the boy's home screen shows (#15).
 *
 * Here and not beside the query, because a `"use server"` module may export
 * nothing but async functions — Next refuses the build otherwise, and
 * `guarded.test.ts` refuses it a step earlier by reading every export of such a
 * file as an endpoint. Which is right: a constant exported from an endpoint
 * file looks like one.
 */
export const RECENT_ENTRIES_LIMIT = 5;

/**
 * How many entries the history screen shows before it says so.
 *
 * The ledger takes a handful of rows a day, so this is years of use and not a
 * page size anybody will meet. It exists because an unbounded `select` is a
 * query whose cost is decided by how long the family keeps using the app, and
 * because a list that silently stops is worse than one that says it stopped —
 * `historico/page.tsx` renders a line when the count comes back equal to this.
 */
export const HISTORY_LIMIT = 200;

/**
 * The extract, as #16 asks for it: "cada linha mostra data, atividade ou
 * destino, e as horas", most recent first.
 *
 * One component for both screens that draw it — the last five on the boy's home
 * (#15) and the whole list under Histórico (#16) — because they are the same
 * row and a row drawn twice is a row that disagrees with itself by the third
 * phase.
 *
 * The sign is the only thing distinguishing a credit from a debit, and it is a
 * sign and not a colour: CLAUDE.md spends colour in exactly two places and
 * none of them is this one. `kindLabel` names the movement in words beside the
 * date, so the row does not rest on a single glyph either.
 *
 * **It draws the inside of a panel and not a panel** (#74). The rule around it
 * and the band naming it belong to the screen, which is what lets five entries
 * read as five readings of one instrument instead of five boxes: the rows share
 * one frame and are divided by a 1 px rule, the label and the date sit on two
 * lines on the left, and the hours sit on the right in the monospace face, so
 * the commas line up down the column whatever the numbers are.
 *
 * `emptyText` is required, not defaulted. Nothing writes to the ledger before
 * Phase 4 and Phase 5, so on a seeded database every list this component draws
 * is empty — that is the app's real state today, not a case to paper over, and
 * #16 asks for it in so many words ("estado vazio tratado com texto escrito").
 * A default would let a screen inherit somebody else's sentence.
 */
export function EntryList({
  emptyText,
  entries,
}: {
  emptyText: string;
  entries: readonly HistoryEntry[];
}) {
  if (entries.length === 0) {
    return <PanelText>{emptyText}</PanelText>;
  }

  return (
    <ul>
      {entries.map((entry) =>
        entry.kind === "rejected" ? (
          <RejectedRow entry={entry} key={`rejected-${entry.id}`} />
        ) : (
          <li className={ROW_CLASS} key={`ledger-${entry.id}`}>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="break-words text-base font-bold text-black">
                {entry.label}
              </span>
              <span className={`${META_CLASS} text-black`}>
                {kindLabel(entry.kind)} · {formatDay(entry.occurredOn)}
              </span>
            </span>
            <span className={`${READOUT_CLASS} shrink-0 text-black`}>
              {formatSignedHours(signedHours(entry))}
            </span>
          </li>
        ),
      )}
    </ul>
  );
}

/**
 * The row of an entry an adult refused (#72).
 *
 * **Inverted, and not coloured.** CLAUDE.md spends colour in exactly three
 * places and a refusal is none of them, so the distinction is made with the
 * palette the whole app is already written in: white on black instead of black
 * on white. It is the loudest a row can be here without becoming a fourth rule,
 * and `design.test.ts` keeps the fourth rule from arriving quietly.
 *
 * The hours read `0 min` rather than being left out, because that is D19 said
 * on the screen: the entry exists, it is on the day it happened, and it paid
 * nothing. A blank there would read as a row whose number failed to load.
 *
 * The reason is drawn only when there is one. A refusal with nothing written on
 * it says "Recusado" and stops — the sentence a screen would invent to fill the
 * gap is exactly the sentence the adult chose not to write.
 */
function RejectedRow({ entry }: { entry: RejectedEntry }) {
  return (
    <li className={`${ROW_CLASS} bg-black text-white`}>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="break-words text-base font-bold text-white">
          {entry.label}
        </span>
        <span className={`${META_CLASS} text-white`}>
          Recusado · {formatDay(entry.occurredOn)}
          {entry.durationMinutes === null
            ? ""
            : ` · ${formatDuration(entry.durationMinutes)}`}
        </span>
        {entry.reason === null ? null : (
          <span className="break-words text-base text-white">
            Motivo: {entry.reason}
          </span>
        )}
      </span>
      <span className={`${READOUT_CLASS} shrink-0 text-white`}>
        {formatHours(0)}
      </span>
    </li>
  );
}

/**
 * The hours as they moved the balance.
 *
 * `ledger.hours` is always positive and `kind` carries the sign — the schema
 * says so, and `fetchBalanceAction` sums it the same way. Reading the sign off
 * the same column in both places is what keeps the extract from adding up to a
 * different number than the balance above it.
 */
export function signedHours(
  entry: Pick<LedgerEntry, "hours" | "kind">,
): number {
  return entry.kind === "spend" ? -entry.hours : entry.hours;
}

function kindLabel(kind: LedgerEntry["kind"]): string {
  switch (kind) {
    case "earn":
      return "Ganho";
    case "spend":
      return "Gasto";
    case "refund":
      return "Estorno";
  }
}
