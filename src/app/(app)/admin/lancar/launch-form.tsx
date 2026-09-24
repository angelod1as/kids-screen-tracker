"use client";

import { useState, useTransition } from "react";
import type {
  EntryPreview,
  LaunchResult,
  NewEntry,
} from "../../../../db/admin";
import { Button } from "../../../../ui/button";
import type { Choice } from "../../../../ui/choice";
import { ChoiceGroup } from "../../../../ui/choice";
import { formatDay } from "../../../../ui/dates";
import { Result } from "../../../../ui/explanation";
import { failureText } from "../../../../ui/failure";
import { Field } from "../../../../ui/field";
import {
  formatDuration,
  formatHours,
  parseTypedHours,
} from "../../../../ui/hours";
import { KidSelect } from "../../../../ui/kid-select";
import { Select } from "../../../../ui/select";
import { BORDER_CLASS } from "../../../../ui/style";
import type {
  LaunchActivity,
  LaunchData,
  Movement,
} from "../../../actions/admin";
import { launchEntryAction, previewEntryAction } from "../../../actions/admin";
import type { Kid } from "../../../actions/people";

/**
 * Launching an activity for a boy (#22).
 *
 * **The value is on screen before anything is written**, which is the criterion
 * and also the reason the screen has two taps at the end instead of one:
 * *Ver quanto vale* asks the server what it would pay, and *Confirmar* writes
 * it. The number in between is a preview and is never what gets written — the
 * server computes it again inside the transaction that writes the row, so two
 * entries launched onto the same day pay the second out of the bucket the first
 * one filled. See `src/db/admin.ts`.
 *
 * It is also the screen's only honest way to say no *before* the tap. One rule
 * can refuse a launch — a pending entry that has to be decided first (D32) —
 * and it is an answer about the database rather than about the form, so no
 * amount of validation here could find it. It comes back with the preview, in
 * words, and takes the confirm button away.
 *
 * A launch onto a past day is never refused for what it would change, because
 * under D34 it changes nothing: it is frozen last, so it reads what the days
 * around it have already spent and pays the reduced rate itself.
 *
 * Nothing here calculates. The engine runs on the server for this screen (the
 * boy's calculator runs it in his browser, which is #17's own argument), so
 * there is exactly one number and one explanation, and they came from the same
 * place the ledger row will.
 */

/** The lengths on offer, the same nine the boy's calculator has. */
const DURATION_CHOICES: readonly Choice[] = [
  15, 30, 45, 60, 90, 120, 180, 240, 360,
].map((minutes) => ({ value: minutes, label: formatDuration(minutes) }));

/** The five grades of the schema's CHECK, and of the engine's `QUALITY_GRADES`. */
const QUALITY_CHOICES: readonly Choice[] = [0, 0.3, 0.5, 0.7, 1].map(
  (grade) => ({
    value: grade,
    label: grade.toLocaleString("pt-BR", { minimumFractionDigits: 1 }),
  }),
);

const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_QUALITY = 1;

/**
 * The entry the form describes, or null while it does not describe one yet.
 *
 * Exported for the same reason `canApprove` is in the queue's screen: it is a
 * rule and not layout, the sabotage matrix mutates it, and a button that is
 * enabled over an incomplete form is a round trip that ends in the generic
 * failure sentence above.
 *
 * The three optional inputs are attached **by the chosen activity's mode**, not
 * by whether they happen to hold a value: a duration sent along with a `fixed`
 * activity is a number the engine ignores and the row would store anyway, and a
 * `free` value that has not been typed is the one case where the form is
 * genuinely not finished.
 */
export function entryOf(
  form: {
    userId: number;
    activityId: number;
    occurredOn: string;
    durationMinutes: number;
    quality: number;
    freeValue: string;
    note: string;
  },
  activity: Pick<LaunchActivity, "calcMode" | "qualityGraded"> | undefined,
): NewEntry | null {
  if (activity === undefined || form.userId === 0 || form.occurredOn === "") {
    return null;
  }

  const freeValue =
    activity.calcMode === "free" ? parseTypedHours(form.freeValue) : null;

  if (activity.calcMode === "free" && freeValue === null) return null;

  return {
    userId: form.userId,
    activityId: form.activityId,
    occurredOn: form.occurredOn,
    durationMinutes:
      activity.calcMode === "duration" ? form.durationMinutes : null,
    quality: activity.qualityGraded ? form.quality : null,
    freeValue,
    note: form.note.trim() === "" ? null : form.note.trim(),
  };
}

/** Whether the preview says this launch may be written (#22, D32). */
export function canConfirm(preview: EntryPreview | null): boolean {
  if (preview === null) return false;

  return preview.blockedBy === null;
}

