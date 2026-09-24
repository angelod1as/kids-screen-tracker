import type { Connection } from "./client";
import { writeTransaction } from "./client";
import type { NewActivity, NewCategory } from "./schema";
import { activities, categories } from "./schema";

/**
 * The rows the app needs to open working: the seven categories and every
 * activity of the table in `docs/spec.md`. No people: `users` is written only
 * by hand, with SQL (D45).
 *
 * Two things are worth reading before changing a number here.
 *
 * - **`decay_step_hours` comes from the calibration table in
 *   `docs/decisions.md`, not from the thresholds in `docs/spec.md`.** The spec
 *   is a historical annex: its `full_up_to` / `half_up_to` weekly bands were
 *   replaced by a daily geometric decay in D1, D2 and D4. What survives from
 *   the spec is the list of activities and their values.
 * - **`value` is always explicit (D11).** `base_rate` is null for the three
 *   categories that declare no rate and is only a suggestion for the
 *   Configuration screen elsewhere. The engine reads the activity's own
 *   `value`, so every non-`free` row carries one even when it repeats the
 *   category's rate.
 */

/**
 * A category as written below: `sort_order` is not typed here because it is
 * derived from the position in the list, and `active` follows the schema
 * default. One less number to keep in step by hand.
 *
 * `id`, on the other hand, is written out and never derived from the position.
 * It is the seed's identity for the row (see `seedDatabase`), so it has to
 * survive a reordering of this list as well as a rename on the Configuration
 * screen. A new category takes the next unused number; the existing ones keep
 * theirs forever.
 */
type SeedCategory = Omit<NewCategory, "sortOrder" | "active"> & {
  id: number;
  activities: SeedActivity[];
};

type SeedActivity = Omit<NewActivity, "categoryId" | "sortOrder" | "active"> & {
  id: number;
};

/**
 * The seven categories and their activities, in the order the pickers show
 * them — which is the order of the seed table in the spec.
 *
 * `return_bonus_pct` is a fraction, not percentage points: the spec's rule is
 * "multiply by (1 + pct)", so the 50% bonus of Corpo, Mente and Criativo is
 * `0.5`. Convívio, Escola and Casa have no return bonus, and Curinga has none
 * by D12 — for all four the pair is `(0, 0)`, which is also the schema default
 * and is written out anyway, because a bonus left implicit is a bonus nobody
 * checks.
 */
