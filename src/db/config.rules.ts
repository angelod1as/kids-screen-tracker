import { asc, eq } from "drizzle-orm";

import type { CategoryInput, CategoryRow } from "./categories";
import type { Connection } from "./client";
import { BOOK, CAR, makeWorld, THAT_DAY, type World } from "./queue.rules";
import { activities, activityLogs, categories, ledger } from "./schema";
import { startTimer } from "./timers";

/**
 * The rules of #26, written out one case at a time.
 *
 * Same shape and same reason as `queue.rules.ts` and `admin.rules.ts`, and
 * built on the first one's `World` for the same reason `admin.rules.ts` is: the
 * decisive case in this file is that editing a category leaves a credited entry
 * exactly where it was frozen (D15), and that case needs a credited entry, a
 * ledger row and a balance — which is what that fixture already is. A matrix
 * whose world differs from the neighbouring matrix's world is a matrix about a
 * different program.
 *
 * Two files run this table. `config.test.ts` asserts the real modules answer
 * every case, and `config.sabotage.test.ts` rewrites one clause of
 * `src/db/categories.ts`, `src/db/input.ts` or `src/engine/limits.ts` at a time
 * and asserts each mutant gets at least one case wrong.
 *
 * **The rules here are mostly refusals**, which is what makes the matrix worth
 * the machinery. A validation that has quietly stopped validating leaves a
 * program that works perfectly: the category saves, the screen redraws, the
 * list is right. What changes is a number in the engine, three weeks later, on
 * a boy's screen. There is no assertion anybody writes by habit that notices
 * that, so each rule is broken on purpose here and watched.
 */

/** The part of the configuration a case may call. */
export type ConfigModule = {
  listCategories: (connection: Connection) => CategoryRow[];
  createCategory: (connection: Connection, input: CategoryInput) => number;
  updateCategory: (
    connection: Connection,
    categoryId: number,
    input: CategoryInput,
  ) => void;
  setCategoryActive: (
    connection: Connection,
    categoryId: number,
    active: boolean,
  ) => void;
};

/** Mente, which decays at a one-hour step and pays a return bonus. */
export const MENTE = "Mente";

/** Convívio, which declares no rate and never decays (D5, D11). */
export const CONVIVIO = "Convívio";

export type ConfigWorld = World & {
  categoryId: (name: string) => number;
  /** Opens a stopwatch session, for the cases about D37's earlier line. */
  startSession: (activityName: string) => void;
  categoryText: (name: string) => string;
  /** Every category as one comparable line, switched-off ones included. */
  listText: (module: ConfigModule) => string;
  balance: () => number;
  /** One log's frozen value and the ledger row beside it. */
  frozenText: (logId: number) => string;
  /**
   * An approved entry **with its ledger row**, which is what D15 freezes.
   *
   * `addApproved`, inherited from `queue.rules.ts`, writes the log alone: that
   * table's cases are about what an approval does, so the ledger row is the
   * thing under test there rather than part of the fixture. Here the ledger row
   * *is* the fixture — "nada já creditado" is a statement about a balance, and
   * a balance with no ledger row behind it is zero before and after any edit,
   * which is a case that passes for the wrong reason.
   */
  credit: (activity: string, hours: number) => number;
};

