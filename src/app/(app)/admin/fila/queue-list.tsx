"use client";

import { useState, useTransition } from "react";

import type { QueueEntry } from "../../../../db/queue";
import type { TimedActivity } from "../../../../db/timers";
import { Button } from "../../../../ui/button";
import type { Choice } from "../../../../ui/choice";
import { ChoiceGroup } from "../../../../ui/choice";
import { formatDay } from "../../../../ui/dates";
import { failureText, RESYNCED_TEXT } from "../../../../ui/failure";
import { Field } from "../../../../ui/field";
import { formatHours, formatRecordedDuration } from "../../../../ui/hours";
import { Panel, PanelText } from "../../../../ui/panel";
import { PendingMark } from "../../../../ui/pending";
import { Select } from "../../../../ui/select";
import { META_CLASS, READOUT_CLASS } from "../../../../ui/style";
import type { QueueData } from "../../../actions/queue";
import {
  approveLogAction,
  fetchQueueAction,
  rejectLogAction,
} from "../../../actions/queue";

/**
 * The approval queue (#20).
 *
 * **One tap approves.** *Aprovar* is the first control of every card and it
 * sends the entry exactly as the boy proposed it; the correction and the
 * refusal are behind a second tap each, because they are the rarer half. The
 * design rule is "mais de dois toques é desenho errado", and the ordinary
 * afternoon — the boy read for an hour, that is what happened — costs one.
 *
 * What each card shows before the tap is what approving would credit, computed
 * by the engine on the day the entry happened (D8). It is a preview and never
 * an input: the approval recomputes inside its own transaction, so approving
 * two entries of the same day pays the second one out of the bucket the first
 * one filled. See `src/db/queue.ts`.
 *
 * **One panel, one rule between entries** (#74). The queue is a work list: the
 * adult reads down it, decides, and the row disappears. So it is drawn as one
 * instrument face with a 2 px rule between entries rather than as a stack of
 * floating cards, the count of what is waiting sits in the band in the pendency
 * colour, and each entry carries what approving it would credit on the right,
 * in the monospace face, where the same number sits on every entry.
 *
 * It stays one column on a wide screen. The order is load-bearing — see below —
 * and two columns would mean deciding whether the queue reads down the left and
 * then down the right, or across.
 *
 * **The order is part of the arithmetic.** The list is oldest first, and an
 * entry whose value depends on one still waiting above it says so and cannot be
 * approved until that one is decided — approving out of order used to pay the
 * full rate twice for the same afternoon. *Recusar* stays open on it: a refusal
 * credits nothing and counts for nothing (D19), so it is one of the two ways to
 * clear the way.
 */

