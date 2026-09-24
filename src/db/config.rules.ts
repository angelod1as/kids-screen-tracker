import { asc, eq } from "drizzle-orm";

import type { CategoryInput, CategoryRow } from "./categories";
import type { Connection } from "./client";
import { BOOK, CAR, makeWorld, THAT_DAY, type World } from "./queue.rules";
import { activities, activityLogs, categories, ledger } from "./schema";
import { startTimer } from "./timers";

/**
 * The rules of #26, on `queue.rules.ts`'s world, run by `config.test.ts` and
 * the sabotage matrix. Mostly refusals: a validation that stopped validating
 * shows up weeks later as a wrong number, so each is broken on purpose.
 */

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

/** A one-hour step and a return bonus. */
export const MENTE = "Mente";

/** No rate, no decay (D5, D11). */
export const CONVIVIO = "Convívio";

export type ConfigWorld = World & {
  categoryId: (name: string) => number;
  /** For D37's `startTimer` line. */
  startSession: (activityName: string) => void;
  categoryText: (name: string) => string;
  /** Switched-off ones included. */
  listText: (module: ConfigModule) => string;
  balance: () => number;
  /** One log's frozen value and the ledger row beside it. */
  frozenText: (logId: number) => string;
  /** With its ledger row: without one, the balance is zero either way (D15). */
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
  rule: string;
  name: string;
  run: (module: ConfigModule, world: ConfigWorld) => unknown;
  expected: unknown;
};

function refused(body: () => void): string {
  try {
    body();
  } catch (thrown) {
    return `refused: ${(thrown as Error).message}`;
  }

  return "not refused";
}

/** Without pinning its wording. */
function wasRefused(body: () => void): boolean {
  return refused(body).startsWith("refused:");
}

/** One field changed at a time. */
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
    // The sentence: the unique index refuses the collision on its own.
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
    // The edit path's own case: the index alone still refuses the rename.
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
    // Only live rows clash (D14); the next case keeps the invariant.
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

  {
    rule: "a category's numbers are held while something is under way",
    name: "an open stopwatch session refuses a decay change",
    // D37: the line is `startTimer`, not `stopTimer`.
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
    // Labels and `base_rate` (D11) price nothing.
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
    // Switched-on first, then `sort_order`, then `id`: Mente moves to the end.
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
    // NaN, not Infinity: the column's ceiling refuses Infinity unaided, and
    // SQLite stores NaN as null, which would save a category with no decay.
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
    // The sentence: `typeof(col) = 'integer'` refuses 1,5 on its own.
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
    // The sentence: the column CHECK refuses -0,5 on its own.
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
    // The ceiling's sentence: the column CHECK refuses it too.
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
    // Forged POST only, but `Math.round("" * 100)` is 0: no bonus, silently.
    expected: "refused: a return bonus is a number, received string ()",
  },
  {
    rule: "a return bonus with no threshold is refused",
    name: "a bonus is held to a hundredth of a percentage point, not to a whole one",
    // Two decimals of a percent: at an hour's precision 0,4% became no bonus.
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

  {
    rule: "every number the engine reads is checked here",
    // Sentences, not only refusals: every rule here is also a column CHECK.
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
    // Forged POST only, but `""` would silently become a rate of zero.
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
    // NaN clears every comparison and SQLite stores it as NULL.
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
    // An inner join drops the new row; `count(*)` over a left join answers 1.
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
    // `sort_order` 0 ties with Corpo; `id` puts the new row last.
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