export function makeConfigWorld(connection: Connection): ConfigWorld {
  const world = makeWorld(connection);

  const categoryId = (name: string) => {
    const row = connection.db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, name))
      .get();

    if (row === undefined) throw new Error(`no category named ${name}`);

    return row.id;
  };

  return {
    ...world,
    categoryId,
    startSession: (activityName) => {
      startTimer(
        connection,
        world.kidId,
        world.activityId(activityName),
        new Date("2026-09-13T12:00:00.000Z"),
      );
    },
    credit: (activity, hours) => {
      const logId = world.addApproved({ activity, hours });

      connection.db
        .insert(ledger)
        .values({
          userId: world.kidId,
          kind: "earn",
          hours,
          occurredOn: THAT_DAY,
          activityLogId: logId,
          createdBy: world.adminId,
        })
        .run();

      return logId;
    },
    categoryText: (name) => {
      const row = connection.db
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
        .where(eq(categories.name, name))
        .get();

      if (row === undefined) return `no category named ${name}`;

      return `${row.name} · taxa ${row.baseRate} · passo ${row.decayStepHours} · bônus ${row.returnBonusPct}/${row.returnBonusAfterDays} · ordem ${row.sortOrder} · ${row.active ? "on" : "off"}`;
    },
    listText: (module) =>
      module
        .listCategories(connection)
        .map(
          (row) =>
            `${row.name}(${row.active ? "on" : "off"}, ${row.activityCount})`,
        )
        .join(" | "),
    balance: () =>
      Math.round(
        connection.db
          .select({ kind: ledger.kind, hours: ledger.hours })
          .from(ledger)
          .where(eq(ledger.userId, world.kidId))
          .all()
          .reduce(
            (sum, row) => sum + (row.kind === "spend" ? -row.hours : row.hours),
            0,
          ) * 100,
      ) / 100,
    frozenText: (logId) => {
      const log = connection.db
        .select({
          computedHours: activityLogs.computedHours,
          status: activityLogs.status,
          activityName: activities.name,
          categoryName: categories.name,
        })
        .from(activityLogs)
        .innerJoin(activities, eq(activityLogs.activityId, activities.id))
        .innerJoin(categories, eq(activities.categoryId, categories.id))
        .where(eq(activityLogs.id, logId))
        .get();

      if (log === undefined) throw new Error(`no log ${logId}`);

      const rows = connection.db
        .select({ hours: ledger.hours, kind: ledger.kind })
        .from(ledger)
        .where(eq(ledger.activityLogId, logId))
        .orderBy(asc(ledger.id))
        .all();

      return `${log.status} ${log.computedHours} h · ${log.activityName} / ${log.categoryName} · ledger ${rows.map((row) => `${row.kind} ${row.hours}`).join(",") || "none"}`;
    },
  };
}

export type ConfigCase = {
  /** Which acceptance criterion of #26 this case belongs to. */
  rule: string;
  name: string;
  run: (module: ConfigModule, world: ConfigWorld) => unknown;
  expected: unknown;
};

/** Runs `body` and names the refusal instead of letting it escape. */
function refused(body: () => void): string {
  try {
    body();
  } catch (thrown) {
    return `refused: ${(thrown as Error).message}`;
  }

  return "not refused";
}

/** Whether a refusal happened at all, without pinning its wording. */
function wasRefused(body: () => void): boolean {
  return refused(body).startsWith("refused:");
}

/** A category as the form hands it over, with one field changed at a time. */
function input(overrides: Partial<CategoryInput> = {}): CategoryInput {
  return {
    name: "Oficina",
    baseRate: 2,
    decayStepHours: 1,
    returnBonusPct: 0,
    returnBonusAfterDays: 0,
    sortOrder: 8,
    ...overrides,
  };
}

