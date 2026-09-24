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
 * Like the schema tests, every case here runs against a database built the way
 * production builds one: `migrateDatabase` on an empty directory, then a
 * connection from `openDatabase`. The committed migration is what the seed is
 * written into.
 *
 * The expected tables below are written out literally rather than derived from
 * `SEED_CATEGORIES`. A test that reads the list it is checking
 * moves with a typo and stays green — and a wrong `value` here is a wrong
 * amount of screen time for the rest of the project.
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
  /**
   * `decay_step_hours` is the calibration table of `docs/decisions.md`, not the
   * weekly `full_up_to` / `half_up_to` bands of `docs/spec.md`, which D1, D2
   * and D4 removed. `base_rate` is null wherever the category declares no rate
   * (D11), and null decay is the off switch (D2, D5, D12).
   */
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

  /**
   * The asymptote is `rate × decay_step_hours × 2`, and it is the number the
   * decision log actually calibrated — the step was derived from it. Asserting
   * the product catches a step and a rate that were changed in opposite
   * directions and still look plausible one at a time.
   */
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

/**
 * The whole activity table, activity by activity, as `docs/spec.md` lists it
 * with the duration rates lowered to 1.5 (#110). `max_session_minutes` is set only where a session has a duration
 * to cut, and `repeat_cooldown_days` is 7 on every activity of Casa and 0
 * everywhere else.
 */
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
  ["Corpo", "Treino em casa", "duration", 1.5, 180, false, 0, 4],

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

  /**
   * D11: the activity's `value` is what the engine reads, so it is explicit
   * everywhere it can be — and `free` is the one mode where the schema demands
   * it be null, because the admin types the number at launch time.
   */
  it("gives every mode but free an explicit value", () => {
    seedDatabase(connection);

    for (const row of seededActivities()) {
      expect([row.name, row.value === null]).toEqual([
        row.name,
        row.calcMode === "free",
      ]);
    }
  });

  /** A `delivery` is `value × quality grade`, so it has to be graded. */
  it("grades exactly the delivery activities", () => {
    seedDatabase(connection);

    for (const row of seededActivities()) {
      expect([row.name, row.qualityGraded]).toEqual([
        row.name,
        row.calcMode === "delivery",
      ]);
    }
  });

  /** D16 cuts a running session at this limit; the other modes never run one. */
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

/**
 * The seed matches on the primary key, because it is the only thing about a
 * seeded row that no screen can change: the Configuration screen renames and
 * deactivates, and the partial unique index of the schema lets two rows share
 * a name. So the ids are part of the seed data and are pinned here — a number
 * that moved would be a row the next deploy no longer recognises.
 */
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

    // `select *`, so a column added later is compared without this test being
    // edited — including the ids, which is where a delete-and-reinsert would
    // show up.
    const snapshot = () =>
      ["users", "categories", "activities"].map((table) =>
        connection.sqlite.prepare(`select * from ${table} order by id`).all(),
      );

    const before = snapshot();

    seedDatabase(connection);

    expect(snapshot()).toEqual(before);
  });

  /**
   * D15: the Configuration screen is where the table gets tuned, and the seed
   * runs on every deploy. If it overwrote, the next deploy would silently undo
   * an admin's calibration — and D14 makes the same point about a category
   * that was switched off rather than deleted.
   */
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

  /**
   * D14 again, from the other side: the match ignores `active`, so a category
   * or an activity the admin switched off stays off instead of coming back as
   * a second, live row — which the partial unique index, scoped to the live
   * rows, would accept without complaint.
   */
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

  /**
   * The Configuration screen does full CRUD on categories and activities
   * (`docs/spec.md`, "Configuração"), so a name is an editable label, not an
   * identity. Keyed by name, the seed re-created what an admin had renamed:
   * `Corpo` renamed to `Físico` came back with its four activities, eight live
   * categories, two of them on `sort_order` 1.
   */
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

  /**
   * D14 through the partial unique index of the schema: it is scoped to the
   * live rows on purpose, so a deactivated `Corpo` may coexist with a `Corpo`
   * the admin created afterwards. A lookup by name then has two rows to choose
   * from — and choosing the last one hung the four seeded activities under the
   * admin's new category, as four duplicates.
   */
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