export function LaunchForm({ data, kids }: { data: LaunchData; kids: Kid[] }) {
  const [userId, setUserId] = useState(kids[0]?.id ?? 0);
  const [activityId, setActivityId] = useState(data.activities[0]?.id ?? 0);
  const [occurredOn, setOccurredOn] = useState(data.today);
  const [durationMinutes, setDurationMinutes] = useState(
    DEFAULT_DURATION_MINUTES,
  );
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [freeValue, setFreeValue] = useState("");
  const [note, setNote] = useState("");

  const [preview, setPreview] = useState<EntryPreview | null>(null);
  const [done, setDone] = useState<(LaunchResult & Movement) | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  const activity = data.activities.find(
    (candidate) => candidate.id === activityId,
  );
  const kid = kids.find((candidate) => candidate.id === userId);
  const entry = entryOf(
    {
      userId,
      activityId,
      occurredOn,
      durationMinutes,
      quality,
      freeValue,
      note,
    },
    activity,
  );

  /**
   * Every field clears the preview, and that is the point of the two taps.
   *
   * A preview left on screen under a changed duration is a number about an
   * entry nobody is launching any more, and it is the number the adult would be
   * reading when he taps *Confirmar*.
   */
  function change(apply: () => void) {
    apply();
    setPreview(null);
    setDone(null);
    setFailed(null);
  }

  function ask() {
    if (entry === null) return;

    startAction(async () => {
      try {
        setPreview(await previewEntryAction(entry));
        setFailed(null);
      } catch (error) {
        setFailed(failureText(error));
      }
    });
  }

  function confirm() {
    if (entry === null || !canConfirm(preview)) return;

    startAction(async () => {
      try {
        setDone(await launchEntryAction(entry));
        setPreview(null);
        setFailed(null);
      } catch (error) {
        setFailed(failureText(error));
      }
    });
  }

  if (kids.length === 0 || activity === undefined) {
    return (
      <p className={`${BORDER_CLASS} bg-white p-4 text-lg text-black`}>
        Nenhuma atividade disponível para lançar.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {failed === null ? null : (
        <p className={`${BORDER_CLASS} bg-white p-4 text-lg text-black`}>
          {failed}
        </p>
      )}

      {done === null ? null : (
        <section className="flex flex-col gap-3">
          {/*
            The explanation of the number that was *written*, not of the one the
            preview showed. The two can differ — a second entry onto the same
            day is paid out of the first one's bucket — and D9's "a soma tem que
            fechar" is about the number on the screen now.
          */}
          <Result
            calculation={done.calculation}
            heading={`Lançado para ${kid?.displayName ?? "o menino"}`}
          />
          <p className={`${BORDER_CLASS} bg-white p-4 text-base text-black`}>
            {done.creditedLedger
              ? `Saldo agora: ${formatHours(done.balance)}.`
              : `Ficou registrado e não valeu horas, então o saldo segue em ${formatHours(done.balance)}.`}
          </p>
        </section>
      )}

      <KidSelect
        kids={kids}
        onChange={(chosen) => change(() => setUserId(chosen))}
        value={userId}
      />

      <Select
        id="atividade"
        label="Atividade"
        onChange={(value) => change(() => setActivityId(Number(value)))}
        value={String(activityId)}
      >
        {groupByCategory(data.activities).map((group) => (
          <optgroup key={group.categoryId} label={group.categoryName}>
            {group.activities.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>

      {/*
        A native date input: one tap opens the OS picker, and `max` keeps the
        common mistake off the screen. The endpoint refuses a future day
        whatever the browser allows (D33's lesson, applied to a date).
      */}
      <Field
        id="dia"
        label="Dia"
        max={data.today}
        onChange={(event) => change(() => setOccurredOn(event.target.value))}
        type="date"
        value={occurredOn}
      />

      {activity.calcMode === "duration" ? (
        <ChoiceGroup
          legend="Por quanto tempo"
          onSelect={(value) => change(() => setDurationMinutes(value))}
          options={DURATION_CHOICES}
          value={durationMinutes}
        />
      ) : null}

      {activity.qualityGraded ? (
        <ChoiceGroup
          legend="Nota"
          onSelect={(value) => change(() => setQuality(value))}
          options={QUALITY_CHOICES}
          value={quality}
        />
      ) : null}

      {/*
        D11 and D12: a `free` activity has no value in the table, and the adult
        types it here. It is the escape hatch for the case the table did not
        foresee, so the field is hours of screen time outright rather than a
        rate to be multiplied by something.
      */}
      {activity.calcMode === "free" ? (
        <Field
          id="valor"
          inputMode="decimal"
          label="Quanto vale, em horas"
          onChange={(event) => change(() => setFreeValue(event.target.value))}
          type="text"
          value={freeValue}
        />
      ) : null}

      <Field
        id="observacao"
        label="Observação (opcional)"
        maxLength={500}
        onChange={(event) => change(() => setNote(event.target.value))}
        type="text"
        value={note}
      />

      {preview === null ? (
        <Button disabled={busy || entry === null} onClick={ask} type="button">
          Ver quanto vale
        </Button>
      ) : (
        <section className="flex flex-col gap-3">
          <Result
            calculation={preview.calculation}
            heading={`${kid?.displayName ?? "O menino"} ganharia`}
          />

          {preview.blockedBy === null ? null : (
            <p className={`${BORDER_CLASS} bg-white p-4 text-base text-black`}>
              Antes disto, decida na fila: {preview.blockedBy.activityName} ·{" "}
              {formatDay(preview.blockedBy.occurredOn)}. Ela vem antes deste
              lançamento, e o valor daqui depende do que for decidido lá.
            </p>
          )}

          <Button
            disabled={busy || !canConfirm(preview)}
            onClick={confirm}
            type="button"
          >
            Confirmar lançamento
          </Button>
        </section>
      )}
    </div>
  );
}

/**
 * The activities under their categories, in the order the pickers use.
 *
 * A `<select>` of thirty-two options with no grouping is a hunt on a phone; the
 * boy's calculator groups them the same way. Built from the list rather than
 * from a second query, so a category with nothing live under it cannot appear
 * as a heading over nothing (D14).
 */
export function groupByCategory(activities: readonly LaunchActivity[]): {
  categoryId: number;
  categoryName: string;
  activities: LaunchActivity[];
}[] {
  const groups: {
    categoryId: number;
    categoryName: string;
    activities: LaunchActivity[];
  }[] = [];

  for (const activity of activities) {
    const last = groups[groups.length - 1];

    if (last !== undefined && last.categoryId === activity.categoryId) {
      last.activities.push(activity);
      continue;
    }

    groups.push({
      categoryId: activity.categoryId,
      categoryName: activity.categoryName,
      activities: [activity],
    });
  }

  return groups;
}
