"use client";

import { useMemo, useState } from "react";
import { calculateEarnedHours } from "../../../../engine/calculate";
import type { Choice } from "../../../../ui/choice";
import { ChoiceGroup } from "../../../../ui/choice";
import { Result } from "../../../../ui/explanation";
import { formatDuration } from "../../../../ui/hours";
import { Select } from "../../../../ui/select";
import { BORDER_CLASS } from "../../../../ui/style";
import type { CalculatorData } from "../../../actions/calculator";

/**
 * Computes nothing: every number comes from the engine, run in the browser
 * (#17). Grade 1,0 draws no line of its own because `roundOnce` leaves out steps
 * that moved nothing; that is not a bug.
 */

/**
 * Past every `max_session_minutes`: that is the timer's stop (D16), and "ler 6
 * horas só rende quase nada a mais que ler 4" is the example the model teaches.
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

export function Calculator({ data }: { data: CalculatorData }) {
  const first = data.activities[0];

  const [activityId, setActivityId] = useState(first?.id ?? 0);
  const [durationMinutes, setDurationMinutes] = useState(
    DEFAULT_DURATION_MINUTES,
  );
  const [quality, setQuality] = useState(DEFAULT_QUALITY);

  const activity =
    data.activities.find((candidate) => candidate.id === activityId) ?? first;
  const category = data.categories.find(
    (candidate) => candidate.id === activity?.categoryId,
  );

  const calculation = useMemo(
    () =>
      activity === undefined || category === undefined
        ? undefined
        : calculateEarnedHours({
            userId: data.userId,
            activity,
            category,
            occurredOn: data.occurredOn,
            durationMinutes,
            quality,
            history: data.history,
            historyFrom: data.historyFrom,
            historyTo: data.historyTo,
            categoryFirstDay: data.categoryFirstDays[category.id] ?? null,
          }),
    [
      activity,
      category,
      data.categoryFirstDays,
      data.historyFrom,
      data.historyTo,
      data.history,
      data.occurredOn,
      data.userId,
      durationMinutes,
      quality,
    ],
  );

  if (activity === undefined || category === undefined) {
    return (
      <p className={`${BORDER_CLASS} bg-white p-4 text-lg text-black`}>
        Nenhuma atividade disponível para simular.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Select
        id="atividade"
        label="Atividade"
        onChange={(value) => setActivityId(Number(value))}
        value={String(activity.id)}
      >
        {data.categories.map((option) => {
          const offered = data.activities.filter(
            (candidate) => candidate.categoryId === option.id,
          );

          // A category with nothing offered is a dead end, e.g. Curinga (D12, D14).
          if (offered.length === 0) return null;

          return (
            <optgroup key={option.id} label={option.name}>
              {offered.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </optgroup>
          );
        })}
      </Select>

      {activity.calcMode === "duration" ? (
        <ChoiceGroup
          legend="Por quanto tempo"
          onSelect={setDurationMinutes}
          options={DURATION_CHOICES}
          value={durationMinutes}
        />
      ) : null}

      {activity.qualityGraded ? (
        <ChoiceGroup
          legend="Nota"
          onSelect={setQuality}
          options={QUALITY_CHOICES}
          value={quality}
        />
      ) : null}

      {calculation === undefined ? null : <Result calculation={calculation} />}
    </div>
  );
}
