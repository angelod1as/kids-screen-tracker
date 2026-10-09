"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { ActivityRow } from "../../../../db/activities";
import type { CategoryRow } from "../../../../db/categories";
import type { Locks } from "../../../../db/pending";
import type { Refused } from "../../../../db/refusal";
import { DEFAULT_MIN_SESSION_MINUTES } from "../../../../engine/timer";
import { Button } from "../../../../ui/button";
import { ChoiceGroup } from "../../../../ui/choice";
import { ErrorNote } from "../../../../ui/error-note";
import { failureText } from "../../../../ui/failure";
import { Field, TimeFields } from "../../../../ui/field";
import type { TypedTime } from "../../../../ui/hours";
import {
  EMPTY_TIME,
  formatDecimalHours,
  formatDuration,
  formatHours,
  isBlankTime,
  parseTypedCount,
  parseTypedHours,
  parseTypedTime,
  timeFromHours,
  timeFromMinutes,
  typedMinutes,
} from "../../../../ui/hours";
import { CardLink } from "../../../../ui/link-button";
import { Panel, PanelText } from "../../../../ui/panel";
import { Select } from "../../../../ui/select";
import { BORDER_CLASS } from "../../../../ui/style";
import type { ActivityRequest } from "../../../actions/config";
import {
  createActivityAction,
  setActivityActiveAction,
  updateActivityAction,
} from "../../../actions/config";
import { FIELD_PAIR_CLASS, lockNote } from "./category-list";

/**
 * `base_rate` only prefills the value field on the screen (D11); a server-side
 * default would follow the category's rate forever unnoticed, and
 * `activities.test.ts` fails if `baseRate` appears in `src/db/activities.ts`.
 */

const CALC_MODES: readonly { value: ActivityRow["calcMode"]; label: string }[] =
  [
    { value: "duration", label: "Por duração (horas × taxa)" },
    { value: "fixed", label: "Valor fixo, seja qual for a duração" },
    { value: "delivery", label: "Entrega, valor × nota" },
    { value: "free", label: "Avulsa: o valor é digitado no lançamento" },
  ];

const GRADED = [
  { value: 0, label: "Sem nota" },
  { value: 1, label: "Com nota" },
] as const;

const NOTE_REQUIRED = [
  { value: 0, label: "Opcional" },
  { value: 1, label: "Obrigatória" },
] as const;

export type ActivityDraft = {
  name: string;
  /** #40: optional; empty is no description. */
  description?: string;
  /** #44. */
  noteRequired?: boolean;
  /** #85: optional; empty is no prompt. */
  observationPrompt?: string;
  calcMode: ActivityRow["calcMode"];
  /** D11: the `duration` rate, prefilled from the category's, and the adult's from then on. */
  value: string;
  /** A `fixed` or `delivery` activity's hours (#48). */
  amount?: TypedTime;
  maxSession: TypedTime;
  minSession: TypedTime;
  /** #18: empty means the boy types the time of a request himself. */
  presumed?: TypedTime;
  qualityGraded: boolean;
  repeatCooldownDays: string;
  sortOrder: string;
};

/** Empty where the category declares no rate: inventing 2,0 would be a number nothing supports (D11). */
export function suggestedValue(baseRate: number | null): string {
  return baseRate === null ? "" : String(baseRate).replace(".", ",");
}

/** `duration` first: the commonest mode, and the one #27 suggests a value for. */
export function emptyActivity(baseRate: number | null): ActivityDraft {
  return {
    name: "",
    description: "",
    observationPrompt: "",
    calcMode: "duration",
    value: suggestedValue(baseRate),
    amount: EMPTY_TIME,
    maxSession: EMPTY_TIME,
    minSession: timeFromMinutes(DEFAULT_MIN_SESSION_MINUTES),
    qualityGraded: false,
    repeatCooldownDays: "0",
    sortOrder: "0",
  };
}

/**
 * `free` empties the value (D12: typed at launch). `duration` takes the
 * suggestion only into an empty field: an offer, never overwriting what was typed.
 */
