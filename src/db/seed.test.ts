import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "./client";
import { migrateDatabase } from "./migrate";
import { activities, categories } from "./schema";
import { seedDatabase } from "./seed";

/**
 * Built by the committed migration. Expected tables are written out, not read
 * from `SEED_CATEGORIES`: a test that reads its own input moves with a typo.
 */

let root: string;
let databasePath: string;
let connection: ReturnType<typeof openDatabase>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-seed-"));
  databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);
  connection = openDatabase(databasePath);
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

function counts() {
  const one = (table: string) =>
    (
      connection.sqlite.prepare(`select count(*) as n from ${table}`).get() as {
        n: number;
      }
    ).n;

  return {
    users: one("users"),
    categories: one("categories"),
    activities: one("activities"),
  };
}

describe("people", () => {
  it("are never written by the seed (D45)", () => {
    seedDatabase(connection);
    seedDatabase(connection);

    expect(counts().users).toBe(0);
  });
});

describe("the seven categories", () => {
  /** D1, D2, D4, D11; null decay is the off switch (D2, D5, D12). */
  it("seeds the calibration table, in the order the pickers show", () => {
    seedDatabase(connection);

    const rows = connection.db
      .select({
        name: categories.name,
        baseRate: categories.baseRate,
        decayStepHours: categories.decayStepHours,
        returnBonusPct: categories.returnBonusPct,
        returnBonusAfterDays: categories.returnBonusAfterDays,
        sortOrder: categories.sortOrder,
        active: categories.active,
      })
      .from(categories)
      .orderBy(categories.sortOrder)
      .all();

    expect(rows).toEqual([
      {
        name: "Corpo",
        baseRate: 1.5,
        decayStepHours: 2,
        returnBonusPct: 0.5,
        returnBonusAfterDays: 3,
        sortOrder: 1,
        active: true,
      },
      {
        name: "Mente",
        baseRate: 1.5,
        decayStepHours: 1,
        returnBonusPct: 0.5,
        returnBonusAfterDays: 3,
        sortOrder: 2,
        active: true,
      },
      {
        name: "Criativo",
        baseRate: 1.5,
        decayStepHours: 1,
        returnBonusPct: 0.5,
        returnBonusAfterDays: 3,
        sortOrder: 3,
        active: true,
      },
      {
        name: "Convívio",
        baseRate: null,
        decayStepHours: null,
        returnBonusPct: 0,
        returnBonusAfterDays: 0,
        sortOrder: 4,
        active: true,
      },
      {
        name: "Escola",
        baseRate: 1,
        decayStepHours: 2,
        returnBonusPct: 0,
        returnBonusAfterDays: 0,
        sortOrder: 5,
        active: true,
      },
      {
        name: "Casa",
        baseRate: null,
        decayStepHours: null,
        returnBonusPct: 0,
        returnBonusAfterDays: 0,
        sortOrder: 6,
        active: true,
      },
      {
        name: "Curinga",
        baseRate: null,
        decayStepHours: null,
        returnBonusPct: 0,
        returnBonusAfterDays: 0,
        sortOrder: 7,
        active: true,
      },
    ]);
  });

  /** The asymptote catches a rate and a step changed in opposite directions. */
  it("lands on the daily ceilings the decision log calibrated", () => {
    seedDatabase(connection);

    const rows = connection.db
      .select({
        name: categories.name,
        baseRate: categories.baseRate,
        decayStepHours: categories.decayStepHours,
      })
      .from(categories)
      .all();

    const asymptotes = Object.fromEntries(
      rows.map((row) => [
        row.name,
        row.baseRate === null || row.decayStepHours === null
          ? null
          : row.baseRate * row.decayStepHours * 2,
      ]),
    );

    expect(asymptotes).toEqual({
      Corpo: 6,
      Mente: 3,
      Criativo: 3,
      Escola: 4,
      Convívio: null,
      Casa: null,
      Curinga: null,
    });
  });
});

/** The spec's activity table, with duration rates lowered to 1,5 (#110). */
type ExpectedActivity = readonly [
  category: string,
  name: string,
  calcMode: string,
  value: number | null,
  maxSessionMinutes: number | null,
  qualityGraded: boolean,
  repeatCooldownDays: number,
  sortOrder: number,
];