export const SEED_CATEGORIES: readonly SeedCategory[] = [
  {
    id: 1,
    name: "Corpo",
    baseRate: 1.5,
    // Twice the step of Mente and Criativo, on purpose: a football match runs
    // two hours and has to pay in full. Asymptote 1.5 × 2 × 2 = ~6h a day.
    decayStepHours: 2,
    returnBonusPct: 0.5,
    returnBonusAfterDays: 3,
    activities: [
      {
        id: 1,
        name: "Futebol ou outro esporte coletivo",
        calcMode: "duration",
        value: 1.5,
        maxSessionMinutes: 180,
      },
      {
        id: 2,
        name: "Bicicleta",
        calcMode: "duration",
        value: 1.5,
        maxSessionMinutes: 180,
      },
      {
        id: 3,
        name: "Corrida ou caminhada",
        calcMode: "duration",
        value: 1.5,
        maxSessionMinutes: 180,
      },
      {
        id: 4,
        name: "Treino em casa",
        calcMode: "duration",
        value: 1.5,
        maxSessionMinutes: 180,
      },
    ],
  },
  {
    id: 2,
    name: "Mente",
    baseRate: 1.5,
    // Asymptote 1.5 × 1 × 2 = ~3h a day.
    decayStepHours: 1,
    returnBonusPct: 0.5,
    returnBonusAfterDays: 3,
    activities: [
      {
        id: 5,
        name: "Ler livro",
        calcMode: "duration",
        value: 1.5,
        maxSessionMinutes: 120,
      },
      {
        id: 6,
        // The spec priced it below its category's rate; since #110 it equals it.
        name: "Ler quadrinhos ou HQ",
        calcMode: "duration",
        value: 1.5,
        maxSessionMinutes: 120,
      },
      {
        id: 7,
        name: "Jogo de tabuleiro, xadrez ou baralho",
        calcMode: "duration",
        value: 1.5,
        maxSessionMinutes: 120,
      },
      {
        id: 8,
        name: "Curso ou aula extra",
        calcMode: "duration",
        value: 1.5,
        maxSessionMinutes: 120,
      },
    ],
  },
  {
    id: 3,
    name: "Criativo",
    baseRate: 1.5,
    // Asymptote 1.5 × 1 × 2 = ~3h a day.
    decayStepHours: 1,
    returnBonusPct: 0.5,
    returnBonusAfterDays: 3,
    activities: [
      {
        id: 9,
        name: "Escrever",
        calcMode: "duration",
        value: 1.5,
        maxSessionMinutes: 120,
      },
      {
        id: 10,
        name: "Praticar instrumento",
        calcMode: "duration",
        value: 1.5,
        maxSessionMinutes: 120,
      },
      {
        id: 11,
        name: "Desenhar ou pintar",
        calcMode: "duration",
        value: 1.5,
        maxSessionMinutes: 120,
      },
      {
        id: 12,
        name: "Cozinhar uma refeição",
        calcMode: "duration",
        value: 1.5,
        maxSessionMinutes: 120,
      },
      {
        id: 13,
        name: "Montar, consertar, marcenaria",
        calcMode: "duration",
        value: 1.5,
        maxSessionMinutes: 120,
      },
      {
        id: 14,
        name: "Quebra-cabeça",
        calcMode: "duration",
        value: 1.5,
        maxSessionMinutes: 120,
      },
    ],
  },
  {
    // D5 and D11: only `fixed` activities here. Nothing has a duration to
    // accumulate, so there is no decay, and no rate to suggest either.
    id: 4,
    name: "Convívio",
    baseRate: null,
    decayStepHours: null,
    returnBonusPct: 0,
    returnBonusAfterDays: 0,
    activities: [
      { id: 15, name: "Sair com os amigos", calcMode: "fixed", value: 3 },
      {
        id: 16,
        name: "Passar o dia inteiro fora",
        calcMode: "fixed",
        value: 5,
      },
      { id: 17, name: "Ir na casa de um amigo", calcMode: "fixed", value: 2 },
      {
        id: 18,
        name: "Dormir na casa de amigo ou parente",
        calcMode: "fixed",
        value: 3,
      },
      { id: 19, name: "Igreja, servir", calcMode: "fixed", value: 3 },
      { id: 20, name: "Igreja, culto", calcMode: "fixed", value: 1 },
      { id: 21, name: "Conexão", calcMode: "fixed", value: 2 },
      {
        id: 22,
        name: "Atividade extra na escola",
        calcMode: "fixed",
        value: 2,
      },
    ],
  },
  {
    // D5: the decay applies to "Estudo para prova" alone, which is the only
    // activity here that has a duration. Asymptote 1 × 2 × 2 = ~4h a day.
    id: 5,
    name: "Escola",
    baseRate: 1,
    decayStepHours: 2,
    returnBonusPct: 0,
    returnBonusAfterDays: 0,
    activities: [
      {
        id: 23,
        name: "Lição de casa do dia",
        calcMode: "delivery",
        value: 1,
        qualityGraded: true,
      },
      {
        id: 24,
        name: "Trabalho entregue antes do prazo",
        calcMode: "fixed",
        value: 2,
      },
      {
        id: 25,
        name: "Estudo para prova",
        calcMode: "duration",
        value: 1,
        maxSessionMinutes: 180,
      },
    ],
  },
  {
    // D5: no decay here either — the seven-day cooldown on every activity is
    // the brake this category gets, and it is the only category that has one.
    id: 6,
    name: "Casa",
    baseRate: null,
    decayStepHours: null,
    returnBonusPct: 0,
    returnBonusAfterDays: 0,
    activities: [
      {
        id: 26,
        name: "Lavar o carro",
        calcMode: "delivery",
        value: 3,
        qualityGraded: true,
        repeatCooldownDays: 7,
      },
      {
        id: 27,
        name: "Lavar a garagem",
        calcMode: "delivery",
        value: 3,
        qualityGraded: true,
        repeatCooldownDays: 7,
      },
      {
        id: 28,
        name: "Ajudar em mudança ou reforma",
        calcMode: "delivery",
        value: 3,
        qualityGraded: true,
        repeatCooldownDays: 7,
      },
      {
        id: 29,
        name: "Limpar a churrasqueira",
        calcMode: "delivery",
        value: 2,
        qualityGraded: true,
        repeatCooldownDays: 7,
      },
      {
        id: 30,
        name: "Organizar o quarto a fundo",
        calcMode: "delivery",
        value: 2,
        qualityGraded: true,
        repeatCooldownDays: 7,
      },
      {
        id: 31,
        name: "Quarto arrumado, verificação semanal",
        calcMode: "delivery",
        value: 2,
        qualityGraded: true,
        repeatCooldownDays: 7,
      },
    ],
  },
  {
    // D12: the admin's escape hatch for the case the table did not foresee.
    // Decaying or bonusing it would defeat the only reason it exists.
    id: 7,
    name: "Curinga",
    baseRate: null,
    decayStepHours: null,
    returnBonusPct: 0,
    returnBonusAfterDays: 0,
    activities: [
      // `free` is the one mode whose value is typed at launch time, and the
      // schema requires the column to be null for it.
      { id: 32, name: "Atividade avulsa", calcMode: "free", value: null },
    ],
  },
];

