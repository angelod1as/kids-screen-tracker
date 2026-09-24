"use client";

import { useState, useTransition } from "react";

import type { ActivityRow } from "../../../../db/activities";
import type { CategoryInput, CategoryRow } from "../../../../db/categories";
import type { Locks } from "../../../../db/pending";
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
 * The categories, configured by hand (#26).
 *
 * **The asymptote is the point of this screen.** `decisions.md` opens by saying
 * that the number one calibrates is how much a category can pay in a day, and
 * that the step falls out of it — `assíntota = taxa × passo × 2`. An adult
 * typing a step is therefore working backwards through a multiplication every
 * single time, and the screen doing it for him, live, under the two fields it
 * comes from, is what turns this from a form into a calibration tool. It is
 * also what makes the floor below legible rather than arbitrary: a step of 0,1
 * at a rate of 3,0 reads "rende no máximo 0,60 h por dia", and nobody has to be
 * told twice why that is refused.
 *
 * **Both floors are shown before they are hit, and enforced somewhere else.**
 * The sentences here and the refusals in `src/db/categories.ts` are two
 * renderings of one predicate — `isUsableDecayStep` and `isUsableReturnBonus`,
 * in `src/engine/limits.ts` — and neither re-states the comparison. That is
 * deliberate: this project has four times found two guards for one rule where
 * each was quietly covering for the other, and a screen that spelled `>= 0.25`
 * out again would be the fifth. The server is the guard (D33); this is the
 * explanation, and it exists so the refusal never has to arrive as a surprise.
 *
 * **Deactivating never deletes (D14).** A switched-off category stays in the
 * list, keeps its numbers, says how many activities go with it, and can be
 * switched back on. Every entry ever written against it stays exactly as it was
 * frozen (D15) — nothing on this screen recalculates anything, and nothing on
 * this screen can.
 */

/**
 * Why a category's numbers will not move right now (D37), or null.
 *
 * The sentence an adult reads **before** the tap, which is the whole point.
 * Measured before this existed: a D37 refusal reached the screen through
 * `catch { setFailed(true) }` and came out as "Confira os números — pode ser um
 * valor que o servidor recusa", on a save where the numbers are *right*. The
 * adult re-checks the field that is not wrong, saves again, gets the same
 * sentence, and has no way at all to discover that the answer is to go and
 * decide a pending entry: nothing in this folder so much as mentions the queue.
 *
 * So the screen asks (`fetchLocksAction`) instead of guessing, and says which
 * of the two it is, because they end differently — a queued entry is waiting
 * for the adult, and an open session is waiting for the boy.
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

/** The form of a new category, or of one being corrected. */
export type CategoryDraft = {
  name: string;
  baseRate: string;
  decayStepHours: string;
  /**
   * Percentage points, as an adult says them: "50" for half as much again.
   *
   * The column is a fraction (`0,5`), because the engine multiplies by
   * `1 + pct` — see `returnBonusMultiplier`. The conversion happens once, in
   * `categoryInputOf`, so the two spellings never meet anywhere else. A field
   * labelled "%" that took 0,5 would be read as half a percent by every adult
   * who has ever filled in a form.
   */
  returnBonusPct: string;
  returnBonusAfterDays: string;
  sortOrder: string;
};

/** An empty form, for the category that does not exist yet. */
export const EMPTY_CATEGORY: CategoryDraft = {
  name: "",
  baseRate: "",
  decayStepHours: "",
  returnBonusPct: "0",
  returnBonusAfterDays: "0",
  sortOrder: "0",
};

/**
 * The draft as the endpoint takes it, or `null` while it is not a category yet.
 *
 * One function and not a `canSave` / `inputOf` pair. Such a pair is two
 * statements of one rule that have to agree, and the failure mode when they
 * stop agreeing is a Save button that is enabled over a draft the builder
 * answers nothing for. Here "can it be saved" is "does this return
 * something", so there is one rule and one place.
 *
 * The two floors are part of it, through `src/engine/limits.ts` and not through
 * a comparison written here. Note what is *not* checked: the ceilings, the
 * lengths and the roundings all belong to the endpoint, which owns them. This
 * answers the narrower question of whether the form is filled in.
 */
export function categoryInputOf(draft: CategoryDraft): CategoryInput | null {
  const name = draft.name.trim();

  // D2: an empty decay field is a category with no decay at all, which is a
  // filled-in answer and not a missing one. Every other field is required, and
  // the base rate is D11's — empty means the category declares no rate.
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

/**
 * What the category being typed would pay in a day, in words (#26).
 *
 * Four sentences, because there are four states and only one of them is a
 * number. A category with no step never decays, so there is no asymptote to
 * name (D2); a category with no rate has nothing to compute one from (D11), and
 * guessing 2,0 there would put a number on screen that the engine will never
 * use; and a step field with something unreadable in it is none of those.
 */
export function asymptoteText(draft: CategoryDraft): string {
  const typedStep = draft.decayStepHours.trim() !== "";
  const step = typedStep ? parseTypedHours(draft.decayStepHours) : null;
  const rate =
    draft.baseRate.trim() === "" ? null : parseTypedHours(draft.baseRate);

  // Five states, not three. An empty field is D2's off switch and says so; a
  // field with something unreadable in it is neither an asymptote nor a
  // category without decay, and saying "sem desgaste" over it was the app
  // asserting something false in its own voice — and contradicting the warning
  // printed directly underneath.
  if (typedStep && step === null) {
    return "Passo do desgaste ainda não é um número.";
  }

  // A rate that is not a number is not a category without a rate, and saying
  // "preencha a taxa" over a field with `abc` in it is the app describing a
  // screen the adult is not looking at.
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

/**
 * Why the step being typed would be refused, or `null` while it would not be.
 *
 * The sentence an adult reads *before* tapping. The refusal itself is the
 * endpoint's, in `src/db/categories.ts`; this and that one are the same
 * predicate rendered twice, and neither restates the comparison.
 */
export function decayStepWarning(draft: CategoryDraft): string | null {
  if (draft.decayStepHours.trim() === "") return null;

  const step = typedStepHours(draft.decayStepHours);

  if (step === null) return "Digite o passo em horas, com vírgula. Ex.: 1,5";
  if (isUsableDecayStep(step)) return null;

  // Not "a conta perde precisão", which is what this said and what stopped being
  // true when the engine went exact (D39). The floor is about the shape of the
  // table now (D35), and this sentence is exact at **any** rate: the asymptote
  // is `taxa × passo × 2`, so it drops below `taxa × 0,5` exactly when the step
  // drops below 0,25 — no need for `base_rate` to be filled in for it to hold.
  return (
    `O passo mínimo é ${formatDecimalHours(MIN_DECAY_STEP_HOURS)}: abaixo disso a categoria rende ` +
    "menos da metade da taxa dela por dia, que na prática é uma categoria " +
    "desligada — e para desligar existe o botão de desativar. Para uma " +
    "categoria sem desgaste, deixe o campo vazio."
  );
}

/**
 * Why the rate being typed would be refused, or `null` while it would not be.
 *
 * The third of three, and it was missing: an unreadable rate printed "Preencha
 * a taxa sugerida" over a field visibly containing `abc`, and killed Save with
 * nothing beside it — the two defects this file's own cases name for the other
 * two fields.
 */
export function baseRateWarning(draft: CategoryDraft): string | null {
  if (draft.baseRate.trim() === "") return null;

  return parseTypedHours(draft.baseRate) === null
    ? "Digite a taxa com vírgula. Ex.: 2 ou 1,5"
    : null;
}

/** Why the bonus being typed would be refused, or `null` while it would not be. */
export function returnBonusWarning(draft: CategoryDraft): string | null {
  const pct = typedBonusFraction(draft.returnBonusPct);
  const afterDays = parseTypedCount(draft.returnBonusAfterDays);

  // The same courtesy `decayStepWarning` extends: a field the parser cannot
  // read leaves Save dead, and a dead button with no sentence beside it is the
  // screen refusing without saying why.
  if (pct === null) {
    return "Digite o bônus em porcentagem. Ex.: 50 para metade a mais.";
  }

  if (afterDays === null) {
    return "Digite os dias em número inteiro. Ex.: 3";
  }
  // A bonus too small to be held at all. The screen and the endpoint now agree
  // that it is zero — which is the bug this file already fixed once, at two
  // orders of magnitude higher — but agreeing silently is still the adult's
  // bonus disappearing without a word. Below a hundredth of a point there is
  // nothing to store, so the screen says that instead of pretending.
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

/**
 * A typed decay step, rounded the way the endpoint rounds it before it judges.
 *
 * The floors are one predicate read from two places, but the *input* to that
 * predicate was computed two ways: the screen tested the raw number and the
 * endpoint tested it after `requireNonNegativeHours` had rounded to two
 * decimals. Measured, the whole interval `[0,245 ; 0,25)` disagreed — the
 * screen refused 0,247 and the endpoint accepted it and stored 0,25. So the
 * screen rounds first too, and the two now answer the same question about the
 * same number.
 */
function typedStepHours(text: string): number | null {
  const step = parseTypedHours(text);

  return step === null ? null : Math.round(step * 100) / 100;
}

/**
 * A typed bonus, in the fraction the column holds and at the precision the
 * endpoint holds it to.
 *
 * Same argument as `typedStepHours`, and the same measurement: below 0,005
 * percentage points the screen showed "com bônus, o mínimo é 1 dia" over a Save
 * button that was still enabled, and saving stored `pct = 0` — the bonus the
 * adult had just typed vanishing without a word, which is the bug this screen
 * was supposed to have fixed.
 */
function typedBonusFraction(text: string): number | null {
  const points = parseTypedHours(text);

  return points === null ? null : Math.round(points * 100) / 10000;
}

/**
 * The fraction the column holds, as the percentage points the screen shows.
 *
 * One function for both places that need it — the card and the form — because
 * they sit one above the other: a card reading "+13%" over a field reading
 * "12,5" is two numbers for one bonus, and the reader has no way to tell which
 * is the real one. Two decimals of a percent, which is exactly what
 * `requireBonusFraction` holds the fraction to.
 */
function percentPointsOf(fraction: number): number {
  return Math.round(fraction * 10000) / 100;
}

/** The same, written the way the rest of the interface writes a decimal. */
function percentText(fraction: number): string {
  return String(percentPointsOf(fraction)).replace(".", ",");
}

/** One category, as a form. */
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
 * The three categories whose shape is a decision, and the sentence that says so.
 *
 * The amendment to D5 and D12 (Fase 6): this screen may give Curinga a decay
 * step or Convívio a bonus, because "sem deploy" is the point of the phase and
 * an adult who decides that Curinga now needs decay is the adult deciding. What
 * it may not do is let that happen without the reason being on screen — D12
 * gives a *functional* reason, not a description of the seed, and `CLAUDE.md`
 * says not to reinterpret a decision in silence.
 *
 * Matched by name, and that is deliberate: these are the three rows the seed
 * ships, and a category somebody creates later has no decision about it to
 * quote. Renaming one takes its sentence away, which is correct — the sentence
 * belongs to Curinga, not to whatever row happens to hold that id.
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

/** The sentence a category's own decision leaves for whoever edits it. */
export function shapeNote(name: string): string | null {
  return SHAPE_NOTES[name.trim()] ?? null;
}

/** What a category says about itself in the list, in one line. */
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
  /**
   * The category whose activities are open, and them (#27).
   *
   * Fetched on the tap rather than with the page: seven categories carry
   * thirty-two activities between them, and an adult opens one of them. Drawing
   * all thirty-two to save a round trip would put the thing he came for behind
   * a scroll, which is the design rule this project measures itself against.
   */
  const [openCategory, setOpenCategory] = useState<number | null>(null);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  function act(call: () => Promise<CategoryRow[]>) {
    startAction(async () => {
      try {
        setRows(await call());
        // What is under way changes with the boy, not with this screen, so it
        // is re-read on every round trip rather than assumed to be what it was
        // when the page was drawn.
        setLocks(await fetchLocksAction());
        setFailed(null);
      } catch (error) {
        let fresh: Locks | null = null;
        try {
          fresh = await fetchLocksAction();
          setLocks(fresh);
        } catch {
          // The list is already telling the adult something went wrong; a
          // second failure here has nothing to add.
        }
        // D37's refusal is the one that lasts: if something is under way now,
        // the sentence says so instead of sending the adult to reload.
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

      {/*
        The one sentence that has to be on screen before an adult opens
        anything. Without it a D37 refusal arrived as "Confira os números" on a
        save whose numbers are right, and nothing in this folder so much as
        mentioned the queue — so there was no way to discover that the answer is
        to go and decide a pending entry.
      */}
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
                    setEditing(null);

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

            {/*
              Never disabled: it opens and closes a form held in this component,
              cannot fail, and the secondary variant has no disabled treatment
              to tell apart.
            */}
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

            {/*
              The activities of one category, under the category (#27).

              Fetched on the tap rather than with the page: seven categories
              carry thirty-two activities between them and an adult opens one of
              them, so drawing all thirty-two would put the thing he came for
              behind a scroll.
            */}
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
 * The six fields a category has, drawn once for the new one and once for the
 * one being corrected.
 *
 * `prefix` because a `<label for>` needs an id unique on the page, and this
 * form appears once per card plus once at the bottom.
 *
 * The asymptote sits directly under the two fields it is computed from rather
 * than at the end of the form: it is feedback on those two numbers, and
 * feedback three fields away from its cause is feedback nobody connects.
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