const EXPECTED_ROWS: ExpectedActivity[] = [
  // category, name, calc_mode, value, max_session_minutes, quality_graded,
  // repeat_cooldown_days, sort_order
  [
    "Corpo",
    "Futebol ou outro esporte coletivo",
    "duration",
    1.5,
    180,
    false,
    0,
    1,
  ],
  ["Corpo", "Bicicleta", "duration", 1.5, 180, false, 0, 2],
  ["Corpo", "Corrida ou caminhada", "duration", 1.5, 180, false, 0, 3],
  ["Corpo", "Academia", "fixed", 1, null, false, 0, 4],

  ["Mente", "Ler livro", "duration", 1.5, 120, false, 0, 1],
  ["Mente", "Ler quadrinhos ou HQ", "duration", 1.5, 120, false, 0, 2],
  [
    "Mente",
    "Jogo de tabuleiro, xadrez ou baralho",
    "duration",
    1.5,
    120,
    false,
    0,
    3,
  ],
  ["Mente", "Curso ou aula extra", "duration", 1.5, 120, false, 0, 4],

  ["Criativo", "Escrever", "duration", 1.5, 120, false, 0, 1],
  ["Criativo", "Praticar instrumento", "duration", 1.5, 120, false, 0, 2],
  ["Criativo", "Desenhar ou pintar", "duration", 1.5, 120, false, 0, 3],
  ["Criativo", "Cozinhar uma refeição", "duration", 1.5, 120, false, 0, 4],
  [
    "Criativo",
    "Montar, consertar, marcenaria",
    "duration",
    1.5,
    120,
    false,
    0,
    5,
  ],
  ["Criativo", "Quebra-cabeça", "duration", 1.5, 120, false, 0, 6],

  ["Convívio", "Sair com os amigos", "fixed", 3, null, false, 0, 1],
  ["Convívio", "Passar o dia inteiro fora", "fixed", 5, null, false, 0, 2],
  ["Convívio", "Ir na casa de um amigo", "fixed", 2, null, false, 0, 3],
  [
    "Convívio",
    "Dormir na casa de amigo ou parente",
    "fixed",
    3,
    null,
    false,
    0,
    4,
  ],
  ["Convívio", "Igreja, servir", "fixed", 3, null, false, 0, 5],
  ["Convívio", "Igreja, culto", "fixed", 1, null, false, 0, 6],
  ["Convívio", "Conexão", "fixed", 2, null, false, 0, 7],
  ["Convívio", "Atividade extra na escola", "fixed", 2, null, false, 0, 8],

  ["Escola", "Lição de casa do dia", "delivery", 1, null, true, 0, 1],
  ["Escola", "Trabalho entregue antes do prazo", "fixed", 2, null, false, 0, 2],
  ["Escola", "Estudo para prova", "duration", 1, 180, false, 0, 3],

  ["Casa", "Lavar o carro", "delivery", 3, null, true, 7, 1],
  ["Casa", "Lavar a garagem", "delivery", 3, null, true, 7, 2],
  ["Casa", "Ajudar em mudança ou reforma", "delivery", 3, null, true, 7, 3],
  ["Casa", "Limpar a churrasqueira", "delivery", 2, null, true, 7, 4],
  ["Casa", "Organizar o quarto a fundo", "delivery", 2, null, true, 7, 5],
  [
    "Casa",
    "Quarto arrumado, verificação semanal",
    "delivery",
    2,
    null,
    true,
    7,
    6,
  ],

  ["Curinga", "Atividade avulsa", "free", null, null, false, 0, 1],
];

const EXPECTED_ACTIVITIES = EXPECTED_ROWS.map(
  ([
    category,
    name,
    calcMode,
    value,
    maxSessionMinutes,
    qualityGraded,
    repeatCooldownDays,
    sortOrder,
  ]) => ({
    category,
    name,
    calcMode,
    value,
    maxSessionMinutes,
    qualityGraded,
    repeatCooldownDays,
    sortOrder,
  }),
);

function seededActivities() {
  return connection.db
    .select({
      category: categories.name,
      name: activities.name,
      calcMode: activities.calcMode,
      value: activities.value,
      maxSessionMinutes: activities.maxSessionMinutes,
      qualityGraded: activities.qualityGraded,
      repeatCooldownDays: activities.repeatCooldownDays,
      sortOrder: activities.sortOrder,
    })
    .from(activities)
    .innerJoin(categories, eq(activities.categoryId, categories.id))
    .orderBy(categories.sortOrder, activities.sortOrder)
    .all();
}

