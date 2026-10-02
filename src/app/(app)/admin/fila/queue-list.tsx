"use client";

import { useState, useTransition } from "react";

import type { Missing, QueueEntry } from "../../../../db/queue";
import type { Refused } from "../../../../db/refusal";
import type { TimedActivity } from "../../../../db/timers";
import { Button } from "../../../../ui/button";
import type { Choice } from "../../../../ui/choice";
import { ChoiceGroup } from "../../../../ui/choice";
import { formatDay } from "../../../../ui/dates";
import { failureText, RESYNCED_TEXT } from "../../../../ui/failure";
import { Field, TimeFields } from "../../../../ui/field";
import type { TypedTime } from "../../../../ui/hours";
import {
  EMPTY_TIME,
  formatHours,
  formatRecordedDuration,
  isBlankTime,
  parseTypedTime,
  timeFromMinutes,
  typedMinutes,
} from "../../../../ui/hours";
import { Panel, PanelText } from "../../../../ui/panel";
import { PendingMark } from "../../../../ui/pending";
import { Select } from "../../../../ui/select";
import { META_CLASS, READOUT_CLASS } from "../../../../ui/style";
import type { ApprovalEdits, QueueData } from "../../../actions/queue";
import {
  approveLogAction,
  fetchQueueAction,
  rejectLogAction,
} from "../../../actions/queue";

/**
 * One tap approves; correction and refusal cost a second. The preview is never
 * the input: approval recomputes in its own transaction. Oldest first, and an
 * entry blocked by one above cannot be approved (D32), so it stays one column.
 */

