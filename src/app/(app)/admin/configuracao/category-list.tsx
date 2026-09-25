"use client";

import { useState, useTransition } from "react";

import type { ActivityRow } from "../../../../db/activities";
import type { CategoryInput, CategoryRow } from "../../../../db/categories";
import type { Locks } from "../../../../db/pending";
import type { Refused } from "../../../../db/refusal";
import {
  asymptoteHours,
  isUsableDecayStep,
  isUsableReturnBonus,
  MIN_DECAY_STEP_HOURS,
  MIN_RETURN_BONUS_AFTER_DAYS,
} from "../../../../engine/limits";
import { Button } from "../../../../ui/button";
import { configFailureText, failureText } from "../../../../ui/failure";
import { Field } from "../../../../ui/field";
import {
  formatDecimalHours,
  parseTypedCount,
  parseTypedHours,
} from "../../../../ui/hours";
import { LinkButton } from "../../../../ui/link-button";
import { BORDER_CLASS, HEADING_CLASS } from "../../../../ui/style";
import {
  createCategoryAction,
  fetchActivitiesAction,
  fetchCategoriesAction,
  fetchLocksAction,
  setCategoryActiveAction,
  updateCategoryAction,
} from "../../../actions/config";
import { ActivityList } from "./activity-list";

/**
 * The asymptote (`taxa × passo × 2`) is what an adult calibrates, so it is shown
 * live. Floors are explained here and enforced by the server (D33), from the one
 * predicate in `src/engine/limits.ts`. Deactivating never deletes (D14).
 */

/**
 * Said before the tap, naming queue or open session (D37): a refusal alone came
 * out as "confira os números" over numbers that were right.
 */
export function lockNote(
  category: CategoryRow,
  activityId: number | null,
  locks: Locks,
): string | null {
  const locked =
    activityId === null
      ? locks.categoryIds.includes(category.id)
      : locks.activityIds.includes(activityId);

  if (!locked) return null;

  const what =
    activityId === null
      ? "O desgaste e o bônus desta categoria"
      : "A taxa, o modo, a nota, o cooldown e a categoria desta atividade";

  const why =
    locks.queued > 0 && locks.running > 0
      ? "há entrada esperando na fila e cronômetro aberto"
      : locks.queued > 0
        ? "há entrada esperando na fila"
        : "há cronômetro aberto";

  return `${what} não mudam agora: ${why}, e o que já foi feito seria pago pelo valor novo. Decida a fila primeiro.`;
}

export type CategoryDraft = {
  name: string;
  baseRate: string;
  decayStepHours: string;
  /** Percentage points ("50"); the column is a fraction, converted once in `categoryInputOf`. */
  returnBonusPct: string;
  returnBonusAfterDays: string;
  sortOrder: string;
};

export const EMPTY_CATEGORY: CategoryDraft = {
  name: "",
  baseRate: "",
  decayStepHours: "",
  returnBonusPct: "0",
  returnBonusAfterDays: "0",
  sortOrder: "0",
};

/**
 * One function, not a `canSave`/`inputOf` pair that could disagree. Ceilings,
 * lengths and roundings belong to the endpoint.
 */
export function categoryInputOf(draft: CategoryDraft): CategoryInput | null {
  const name = draft.name.trim();

  // An empty decay field is D2's "no decay", and an empty rate is D11's "no rate".
  const decayStepHours =
    draft.decayStepHours.trim() === ""
      ? null
      : typedStepHours(draft.decayStepHours);
  const baseRate =
    draft.baseRate.trim() === "" ? null : parseTypedHours(draft.baseRate);
  const returnBonusPct = typedBonusFraction(draft.returnBonusPct);
  const returnBonusAfterDays = parseTypedCount(draft.returnBonusAfterDays);
  const sortOrder = parseTypedCount(draft.sortOrder);

  if (
    name === "" ||
    (draft.decayStepHours.trim() !== "" && decayStepHours === null) ||
    (draft.baseRate.trim() !== "" && baseRate === null) ||
    returnBonusPct === null ||
    returnBonusAfterDays === null ||
    sortOrder === null
  ) {
    return null;
  }

  if (
    !isUsableDecayStep(decayStepHours) ||
    !isUsableReturnBonus(returnBonusPct, returnBonusAfterDays)
  ) {
    return null;
  }

  return {
    name,
    baseRate,
    decayStepHours,
    returnBonusPct,
    returnBonusAfterDays,
    sortOrder,
  };
}

