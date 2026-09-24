import type { Connection } from "./client";
import { writeTransaction } from "./client";
import type { NewActivity, NewCategory } from "./schema";
import { activities, categories } from "./schema";

/**
 * The seven categories and every activity of `docs/spec.md`; no people (D45).
 * `decay_step_hours` comes from `decisions.md` (D1, D2, D4), not the spec's bands.
 */

/**
 * `sort_order` comes from the list position. `id` is written out: it is the
 * seed's identity for the row, so it survives a reorder and a rename.
 */
type SeedCategory = Omit<NewCategory, "sortOrder" | "active"> & {
  id: number;
  activities: SeedActivity[];
};

type SeedActivity = Omit<NewActivity, "categoryId" | "sortOrder" | "active"> & {
  id: number;
};

/**
 * In the pickers' order. `return_bonus_pct` is a fraction (0,5 is +50%), and
 * `(0, 0)` is written out anyway: a bonus left implicit is a bonus nobody checks.
 */
export const SEED_CATEGORIES: readonly SeedCategory[] = [
  {
    id: 1,
    name: "Corpo",
    baseRate: 1.5,
    // Twice Mente's step so a two-hour match pays in full. Asymptote ~6h a day.
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
    // D5, D11.
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
    // D5: only "Estudo para prova" has a duration. Asymptote 1 × 2 × 2 = ~4h a day.
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
    // D5: the seven-day cooldown is this category's brake.
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
    // D12.
    id: 7,
    name: "Curinga",
    baseRate: null,
    decayStepHours: null,
    returnBonusPct: 0,
    returnBonusAfterDays: 0,
    activities: [
      { id: 32, name: "Atividade avulsa", calcMode: "free", value: null },
    ],
  },
];

/** Zero everywhere on a second run. */
export type SeedResult = {
  categories: number;
  activities: number;
};

/**
 * Insert-only, by primary key: an upsert would undo the admin's tuning (D15),
 * and a name is editable and not unique (D14). One transaction.
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