export function withCalcMode(
  draft: ActivityDraft,
  calcMode: ActivityRow["calcMode"],
  baseRate: number | null,
): ActivityDraft {
  if (calcMode === "free") {
    return { ...draft, calcMode, value: "", amount: EMPTY_TIME };
  }

  if (calcMode === "duration" && draft.value.trim() === "") {
    return { ...draft, calcMode, value: suggestedValue(baseRate) };
  }

  return { ...draft, calcMode };
}

/** One function, not a `canSave`/`inputOf` pair: see `categoryInputOf`. */
export function activityInputOf(
  draft: ActivityDraft,
  categoryId: number,
): ActivityRequest | null {
  const name = draft.name.trim();
  // Scoped to `duration` as `requireActivity` scopes it, or a limit left behind
  // by a mode switch kills Save over a field no longer on screen.
  const timed = draft.calcMode === "duration";
  const priced = draft.calcMode === "fixed" || draft.calcMode === "delivery";
  const rate = timed ? parseTypedHours(draft.value) : null;
  const amount = priced ? parseTypedTime(draft.amount ?? EMPTY_TIME) : null;
  const maxSession =
    !timed || isBlankTime(draft.maxSession)
      ? null
      : parseTypedTime(draft.maxSession);
  const maxSessionMinutes = maxSession === null ? null : minutesOf(maxSession);
  // Not read by the server outside `duration`; sent so the shape is one.
  const minSession = timed
    ? parseTypedTime(draft.minSession)
    : { hours: 0, minutes: DEFAULT_MIN_SESSION_MINUTES };
  const minSessionMinutes = typedMinutes(draft.minSession);
  const presumedTyped = draft.presumed ?? EMPTY_TIME;
  const presumed =
    !timed || isBlankTime(presumedTyped) ? null : parseTypedTime(presumedTyped);
  const repeatCooldownDays = parseTypedCount(draft.repeatCooldownDays);
  const sortOrder = parseTypedCount(draft.sortOrder);

  if (
    name === "" ||
    (timed && rate === null) ||
    (priced && amount === null) ||
    (timed && !isBlankTime(draft.maxSession) && maxSession === null) ||
    minSession === null ||
    (timed &&
      (minSessionMinutes === null ||
        minSessionMinutes < 1 ||
        (maxSessionMinutes !== null &&
          minSessionMinutes > maxSessionMinutes))) ||
    (maxSessionMinutes !== null && maxSessionMinutes < 1) ||
    (timed &&
      !isBlankTime(presumedTyped) &&
      (presumed === null || minutesOf(presumed) < 1)) ||
    repeatCooldownDays === null ||
    sortOrder === null
  ) {
    return null;
  }

  return {
    categoryId,
    name,
    description: (draft.description ?? "").trim() || null,
    noteRequired: draft.noteRequired === true,
    observationPrompt: (draft.observationPrompt ?? "").trim() || null,
    calcMode: draft.calcMode,
    rate,
    amount,
    maxSession,
    minSession,
    presumed,
    qualityGraded: draft.qualityGraded,
    repeatCooldownDays,
    sortOrder,
  };
}

function minutesOf(time: { hours: number; minutes: number }): number {
  return time.hours * 60 + time.minutes;
}

/** Why Save is dead over the floor, said beside it (D44). */
export function minSessionWarning(draft: ActivityDraft): string | null {
  if (draft.calcMode !== "duration") return null;

  const floor = typedMinutes(draft.minSession);
  const limit = typedMinutes(draft.maxSession);

  if (floor === null || floor < 1) {
    return "Digite a sessão mínima em horas e minutos inteiros, de 1 minuto para cima. Ex.: 0 h e 5 min";
  }

  if (limit !== null && floor > limit) {
    return "A sessão mínima não pode passar do limite da sessão: toda sessão parada pelo limite seria descartada.";
  }

  return null;
}