/** No step means no asymptote (D2); no rate means nothing to compute one from (D11). */
export function asymptoteText(draft: CategoryDraft): string {
  const typedStep = draft.decayStepHours.trim() !== "";
  const step = typedStep ? parseTypedHours(draft.decayStepHours) : null;
  const rate =
    draft.baseRate.trim() === "" ? null : parseTypedHours(draft.baseRate);

  // Unreadable is neither an asymptote nor "sem desgaste", which would contradict the warning below.
  if (typedStep && step === null) {
    return "Passo do desgaste ainda não é um número.";
  }

  if (draft.baseRate.trim() !== "" && rate === null) {
    return "Taxa sugerida ainda não é um número.";
  }

  if (step === null)
    return "Sem desgaste: cada hora vale o mesmo o dia inteiro.";

  const asymptote = asymptoteHours(rate, step);

  if (asymptote === null) {
    return "Preencha a taxa sugerida para ver quanto a categoria rende por dia.";
  }

  return `Rende no máximo ${formatDecimalHours(asymptote)} por dia (taxa × passo × 2).`;
}

/** The endpoint refuses; this is the same predicate, said before the tap. */
export function decayStepWarning(draft: CategoryDraft): string | null {
  if (draft.decayStepHours.trim() === "") return null;

  const step = typedStepHours(draft.decayStepHours);

  if (step === null) return "Digite o passo em horas, com vírgula. Ex.: 1,5";
  if (isUsableDecayStep(step)) return null;

  // The floor is about the table's shape (D35), and this sentence holds at any rate.
  return (
    `O passo mínimo é ${formatDecimalHours(MIN_DECAY_STEP_HOURS)}: abaixo disso a categoria rende ` +
    "menos da metade da taxa dela por dia, que na prática é uma categoria " +
    "desligada — e para desligar existe o botão de desativar. Para uma " +
    "categoria sem desgaste, deixe o campo vazio."
  );
}

export function baseRateWarning(draft: CategoryDraft): string | null {
  if (draft.baseRate.trim() === "") return null;

  return parseTypedHours(draft.baseRate) === null
    ? "Digite a taxa com vírgula. Ex.: 2 ou 1,5"
    : null;
}

export function returnBonusWarning(draft: CategoryDraft): string | null {
  const pct = typedBonusFraction(draft.returnBonusPct);
  const afterDays = parseTypedCount(draft.returnBonusAfterDays);

  // A field the parser cannot read leaves Save dead; say why.
  if (pct === null) {
    return "Digite o bônus em porcentagem. Ex.: 50 para metade a mais.";
  }

  if (afterDays === null) {
    return "Digite os dias em número inteiro. Ex.: 3";
  }
  // Below a hundredth of a point there is nothing to store; say so instead of dropping it.
  const typedPoints = parseTypedHours(draft.returnBonusPct);

  if (typedPoints !== null && typedPoints > 0 && pct === 0) {
    return "Menor que 0,01% é guardado como sem bônus. Digite 0,01 ou mais.";
  }

  if (isUsableReturnBonus(pct, afterDays)) return null;

  return (
    `Com bônus, o mínimo é ${MIN_RETURN_BONUS_AFTER_DAYS} dia. Em zero a janela é o próprio dia, ` +
    "então o primeiro lançamento de todo dia conta como volta e o bônus vira permanente. " +
    "Para uma categoria sem bônus, use 0%."
  );
}

