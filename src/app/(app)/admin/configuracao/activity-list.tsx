"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { ActivityInput, ActivityRow } from "../../../../db/activities";
import type { CategoryRow } from "../../../../db/categories";
import type { Locks } from "../../../../db/pending";
import type { Refused } from "../../../../db/refusal";
import { DEFAULT_MIN_SESSION_MINUTES } from "../../../../engine/timer";
import { Button } from "../../../../ui/button";
import { ChoiceGroup } from "../../../../ui/choice";
import { failureText } from "../../../../ui/failure";
import { Field } from "../../../../ui/field";
import {
  formatDecimalHours,
  formatDuration,
  parseTypedCount,
  parseTypedHours,
} from "../../../../ui/hours";
import { CardLink } from "../../../../ui/link-button";
import { Panel, PanelText } from "../../../../ui/panel";
import { Select } from "../../../../ui/select";
import { BORDER_CLASS } from "../../../../ui/style";
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

export type ActivityDraft = {
  name: string;
  /** #40: optional; empty is no description. */
  description?: string;
  calcMode: ActivityRow["calcMode"];
  /** D11: prefilled from the category's rate, and the adult's from then on. */
  value: string;
  maxSessionMinutes: string;
  minSessionMinutes: string;
  /** #18: empty means the boy types the minutes of a request himself. */
  presumedMinutes?: string;
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
    calcMode: "duration",
    value: suggestedValue(baseRate),
    maxSessionMinutes: "",
    minSessionMinutes: String(DEFAULT_MIN_SESSION_MINUTES),
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
  if (calcMode === "free") return { ...draft, calcMode, value: "" };

  if (calcMode === "duration" && draft.value.trim() === "") {
    return { ...draft, calcMode, value: suggestedValue(baseRate) };
  }

  return { ...draft, calcMode };
}

/** One function, not a `canSave`/`inputOf` pair: see `categoryInputOf`. */
export function activityInputOf(
  draft: ActivityDraft,
  categoryId: number,
): ActivityInput | null {
  const name = draft.name.trim();
  const value = draft.calcMode === "free" ? null : parseTypedHours(draft.value);
  // Scoped to `duration` as `requireActivity` scopes it, or a limit left behind
  // by a mode switch kills Save over a field no longer on screen.
  const timed = draft.calcMode === "duration";
  const maxSessionMinutes =
    !timed || draft.maxSessionMinutes.trim() === ""
      ? null
      : parseTypedCount(draft.maxSessionMinutes);
  const minSessionMinutes = timed
    ? parseTypedCount(draft.minSessionMinutes)
    : DEFAULT_MIN_SESSION_MINUTES;
  const presumedTyped = (draft.presumedMinutes ?? "").trim();
  const presumedMinutes =
    !timed || presumedTyped === "" ? null : parseTypedCount(presumedTyped);
  const repeatCooldownDays = parseTypedCount(draft.repeatCooldownDays);
  const sortOrder = parseTypedCount(draft.sortOrder);

  if (
    name === "" ||
    (draft.calcMode !== "free" && value === null) ||
    (timed &&
      draft.maxSessionMinutes.trim() !== "" &&
      maxSessionMinutes === null) ||
    minSessionMinutes === null ||
    minSessionMinutes < 1 ||
    (maxSessionMinutes !== null && minSessionMinutes > maxSessionMinutes) ||
    (timed &&
      presumedTyped !== "" &&
      (presumedMinutes === null || presumedMinutes < 1)) ||
    repeatCooldownDays === null ||
    sortOrder === null
  ) {
    return null;
  }

  return {
    categoryId,
    name,
    description: (draft.description ?? "").trim() || null,
    calcMode: draft.calcMode,
    value,
    maxSessionMinutes,
    minSessionMinutes,
    presumedMinutes,
    qualityGraded: draft.qualityGraded,
    repeatCooldownDays,
    sortOrder,
  };
}

/** Why Save is dead over the floor, said beside it (D44). */
export function minSessionWarning(draft: ActivityDraft): string | null {
  if (draft.calcMode !== "duration") return null;

  const floor = parseTypedCount(draft.minSessionMinutes);
  const limit = parseTypedCount(draft.maxSessionMinutes);

  if (floor === null || floor < 1) {
    return "Digite a sessão mínima em minutos inteiros, de 1 para cima. Ex.: 5";
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
    calcMode: activity.calcMode,
    value:
      activity.value === null ? "" : String(activity.value).replace(".", ","),
    maxSessionMinutes:
      activity.maxSessionMinutes === null
        ? ""
        : String(activity.maxSessionMinutes),
    minSessionMinutes: String(activity.minSessionMinutes),
    presumedMinutes:
      activity.presumedMinutes === null ? "" : String(activity.presumedMinutes),
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
      parts.push(`${formatDecimalHours(activity.value ?? 0)} fixas`);
      break;
    case "delivery":
      parts.push(`${formatDecimalHours(activity.value ?? 0)} × nota`);
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

        {failed === null ? null : (
          <p className={`${BORDER_CLASS} bg-white p-3 text-base text-black`}>
            {failed}
          </p>
        )}

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

        {failed === null ? null : (
          <p className={`${BORDER_CLASS} bg-white p-3 text-base text-black`}>
            {failed}
          </p>
        )}

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
        {draft.calcMode === "free" ? null : (
          <Field
            id={`${prefix}-valor`}
            inputMode="decimal"
            label={
              draft.calcMode === "duration"
                ? "Taxa por hora (sugerida pela categoria, dá para mudar)"
                : "Valor em horas"
            }
            onChange={(event) =>
              onChange({ ...draft, value: event.target.value })
            }
            type="text"
            value={draft.value}
          />
        )}

        {draft.calcMode === "duration" ? (
          <Field
            id={`${prefix}-limite`}
            inputMode="numeric"
            label="Limite da sessão, em minutos (vazio: sem limite)"
            onChange={(event) =>
              onChange({ ...draft, maxSessionMinutes: event.target.value })
            }
            type="text"
            value={draft.maxSessionMinutes}
          />
        ) : null}

        {draft.calcMode === "duration" ? (
          <Field
            id={`${prefix}-minimo`}
            inputMode="numeric"
            label="Sessão mínima, em minutos (abaixo disso não é enviada)"
            onChange={(event) =>
              onChange({ ...draft, minSessionMinutes: event.target.value })
            }
            type="text"
            value={draft.minSessionMinutes}
          />
        ) : null}

        {draft.calcMode === "duration" ? (
          <Field
            id={`${prefix}-presumida`}
            inputMode="numeric"
            label="Duração presumida do pedido, em minutos (vazio: o menino digita)"
            onChange={(event) =>
              onChange({ ...draft, presumedMinutes: event.target.value })
            }
            type="text"
            value={draft.presumedMinutes ?? ""}
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