function draftOf(activity: ActivityRow): ActivityDraft {
  return {
    name: activity.name,
    description: activity.description ?? "",
    observationPrompt: activity.observationPrompt ?? "",
    noteRequired: activity.noteRequired === true,
    calcMode: activity.calcMode,
    value:
      activity.calcMode !== "duration" || activity.value === null
        ? ""
        : String(activity.value).replace(".", ","),
    amount:
      activity.calcMode === "duration"
        ? EMPTY_TIME
        : timeFromHours(activity.value),
    maxSession: timeFromMinutes(activity.maxSessionMinutes),
    minSession: timeFromMinutes(activity.minSessionMinutes),
    presumed: timeFromMinutes(activity.presumedMinutes ?? null),
    qualityGraded: activity.qualityGraded,
    repeatCooldownDays: String(activity.repeatCooldownDays),
    sortOrder: String(activity.sortOrder),
  };
}

export function activitySummary(activity: ActivityRow): string {
  const parts: string[] = [];

  switch (activity.calcMode) {
    case "duration":
      parts.push(`${formatDecimalHours(activity.value ?? 0)} por hora`);
      break;
    case "fixed":
      parts.push(`${formatHours(activity.value ?? 0)} fixas`);
      break;
    case "delivery":
      parts.push(`${formatHours(activity.value ?? 0)} × nota`);
      break;
    case "free":
      parts.push("valor digitado no lançamento");
      break;
  }

  if (activity.calcMode === "duration") {
    parts.push(`mínimo de ${formatDuration(activity.minSessionMinutes)}`);
  }

  if (activity.maxSessionMinutes !== null) {
    parts.push(`até ${formatDuration(activity.maxSessionMinutes)} por sessão`);
  }

  if (activity.presumedMinutes != null) {
    parts.push(`pedido vale ${formatDuration(activity.presumedMinutes)}`);
  }

  if (activity.noteRequired === true) {
    parts.push("pede observação");
  }

  if (activity.repeatCooldownDays > 0) {
    parts.push(
      `repete a cada ${activity.repeatCooldownDays} ${
        activity.repeatCooldownDays === 1 ? "dia" : "dias"
      }`,
    );
  }

  return parts.join(" · ");
}