/** Rounded the way the endpoint rounds before it judges, so screen and server agree on 0,247. */
function typedStepHours(text: string): number | null {
  const step = parseTypedHours(text);

  return step === null ? null : Math.round(step * 100) / 100;
}

/** In the column's fraction, at the endpoint's precision (see `typedStepHours`). */
function typedBonusFraction(text: string): number | null {
  const points = parseTypedHours(text);

  return points === null ? null : Math.round(points * 100) / 10000;
}

/** Two decimals of a percent, as `requireBonusFraction` holds it, so card and form agree. */
function percentPointsOf(fraction: number): number {
  return Math.round(fraction * 10000) / 100;
}

function percentText(fraction: number): string {
  return String(percentPointsOf(fraction)).replace(".", ",");
}

function draftOf(category: CategoryRow): CategoryDraft {
  const decimal = (value: number) => String(value).replace(".", ",");

  return {
    name: category.name,
    baseRate: category.baseRate === null ? "" : decimal(category.baseRate),
    decayStepHours:
      category.decayStepHours === null ? "" : decimal(category.decayStepHours),
    returnBonusPct: percentText(category.returnBonusPct),
    returnBonusAfterDays: String(category.returnBonusAfterDays),
    sortOrder: String(category.sortOrder),
  };
}

/**
 * The amendment to D5 and D12: editable, but the reason is on screen. Matched by
 * name, so the sentence belongs to Curinga and not to whatever row has its id.
 */
const SHAPE_NOTES: Readonly<Record<string, string>> = {
  Curinga:
    "D12: é a válvula de escape para o caso que a tabela não previu. Se ela " +
    "desgastar, deixa de servir ao motivo de existir.",
  Convívio:
    "D5: as atividades aqui não têm duração, então não há hora para acumular. " +
    "O freio é o cooldown.",
  Casa:
    "D5: as atividades aqui não têm duração, então não há hora para acumular. " +
    "O freio é o cooldown.",
};

export function shapeNote(name: string): string | null {
  return SHAPE_NOTES[name.trim()] ?? null;
}

export function categorySummary(category: CategoryRow): string {
  const asymptote = asymptoteHours(category.baseRate, category.decayStepHours);
  const decay =
    category.decayStepHours === null
      ? "sem desgaste"
      : asymptote === null
        ? `passo de ${formatDecimalHours(category.decayStepHours)}`
        : `até ${formatDecimalHours(asymptote)} por dia`;
  const bonus =
    category.returnBonusPct <= 0
      ? "sem bônus"
      : `+${percentText(category.returnBonusPct)}% após ${category.returnBonusAfterDays} ${
          category.returnBonusAfterDays === 1 ? "dia" : "dias"
        }`;

  return `${decay} · ${bonus}`;
}