export function QueueList({ initial }: { initial: QueueData }) {
  const [data, setData] = useState(initial);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  function act(call: () => Promise<QueueData | Refused>) {
    startAction(async () => {
      try {
        const result = await call();

        if ("refused" in result) {
          // D32's sentence names the entry to decide first, which a stale screen may lack.
          setFailed(result.refused);
          try {
            setData(await fetchQueueAction());
          } catch {
            // The sentence already says what to do.
          }
          return;
        }

        setData(result);
        setFailed(null);
      } catch (error) {
        // The queue changes under the adult, and a lost approval may already be
        // frozen: read it again, and the refreshed cards carry the reason.
        try {
          setData(await fetchQueueAction());
          setFailed(RESYNCED_TEXT);
        } catch {
          setFailed(failureText(error));
        }
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 lg:max-w-3xl lg:gap-6">
      {failed === null ? null : (
        <Panel title="O que aconteceu">
          <PanelText>{failed}</PanelText>
        </Panel>
      )}

      <Panel
        note={
          data.entries.length === 0 ? (
            "nada esperando"
          ) : (
            <PendingMark>
              {data.entries.length === 1
                ? "1 esperando"
                : `${data.entries.length} esperando`}
            </PendingMark>
          )
        }
        title="Fila de aprovação"
        top
      >
        {data.entries.length === 0 ? (
          <PanelText>
            Nada esperando. O que os meninos propuserem pelo cronômetro ou
            pedirem sem ele aparece aqui.
          </PanelText>
        ) : (
          <ul className="divide-y-2 divide-black">
            {data.entries.map((entry) => (
              <Card
                activities={data.activities}
                busy={busy}
                entry={entry}
                key={entry.id}
                onApprove={(edits) =>
                  act(() => approveLogAction(entry.id, edits))
                }
                onReject={(reason) =>
                  act(() => rejectLogAction(entry.id, reason))
                }
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** A rule, not layout: an entry blocked by one above cannot be frozen (D32), and a correction needs a valid duration. */
export function canApprove(
  entry: Pick<QueueEntry, "blockedBy" | "qualityGraded" | "quality"> &
    Partial<Pick<QueueEntry, "durationMinutes" | "calcMode" | "unpriceable">>,
  editing: boolean,
  duration: TypedTime,
  grade: number | null = null,
  value: TypedTime = EMPTY_TIME,
  override: TypedTime = EMPTY_TIME,
): boolean {
  if (entry.blockedBy !== null) return false;

  // D50: the adult's final number stands in for the grade or value the rule lacks.
  const overridden = editing && !isBlankTime(override);
  if (overridden && parseTypedTime(override) === null) return false;

  // The stopwatch never grades, so a graded activity waits for the adult's grade (D37).
  const graded =
    !overridden && entry.qualityGraded && (grade ?? entry.quality) === null;

  // D49: a `free` activity a boy requested has no value until an adult types one.
  // With no minutes to correct, only the final value prices it (D50).
  const priced =
    overridden ||
    (!entry.unpriceable?.includes("duration") &&
      (entry.calcMode !== "free" || (typedMinutes(value) ?? 0) >= 1));

  if (!editing) return !graded && priced;

  // An untimed request of a non-`duration` activity has no minutes to correct.
  if (entry.durationMinutes === null) return !graded && priced;

  const typed = typedMinutes(duration);

  // The same ceiling `requireDuration` enforces, said before the round trip.
  return !graded && typed !== null && typed >= 1 && typed <= MAX_MINUTES;
}

/**
 * What unlocks an entry the rule cannot price, never the engine's words. The
 * value and the grade are typed on the card itself (D49, D37); the rest is D50's.
 */
export function unpriceableText(missing: readonly Missing[]): string {
  // First: without minutes the grade cannot price it either; the final value covers both (D50).
  if (missing.includes("duration")) {
    return "Esta entrada chegou sem duração, e a atividade é medida em tempo. Toque em Corrigir e digite o valor final, ou recuse.";
  }

  if (missing.includes("value") && missing.includes("grade")) {
    return "Esta atividade vale o que você decidir e tem nota. Digite o valor, escolha a nota e aprove.";
  }

  if (missing.includes("value")) {
    return "Esta atividade não tem valor na tabela: vale o que você decidir. Digite o valor e aprove.";
  }

  if (missing.includes("grade")) {
    return "Esta atividade tem nota, e ninguém deu ainda. Escolha a nota e aprove.";
  }

  return "O app não conseguiu calcular esta entrada. Toque em Corrigir e digite o valor final, ou recuse.";
}

/** The column's CHECK ceiling, as `requireDuration` enforces it. */
const MAX_MINUTES = 1_000_000;

const QUALITY_CHOICES: readonly Choice[] = [0, 0.3, 0.5, 0.7, 1].map(
  (grade) => ({
    value: grade,
    label: grade.toLocaleString("pt-BR", { minimumFractionDigits: 1 }),
  }),
);

function Card({
  activities,
  busy,
  entry,
  onApprove,
  onReject,
}: {
  activities: TimedActivity[];
  busy: boolean;
  entry: QueueEntry;
  onApprove: (edits: ApprovalEdits) => void;
  onReject: (reason: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [activityId, setActivityId] = useState(entry.activityId);
  const [duration, setDuration] = useState(
    timeFromMinutes(entry.durationMinutes),
  );
  const [grade, setGrade] = useState<number | null>(entry.quality);
  const [note, setNote] = useState(entry.note ?? "");
  const [reason, setReason] = useState("");
  const [value, setValue] = useState(EMPTY_TIME);
  const [override, setOverride] = useState(EMPTY_TIME);
  const [overrideReason, setOverrideReason] = useState("");

  const typedDuration = parseTypedTime(duration);
  const typedValue = parseTypedTime(value);
  const typedOverride = parseTypedTime(override);
  const timed = entry.durationMinutes !== null;
  // Asked on the card, not behind Corrigir: two taps (D49, D37).
  const needsValue = entry.unpriceable?.includes("value") ?? false;
  const needsGrade = entry.unpriceable?.includes("grade") ?? false;

  return (
    <li className="flex flex-col gap-3 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="break-words text-base font-bold text-black">
            {entry.kidName} · {entry.activityName}
          </span>
          <span className={`${META_CLASS} text-black`}>
            {entry.categoryName} · {formatDay(entry.occurredOn)}
            {entry.durationSeconds === null
              ? ""
              : ` · ${formatRecordedDuration(entry.durationSeconds)}`}
            {entry.autoStopped ? " · parou sozinha" : ""}
            {entry.source === "request" ? " · pedido sem cronômetro" : ""}
          </span>
        </span>
        {entry.preview === null ? null : (
          <span className={`${READOUT_CLASS} shrink-0 text-black`}>
            {formatHours(entry.preview.hours)}
          </span>
        )}
      </div>

      {entry.note === null ? null : (
        <span className="break-words text-base text-black">{entry.note}</span>
      )}

      {entry.unpriceable === null ? null : (
        /*
          An entry the engine cannot price is a row with a sentence, not a
          queue-wide 500 (D19). No colour: not a pendency.
        */
        <p className="break-words text-base font-bold text-black">
          {unpriceableText(entry.unpriceable)}
        </p>
      )}

      {needsGrade ? (
        <ChoiceGroup
          legend="Nota"
          onSelect={setGrade}
          options={QUALITY_CHOICES}
          value={grade ?? -1}
        />
      ) : null}

      {needsValue ? (
        <TimeFields
          id={`valor-${entry.id}`}
          legend="Valor"
          onChange={setValue}
          value={value}
        />
      ) : null}

      {editing ? (
        <div className="flex flex-col gap-3">
          {entry.qualityGraded && !needsGrade ? (
            /* The stopwatch never grades, so the correction can (D37). */
            <ChoiceGroup
              legend="Nota"
              onSelect={setGrade}
              options={QUALITY_CHOICES}
              value={grade ?? -1}
            />
          ) : null}

          {entry.calcMode === "free" && !needsValue ? (
            <TimeFields
              id={`valor-${entry.id}`}
              legend="Valor"
              onChange={setValue}
              value={value}
            />
          ) : null}

          {timed ? (
            <>
              <Select
                id={`atividade-${entry.id}`}
                label="Atividade"
                onChange={(value) => setActivityId(Number(value))}
                value={String(activityId)}
              >
                {activities.map((activity) => (
                  <option key={activity.id} value={activity.id}>
                    {activity.categoryName} · {activity.name}
                  </option>
                ))}
              </Select>

              <TimeFields
                id={`duracao-${entry.id}`}
                legend="Duração"
                onChange={setDuration}
                value={duration}
              />
            </>
          ) : null}

          {/* D50: a second path beside correcting the report, for any mode. */}
          <div className="flex flex-col gap-1">
            <TimeFields
              id={`valor-final-${entry.id}`}
              legend="Valor final (opcional)"
              onChange={setOverride}
              value={override}
            />
            <p className="text-base text-black">
              Vazio, o app calcula pela regra. Preenchido, vale este número, e o
              menino vê no histórico que foi decisão de um adulto e quanto a
              regra daria.
            </p>
          </div>

          {isBlankTime(override) ? null : (
            <Field
              id={`motivo-valor-${entry.id}`}
              label="Motivo do valor final (opcional)"
              maxLength={500}
              onChange={(event) => setOverrideReason(event.target.value)}
              type="text"
              value={overrideReason}
            />
          )}

          <Field
            id={`nota-${entry.id}`}
            label="Observação"
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            type="text"
            value={note}
          />
        </div>
      ) : null}

      {rejecting ? (
        <Field
          id={`motivo-${entry.id}`}
          label="Motivo (opcional)"
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
          type="text"
          value={reason}
        />
      ) : null}

      {entry.blockedBy === null ? null : (
        <p className="text-base font-bold text-black">
          Aprove antes: {entry.blockedBy.activityName} ·{" "}
          {formatDay(entry.blockedBy.occurredOn)}. O valor deste depende do que
          for decidido lá.
        </p>
      )}

      {/* Stacked on a phone: three in a row would fall under 48 px at 320. */}
      <div className="flex flex-col gap-2 lg:flex-row lg:gap-3">
        <div className="lg:flex-1">
          <Button
            disabled={
              busy ||
              !canApprove(entry, editing, duration, grade, value, override)
            }
            onClick={() =>
              onApprove(
                editing
                  ? {
                      ...(timed && typedDuration !== null
                        ? { activityId, duration: typedDuration }
                        : {}),
                      ...(entry.calcMode === "free" && typedValue !== null
                        ? { freeValue: typedValue }
                        : {}),
                      ...(typedOverride === null
                        ? {}
                        : {
                            override: typedOverride,
                            overrideReason:
                              overrideReason.trim() === ""
                                ? null
                                : overrideReason.trim(),
                          }),
                      quality: grade,
                      note: note.trim() === "" ? null : note.trim(),
                    }
                  : {
                      ...(needsValue && typedValue !== null
                        ? { freeValue: typedValue }
                        : {}),
                      ...(needsGrade ? { quality: grade } : {}),
                    },
              )
            }
            type="button"
          >
            {editing ? "Aprovar com as correções" : "Aprovar"}
          </Button>
        </div>

        {rejecting ? (
          <div className="lg:flex-1">
            <Button
              disabled={busy}
              onClick={() => onReject(reason)}
              type="button"
              variant="secondary"
            >
              Confirmar recusa
            </Button>
          </div>
        ) : null}

        <div className="lg:flex-1">
          <Button
            disabled={busy}
            onClick={() => setEditing(!editing)}
            type="button"
            variant="secondary"
          >
            {editing ? "Cancelar correção" : "Corrigir"}
          </Button>
        </div>

        <div className="lg:flex-1">
          <Button
            disabled={busy}
            onClick={() => setRejecting(!rejecting)}
            type="button"
            variant="secondary"
          >
            {rejecting ? "Cancelar recusa" : "Recusar"}
          </Button>
        </div>
      </div>
    </li>
  );
}