/** How many rows each table gained. Zero everywhere on a second run. */
export type SeedResult = {
  categories: number;
  activities: number;
};

/**
 * Writes whatever of the seed is missing, and nothing else.
 *
 * Idempotent by **primary key** and **insert-only**: a row that is already there
 * is left exactly as it is. Two rules force that shape.
 *
 * - D15 says the table will change a lot in the first months and that editing
 *   it never rewrites the past. A seed that upserted would undo, on the next
 *   deploy, the tuning an admin did on the Configuration screen.
 * - D14 says a category or activity is deactivated, never deleted. So the
 *   match deliberately ignores `active`: a `Corpo` the admin switched off is
 *   still a `Corpo`, and re-inserting it would resurrect it as a duplicate —
 *   which the partial unique index of the schema, scoped to the live rows,
 *   would happily accept.
 *
 * **Why the id and not the name.** The name was the natural key here until it
 * turned out to be editable: the Configuration screen does full CRUD on
 * categories and activities (`docs/spec.md`, "Configuração"), so a rename made
 * the seed re-create the row it had just renamed — `Corpo` renamed to `Físico`
 * came back with its four activities, eight live categories, two of them on
 * `sort_order` 1. And the name is not even unique in the database: the partial
 * unique index of the schema is scoped to the live rows on purpose, so that a
 * deactivated `Corpo` can coexist with a live one, and a lookup by name then
 * has two rows to choose from.
 *
 * The primary key is the one thing about a seeded row that no screen can
 * change: `id` survives a rename, a deactivation, and a second row of the same
 * name. So the ids of the seven categories and the thirty-two activities are
 * written out in `SEED_CATEGORIES` and are part of the data, not of the
 * insertion order — which is also why the activities carry a single 1–32
 * sequence rather than numbering restarting per category.
 *
 * The whole thing runs in one `IMMEDIATE` transaction, so a seed interrupted
 * halfway leaves no half-populated category behind.
 */
export function seedDatabase(connection: Connection): SeedResult {
  return writeTransaction(connection, (tx) => {
    const existingCategoryIds = new Set(
      tx
        .select({ id: categories.id })
        .from(categories)
        .all()
        .map((row) => row.id),
    );
    const missingCategories = SEED_CATEGORIES.map((category, index) => ({
      id: category.id,
      name: category.name,
      baseRate: category.baseRate,
      decayStepHours: category.decayStepHours,
      returnBonusPct: category.returnBonusPct,
      returnBonusAfterDays: category.returnBonusAfterDays,
      sortOrder: index + 1,
    })).filter((category) => !existingCategoryIds.has(category.id));
    if (missingCategories.length > 0) {
      tx.insert(categories).values(missingCategories).run();
    }

    const existingActivityIds = new Set(
      tx
        .select({ id: activities.id })
        .from(activities)
        .all()
        .map((row) => row.id),
    );

    const missingActivities: NewActivity[] = [];
    for (const category of SEED_CATEGORIES) {
      category.activities.forEach((activity, index) => {
        if (existingActivityIds.has(activity.id)) {
          return;
        }

        missingActivities.push({
          ...activity,
          categoryId: category.id,
          sortOrder: index + 1,
        });
      });
    }
    if (missingActivities.length > 0) {
      tx.insert(activities).values(missingActivities).run();
    }

    return {
      categories: missingCategories.length,
      activities: missingActivities.length,
    };
  });
}