describe("every activity of the spec", () => {
  it("is seeded, once, with the mode and the value the spec gives it", () => {
    seedDatabase(connection);

    expect(seededActivities()).toEqual(EXPECTED_ACTIVITIES);
  });

  it("adds up to the counts the spec lists per category", () => {
    seedDatabase(connection);

    const perCategory: Record<string, number> = {};
    for (const row of seededActivities()) {
      perCategory[row.category] = (perCategory[row.category] ?? 0) + 1;
    }

    expect(perCategory).toEqual({
      Corpo: 4,
      Mente: 4,
      Criativo: 6,
      Convívio: 8,
      Escola: 3,
      Casa: 6,
      Curinga: 1,
    });
    expect(counts().activities).toBe(32);
  });

  it("puts the seven-day cooldown on Casa and only on Casa", () => {
    seedDatabase(connection);

    for (const row of seededActivities()) {
      expect([row.name, row.repeatCooldownDays]).toEqual([
        row.name,
        row.category === "Casa" ? 7 : 0,
      ]);
    }
  });

  /** D11: explicit everywhere but `free`, where the schema demands null. */
  it("gives every mode but free an explicit value", () => {
    seedDatabase(connection);

    for (const row of seededActivities()) {
      expect([row.name, row.value === null]).toEqual([
        row.name,
        row.calcMode === "free",
      ]);
    }
  });

  /** `value × grade`, so it has to be graded. */
  it("grades exactly the delivery activities", () => {
    seedDatabase(connection);

    for (const row of seededActivities()) {
      expect([row.name, row.qualityGraded]).toEqual([
        row.name,
        row.calcMode === "delivery",
      ]);
    }
  });

  /** D16: only a timed mode runs a session. */
  it("sets a session limit exactly on the timed activities", () => {
    seedDatabase(connection);

    for (const row of seededActivities()) {
      expect([row.name, row.maxSessionMinutes !== null]).toEqual([
        row.name,
        row.calcMode === "duration",
      ]);
    }
  });
});

/** Ids are seed data: a moved id is a row the next deploy no longer recognises. */
describe("the identity of a seeded row", () => {
  it("gives the seven categories the ids the seed declares", () => {
    seedDatabase(connection);

    const rows = connection.db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .orderBy(categories.id)
      .all();

    expect(rows).toEqual([
      { id: 1, name: "Corpo" },
      { id: 2, name: "Mente" },
      { id: 3, name: "Criativo" },
      { id: 4, name: "Convívio" },
      { id: 5, name: "Escola" },
      { id: 6, name: "Casa" },
      { id: 7, name: "Curinga" },
    ]);
  });

  it("numbers the thirty-two activities 1 to 32, each under its category", () => {
    seedDatabase(connection);

    const rows = connection.db
      .select({ id: activities.id, categoryId: activities.categoryId })
      .from(activities)
      .orderBy(activities.id)
      .all();

    const idsByCategory: Record<number, number[]> = {};
    for (const row of rows) {
      const ids = idsByCategory[row.categoryId] ?? [];
      ids.push(row.id);
      idsByCategory[row.categoryId] = ids;
    }

    expect(idsByCategory).toEqual({
      1: [1, 2, 3, 4],
      2: [5, 6, 7, 8],
      3: [9, 10, 11, 12, 13, 14],
      4: [15, 16, 17, 18, 19, 20, 21, 22],
      5: [23, 24, 25],
      6: [26, 27, 28, 29, 30, 31],
      7: [32],
    });
  });
});

