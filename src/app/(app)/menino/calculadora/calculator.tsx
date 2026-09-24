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
 * The calculator (#17): pick an activity and a length, see what it is worth
 * **right now**, and read why.
 *
 * It calls `calculateEarnedHours` — the engine, the one the admin's real entry
 * will call in Phase 5 — and not a copy of the formula. That is the acceptance
 * criterion "usa a mesma função de f1-engine; nenhuma lógica de cálculo
 * reimplementada aqui", and it is the reason this file computes nothing at all:
 * every number below comes out of `Calculation`, including the total, which is
 * the sum of the lines by the engine's own construction (see `roundOnce`).
 *
 * Running it in the browser is what makes changing 1h to 1h30 cost one tap and
 * no wait. The engine is safe to import here — measured, and written down in
 * its module docstring — because its only import is an `import type`.
 *
 * **Nothing is written.** There is no form and no action, and the history the
 * engine is handed is simply everything the boy has already been credited for:
 * under D34 an entry counts what was frozen before it, and nothing has been
 * frozen after a simulation that is never going to be written.
 *
 * One consequence of computing nothing, declared because it reads like a bug
 * and is not: at the default grade of 1,0 the "Nota" control draws no line of
 * its own. A step that multiplies by one moved nothing, and `roundOnce` leaves
 * out the steps that moved nothing — a "nota 1,0 · +0 min" row is a deduction
 * that is not one. The control is working; it is the grades below 1,0 that
 * have something to say, and the total moves the moment one is tapped.
 */

/**
 * The lengths on offer.
 *
 * Nine buttons, a quarter of an hour to six. They are not filtered by the
 * chosen activity's own maximum: that column is the timer's automatic stop
 * (D16), and this screen answers "quanto isso renderia", which is a fair
 * question about six hours of reading done in three sittings.
 *
 * Which is exactly why the list runs past three hours, `Corpo`'s longest
 * `max_session_minutes`. `decisions.md` opens on "ler 6 horas é permitido — só
 * rende quase nada a mais do que ler 4", and that sentence is the whole model:
 * the limit is an asymptote and not a shut door. A calculator that stopped at
 * three hours could not reproduce the one example the document teaches the
 * system with, on the screen that exists to teach the system.
 */
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

          // A category with nothing under it is not a heading, it is a dead
          // end. Curinga was one: its only activity is `free` and the action
          // leaves those out (D12), so the group arrived with the seven others
          // and no options at all — on Android the boy scrolls down to
          // "Curinga" and finds nothing beneath it. The same happens to any
          // category whose activities an admin switches off one by one (D14).
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