/** Level two's half (#41): each row opens the activity's own page. */
export function ActivityList({
  category,
  rows,
}: {
  category: CategoryRow;
  rows: ActivityRow[];
}) {
  return (
    <Panel note={String(rows.length)} title="Atividades">
      {category.active ? null : (
        <PanelText>
          Categoria desativada: as atividades continuam aqui, mas saíram das
          listas. Para mexer nelas, ative a categoria de novo.
        </PanelText>
      )}

      {rows.length === 0 ? (
        <PanelText>Nenhuma atividade nesta categoria ainda.</PanelText>
      ) : (
        <ul>
          {rows.map((activity) => (
            <li
              className="border-t border-black first:border-t-0"
              key={activity.id}
            >
              <CardLink
                disabled={!activity.active}
                flush
                href={`/admin/configuracao/${category.id}/${activity.id}`}
              >
                <span className="break-words text-base font-bold text-black">
                  {activity.name}
                  {activity.active ? "" : " · desativada"}
                </span>
                <span className="text-base text-black">
                  {activitySummary(activity)}
                </span>
              </CardLink>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * Level three (#41): the form is open on arrival, so the tap on the card stands
 * in for *Editar*. Done, the adult goes back to the category; refused, stays.
 */
export function ActivityEditor({
  activity,
  categories,
  category,
  locks,
}: {
  activity: ActivityRow;
  /** The live categories, so an activity can be moved between them (D33). */
  categories: CategoryRow[];
  category: CategoryRow;
  /** D37: what is waiting or running, so a refusal is never a surprise. */
  locks: Locks;
}) {
  const router = useRouter();
  const [edited, setEdited] = useState<ActivityDraft>(draftOf(activity));
  const [editedCategoryId, setEditedCategoryId] = useState(activity.categoryId);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startAction] = useTransition();
  const back = `/admin/configuracao/${category.id}`;

  function act(call: () => Promise<ActivityRow[] | Refused>) {
    startAction(async () => {
      try {
        const result = await call();

        // D37's sentence, as the server wrote it: it names the entry to decide first.
        if ("refused" in result) {
          setFailed(result.refused);
          return;
        }

        router.push(back);
      } catch (error) {
        setFailed(failureText(error));
      }
    });
  }

  /**
   * A switched-off category's activities stay listed (D14) but get no form: the
   * endpoint refuses every change under it (D33), so a Save button would lie.
   */
  const editable = category.active;
  const note = lockNote(category, activity.id, locks);

  return (
    <Panel
      title={`${activity.name}${activity.active ? "" : " · desativada"}`}
      top
    >
      <div className="flex flex-col gap-3 p-3">
        {editable ? null : (
          <p className="text-base text-black">
            {activitySummary(activity)}. Categoria desativada: para mexer nesta
            atividade, ative a categoria de novo.
          </p>
        )}

        {editable && note !== null ? (
          <p
            className={`${BORDER_CLASS} bg-white p-3 text-base font-bold text-black`}
          >
            {note}
          </p>
        ) : null}

        {editable ? (
          <ActivityFields
            categories={categories}
            categoryId={editedCategoryId}
            draft={edited}
            onChange={setEdited}
            onChangeCategory={setEditedCategoryId}
            prefix={`atividade-${activity.id}`}
          />
        ) : null}

        {failed === null ? null : <ErrorNote>{failed}</ErrorNote>}

        {editable ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <Button
              disabled={
                busy || activityInputOf(edited, editedCategoryId) === null
              }
              onClick={() => {
                const input = activityInputOf(edited, editedCategoryId);

                if (input === null) return;

                act(() =>
                  updateActivityAction(category.id, activity.id, input),
                );
              }}
              type="button"
            >
              Salvar atividade
            </Button>

            <Button
              disabled={busy}
              onClick={() =>
                act(() =>
                  setActivityActiveAction(
                    category.id,
                    activity.id,
                    !activity.active,
                  ),
                )
              }
              type="button"
              variant="secondary"
            >
              {activity.active ? "Desativar" : "Ativar de novo"}
            </Button>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

export function NewActivityForm({
  categories,
  category,
}: {
  categories: CategoryRow[];
  category: CategoryRow;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<ActivityDraft>(
    emptyActivity(category.baseRate),
  );
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  return (
    <Panel title={`Nova atividade em ${category.name}`} top>
      <div className="flex flex-col gap-3 p-3">
        <ActivityFields
          baseRate={category.baseRate}
          categories={categories}
          categoryId={category.id}
          draft={draft}
          onChange={setDraft}
          prefix={`nova-atividade-${category.id}`}
        />

        {failed === null ? null : <ErrorNote>{failed}</ErrorNote>}

        <Button
          disabled={busy || activityInputOf(draft, category.id) === null}
          onClick={() => {
            const input = activityInputOf(draft, category.id);

            if (input === null) return;

            startAction(async () => {
              try {
                await createActivityAction(input);
                router.push(`/admin/configuracao/${category.id}`);
              } catch (error) {
                setFailed(failureText(error));
              }
            });
          }}
          type="button"
        >
          Criar atividade
        </Button>
      </div>
    </Panel>
  );
}

/** `onChangeCategory` only on the editing form: a new activity belongs to the page it is created from. */
function ActivityFields({
  baseRate = null,
  categories,
  categoryId,
  draft,
  onChange,
  onChangeCategory,
  prefix,
}: {
  /** D11: only the new-activity form suggests, and only for `duration`. */
  baseRate?: number | null;
  categories: CategoryRow[];
  categoryId: number;
  draft: ActivityDraft;
  onChange: (draft: ActivityDraft) => void;
  onChangeCategory?: (categoryId: number) => void;
  prefix: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Field
        id={`${prefix}-nome`}
        label="Nome"
        maxLength={500}
        onChange={(event) => onChange({ ...draft, name: event.target.value })}
        type="text"
        value={draft.name}
      />

      <Field
        id={`${prefix}-descricao`}
        label="Descrição: o que cabe aqui (opcional)"
        // `MAX_DESCRIPTION_LENGTH`, which a client file cannot import from `db/`.
        maxLength={200}
        onChange={(event) =>
          onChange({ ...draft, description: event.target.value })
        }
        type="text"
        value={draft.description ?? ""}
      />

      <ChoiceGroup
        legend="Observação do menino"
        onSelect={(value) => onChange({ ...draft, noteRequired: value === 1 })}
        options={NOTE_REQUIRED}
        value={draft.noteRequired === true ? 1 : 0}
      />

      <Field
        id={`${prefix}-observacao`}
        label="O que deve ser explicado na observação? (opcional)"
        // `MAX_OBSERVATION_PROMPT_LENGTH`, which a client file cannot import from `db/`.
        maxLength={200}
        onChange={(event) =>
          onChange({ ...draft, observationPrompt: event.target.value })
        }
        type="text"
        value={draft.observationPrompt ?? ""}
      />

      <div className={"grid gap-3 lg:grid-cols-2"}>
        {onChangeCategory === undefined ? null : (
          <Select
            id={`${prefix}-categoria`}
            label="Categoria"
            onChange={(value) => onChangeCategory(Number(value))}
            value={String(categoryId)}
          >
            {categories.map((option) => (
              <option key={option.id} value={String(option.id)}>
                {option.name}
              </option>
            ))}
          </Select>
        )}

        <Select
          id={`${prefix}-modo`}
          label="Como conta"
          onChange={(value) =>
            onChange(
              withCalcMode(draft, value as ActivityRow["calcMode"], baseRate),
            )
          }
          value={draft.calcMode}
        >
          {CALC_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </Select>
      </div>

      {draft.calcMode !== "free" ? null : (
        <p className={`${BORDER_CLASS} bg-white p-3 text-base text-black`}>
          Atividade avulsa: o valor é digitado na hora de lançar.
        </p>
      )}

      <div className={`${FIELD_PAIR_CLASS} lg:grid-cols-4`}>
        {draft.calcMode === "duration" ? (
          <Field
            id={`${prefix}-valor`}
            inputMode="decimal"
            label="Taxa por hora (sugerida pela categoria, dá para mudar)"
            onChange={(event) =>
              onChange({ ...draft, value: event.target.value })
            }
            type="text"
            value={draft.value}
          />
        ) : null}

        {draft.calcMode === "fixed" || draft.calcMode === "delivery" ? (
          <TimeFields
            id={`${prefix}-valor`}
            legend="Valor"
            onChange={(amount) => onChange({ ...draft, amount })}
            value={draft.amount ?? EMPTY_TIME}
          />
        ) : null}

        {draft.calcMode === "duration" ? (
          <TimeFields
            id={`${prefix}-limite`}
            legend="Limite da sessão (vazio: sem limite)"
            onChange={(maxSession) => onChange({ ...draft, maxSession })}
            value={draft.maxSession}
          />
        ) : null}

        {draft.calcMode === "duration" ? (
          <TimeFields
            id={`${prefix}-minimo`}
            legend="Sessão mínima (abaixo disso não é enviada)"
            onChange={(minSession) => onChange({ ...draft, minSession })}
            value={draft.minSession}
          />
        ) : null}

        {draft.calcMode === "duration" ? (
          <TimeFields
            id={`${prefix}-presumida`}
            legend="Duração presumida do pedido (vazio: o menino digita)"
            onChange={(presumed) => onChange({ ...draft, presumed })}
            value={draft.presumed ?? EMPTY_TIME}
          />
        ) : null}
      </div>

      {minSessionWarning(draft) === null ? null : (
        <p
          className={`${BORDER_CLASS} bg-white p-3 text-base font-bold text-black`}
        >
          {minSessionWarning(draft)}
        </p>
      )}

      <ChoiceGroup
        legend="Nota de qualidade"
        onSelect={(value) => onChange({ ...draft, qualityGraded: value === 1 })}
        options={GRADED}
        value={draft.qualityGraded ? 1 : 0}
      />

      <div className={FIELD_PAIR_CLASS}>
        <Field
          id={`${prefix}-cooldown`}
          inputMode="numeric"
          label="Só repete depois de quantos dias (0: sem espera)"
          onChange={(event) =>
            onChange({ ...draft, repeatCooldownDays: event.target.value })
          }
          type="text"
          value={draft.repeatCooldownDays}
        />

        <Field
          id={`${prefix}-ordem`}
          inputMode="numeric"
          label="Ordem na lista"
          onChange={(event) =>
            onChange({ ...draft, sortOrder: event.target.value })
          }
          type="text"
          value={draft.sortOrder}
        />
      </div>
    </div>
  );
}