describe("running it again", () => {
  it("inserts nothing the second time, and the third", () => {
    expect(seedDatabase(connection)).toEqual({
      categories: 7,
      activities: 32,
    });
    expect(counts()).toEqual({ users: 0, categories: 7, activities: 32 });

    expect(seedDatabase(connection)).toEqual({
      categories: 0,
      activities: 0,
    });
    expect(counts()).toEqual({ users: 0, categories: 7, activities: 32 });

    expect(seedDatabase(connection)).toEqual({
      categories: 0,
      activities: 0,
    });
    expect(counts()).toEqual({ users: 0, categories: 7, activities: 32 });
  });

  it("leaves the rows byte for byte as they were", () => {
    seedDatabase(connection);

    // `select *`, so a later column and a delete-and-reinsert both show up.
    const snapshot = () =>
      ["users", "categories", "activities"].map((table) =>
        connection.sqlite.prepare(`select * from ${table} order by id`).all(),
      );

    const before = snapshot();

    seedDatabase(connection);

    expect(snapshot()).toEqual(before);
  });

  /** D15: overwriting would undo the admin's calibration on the next deploy. */
  it("does not overwrite a rate an admin changed", () => {
    seedDatabase(connection);

    connection.db
      .update(categories)
      .set({ baseRate: 3, decayStepHours: 4 })
      .where(eq(categories.name, "Mente"))
      .run();
    connection.db
      .update(activities)
      .set({ value: 9, repeatCooldownDays: 2 })
      .where(eq(activities.name, "Ler livro"))
      .run();

    expect(seedDatabase(connection)).toEqual({
      categories: 0,
      activities: 0,
    });

    const [mente] = connection.db
      .select()
      .from(categories)
      .where(eq(categories.name, "Mente"))
      .all();
    const [book] = connection.db
      .select()
      .from(activities)
      .where(eq(activities.name, "Ler livro"))
      .all();

    expect([mente?.baseRate, mente?.decayStepHours]).toEqual([3, 4]);
    expect([book?.value, book?.repeatCooldownDays]).toEqual([9, 2]);
  });

  /** D14: the match ignores `active`, so a switched-off row stays off. */
  it("does not resurrect a deactivated category or activity", () => {
    seedDatabase(connection);

    connection.db
      .update(categories)
      .set({ active: false })
      .where(eq(categories.name, "Curinga"))
      .run();
    connection.db
      .update(activities)
      .set({ active: false })
      .where(eq(activities.name, "Bicicleta"))
      .run();

    expect(seedDatabase(connection)).toEqual({
      categories: 0,
      activities: 0,
    });
    expect(counts()).toEqual({ users: 0, categories: 7, activities: 32 });

    const curinga = connection.db
      .select()
      .from(categories)
      .where(eq(categories.name, "Curinga"))
      .all();
    const bicicleta = connection.db
      .select()
      .from(activities)
      .where(eq(activities.name, "Bicicleta"))
      .all();

    expect(curinga.map((row) => row.active)).toEqual([false]);
    expect(bicicleta.map((row) => row.active)).toEqual([false]);
  });

  /** A name is an editable label: keyed by name, a rename came back as a duplicate. */
  it("does not re-create a category or activity that was renamed", () => {
    seedDatabase(connection);

    connection.db
      .update(categories)
      .set({ name: "Físico" })
      .where(eq(categories.name, "Corpo"))
      .run();
    connection.db
      .update(activities)
      .set({ name: "Bike" })
      .where(eq(activities.name, "Bicicleta"))
      .run();

    expect(seedDatabase(connection)).toEqual({
      categories: 0,
      activities: 0,
    });
    expect(counts()).toEqual({ users: 0, categories: 7, activities: 32 });

    const live = connection.db
      .select({ name: categories.name, sortOrder: categories.sortOrder })
      .from(categories)
      .where(eq(categories.active, true))
      .orderBy(categories.sortOrder)
      .all();

    expect(live.map((row) => row.name)).toEqual([
      "Físico",
      "Mente",
      "Criativo",
      "Convívio",
      "Escola",
      "Casa",
      "Curinga",
    ]);
    expect(live.map((row) => row.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  /** D14: a deactivated and a live `Corpo` may coexist; the seed must not pick one. */
  it("does not duplicate activities when two categories share a name", () => {
    seedDatabase(connection);

    connection.db
      .update(categories)
      .set({ active: false })
      .where(eq(categories.name, "Corpo"))
      .run();
    connection.db
      .insert(categories)
      .values({
        name: "Corpo",
        baseRate: 2,
        decayStepHours: 2,
        returnBonusPct: 0.5,
        returnBonusAfterDays: 3,
        sortOrder: 8,
      })
      .run();

    expect(seedDatabase(connection)).toEqual({
      categories: 0,
      activities: 0,
    });
    expect(counts()).toEqual({ users: 0, categories: 8, activities: 32 });

    const corpo = connection.db
      .select({ id: categories.id, active: categories.active })
      .from(categories)
      .where(eq(categories.name, "Corpo"))
      .orderBy(categories.id)
      .all();
    const perCategory = connection.db
      .select({ categoryId: activities.categoryId })
      .from(activities)
      .all();

    expect(corpo).toEqual([
      { id: 1, active: false },
      { id: 8, active: true },
    ]);
    expect(perCategory.filter((row) => row.categoryId === 8).length).toBe(0);
  });

  /** A half-seeded database is the shape a first run interrupted leaves. */
  it("completes a seed that was interrupted halfway", () => {
    seedDatabase(connection);

    connection.sqlite.exec("delete from activities where id > 10");

    expect(seedDatabase(connection)).toEqual({
      categories: 0,
      activities: 22,
    });
    expect(seededActivities()).toEqual(EXPECTED_ACTIVITIES);
    expect(counts()).toEqual({ users: 0, categories: 7, activities: 32 });
  });
});
