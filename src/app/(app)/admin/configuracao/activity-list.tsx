"use client";

import { useState, useTransition } from "react";

import type { ActivityInput, ActivityRow } from "../../../../db/activities";
import type { CategoryRow } from "../../../../db/categories";
import type { Locks } from "../../../../db/pending";
import { DEFAULT_MIN_SESSION_MINUTES } from "../../../../engine/timer";
import { Button } from "../../../../ui/button";
import { ChoiceGroup } from "../../../../ui/choice";
import { configFailureText } from "../../../../ui/failure";
import { Field } from "../../../../ui/field";
import {
  formatDecimalHours,
  formatDuration,
  parseTypedCount,
  parseTypedHours,
} from "../../../../ui/hours";
import { Select } from "../../../../ui/select";
import { BORDER_CLASS, HEADING_CLASS } from "../../../../ui/style";
import {
  createActivityAction,
  fetchLocksAction,
  setActivityActiveAction,
  updateActivityAction,
} from "../../../actions/config";
import { lockNote } from "./category-list";

/**
 * One category's activities, configured by hand (#27).
 *
 * **The suggestion is here, and the value is the adult's (D11).** When a
 * `duration` activity is created, the category's `base_rate` arrives in the
 * value field already filled in — and that is the whole of what `base_rate`
 * does in this application. It is nullable, three categories declare none, and
 * the engine never reads it: what governs a calculation is `activities.value`,
 * always explicitly, and by the time the form is submitted the value is a
 * number an adult saw and left there.
 *
 * The distinction is not pedantic. A default applied on the *server* would be
 * invisible — most activities are priced at their category's rate anyway, so an
 * activity that quietly fell back to `base_rate` would look right everywhere
 * anyone thought to check, and would then follow the category's rate around
 * forever without anybody having agreed to that. `src/db/activities.ts` cannot
 * do it: `activities.test.ts` fails if the word `baseRate` appears in it.
 *
 * **Changing a rate here changes nothing already credited (D15).** The list
 * writes no ledger row and reads no log.
 */

/** The four ways of counting, in the words the screen uses for them. */
const CALC_MODES: readonly { value: ActivityRow["calcMode"]; label: string }[] =
  [
    { value: "duration", label: "Por duração (horas × taxa)" },
    { value: "fixed", label: "Valor fixo, seja qual for a duração" },
    { value: "delivery", label: "Entrega, valor × nota" },
    { value: "free", label: "Avulsa: o valor é digitado no lançamento" },
  ];

/** The grade flag, as the one pair of buttons it is. */
const GRADED = [
  { value: 0, label: "Sem nota" },
  { value: 1, label: "Com nota" },
] as const;

/** The form of a new activity, or of one being corrected. */
export type ActivityDraft = {
  name: string;
  calcMode: ActivityRow["calcMode"];
  /** D11: prefilled from the category's rate, and the adult's from then on. */
  value: string;
  maxSessionMinutes: string;
  minSessionMinutes: string;
  qualityGraded: boolean;
  repeatCooldownDays: string;
  sortOrder: string;
};

/**
 * The category's rate as a field value, or an empty field (D11).
 *
 * Empty for the three categories that declare no rate — Convívio, Casa and
 * Curinga — because there is nothing to suggest, and inventing 2,0 there would
 * put a number in front of an adult that nothing in the data supports.
 */
export function suggestedValue(baseRate: number | null): string {
  return baseRate === null ? "" : String(baseRate).replace(".", ",");
}

/**
 * The form a new activity starts from, in the category it is being created in.
 *
 * `duration` first, and therefore the suggestion filled in from the start: it
 * is the commonest mode by some way — fifteen of the seed's thirty-two — and it
 * is the only one #27 asks for the suggestion on.
 */
