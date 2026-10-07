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

/** #64: the history opens on the two newest days with an entry. */
export const FIRST_HISTORY_DAYS = 2;

/** Bounds `?dias=`, so a typed URL cannot ask for everything. */
export const MAX_HISTORY_DAYS = 60;

/** `?dias=` is typed by anyone: garbage opens the first page, too much stops at the cap. */
export function historyDays(param: string | string[] | undefined): number {
  const days = Number(param);

  return Number.isInteger(days)
    ? Math.min(Math.max(days, FIRST_HISTORY_DAYS), MAX_HISTORY_DAYS)
    : FIRST_HISTORY_DAYS;
}

/**
 * The extract of #15 and #16, drawn by one component so the two screens cannot
 * disagree. The inside of a panel, not a panel (#74). `emptyText` has no default,
 * so no screen inherits another's empty sentence.
 */
export function EntryList({
  emptyText,
  entries,
  action,
  nameDecider = false,
}: {
  emptyText: string;
  entries: readonly HistoryEntry[];
  /** D52: the adult's control under an entry that still counts. */
  action?: (entry: LedgerEntry | ZeroEntry) => ReactNode;
  /** #71: the author line lives on the two history screens, not the home (#15). */
  nameDecider?: boolean;
}) {
  if (entries.length === 0) {
    return <PanelText>{emptyText}</PanelText>;
  }

  return (
    <ul>
      {entries.map((entry) =>
        entry.kind === "rejected" ? (
          <RejectedRow
            entry={entry}
            key={`rejected-${entry.id}`}
            nameDecider={nameDecider}
          />
        ) : entry.kind === "zero" ? (
          <ZeroRow
            action={entry.voided === null ? action?.(entry) : null}
            entry={entry}
            key={`zero-${entry.id}`}
            nameDecider={nameDecider}
          />
        ) : (
          <li className={ROW_CLASS} key={`ledger-${entry.id}`}>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="break-words text-base font-bold text-black">
                {entry.label}
              </span>
              <span className={`${META_CLASS} text-black`}>
                {kindLabel(entry.kind)} · {formatDay(entry.occurredOn)}
                {nameDecider && entry.override !== null
                  ? ` · ${overriddenText(entry.decidedBy)}`
                  : ""}
              </span>
              {entry.override === null ? null : (
                <AdultValueText override={entry.override} />
              )}
              {nameDecider &&
              entry.override === null &&
              entry.decidedBy !== null ? (
                <ReviewerLine
                  by={entry.decidedBy}
                  className="text-black"
                  verb={ledgerVerb(entry.kind)}
                />
              ) : null}
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
function RejectedRow({
  entry,
  nameDecider,
}: {
  entry: RejectedEntry;
  nameDecider: boolean;
}) {
  return (
    <li className={`${ROW_CLASS} bg-black text-white`}>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
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
        {nameDecider && entry.decidedBy !== null ? (
          <ReviewerLine
            by={entry.decidedBy}
            className="text-white"
            verb="Recusado"
          />
        ) : null}
      </span>
      <span className={`${READOUT_CLASS} shrink-0 text-white`}>
        {formatHours(0)}
      </span>
    </li>
  );
}

/** D50: said on the row, so a number that differs from the rule is not read as a bug. Names the adult (emenda à D50). */
function overriddenText(decidedBy: string | null): string {
  return `valor decidido por ${decidedBy ?? "um adulto"}`;
}

/** The author verb for a ledger movement (#71): earn was approved, spend taken, refund given. */
function ledgerVerb(kind: LedgerEntry["kind"]): string {
  switch (kind) {
    case "earn":
      return "Aprovado";
    case "spend":
      return "Tirado";
    case "refund":
      return "Dado";
  }
}

/** Who decided the entry (emenda à D50): named on both screens, under the kind and date. */
function ReviewerLine({
  by,
  verb,
  className,
}: {
  by: string;
  verb: string;
  className: string;
}) {
  return (
    <span className={`${META_CLASS} ${className}`}>
      {verb} por {by}
    </span>
  );
}

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
function ZeroRow({
  entry,
  action,
  nameDecider,
}: {
  entry: ZeroEntry;
  action: ReactNode;
  nameDecider: boolean;
}) {
  return (
    <li className={ROW_CLASS}>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="break-words text-base font-bold text-black">
          {entry.label}
        </span>
        <span className={`${META_CLASS} text-black`}>
          {kindLabel("earn")} · {formatDay(entry.occurredOn)}
          {nameDecider && entry.override !== null
            ? ` · ${overriddenText(entry.decidedBy)}`
            : ""}
        </span>
        {entry.override === null ? null : (
          <AdultValueText override={entry.override} />
        )}
        {nameDecider && entry.override === null && entry.decidedBy !== null ? (
          <ReviewerLine
            by={entry.decidedBy}
            className="text-black"
            verb="Aprovado"
          />
        ) : null}
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
      return "Tirado";
    case "refund":
      return "Dado";
  }
}
