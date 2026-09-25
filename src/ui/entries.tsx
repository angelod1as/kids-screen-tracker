import type { ReactNode } from "react";

import type {
  AdultValue,
  HistoryEntry,
  LedgerEntry,
  RejectedEntry,
  VoidMark,
  ZeroEntry,
} from "../app/actions/history";
import { formatDay, formatSignedHours } from "./dates";
import { formatDuration, formatHours } from "./hours";
import { PanelText } from "./panel";
import { META_CLASS, READOUT_CLASS, ROW_CLASS } from "./style";

/** Not beside the query: a `"use server"` module may export only async functions. */
export const RECENT_ENTRIES_LIMIT = 5;

/** Years of use, not a page size: it bounds the `select`, and the screen says when it is hit. */
export const HISTORY_LIMIT = 200;

/**
 * The extract of #15 and #16, drawn by one component so the two screens cannot
 * disagree. The inside of a panel, not a panel (#74). `emptyText` has no default,
 * so no screen inherits another's empty sentence.
 */
export function EntryList({
  emptyText,
  entries,
  action,
}: {
  emptyText: string;
  entries: readonly HistoryEntry[];
  /** D52: the adult's control under an entry that still counts. */
  action?: (entry: LedgerEntry | ZeroEntry) => ReactNode;
}) {
  if (entries.length === 0) {
    return <PanelText>{emptyText}</PanelText>;
  }

  return (
    <ul>
      {entries.map((entry) =>
        entry.kind === "rejected" ? (
          <RejectedRow entry={entry} key={`rejected-${entry.id}`} />
        ) : entry.kind === "zero" ? (
          <ZeroRow
            action={entry.voided === null ? action?.(entry) : null}
            entry={entry}
            key={`zero-${entry.id}`}
          />
        ) : (
          <li className={ROW_CLASS} key={`ledger-${entry.id}`}>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="break-words text-base font-bold text-black">
                {entry.label}
              </span>
              <span className={`${META_CLASS} text-black`}>
                {kindLabel(entry.kind)} · {formatDay(entry.occurredOn)}
                {entry.override === null ? "" : ` · ${OVERRIDDEN_TEXT}`}
              </span>
              {entry.override === null ? null : (
                <AdultValueText override={entry.override} />
              )}
              {entry.voided === null ? (
                action?.(entry)
              ) : (
                <VoidedText voided={entry.voided} />
              )}
            </span>
            <span
              className={`${READOUT_CLASS} shrink-0 text-black ${entry.voided === null ? "" : "line-through"}`}
            >
              {formatSignedHours(signedHours(entry))}
            </span>
          </li>
        ),
      )}
    </ul>
  );
}

/**
 * A refused entry (#72): inverted, not coloured (D42). `0 min` rather than blank
 * is D19 on screen. No invented reason when the adult wrote none.
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

/** D50: said on the row, so a number that differs from the rule is not read as a bug. */
const OVERRIDDEN_TEXT = "valor decidido por um adulto";

/** No invented line: the rule's number only where it could price, the reason only if written. */
function AdultValueText({ override }: { override: AdultValue }) {
  return (
    <>
      {override.ruleHours === null ? null : (
        <span className="break-words text-base text-black">
          Pela regra: {formatHours(override.ruleHours)}
        </span>
      )}
      {override.reason === null ? null : (
        <span className="break-words text-base text-black">
          Motivo: {override.reason}
        </span>
      )}
    </>
  );
}

/** D52: struck through in place, and said in words, since a line alone is easy to miss. */
function VoidedText({ voided }: { voided: VoidMark }) {
  return (
    <span className="break-words text-base font-bold text-black">
      Anulado por {voided.by} em {formatDay(voided.on)}. Não conta no saldo.
    </span>
  );
}

/** D10: an approved zero stays visible; it counted for the cooldown and the bucket. */
function ZeroRow({ entry, action }: { entry: ZeroEntry; action: ReactNode }) {
  return (
    <li className={ROW_CLASS}>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="break-words text-base font-bold text-black">
          {entry.label}
        </span>
        <span className={`${META_CLASS} text-black`}>
          {kindLabel("earn")} · {formatDay(entry.occurredOn)}
          {entry.override === null ? "" : ` · ${OVERRIDDEN_TEXT}`}
        </span>
        {entry.override === null ? null : (
          <AdultValueText override={entry.override} />
        )}
        {entry.voided === null ? action : <VoidedText voided={entry.voided} />}
      </span>
      <span
        className={`${READOUT_CLASS} shrink-0 text-black ${entry.voided === null ? "" : "line-through"}`}
      >
        {formatHours(0)}
      </span>
    </li>
  );
}

/** `kind` carries the sign, read the same way the balance sums it, so the extract adds up. */
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