export function emptyActivity(baseRate: number | null): ActivityDraft {
  return {
    name: "",
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
 * The draft with a different way of counting chosen, and the value field put
 * where that mode leaves it.
 *
 * Two of the four modes say something about the value, and both are D11's or
 * D12's rather than this screen's:
 *
 * - `free` has no stored value at all — the adult types it at launch (D12's
 *   Curinga) — so the field is emptied rather than left carrying a number the
 *   endpoint would refuse;
 * - `duration` is the mode #27 asks for the suggestion on, so an empty field
 *   takes the category's rate. A field an adult has already typed in is left
 *   exactly as he left it: the suggestion is an offer, and overwriting a typed
 *   number with it would make the offer a rule.
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

/**
 * The draft as the endpoint takes it, or `null` while it is not an activity
 * yet.
 *
 * One function rather than a `canSave` / `inputOf` pair, for the reason
 * `categoryInputOf` gives: two statements of one rule are two things that have
 * to agree.
 */
export function activityInputOf(
  draft: ActivityDraft,
  categoryId: number,
): ActivityInput | null {
  const name = draft.name.trim();
  const value = draft.calcMode === "free" ? null : parseTypedHours(draft.value);
  // Scoped to `duration`, exactly as `requireActivity` scopes it: the field is
  // only drawn for that mode and the endpoint nulls it for every other one.
  // Unscoped, a limit typed while the mode was `duration` and left behind by a
  // switch to `fixed` killed the Save button over a field that was no longer on
  // screen, with nothing anywhere saying why.
  const timed = draft.calcMode === "duration";
  const maxSessionMinutes =
    !timed || draft.maxSessionMinutes.trim() === ""
      ? null
      : parseTypedCount(draft.maxSessionMinutes);
  const minSessionMinutes = timed
    ? parseTypedCount(draft.minSessionMinutes)
    : DEFAULT_MIN_SESSION_MINUTES;
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
    repeatCooldownDays === null ||
    sortOrder === null
  ) {
    return null;
  }

  return {
    categoryId,
    name,
    calcMode: draft.calcMode,
    value,
    maxSessionMinutes,
    minSessionMinutes,
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

/** One activity, as a form. */
function draftOf(activity: ActivityRow): ActivityDraft {
  return {
    name: activity.name,
    calcMode: activity.calcMode,
    value:
      activity.value === null ? "" : String(activity.value).replace(".", ","),
    maxSessionMinutes:
      activity.maxSessionMinutes === null
        ? ""
        : String(activity.maxSessionMinutes),
    minSessionMinutes: String(activity.minSessionMinutes),
    qualityGraded: activity.qualityGraded,
    repeatCooldownDays: String(activity.repeatCooldownDays),
    sortOrder: String(activity.sortOrder),
  };
}

/** What an activity says about itself in the list, in one line. */
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

  if (activity.repeatCooldownDays > 0) {
    parts.push(
      `repete a cada ${activity.repeatCooldownDays} ${
        activity.repeatCooldownDays === 1 ? "dia" : "dias"
      }`,
    );
  }

  return parts.join(" · ");
}

export function ActivityList({
  categories,
  category,
  initial,
  locks,
  onChanged,
}: {
  /** The live categories, so an activity can be moved between them (D33). */
  categories: CategoryRow[];
  category: CategoryRow;
  initial: ActivityRow[];
  /** D37: what is waiting or running, so a refusal is never a surprise. */
  locks: Locks;
  /**
   * Called after anything here changes, so the categories can be read again.
   *
   * The card above this list says how many activities the category has, and
   * creating one — or moving one out — changes that number. Counting the rows
   * held here would answer for this category only: a move changes *two* counts,
   * and the destination's card is on the same screen. So the list says "it
   * moved" and the screen asks the database again, which is one query on an
   * action nobody performs twice a day.
   */
  onChanged: () => void;
}) {
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<number | null>(null);
  const [edited, setEdited] = useState<ActivityDraft>(
    emptyActivity(category.baseRate),
  );
  const [editedCategoryId, setEditedCategoryId] = useState(category.id);
  const [draft, setDraft] = useState<ActivityDraft>(
    emptyActivity(category.baseRate),
  );
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  function act(call: () => Promise<ActivityRow[]>) {
    startAction(async () => {
      try {
        setRows(await call());
        setFailed(null);
        onChanged();
      } catch (error) {
        // `locks` came with the page, and the boy may have started a session
        // since: D37's refusal is read fresh here, as the category list does.
        let fresh: Locks | null = null;
        try {
          fresh = await fetchLocksAction();
        } catch {
          // Nothing to add to a failure that is already on screen.
        }
        setFailed(configFailureText(error, fresh));
      }
    });
  }

  /**
   * Whether anything here can be changed.
   *
   * A switched-off category takes its activities out of every picker with it,
   * and the endpoint refuses to create one under it, to move one into it, or to
   * switch one back on inside it (D33). So the forms are not drawn: an adult
   * offered a Save button the server is going to refuse has been told something
   * false by the screen — and the category picker would be worse than that,
   * because the category he is looking at is not among the live ones it offers,
   * so it would sit on somebody else's name from the moment it appeared.
   *
   * The activities are still *listed*, which is D14: what was there, and what
   * it was worth, stays readable. To change any of it, switch the category back
   * on — one tap, on the card directly above this list.
   */
  const editable = category.active;

  return (
    <div className="flex flex-col gap-4">
      {editable ? null : (
        <p className={`${BORDER_CLASS} bg-white p-3 text-base text-black`}>
          Categoria desativada: as atividades continuam aqui, mas saíram das
          listas. Para mexer nelas, ative a categoria de novo.
        </p>
      )}

      {failed === null ? null : (
        <p className={`${BORDER_CLASS} bg-white p-3 text-base text-black`}>
          {failed}
        </p>
      )}

      {rows.length === 0 ? (
        <p className={`${BORDER_CLASS} bg-white p-3 text-base text-black`}>
          Nenhuma atividade nesta categoria ainda.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((activity) => (
            <li
              className={`${BORDER_CLASS} flex flex-col gap-2 bg-white p-3`}
              key={activity.id}
            >
              <div className="flex flex-col">
                <span className="break-words text-base font-bold text-black">
                  {activity.name}
                  {activity.active ? "" : " · desativada"}
                </span>
                <span className="text-base text-black">
                  {activitySummary(activity)}
                </span>
              </div>

              {editable && editing === activity.id ? (
                <>
                  {lockNote(category, activity.id, locks) === null ? null : (
                    <p
                      className={`${BORDER_CLASS} bg-white p-3 text-base font-bold text-black`}
                    >
                      {lockNote(category, activity.id, locks)}
                    </p>
                  )}
                  <ActivityFields
                    categories={categories}
                    categoryId={editedCategoryId}
                    draft={edited}
                    onChange={setEdited}
                    onChangeCategory={setEditedCategoryId}
                    prefix={`atividade-${activity.id}`}
                  />
                </>
              ) : null}

              {!editable ? null : editing === activity.id ? (
                <Button
                  disabled={
                    busy || activityInputOf(edited, editedCategoryId) === null
                  }
                  onClick={() => {
                    const input = activityInputOf(edited, editedCategoryId);

                    if (input === null) return;

                    act(async () => {
                      const next = await updateActivityAction(
                        category.id,
                        activity.id,
                        input,
                      );
                      setEditing(null);

                      return next;
                    });
                  }}
                  type="button"
                >
                  Salvar atividade
                </Button>
              ) : (
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
                >
                  {activity.active ? "Desativar" : "Ativar de novo"}
                </Button>
              )}

              {editable ? (
                <Button
                  onClick={() => {
                    setEdited(draftOf(activity));
                    setEditedCategoryId(activity.categoryId);
                    setEditing(editing === activity.id ? null : activity.id);
                  }}
                  type="button"
                  variant="secondary"
                >
                  {editing === activity.id ? "Cancelar" : "Editar"}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editable ? (
        <section className="flex flex-col gap-2">
          <h3 className={HEADING_CLASS}>Nova atividade</h3>

          <ActivityFields
            baseRate={category.baseRate}
            categories={categories}
            categoryId={category.id}
            draft={draft}
            onChange={setDraft}
            prefix={`nova-atividade-${category.id}`}
          />

          <Button
            disabled={busy || activityInputOf(draft, category.id) === null}
            onClick={() => {
              const input = activityInputOf(draft, category.id);

              if (input === null) return;

              act(async () => {
                const next = await createActivityAction(input);
                setDraft(emptyActivity(category.baseRate));

                return next;
              });
            }}
            type="button"
          >
            Criar atividade
          </Button>
        </section>
      ) : null}
    </div>
  );
}

/**
 * The fields an activity has, drawn once per card plus once at the bottom.
 *
 * `onChangeCategory` is only passed on the editing form: a new activity is
 * created in the category whose card it is under, and offering a picker there
 * would be a second way to say a thing the screen has already said. Moving an
 * existing one is a different intention and gets the picker.
 */
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

      {draft.calcMode === "free" ? (
        <p className={`${BORDER_CLASS} bg-white p-3 text-base text-black`}>
          Atividade avulsa: o valor é digitado na hora de lançar.
        </p>
      ) : (
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
  );
}