export function CategoryList({
  initial,
  initialLocks,
}: {
  initial: CategoryRow[];
  initialLocks: Locks;
}) {
  const [rows, setRows] = useState(initial);
  const [locks, setLocks] = useState(initialLocks);
  const [editing, setEditing] = useState<number | null>(null);
  const [edited, setEdited] = useState<CategoryDraft>(EMPTY_CATEGORY);
  const [draft, setDraft] = useState<CategoryDraft>(EMPTY_CATEGORY);
  /** Fetched on the tap: an adult opens one category's activities, not all thirty-two. */
  const [openCategory, setOpenCategory] = useState<number | null>(null);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  function act(call: () => Promise<CategoryRow[] | Refused>) {
    startAction(async () => {
      try {
        const result = await call();

        // D37's sentence, as the server wrote it: it names the entry to decide first.
        if ("refused" in result) {
          setFailed(result.refused);
          try {
            setLocks(await fetchLocksAction());
          } catch {
            // The sentence already says what is waiting.
          }
          return;
        }

        setRows(result);
        // What is under way changes with the boy, so it is re-read every time.
        setLocks(await fetchLocksAction());
        setFailed(null);
      } catch (error) {
        let fresh: Locks | null = null;
        try {
          fresh = await fetchLocksAction();
          setLocks(fresh);
        } catch {
          // The list already says something went wrong.
        }
        // D37's refusal says what is under way instead of sending the adult to reload.
        setFailed(configFailureText(error, fresh));
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {failed === null ? null : (
        <p className={`${BORDER_CLASS} bg-white p-4 text-lg text-black`}>
          {failed}
        </p>
      )}

      {/* Before any tap: a D37 refusal alone never mentioned the queue. */}
      {locks.queued + locks.running === 0 ? null : (
        <div className={`${BORDER_CLASS} flex flex-col gap-3 bg-white p-4`}>
          <p className="text-base font-bold text-black">
            {locks.queued > 0
              ? `${locks.queued === 1 ? "1 entrada" : `${locks.queued} entradas`} esperando na fila`
              : ""}
            {locks.queued > 0 && locks.running > 0 ? " e " : ""}
            {locks.running > 0
              ? `${locks.running === 1 ? "1 cronômetro" : `${locks.running} cronômetros`} aberto${locks.running === 1 ? "" : "s"}`
              : ""}
            . Taxa, modo, nota, cooldown e categoria das atividades envolvidas —
            e o desgaste e o bônus das categorias delas — só mudam depois que
            isso for decidido.
          </p>

          <LinkButton href="/admin/fila" variant="secondary">
            Ir para a fila
          </LinkButton>
        </div>
      )}

      {rows.length === 0 ? (
        <p className={`${BORDER_CLASS} bg-white p-4 text-lg text-black`}>
          Nenhuma categoria ainda. Crie a primeira em Nova categoria, logo
          abaixo.
        </p>
      ) : null}

      <ul className="flex flex-col gap-4">
        {rows.map((category) => (
          <li
            className={`${BORDER_CLASS} flex flex-col gap-3 bg-white p-4`}
            key={category.id}
          >
            <div className="flex flex-col">
              <span className="break-words text-lg font-bold text-black">
                {category.name}
                {category.active ? "" : " · desativada"}
              </span>
              <span className="text-base text-black">
                {categorySummary(category)}
              </span>
              <span className="text-base text-black">
                {category.activityCount === 1
                  ? "1 atividade"
                  : `${category.activityCount} atividades`}
              </span>
            </div>

            {editing === category.id ? (
              <>
                {lockNote(category, null, locks) === null ? null : (
                  <p
                    className={`${BORDER_CLASS} bg-white p-3 text-base font-bold text-black`}
                  >
                    {lockNote(category, null, locks)}
                  </p>
                )}
                {shapeNote(category.name) === null ? null : (
                  <p
                    className={`${BORDER_CLASS} bg-white p-3 text-base text-black`}
                  >
                    {shapeNote(category.name)}
                  </p>
                )}
                <CategoryFields
                  draft={edited}
                  onChange={setEdited}
                  prefix={`categoria-${category.id}`}
                />
              </>
            ) : null}

            {editing === category.id ? (
              <Button
                disabled={busy || categoryInputOf(edited) === null}
                onClick={() => {
                  const input = categoryInputOf(edited);

                  if (input === null) return;

                  act(async () => {
                    const next = await updateCategoryAction(category.id, input);
                    if (!("refused" in next)) setEditing(null);

                    return next;
                  });
                }}
                type="button"
              >
                Salvar
              </Button>
            ) : (
              <Button
                disabled={busy}
                onClick={() =>
                  act(() =>
                    setCategoryActiveAction(category.id, !category.active),
                  )
                }
                type="button"
              >
                {category.active ? "Desativar" : "Ativar de novo"}
              </Button>
            )}

            {/* Never disabled: it cannot fail, and the secondary variant has no disabled look. */}
            <Button
              onClick={() => {
                setEdited(draftOf(category));
                setEditing(editing === category.id ? null : category.id);
              }}
              type="button"
              variant="secondary"
            >
              {editing === category.id ? "Cancelar" : "Editar"}
            </Button>

            <Button
              disabled={busy}
              onClick={() => {
                if (openCategory === category.id) {
                  setOpenCategory(null);

                  return;
                }

                startAction(async () => {
                  try {
                    setActivities(await fetchActivitiesAction(category.id));
                    setOpenCategory(category.id);
                    setFailed(null);
                  } catch (error) {
                    setFailed(failureText(error));
                  }
                });
              }}
              type="button"
              variant="secondary"
            >
              {openCategory === category.id
                ? "Fechar atividades"
                : "Atividades"}
            </Button>

            {openCategory === category.id ? (
              <ActivityList
                categories={rows.filter((one) => one.active)}
                category={category}
                initial={activities}
                locks={locks}
                key={category.id}
                onChanged={() =>
                  startAction(async () => {
                    try {
                      setRows(await fetchCategoriesAction());
                    } catch (error) {
                      setFailed(failureText(error));
                    }
                  })
                }
              />
            ) : null}
          </li>
        ))}
      </ul>

      <section className="flex flex-col gap-3">
        <h2 className={HEADING_CLASS}>Nova categoria</h2>

        <CategoryFields draft={draft} onChange={setDraft} prefix="nova" />

        <Button
          disabled={busy || categoryInputOf(draft) === null}
          onClick={() => {
            const input = categoryInputOf(draft);

            if (input === null) return;

            act(async () => {
              const next = await createCategoryAction(input);
              setDraft(EMPTY_CATEGORY);

              return next;
            });
          }}
          type="button"
        >
          Criar categoria
        </Button>
      </section>
    </div>
  );
}

/**
 * `prefix` keeps `<label for>` ids unique: this form appears once per card and
 * once at the bottom. The asymptote sits under the two fields it comes from.
 */
function CategoryFields({
  draft,
  onChange,
  prefix,
}: {
  draft: CategoryDraft;
  onChange: (draft: CategoryDraft) => void;
  prefix: string;
}) {
  const rateWarning = baseRateWarning(draft);
  const stepWarning = decayStepWarning(draft);
  const bonusWarning = returnBonusWarning(draft);

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
        id={`${prefix}-taxa`}
        inputMode="decimal"
        label="Taxa sugerida (vazio: nenhuma)"
        onChange={(event) =>
          onChange({ ...draft, baseRate: event.target.value })
        }
        type="text"
        value={draft.baseRate}
      />

      {rateWarning === null ? null : (
        <p
          className={`${BORDER_CLASS} bg-white p-3 text-base font-bold text-black`}
        >
          {rateWarning}
        </p>
      )}

      <Field
        id={`${prefix}-passo`}
        inputMode="decimal"
        label="Passo do desgaste, em horas (vazio: sem desgaste)"
        onChange={(event) =>
          onChange({ ...draft, decayStepHours: event.target.value })
        }
        type="text"
        value={draft.decayStepHours}
      />

      <p className={`${BORDER_CLASS} bg-white p-3 text-base text-black`}>
        {asymptoteText(draft)}
        {stepWarning === null ? null : (
          <>
            {" "}
            <span className="font-bold">{stepWarning}</span>
          </>
        )}
      </p>

      <Field
        id={`${prefix}-bonus`}
        inputMode="decimal"
        label="Bônus de retorno (%)"
        onChange={(event) =>
          onChange({ ...draft, returnBonusPct: event.target.value })
        }
        type="text"
        value={draft.returnBonusPct}
      />

      <Field
        id={`${prefix}-bonus-dias`}
        inputMode="numeric"
        label="Bônus a partir de quantos dias sem fazer"
        onChange={(event) =>
          onChange({ ...draft, returnBonusAfterDays: event.target.value })
        }
        type="text"
        value={draft.returnBonusAfterDays}
      />

      {bonusWarning === null ? null : (
        <p
          className={`${BORDER_CLASS} bg-white p-3 text-base font-bold text-black`}
        >
          {bonusWarning}
        </p>
      )}

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