export function QueueList({ initial }: { initial: QueueData }) {
  const [data, setData] = useState(initial);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  function act(call: () => Promise<QueueData>) {
    startAction(async () => {
      try {
        setData(await call());
        setFailed(null);
      } catch (error) {
        // The queue changes under the adult: the other adult decides an entry,
        // the boy sends another, and an approval whose answer was lost may
        // already be frozen. So a failure reads the queue again, and the
        // refreshed cards carry the reason themselves — D32's "Aprove antes",
        // an entry that is gone, an activity the picker no longer offers.
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
            Nada esperando. O que os meninos propuserem pelo cronômetro aparece
            aqui.
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

/**
 * Whether *Aprovar* is a tap the adult can make.
 *
 * Two rules and no layout, which is why it is a function rather than an
 * expression in the middle of the button. An entry whose value depends on one
 * still waiting above it cannot be frozen at all (D8), and a correction that
 * has been opened has to carry a duration the database would take — the same
 * whole minute `requireDuration` insists on, said here so the button is off
 * before the round trip rather than after it.
 */
export function canApprove(
  entry: Pick<QueueEntry, "blockedBy" | "qualityGraded" | "quality">,
  editing: boolean,
  minutes: string,
  grade: number | null = null,
): boolean {
  if (entry.blockedBy !== null) return false;

  // An entry whose activity wants a grade cannot be frozen without one — the
  // engine has no rule for it, and the stopwatch never supplies one. So the
  // adult has to open the correction and choose, and Approve is off until he
  // does. Before this the row could only be refused or moved somewhere else,
  // which is the harm D37 cites to reject stamping the price onto the entry.
  const graded = entry.qualityGraded && (grade ?? entry.quality) === null;

  if (!editing) return !graded;

  const typed = Number(minutes);

  // A ceiling as well as a floor, and it was missing: this field validated only
  // `Number.isInteger && >= 1`, so a correction could carry any number the
  // column would take — up to a million minutes, or 694 days. `requireDuration`
  // on the server has the same bound; this is the same rule said before the
  // round trip, which is what the rest of this screen already does.
  return (
    !graded && Number.isInteger(typed) && typed >= 1 && typed <= MAX_MINUTES
  );
}

/**
 * The longest a corrected session may be, in minutes.
 *
 * The ceiling `activity_logs_duration_minutes_check` puts on the column, and
 * the one `requireDuration` enforces on the server. A million minutes is 694
 * days; a day is 1.440, and D31 already stops a session crossing midnight.
 */
const MAX_MINUTES = 1_000_000;

/** The five grades of the schema's CHECK, and of the engine's `QUALITY_GRADES`. */
const QUALITY_CHOICES: readonly Choice[] = [0, 0.3, 0.5, 0.7, 1].map(
  (grade) => ({
    value: grade,
    label: grade.toLocaleString("pt-BR", { minimumFractionDigits: 1 }),
  }),
);

type Edits = {
  activityId?: number;
  durationMinutes?: number;
  quality?: number | null;
  note?: string | null;
};

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
  onApprove: (edits: Edits) => void;
  onReject: (reason: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [activityId, setActivityId] = useState(entry.activityId);
  const [minutes, setMinutes] = useState(String(entry.durationMinutes ?? ""));
  const [grade, setGrade] = useState<number | null>(entry.quality);
  const [note, setNote] = useState(entry.note ?? "");
  const [reason, setReason] = useState("");

  const typed = Number(minutes);

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

      {entry.preview !== null ? null : (
        /*
          An entry the engine has no rule for, which #26 and #27 made reachable:
          an activity that gained a quality grade, or became `free`, while a
          session was running under it. This used to take the whole queue down
          with an HTTP 500 — for both boys, with no way in the app to see it or
          undo it, and the one screen that can refuse it (D19) was the screen
          that had stopped existing.

          So it is a row with a sentence, and the two things an adult can still
          do with it are both right here: correct it onto another activity, or
          refuse it. No colour: this is not a pendency or a negative balance,
          and CLAUDE.md spends colour on exactly those two.
        */
        <p className="break-words text-base font-bold text-black">
          Não dá para calcular esta entrada com a configuração de agora:{" "}
          {entry.unpriceable}. Corrija a atividade ou recuse.
        </p>
      )}

      {editing ? (
        <div className="flex flex-col gap-3">
          {entry.qualityGraded ? (
            /*
              Only for an activity that wants one. The stopwatch never supplies
              a grade, so an activity that gains one leaves entries the engine
              cannot price — and until this existed the adult's only exits were
              to refuse the boy's real afternoon or to move it onto some other
              activity that happened to be priced right, which is word for word
              the harm D37 cites to reject stamping the price onto the entry.
            */
            <ChoiceGroup
              legend="Nota"
              onSelect={setGrade}
              options={QUALITY_CHOICES}
              value={grade ?? -1}
            />
          ) : null}

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

          <Field
            id={`duracao-${entry.id}`}
            inputMode="numeric"
            label="Duração em minutos"
            onChange={(event) => setMinutes(event.target.value)}
            type="text"
            value={minutes}
          />

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

      {/*
        Stacked on a phone, because a row of three would put each of them under
        48 px at 320; side by side from `lg`, because a 600 px wide *Aprovar* is
        a control nobody believes is a button.
      */}
      <div className="flex flex-col gap-2 lg:flex-row lg:gap-3">
        <div className="lg:flex-1">
          <Button
            disabled={busy || !canApprove(entry, editing, minutes, grade)}
            onClick={() =>
              onApprove(
                editing
                  ? {
                      activityId,
                      durationMinutes: typed,
                      quality: grade,
                      note: note.trim() === "" ? null : note.trim(),
                    }
                  : {},
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