export const CONFIG_CASES: readonly ConfigCase[] = [
  // --- criar, editar, desativar --------------------------------------------
  {
    rule: "a category can be created, edited and switched off",
    name: "a new category is stored with every field the form sent",
    run: (module, world) => {
      module.createCategory(world.connection, input());

      return world.categoryText("Oficina");
    },
    expected: "Oficina · taxa 2 · passo 1 · bônus 0/0 · ordem 8 · on",
  },
  {
    rule: "a category can be created, edited and switched off",
    name: "it is born switched on, whatever the form says",
    run: (module, world) => {
      module.createCategory(world.connection, input());

      return module
        .listCategories(world.connection)
        .find((row) => row.name === "Oficina")?.active;
    },
    expected: true,
  },
  {
    rule: "a category can be created, edited and switched off",
    name: "editing writes every field, not only the one that changed",
    run: (module, world) => {
      module.updateCategory(
        world.connection,
        world.categoryId(MENTE),
        input({
          name: "Mente",
          baseRate: 3,
          decayStepHours: 2,
          returnBonusPct: 0.25,
          returnBonusAfterDays: 5,
          sortOrder: 1,
        }),
      );

      return world.categoryText("Mente");
    },
    expected: "Mente · taxa 3 · passo 2 · bônus 0.25/5 · ordem 1 · on",
  },
  {
    rule: "a category can be created, edited and switched off",
    name: "a name is trimmed before it is stored",
    run: (module, world) => {
      module.createCategory(world.connection, input({ name: "  Oficina  " }));

      return world.categoryText("Oficina");
    },
    expected: "Oficina · taxa 2 · passo 1 · bônus 0/0 · ordem 8 · on",
  },
  {
    rule: "a category can be created, edited and switched off",
    name: "a category with no name is refused",
    run: (module, world) =>
      refused(() =>
        module.createCategory(world.connection, input({ name: "   " })),
      ),
    expected: "refused: a category needs a name: it is what the pickers show",
  },
  {
    rule: "a category can be created, edited and switched off",
    name: "editing a category that does not exist is refused",
    run: (module, world) =>
      refused(() => module.updateCategory(world.connection, 9999, input())),
    expected: "refused: there is no category 9999",
  },
  {
    rule: "a category can be created, edited and switched off",
    name: "switching a category that does not exist is refused",
    run: (module, world) =>
      refused(() => module.setCategoryActive(world.connection, 9999, false)),
    expected: "refused: there is no category 9999",
  },
  {
    rule: "a category can be created, edited and switched off",
    name: "two live categories may not share a name, and are told which",
    // The sentence and not merely the refusal: `categories_name_unique` makes
    // the collision impossible on its own, so a case that only asked "was it
    // refused" could not tell the friendly message from the constraint name —
    // and the sabotage matrix proved exactly that by surviving the removal of
    // `requireNameIsFree`. What this rule adds to the index is the sentence.
    run: (module, world) =>
      refused(() =>
        module.createCategory(world.connection, input({ name: "Mente" })),
      ),
    expected:
      "refused: there is already a category called Mente; switch that one off first, or pick another name",
  },
  {
    rule: "a category can be created, edited and switched off",
    name: "a category may keep its own name while being edited",
    run: (module, world) => {
      module.updateCategory(
        world.connection,
        world.categoryId(MENTE),
        input({ name: "Mente", baseRate: 4 }),
      );

      return world.categoryText("Mente");
    },
    expected: "Mente · taxa 4 · passo 1 · bônus 0/0 · ordem 8 · on",
  },
  {
    rule: "a category can be created, edited and switched off",
    name: "a switched-off name is free again (D14)",
    run: (module, world) => {
      module.setCategoryActive(
        world.connection,
        world.categoryId(MENTE),
        false,
      );
      module.createCategory(world.connection, input({ name: "Mente" }));

      return module
        .listCategories(world.connection)
        .filter((row) => row.name === "Mente")
        .map((row) => (row.active ? "on" : "off"))
        .sort()
        .join(",");
    },
    expected: "off,on",
  },
  {
    rule: "a category can be created, edited and switched off",
    name: "renaming a live category onto a taken name is refused, in words",
    // The edit path's own case. The create path has one above it, and the two
    // are not the same code — measured: dropping the check from the edit alone
    // left every other case green, because the unique index still refuses the
    // rename, with a constraint name instead of a sentence.
    run: (module, world) =>
      refused(() =>
        module.updateCategory(
          world.connection,
          world.categoryId("Criativo"),
          input({ name: "Mente" }),
        ),
      ),
    expected:
      "refused: there is already a category called Mente; switch that one off first, or pick another name",
  },
  {
    rule: "a category can be created, edited and switched off",
    name: "a switched-off category can still be corrected under a taken name",
    // The name rule is the partial index's: it is about the live rows (D14).
    // Enforcing it on a switched-off row too locked an adult out of his own
    // data — switch "Mente" off, create a new one, and the old row could not be
    // edited at all, not even to fix its sort order. The invariant is kept at
    // the moment it matters, by the case below this one.
    run: (module, world) => {
      const id = world.categoryId(MENTE);
      module.setCategoryActive(world.connection, id, false);
      module.createCategory(world.connection, input({ name: "Mente" }));

      module.updateCategory(
        world.connection,
        id,
        input({ name: "Mente", sortOrder: 99, decayStepHours: 1, baseRate: 2 }),
      );

      return module
        .listCategories(world.connection)
        .filter((row) => row.name === "Mente")
        .map((row) => `${row.active ? "on" : "off"}:${row.sortOrder}`)
        .sort()
        .join(",");
    },
    expected: "off:99,on:8",
  },
  {
    rule: "a category can be created, edited and switched off",
    name: "switching one back on cannot collide with a live namesake",
    run: (module, world) => {
      module.setCategoryActive(
        world.connection,
        world.categoryId(MENTE),
        false,
      );
      module.createCategory(world.connection, input({ name: "Mente" }));

      return refused(() =>
        module.setCategoryActive(
          world.connection,
          world.categoryId(MENTE),
          true,
        ),
      );
    },
    expected:
      "refused: there is already a category called Mente; switch that one off first, or pick another name",
  },

  // --- D37: a categoria também é segurada enquanto algo está em curso -------
  {
    rule: "a category's numbers are held while something is under way",
    name: "an open stopwatch session refuses a decay change",
    // The line is `startTimer`, not `stopTimer`. Left at the filing, a category
    // edit made with the clock running repriced the session that was already
    // being run — 120 min of Ler livro went from 4,50 h to 120,00 h with three
    // fields on one screen.
    run: (module, world) => {
      world.startSession(BOOK);

      return refused(() =>
        module.updateCategory(
          world.connection,
          world.categoryId(MENTE),
          input({ name: MENTE, decayStepHours: 8 }),
        ),
      ).includes("cronômetro aberto");
    },
    expected: true,
  },
  {
    rule: "a category's numbers are held while something is under way",
    name: "a filed entry says so, and names the entry",
    run: (module, world) => {
      const logId = world.addPending({ activity: BOOK });

      return refused(() =>
        module.updateCategory(
          world.connection,
          world.categoryId(MENTE),
          input({ name: MENTE, returnBonusPct: 5, returnBonusAfterDays: 3 }),
        ),
      ).includes(`a entrada ${logId} (${BOOK},`);
    },
    expected: true,
  },
  {
    rule: "a category's numbers are held while something is under way",
    name: "a rename and a sort order go through anyway",
    // The bound: `name`, `sort_order` and `base_rate` cannot change a price —
    // D11 keeps the last one out of every calculation — so the screen does not
    // freeze because a boy touched the stopwatch.
    run: (module, world) => {
      world.startSession(BOOK);

      module.updateCategory(
        world.connection,
        world.categoryId(MENTE),
        input({
          name: "Mente renomeada",
          baseRate: 9,
          decayStepHours: 1,
          returnBonusPct: 0.5,
          returnBonusAfterDays: 3,
          sortOrder: 4,
        }),
      );

      return world.categoryText("Mente renomeada");
    },
    expected: "Mente renomeada · taxa 9 · passo 1 · bônus 0.5/3 · ordem 4 · on",
  },

  // --- D14: desativar não apaga, e o histórico continua legível -------------
  {
    rule: "switching a category off deletes nothing",
    name: "the row is still there, switched off",
    run: (module, world) => {
      module.setCategoryActive(
        world.connection,
        world.categoryId(MENTE),
        false,
      );

      return world.categoryText("Mente");
    },
    expected: "Mente · taxa 1.5 · passo 1 · bônus 0.5/3 · ordem 2 · off",
  },
  {
    rule: "switching a category off deletes nothing",
    name: "a switched-off category stays in the list, with its activities",
    run: (module, world) => {
      module.setCategoryActive(
        world.connection,
        world.categoryId(MENTE),
        false,
      );

      return module
        .listCategories(world.connection)
        .map((row) => `${row.name}(${row.active ? "on" : "off"})`)
        .join(" | ");
    },
    // Switched-on first, then `sort_order` then `id` — Mente moves to the end.
    expected:
      "Corpo(on) | Criativo(on) | Convívio(on) | Escola(on) | Casa(on) | Curinga(on) | Mente(off)",
  },
  {
    rule: "switching a category off deletes nothing",
    name: "an entry written against it still reads its activity and category",
    run: (module, world) => {
      const logId = world.credit(BOOK, 3);
      module.setCategoryActive(
        world.connection,
        world.categoryId(MENTE),
        false,
      );

      return world.frozenText(logId);
    },
    expected: "approved 3 h · Ler livro / Mente · ledger earn 3",
  },
  {
    rule: "switching a category off deletes nothing",
    name: "it can be switched back on",
    run: (module, world) => {
      const id = world.categoryId(MENTE);
      module.setCategoryActive(world.connection, id, false);
      module.setCategoryActive(world.connection, id, true);

      return world.categoryText("Mente");
    },
    expected: "Mente · taxa 1.5 · passo 1 · bônus 0.5/3 · ordem 2 · on",
  },
  {
    rule: "switching a category off deletes nothing",
    name: "the list says how many activities go off with it",
    run: (module, world) => {
      module.setCategoryActive(
        world.connection,
        world.categoryId(MENTE),
        false,
      );

      return module
        .listCategories(world.connection)
        .find((row) => row.name === "Mente")?.activityCount;
    },
    expected: 4,
  },

  // --- D15: editar não recalcula nada já creditado --------------------------
  {
    rule: "editing recalculates nothing already credited",
    name: "the frozen value of an entry does not move when the rate doubles",
    run: (module, world) => {
      const logId = world.credit(BOOK, 3);

      module.updateCategory(
        world.connection,
        world.categoryId(MENTE),
        input({ name: "Mente", baseRate: 4, decayStepHours: 4 }),
      );

      return world.frozenText(logId);
    },
    expected: "approved 3 h · Ler livro / Mente · ledger earn 3",
  },
  {
    rule: "editing recalculates nothing already credited",
    name: "the balance does not move when the category is edited",
    run: (module, world) => {
      world.credit(BOOK, 3);
      const before = world.balance();

      module.updateCategory(
        world.connection,
        world.categoryId(MENTE),
        input({ name: "Mente", baseRate: 0, decayStepHours: 0.25 }),
      );

      return `${before} then ${world.balance()}`;
    },
    expected: "3 then 3",
  },
  {
    rule: "editing recalculates nothing already credited",
    name: "the balance does not move when the category is switched off",
    run: (module, world) => {
      world.credit(BOOK, 3);
      const before = world.balance();

      module.setCategoryActive(
        world.connection,
        world.categoryId(MENTE),
        false,
      );

      return `${before} then ${world.balance()}`;
    },
    expected: "3 then 3",
  },
  {
    rule: "editing recalculates nothing already credited",
    name: "no ledger row is added or removed by any of it",
    run: (module, world) => {
      world.credit(BOOK, 3);
      const id = world.categoryId(MENTE);

      module.updateCategory(
        world.connection,
        id,
        input({ name: "Mente", baseRate: 9, decayStepHours: 3 }),
      );
      module.setCategoryActive(world.connection, id, false);
      module.setCategoryActive(world.connection, id, true);

      return world.ledgerRows().length;
    },
    expected: 1,
  },

  // --- o piso do passo (comentário da #26, medido no PR #46) ----------------
  {
    rule: "a decay step below the floor is refused",
    name: "the 0,1 h that inverts the engine is refused",
    run: (module, world) =>
      wasRefused(() =>
        module.createCategory(world.connection, input({ decayStepHours: 0.1 })),
      ),
    expected: true,
  },
  {
    rule: "a decay step below the floor is refused",
    name: "the refusal says the floor and what to do instead",
    run: (module, world) =>
      refused(() =>
        module.createCategory(world.connection, input({ decayStepHours: 0.1 })),
      ).includes("0.25"),
    expected: true,
  },
  {
    rule: "a decay step below the floor is refused",
    name: "a hair under the floor is still under it",
    run: (module, world) =>
      wasRefused(() =>
        module.createCategory(
          world.connection,
          input({ decayStepHours: 0.24 }),
        ),
      ),
    expected: true,
  },
  {
    rule: "a decay step below the floor is refused",
    name: "the floor itself is accepted",
    run: (module, world) => {
      module.createCategory(world.connection, input({ decayStepHours: 0.25 }));

      return world.categoryText("Oficina");
    },
    expected: "Oficina · taxa 2 · passo 0.25 · bônus 0/0 · ordem 8 · on",
  },
  {
    rule: "a decay step below the floor is refused",
    name: "an empty step is a category with no decay, not a step of zero (D2)",
    run: (module, world) => {
      module.createCategory(world.connection, input({ decayStepHours: null }));

      return world.categoryText("Oficina");
    },
    expected: "Oficina · taxa 2 · passo null · bônus 0/0 · ordem 8 · on",
  },
  {
    rule: "a decay step below the floor is refused",
    name: "a step of zero is refused rather than read as no decay",
    run: (module, world) =>
      wasRefused(() =>
        module.createCategory(world.connection, input({ decayStepHours: 0 })),
      ),
    expected: true,
  },
  {
    rule: "a decay step below the floor is refused",
    name: "a negative step is refused",
    run: (module, world) =>
      wasRefused(() =>
        module.createCategory(world.connection, input({ decayStepHours: -1 })),
      ),
    expected: true,
  },
  {
    rule: "a decay step below the floor is refused",
    name: "a step that is not a number at all is refused, in words",
    // The sentence, and NaN rather than Infinity: the column's own ceiling
    // refuses Infinity without help, so a case using it passed with
    // `requireNonNegativeHours` deleted from the call site — measured. NaN
    // clears every comparison and SQLite stores it as null, so without the
    // guard the category would save with no decay at all and no error.
    run: (module, world) =>
      refused(() =>
        module.createCategory(
          world.connection,
          input({ decayStepHours: Number.NaN }),
        ),
      ),
    expected:
      "refused: a decay step is a number of hours between 0 and 1000000, received NaN",
  },
  {
    rule: "a decay step below the floor is refused",
    name: "the floor holds on an edit too, not only on a create",
    run: (module, world) =>
      wasRefused(() =>
        module.updateCategory(
          world.connection,
          world.categoryId(MENTE),
          input({ name: "Mente", decayStepHours: 0.1 }),
        ),
      ),
    expected: true,
  },
  {
    rule: "a decay step below the floor is refused",
    name: "the category is untouched after a refused edit",
    run: (module, world) => {
      refused(() =>
        module.updateCategory(
          world.connection,
          world.categoryId(MENTE),
          input({ name: "Mente", decayStepHours: 0.1 }),
        ),
      );

      return world.categoryText("Mente");
    },
    expected: "Mente · taxa 1.5 · passo 1 · bônus 0.5/3 · ordem 2 · on",
  },

  // --- o bônus de retorno que vira permanente (comentário da #26) -----------
  {
    rule: "a return bonus with no threshold is refused",
    name: "a bonus above zero at zero days is refused",
    run: (module, world) =>
      wasRefused(() =>
        module.createCategory(
          world.connection,
          input({ returnBonusPct: 0.5, returnBonusAfterDays: 0 }),
        ),
      ),
    expected: true,
  },
  {
    rule: "a return bonus with no threshold is refused",
    name: "the refusal says why the window of one day is not an absence",
    run: (module, world) =>
      refused(() =>
        module.createCategory(
          world.connection,
          input({ returnBonusPct: 0.5, returnBonusAfterDays: 0 }),
        ),
      ).includes("permanent"),
    expected: true,
  },
  {
    rule: "a return bonus with no threshold is refused",
    name: "one day is enough",
    run: (module, world) => {
      module.createCategory(
        world.connection,
        input({ returnBonusPct: 0.5, returnBonusAfterDays: 1 }),
      );

      return world.categoryText("Oficina");
    },
    expected: "Oficina · taxa 2 · passo 1 · bônus 0.5/1 · ordem 8 · on",
  },
  {
    rule: "a return bonus with no threshold is refused",
    name: "no bonus at zero days is the pair the seed writes, and is accepted",
    run: (module, world) => {
      module.createCategory(
        world.connection,
        input({ returnBonusPct: 0, returnBonusAfterDays: 0 }),
      );

      return world.categoryText("Oficina");
    },
    expected: "Oficina · taxa 2 · passo 1 · bônus 0/0 · ordem 8 · on",
  },
  {
    rule: "a return bonus with no threshold is refused",
    name: "a bonus of zero may keep any threshold at all",
    run: (module, world) => {
      module.createCategory(
        world.connection,
        input({ returnBonusPct: 0, returnBonusAfterDays: 7 }),
      );

      return world.categoryText("Oficina");
    },
    expected: "Oficina · taxa 2 · passo 1 · bônus 0/7 · ordem 8 · on",
  },
  {
    rule: "a return bonus with no threshold is refused",
    name: "the pair holds on an edit too",
    run: (module, world) =>
      wasRefused(() =>
        module.updateCategory(
          world.connection,
          world.categoryId(CONVIVIO),
          input({
            name: "Convívio",
            returnBonusPct: 0.5,
            returnBonusAfterDays: 0,
          }),
        ),
      ),
    expected: true,
  },
  {
    rule: "a return bonus with no threshold is refused",
    name: "a fractional threshold is refused rather than rounded, in words",
    // The sentence, because `typeof(col) = 'integer'` refuses 1,5 on its own.
    run: (module, world) =>
      refused(() =>
        module.createCategory(
          world.connection,
          input({ returnBonusPct: 0.5, returnBonusAfterDays: 1.5 }),
        ),
      ),
    expected:
      "refused: a return bonus threshold is a whole number between 0 and 1000000, received 1.5",
  },
  {
    rule: "a return bonus with no threshold is refused",
    name: "a negative bonus is refused, in words",
    // The sentence, because `categories_return_bonus_pct_check` refuses -0,5 on
    // its own: measured, dropping `requireBonusFraction` from the call site left
    // every case in this table green.
    run: (module, world) =>
      refused(() =>
        module.createCategory(
          world.connection,
          input({ returnBonusPct: -0.5, returnBonusAfterDays: 3 }),
        ),
      ),
    expected:
      "refused: a return bonus is a fraction between 0 and 1000000, received -0.5",
  },
  {
    rule: "a return bonus with no threshold is refused",
    name: "a bonus above the column ceiling is refused, in words",
    // The twin of the base rate's case, and it was missing: measured, the
    // ceiling clause of `requireBonusFraction` could be deleted whole and all
    // 1344 tests stayed green, because `categories_return_bonus_pct_check`
    // refuses it too — with a constraint name where an adult needed a sentence.
    run: (module, world) =>
      refused(() =>
        module.createCategory(
          world.connection,
          input({ returnBonusPct: 2e6, returnBonusAfterDays: 3 }),
        ),
      ),
    expected:
      "refused: a return bonus is a fraction between 0 and 1000000, received 2000000",
  },
  {
    rule: "a return bonus with no threshold is refused",
    name: "a bonus that is not a number at all is refused",
    run: (module, world) =>
      refused(() =>
        module.createCategory(
          world.connection,
          input({ returnBonusPct: "" as unknown as number }),
        ),
      ),
    // Reachable only through a forged admin POST — the screen sends `null` for
    // an empty field — but `Math.round("" * 100)` is 0, so without this the
    // bonus an adult set would quietly become no bonus at all.
    expected: "refused: a return bonus is a number, received string ()",
  },
  {
    rule: "a return bonus with no threshold is refused",
    name: "a bonus is held to a hundredth of a percentage point, not to a whole one",
    // 12,5% is a fraction of 0,125. Held to the two decimals an *hour* is held
    // to — which is what this used to borrow — it became 0,13, and a bonus of
    // 0,4% became no bonus at all, silently. The field offers two decimals of a
    // percent; the column now keeps them.
    run: (module, world) => {
      module.createCategory(
        world.connection,
        input({ returnBonusPct: 0.125, returnBonusAfterDays: 3 }),
      );

      return world.categoryText("Oficina");
    },
    expected: "Oficina · taxa 2 · passo 1 · bônus 0.125/3 · ordem 8 · on",
  },
  {
    rule: "a return bonus with no threshold is refused",
    name: "a bonus of a tenth of a percent survives instead of vanishing",
    run: (module, world) => {
      module.createCategory(
        world.connection,
        input({ returnBonusPct: 0.001, returnBonusAfterDays: 3 }),
      );

      return world.categoryText("Oficina");
    },
    expected: "Oficina · taxa 2 · passo 1 · bônus 0.001/3 · ordem 8 · on",
  },

  // --- os outros números que o motor consome -------------------------------
  {
    rule: "every number the engine reads is checked here",
    // These three assert the sentence rather than only the refusal, and the
    // reason is `input.ts`'s own: every rule there is also a CHECK on the
    // column, and the CHECK is the backstop. A case that asked "was it
    // refused" would pass with the friendly guard deleted — measured, the
    // sabotage matrix survived all three — because the constraint refuses it
    // too, with a sentence naming neither the field nor an acceptable value,
    // on a screen where an adult is trying to work out what to type.
    name: "a negative base rate is refused, in words",
    run: (module, world) =>
      refused(() =>
        module.createCategory(world.connection, input({ baseRate: -2 })),
      ),
    expected:
      "refused: a base rate is a number of hours between 0 and 1000000, received -2",
  },
  {
    rule: "every number the engine reads is checked here",
    name: "an infinite base rate is refused, in words",
    run: (module, world) =>
      refused(() =>
        module.createCategory(
          world.connection,
          input({ baseRate: Number.POSITIVE_INFINITY }),
        ),
      ),
    expected:
      "refused: a base rate is a number of hours between 0 and 1000000, received Infinity",
  },
  {
    rule: "every number the engine reads is checked here",
    name: "a base rate that is not a number is refused, not coerced",
    // `Math.round("" * 100)` is 0, so without the type guard an empty string in
    // a forged admin POST becomes a rate of zero. Reachable only that way — the
    // screen sends `null` for an empty field — but a `duration` activity that
    // silently starts paying nothing is worth a sentence.
    run: (module, world) =>
      refused(() =>
        module.createCategory(
          world.connection,
          input({ baseRate: "" as unknown as number }),
        ),
      ),
    expected: "refused: a base rate is a number, received string ()",
  },
  {
    rule: "every number the engine reads is checked here",
    name: "a base rate that is not a number at all is refused",
    // The case `Number.isFinite` is actually for. Infinity above is caught by
    // the ceiling either way; NaN clears every comparison — `NaN < 0` and
    // `NaN > MAX_HOURS` are both false — and SQLite stores it as NULL, so
    // without this the category would save with no rate at all and no error.
    run: (module, world) =>
      refused(() =>
        module.createCategory(
          world.connection,
          input({ baseRate: Number.NaN }),
        ),
      ),
    expected:
      "refused: a base rate is a number of hours between 0 and 1000000, received NaN",
  },
  {
    rule: "every number the engine reads is checked here",
    name: "a base rate above the column ceiling is refused, in words",
    run: (module, world) =>
      refused(() =>
        module.createCategory(world.connection, input({ baseRate: 2e6 })),
      ),
    expected:
      "refused: a base rate is a number of hours between 0 and 1000000, received 2000000",
  },
  {
    rule: "every number the engine reads is checked here",
    name: "an empty base rate is D11's category that declares none",
    run: (module, world) => {
      module.createCategory(world.connection, input({ baseRate: null }));

      return world.categoryText("Oficina");
    },
    expected: "Oficina · taxa null · passo 1 · bônus 0/0 · ordem 8 · on",
  },
  {
    rule: "every number the engine reads is checked here",
    name: "a rate is held to the two decimals an hour is held to",
    run: (module, world) => {
      module.createCategory(world.connection, input({ baseRate: 2.005 }));

      return world.categoryText("Oficina");
    },
    expected: "Oficina · taxa 2.01 · passo 1 · bônus 0/0 · ordem 8 · on",
  },
  {
    rule: "every number the engine reads is checked here",
    name: "a fractional sort order is refused",
    run: (module, world) =>
      wasRefused(() =>
        module.createCategory(world.connection, input({ sortOrder: 1.5 })),
      ),
    expected: true,
  },
  {
    rule: "every number the engine reads is checked here",
    name: "a negative sort order is refused",
    run: (module, world) =>
      wasRefused(() =>
        module.createCategory(world.connection, input({ sortOrder: -1 })),
      ),
    expected: true,
  },
  {
    rule: "every number the engine reads is checked here",
    name: "a name longer than the field allows is refused",
    run: (module, world) =>
      wasRefused(() =>
        module.createCategory(
          world.connection,
          input({ name: "x".repeat(501) }),
        ),
      ),
    expected: true,
  },
  {
    rule: "every number the engine reads is checked here",
    name: "a refused create writes nothing at all",
    run: (module, world) => {
      refused(() =>
        module.createCategory(world.connection, input({ decayStepHours: 0.1 })),
      );

      return module.listCategories(world.connection).length;
    },
    expected: 7,
  },

  // --- a lista que a tela desenha ------------------------------------------
  {
    rule: "the list is the one the screen draws",
    name: "switched-on first, then sort order, then id",
    run: (module, world) => world.listText(module),
    expected:
      "Corpo(on, 4) | Mente(on, 4) | Criativo(on, 6) | Convívio(on, 8) | Escola(on, 3) | Casa(on, 6) | Curinga(on, 1)",
  },
  {
    rule: "the list is the one the screen draws",
    name: "a category with no activities is in the list, counted as zero",
    run: (module, world) => {
      module.createCategory(world.connection, input());

      return world.listText(module);
    },
    // Two things at once, and both have been got wrong by the obvious query: an
    // inner join drops the new row entirely, and `count(*)` over a left join
    // counts the row with the null on the right and answers 1.
    expected:
      "Corpo(on, 4) | Mente(on, 4) | Criativo(on, 6) | Convívio(on, 8) | " +
      "Escola(on, 3) | Casa(on, 6) | Curinga(on, 1) | Oficina(on, 0)",
  },
  {
    rule: "the list is the one the screen draws",
    name: "a new category takes its place by sort order",
    run: (module, world) => {
      module.createCategory(world.connection, input({ sortOrder: 0 }));

      return module
        .listCategories(world.connection)
        .map((row) => row.name)
        .join(",");
    },
    // `sort_order` 0 ties with Corpo, and `id` breaks the tie: the new row is
    // last among the zeroes.
    expected: "Oficina,Corpo,Mente,Criativo,Convívio,Escola,Casa,Curinga",
  },
];

/** The cases the given implementation gets wrong. */
export function failingConfigCases(
  module: ConfigModule,
  worlds: () => ConfigWorld,
): ConfigCase[] {
  return CONFIG_CASES.filter((configCase) => {
    const world = worlds();

    try {
      return configCase.run(module, world) !== configCase.expected;
    } catch (thrown) {
      return `threw: ${(thrown as Error).message}` !== configCase.expected;
    } finally {
      world.connection.sqlite.close();
    }
  });
}

export { BOOK, CAR, THAT_DAY };
