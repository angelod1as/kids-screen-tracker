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
 * *Ver quanto vale* previews, *Confirmar* writes, and the server recomputes in
 * the write's transaction. The preview is also where a D32 refusal arrives
 * before the tap. A past day is never refused: D34 freezes it last.
 */

const DURATION_CHOICES: readonly Choice[] = [
  15, 30, 45, 60, 90, 120, 180, 240, 360,
].map((minutes) => ({ value: minutes, label: formatDuration(minutes) }));

const QUALITY_CHOICES: readonly Choice[] = [0, 0.3, 0.5, 0.7, 1].map(
  (grade) => ({
    value: grade,
    label: grade.toLocaleString("pt-BR", { minimumFractionDigits: 1 }),
  }),
);

const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_QUALITY = 1;

/**
 * Exported: the sabotage matrix mutates it. Optional inputs are attached by the
 * activity's mode, not by whether they hold a value.
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

/** D32. */
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

  /** Every field clears the preview, so *Confirmar* never reads a stale number. */
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
        const result = await launchEntryAction(entry);

        // D32's sentence, as the server wrote it.
        if ("refused" in result) {
          setFailed(result.refused);
          return;
        }

        setDone(result);
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
          {/* The written number's explanation: it may differ from the preview's. */}
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

      {/* `max` keeps the common mistake off screen; the endpoint refuses a future day anyway (D33). */}
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

      {/* D11, D12: a `free` activity's value is typed here, in hours outright. */}
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

/** Grouped from the list, so a category with nothing live under it has no heading (D14). */
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
