import { desc, eq } from "drizzle-orm";

import type { ActivityInput, ActivityRow } from "./activities";
import type { Connection } from "./client";
import type { ConfigWorld } from "./config.rules";
import { makeConfigWorld } from "./config.rules";
import { listPendingLogs } from "./queue";
import { activities, activityLogs, categories } from "./schema";
import { pauseTimer, startTimer } from "./timers";

/**
 * The rules of #27, written out one case at a time.
 *
 * Same shape and same reason as `config.rules.ts` next door, and built on its
 * world: the categories and the activities are one screen and one set of
 * decisions, and the decisive cases here need a category that can be switched
 * off (D33) and a credited entry that must not move (D15) — both of which that
 * fixture already is.
 *
 * Two files run this table. `activities.test.ts` asserts the real module
 * answers every case, and `activities.sabotage.test.ts` rewrites one clause of
 * `src/db/activities.ts` or `src/db/input.ts` at a time and asserts each mutant
 * gets at least one case wrong.
 *
 * **Most cases assert the sentence and not merely the refusal**, and that is a
 * lesson the categories' own matrix taught at some cost: every rule in this
 * module is also a CHECK on its column, so a case asking "was it refused"
 * passes with the guard deleted. What the guard adds to the constraint is a
 * sentence naming the field and an acceptable value, on a screen where an adult
 * is trying to work out what to type — so the sentence is the rule.
 */

/** The part of the activity CRUD a case may call. */
export type ActivityModule = {
  listActivities: (connection: Connection, categoryId: number) => ActivityRow[];
  createActivity: (connection: Connection, input: ActivityInput) => number;
  updateActivity: (
    connection: Connection,
    activityId: number,
    input: ActivityInput,
  ) => void;
  setActivityActive: (
    connection: Connection,
    activityId: number,
    active: boolean,
  ) => void;
};

export type ActivityWorld = ConfigWorld & {
  /** One activity as one comparable line. */
  activityText: (name: string) => string;
  /** A category's activities as one line, switched-off ones included. */
  activityListText: (module: ActivityModule, categoryName: string) => string;
  /** Whether an activity is one an adult can still choose (D14, D33). */
  isOffered: (name: string) => boolean;
  /** The most recently written log, for the cases that file one via the timer. */
  newestLogId: () => number;
  /**
   * Refuses an entry, as the fixture rather than as the thing under test.
   *
   * A raw update for the reason `setCategoryOff` gives: `rejectLog` is another
   * module's rule with its own matrix, and a case that says "once the entry is
   * decided" should be about a row that is no longer pending, however it got
   * there.
   */
  reject: (logId: number) => void;
  /**
   * What a waiting entry would be paid right now.
   *
   * Read through the queue's own list, which is what an adult is looking at
   * when he edits — so a case that says "the price did not move" is about the
   * number on the screen and not a second opinion of it.
   */
  previewOf: (logId: number) => number | null;
  /**
   * Puts an activity into a state the CRUD now refuses to create, by writing
   * the column directly.
   *
   * D37 stops an adult reaching these states, which is the point of it — but
   * `requireEditableActivity` in `approveLog` is what catches them if D37 ever
   * has a hole, and a guard whose state nothing can build is a guard nothing
   * tests. So the fixture builds it and the case asks the approval, which is
   * the question that guard answers.
   */
  forceActivity: (name: string, patch: Record<string, unknown>) => void;
  /** Opens a stopwatch session on an activity, and optionally pauses it. */
  startSession: (name: string, options?: { paused?: boolean }) => void;
  /**
   * Switches a category, as the fixture rather than as the thing under test.
   *
   * A `update` straight at the column, deliberately: `setCategoryActive` from
   * `categories.ts` is another module's rule with its own matrix, and a fixture
   * built out of the neighbouring module makes every case here depend on it. A
   * case that says "under a switched-off category" should be about a row whose
   * `active` is 0, however it got that way.
   */
  setCategoryOff: (categoryName: string) => void;
};

export function makeActivityWorld(connection: Connection): ActivityWorld {
  const world = makeConfigWorld(connection);

  const activityIdOf = (name: string) => world.activityId(name);

  return {
    ...world,
    activityText: (name) => {
      const row = connection.db
        .select({
          name: activities.name,
          categoryName: categories.name,
          calcMode: activities.calcMode,
          value: activities.value,
          maxSessionMinutes: activities.maxSessionMinutes,
          qualityGraded: activities.qualityGraded,
          repeatCooldownDays: activities.repeatCooldownDays,
          sortOrder: activities.sortOrder,
          active: activities.active,
        })
        .from(activities)
        .innerJoin(categories, eq(activities.categoryId, categories.id))
        .where(eq(activities.name, name))
        .get();

      if (row === undefined) return `no activity named ${name}`;

      return `${row.name} em ${row.categoryName} · ${row.calcMode} ${row.value} · limite ${row.maxSessionMinutes} · nota ${row.qualityGraded} · cooldown ${row.repeatCooldownDays} · ordem ${row.sortOrder} · ${row.active ? "on" : "off"}`;
    },
    activityListText: (module, categoryName) =>
      module
        .listActivities(connection, world.categoryId(categoryName))
        .map((row) => `${row.name}(${row.active ? "on" : "off"})`)
        .join(" | "),
    isOffered: (name) => {
      // Exactly the join every picker uses (`fetchLaunchDataAction`), so "is it
      // offered" is answered by the query the screens actually run rather than
      // by a second opinion about what `active` means.
      const found = connection.db
        .select({
          active: activities.active,
          categoryActive: categories.active,
        })
        .from(activities)
        .innerJoin(categories, eq(activities.categoryId, categories.id))
        .where(eq(activities.name, name))
        .get();

      return found?.active === true && found.categoryActive;
    },
    newestLogId: () =>
      connection.db
        .select({ id: activityLogs.id })
        .from(activityLogs)
        .orderBy(desc(activityLogs.id))
        .limit(1)
        .get()?.id ?? 0,
    startSession: (name, options: { paused?: boolean } = {}) => {
      const start = new Date("2026-09-13T12:00:00.000Z");

      startTimer(connection, world.kidId, activityIdOf(name), start);

      if (options.paused === true) {
        pauseTimer(
          connection,
          world.kidId,
          new Date(start.getTime() + 30 * 60_000),
        );
      }
    },
    forceActivity: (name, patch) => {
      connection.db
        .update(activities)
        .set(patch)
        .where(eq(activities.name, name))
        .run();
    },
    previewOf: (logId) =>
      listPendingLogs(connection).find((one) => one.id === logId)?.preview
        ?.hours ?? null,
    reject: (logId) => {
      connection.db
        .update(activityLogs)
        .set({
          status: "rejected",
          reviewedBy: world.adminId,
          reviewedAt: new Date("2026-09-13T15:00:00.000Z"),
        })
        .where(eq(activityLogs.id, logId))
        .run();
    },
    setCategoryOff: (categoryName) => {
      connection.db
        .update(categories)
        .set({ active: false })
        .where(eq(categories.name, categoryName))
        .run();
    },
  };
}

export type ActivityCase = {
  /** Which acceptance criterion of #27 this case belongs to. */
  rule: string;
  name: string;
  run: (module: ActivityModule, world: ActivityWorld) => unknown;
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

/** Mente, which is where the cases put a new activity unless they say otherwise. */
const MENTE = "Mente";

/** Casa, whose activities are `delivery` and carry a seven-day cooldown. */
const CASA = "Casa";

/** An activity as the form hands it over, with one field changed at a time. */
function input(
  world: ActivityWorld,
  overrides: Partial<ActivityInput> = {},
): ActivityInput {
  return {
    categoryId: world.categoryId(MENTE),
    name: "Podcast",
    calcMode: "duration",
    value: 2,
    maxSessionMinutes: 120,
    minSessionMinutes: 5,
    qualityGraded: false,
    repeatCooldownDays: 0,
    sortOrder: 5,
    ...overrides,
  };
}

export const ACTIVITY_CASES: readonly ActivityCase[] = [
  // --- criar, editar, desativar --------------------------------------------
  {
    rule: "an activity can be created, edited and switched off",
    name: "a new activity is stored with every field the form sent",
    run: (module, world) => {
      module.createActivity(world.connection, input(world));

      return world.activityText("Podcast");
    },
    expected:
      "Podcast em Mente · duration 2 · limite 120 · nota false · cooldown 0 · ordem 5 · on",
  },
  {
    rule: "an activity can be created, edited and switched off",
    name: "it is born switched on",
    run: (module, world) => {
      module.createActivity(world.connection, input(world));

      return world.isOffered("Podcast");
    },
    expected: true,
  },
  {
    rule: "an activity can be created, edited and switched off",
    name: "editing writes every field #27 lists",
    run: (module, world) => {
      module.updateActivity(world.connection, world.activityId("Ler livro"), {
        categoryId: world.categoryId(MENTE),
        name: "Ler livro",
        calcMode: "delivery",
        value: 4,
        maxSessionMinutes: 90,
        minSessionMinutes: 5,
        qualityGraded: true,
        repeatCooldownDays: 3,
        sortOrder: 9,
      });

      return world.activityText("Ler livro");
    },
    // The limit is dropped: a `delivery` has no session for one to be about.
    expected:
      "Ler livro em Mente · delivery 4 · limite null · nota true · cooldown 3 · ordem 9 · on",
  },
  {
    rule: "an activity can be created, edited and switched off",
    name: "an activity can be moved to another live category",
    run: (module, world) => {
      module.updateActivity(world.connection, world.activityId("Ler livro"), {
        categoryId: world.categoryId("Criativo"),
        name: "Ler livro",
        calcMode: "duration",
        value: 2,
        maxSessionMinutes: 120,
        minSessionMinutes: 5,
        qualityGraded: false,
        repeatCooldownDays: 0,
        sortOrder: 1,
      });

      return world.activityText("Ler livro");
    },
    expected:
      "Ler livro em Criativo · duration 2 · limite 120 · nota false · cooldown 0 · ordem 1 · on",
  },
  {
    rule: "an activity can be created, edited and switched off",
    name: "a name is trimmed before it is stored",
    run: (module, world) => {
      module.createActivity(
        world.connection,
        input(world, { name: " Podcast " }),
      );

      return world.activityText("Podcast").startsWith("Podcast em Mente");
    },
    expected: true,
  },
  {
    rule: "an activity can be created, edited and switched off",
    name: "an activity with no name is refused, in words",
    run: (module, world) =>
      refused(() =>
        module.createActivity(world.connection, input(world, { name: "  " })),
      ),
    expected: "refused: an activity needs a name: it is what the pickers show",
  },
  {
    rule: "an activity can be created, edited and switched off",
    name: "a name longer than the field allows is refused, in words",
    run: (module, world) =>
      refused(() =>
        module.createActivity(
          world.connection,
          input(world, { name: "x".repeat(501) }),
        ),
      ),
    expected:
      "refused: an activity name is at most 500 characters, received 501",
  },
  {
    rule: "an activity can be created, edited and switched off",
    name: "editing an activity that does not exist is refused",
    run: (module, world) =>
      refused(() =>
        module.updateActivity(world.connection, 9999, input(world)),
      ),
    expected: "refused: there is no activity 9999",
  },
  {
    rule: "an activity can be created, edited and switched off",
    name: "switching an activity that does not exist is refused",
    run: (module, world) =>
      refused(() => module.setActivityActive(world.connection, 9999, false)),
    expected: "refused: there is no activity 9999",
  },
  {
    rule: "an activity can be created, edited and switched off",
    name: "a way of counting that does not exist is refused",
    run: (module, world) =>
      refused(() =>
        module.createActivity(
          world.connection,
          input(world, {
            calcMode: "guessing" as ActivityInput["calcMode"],
          }),
        ),
      ),
    expected:
      "refused: guessing is not a way of counting: it is one of duration, fixed, delivery, free",
  },

  // --- D14: desativar não apaga --------------------------------------------
  {
    rule: "switching an activity off deletes nothing",
    name: "the row is still there, switched off, with its numbers",
    run: (module, world) => {
      module.setActivityActive(
        world.connection,
        world.activityId("Ler livro"),
        false,
      );

      return world.activityText("Ler livro");
    },
    expected:
      "Ler livro em Mente · duration 1.5 · limite 120 · nota false · cooldown 0 · ordem 1 · off",
  },
  {
    rule: "switching an activity off deletes nothing",
    name: "it leaves the pickers",
    run: (module, world) => {
      module.setActivityActive(
        world.connection,
        world.activityId("Ler livro"),
        false,
      );

      return world.isOffered("Ler livro");
    },
    expected: false,
  },
  {
    rule: "switching an activity off deletes nothing",
    name: "it stays in the configuration list, so it can be found again",
    run: (module, world) => {
      module.setActivityActive(
        world.connection,
        world.activityId("Ler livro"),
        false,
      );

      return world.activityListText(module, MENTE);
    },
    expected:
      "Ler quadrinhos ou HQ(on) | Jogo de tabuleiro, xadrez ou baralho(on) | Curso ou aula extra(on) | Ler livro(off)",
  },
  {
    rule: "switching an activity off deletes nothing",
    name: "it can be switched back on",
    run: (module, world) => {
      const id = world.activityId("Ler livro");
      module.setActivityActive(world.connection, id, false);
      module.setActivityActive(world.connection, id, true);

      return world.isOffered("Ler livro");
    },
    expected: true,
  },
  {
    rule: "switching an activity off deletes nothing",
    name: "an entry written against it stays readable and frozen",
    run: (module, world) => {
      const logId = world.credit("Ler livro", 3);
      module.setActivityActive(
        world.connection,
        world.activityId("Ler livro"),
        false,
      );

      return world.frozenText(logId);
    },
    expected: "approved 3 h · Ler livro / Mente · ledger earn 3",
  },

  // --- D33: a guarda vale no endpoint --------------------------------------
  {
    rule: "an activity is only ever under a live category",
    name: "creating one under a switched-off category is refused, in words",
    run: (module, world) => {
      world.setCategoryOff(MENTE);

      return refused(() =>
        module.createActivity(world.connection, input(world)),
      );
    },
    expected:
      "refused: Mente is switched off: an activity under it would be in no picker at all (D14, D33)",
  },
  {
    rule: "an activity is only ever under a live category",
    name: "creating one under a category that does not exist is refused",
    run: (module, world) =>
      refused(() =>
        module.createActivity(
          world.connection,
          input(world, { categoryId: 9999 }),
        ),
      ),
    expected: "refused: there is no category 9999",
  },
  {
    rule: "an activity is only ever under a live category",
    name: "moving one into a switched-off category is refused",
    run: (module, world) => {
      world.setCategoryOff("Criativo");

      return refused(() =>
        module.updateActivity(
          world.connection,
          world.activityId("Ler livro"),
          input(world, {
            name: "Ler livro",
            categoryId: world.categoryId("Criativo"),
          }),
        ),
      );
    },
    expected:
      "refused: Criativo is switched off: an activity under it would be in no picker at all (D14, D33)",
  },
  {
    rule: "an activity is only ever under a live category",
    name: "switching one back on under a switched-off category is refused",
    run: (module, world) => {
      const id = world.activityId("Ler livro");
      module.setActivityActive(world.connection, id, false);
      world.setCategoryOff(MENTE);

      return refused(() =>
        module.setActivityActive(world.connection, id, true),
      );
    },
    // Otherwise the tap reports success and the activity is still in no picker,
    // which is worse than a refusal.
    expected:
      "refused: Mente is switched off: an activity under it would be in no picker at all (D14, D33)",
  },
  {
    rule: "an activity is only ever under a live category",
    name: "switching one off never needs its category to be on",
    run: (module, world) => {
      world.setCategoryOff(MENTE);
      module.setActivityActive(
        world.connection,
        world.activityId("Ler livro"),
        false,
      );

      return world.activityText("Ler livro").endsWith("off");
    },
    expected: true,
  },

  // --- D11: o value é explícito e é quem manda ------------------------------
  {
    rule: "the value is explicit, and it is what the engine reads",
    name: "an activity priced away from its category keeps its own price",
    run: (module, world) => {
      // Mente's `base_rate` is 2,0; this one is 1,5, like "Ler quadrinhos".
      module.createActivity(world.connection, input(world, { value: 1.5 }));

      return world.activityText("Podcast");
    },
    expected:
      "Podcast em Mente · duration 1.5 · limite 120 · nota false · cooldown 0 · ordem 5 · on",
  },
  {
    rule: "the value is explicit, and it is what the engine reads",
    name: "a duration activity with no value at all is refused, in words",
    run: (module, world) =>
      refused(() =>
        module.createActivity(world.connection, input(world, { value: null })),
      ),
    expected:
      "refused: a duration activity needs a value: it is what the engine reads, and it is never taken from the category (D11)",
  },
  {
    rule: "the value is explicit, and it is what the engine reads",
    name: "the category's rate is never quietly copied in",
    run: (module, world) => {
      // Convívio declares no rate at all (D11). An activity under it still has
      // to carry one, and nothing here may invent it.
      const value = refused(() =>
        module.createActivity(
          world.connection,
          input(world, {
            categoryId: world.categoryId("Convívio"),
            calcMode: "fixed",
            value: null,
            maxSessionMinutes: null,
          }),
        ),
      );

      return value;
    },
    expected:
      "refused: a fixed activity needs a value: it is what the engine reads, and it is never taken from the category (D11)",
  },
  {
    rule: "the value is explicit, and it is what the engine reads",
    name: "a free activity is the one with no value of its own (D12)",
    run: (module, world) => {
      module.createActivity(
        world.connection,
        input(world, {
          calcMode: "free",
          value: null,
          maxSessionMinutes: null,
        }),
      );

      return world.activityText("Podcast");
    },
    expected:
      "Podcast em Mente · free null · limite null · nota false · cooldown 0 · ordem 5 · on",
  },
  {
    rule: "the value is explicit, and it is what the engine reads",
    name: "a free activity carrying a value is refused, in words",
    run: (module, world) =>
      refused(() =>
        module.createActivity(
          world.connection,
          input(world, { calcMode: "free", value: 3 }),
        ),
      ),
    expected:
      "refused: a free activity has no value of its own: the adult types it when he launches it (D11, D12)",
  },
  {
    rule: "the value is explicit, and it is what the engine reads",
    name: "a negative value is refused, in words",
    run: (module, world) =>
      refused(() =>
        module.createActivity(world.connection, input(world, { value: -2 })),
      ),
    expected:
      "refused: an activity value is a number of hours between 0 and 1000000, received -2",
  },
  {
    rule: "the value is explicit, and it is what the engine reads",
    name: "a value that is not a number at all is refused",
    run: (module, world) =>
      refused(() =>
        module.createActivity(
          world.connection,
          input(world, { value: Number.NaN }),
        ),
      ),
    expected:
      "refused: an activity value is a number of hours between 0 and 1000000, received NaN",
  },
  {
    rule: "the value is explicit, and it is what the engine reads",
    name: "a value is held to the two decimals an hour is held to",
    run: (module, world) => {
      module.createActivity(world.connection, input(world, { value: 1.995 }));

      return world.activityText("Podcast");
    },
    expected:
      "Podcast em Mente · duration 2 · limite 120 · nota false · cooldown 0 · ordem 5 · on",
  },

  // --- D16: o limite de sessão, e os outros contadores ---------------------
  {
    rule: "every counter the engine reads is checked here",
    name: "a session limit is kept only where there is a session",
    run: (module, world) => {
      module.createActivity(
        world.connection,
        input(world, { calcMode: "fixed", maxSessionMinutes: 90 }),
      );

      return world.activityText("Podcast");
    },
    // Stored as null rather than refused: a mode changed away from `duration`
    // must not leave a limit behind for nothing to read.
    expected:
      "Podcast em Mente · fixed 2 · limite null · nota false · cooldown 0 · ordem 5 · on",
  },
  {
    rule: "every counter the engine reads is checked here",
    name: "a duration activity may have no limit at all",
    run: (module, world) => {
      module.createActivity(
        world.connection,
        input(world, { maxSessionMinutes: null }),
      );

      return world.activityText("Podcast");
    },
    expected:
      "Podcast em Mente · duration 2 · limite null · nota false · cooldown 0 · ordem 5 · on",
  },
  {
    rule: "every counter the engine reads is checked here",
    name: "a limit of zero minutes is refused, in words",
    run: (module, world) =>
      refused(() =>
        module.createActivity(
          world.connection,
          input(world, { maxSessionMinutes: 0 }),
        ),
      ),
    expected:
      "refused: a session limit is a whole number between 1 and 1000000, received 0",
  },
  {
    rule: "every counter the engine reads is checked here",
    name: "half a minute of limit is refused rather than rounded",
    run: (module, world) =>
      refused(() =>
        module.createActivity(
          world.connection,
          input(world, { maxSessionMinutes: 90.5 }),
        ),
      ),
    expected:
      "refused: a session limit is a whole number between 1 and 1000000, received 90.5",
  },
  {
    rule: "every counter the engine reads is checked here",
    name: "a duration activity keeps the floor it was given (D44)",
    run: (module, world) => {
      module.createActivity(
        world.connection,
        input(world, { minSessionMinutes: 10 }),
      );

      return world.connection.db
        .select({ floor: activities.minSessionMinutes })
        .from(activities)
        .where(eq(activities.name, "Podcast"))
        .get()?.floor;
    },
    expected: 10,
  },
  {
    rule: "every counter the engine reads is checked here",
    name: "a floor of zero minutes is refused, in words (D44)",
    run: (module, world) =>
      refused(() =>
        module.createActivity(
          world.connection,
          input(world, { minSessionMinutes: 0 }),
        ),
      ),
    expected:
      "refused: a minimum session is a whole number between 1 and 1000000, received 0",
  },
  {
    rule: "every counter the engine reads is checked here",
    name: "a floor above the session limit is refused, in words (D44)",
    run: (module, world) =>
      refused(() =>
        module.createActivity(
          world.connection,
          input(world, { minSessionMinutes: 121 }),
        ),
      ),
    expected:
      "refused: a minimum session of 121 minutes is longer than the session limit of 120 (D44)",
  },
  {
    rule: "every counter the engine reads is checked here",
    name: "a negative cooldown is refused, in words",
    run: (module, world) =>
      refused(() =>
        module.createActivity(
          world.connection,
          input(world, { repeatCooldownDays: -1 }),
        ),
      ),
    expected:
      "refused: a repeat cooldown is a whole number between 0 and 1000000, received -1",
  },
  {
    rule: "every counter the engine reads is checked here",
    name: "a cooldown of zero is the seed's way of saying it does not apply (D6)",
    run: (module, world) => {
      module.createActivity(
        world.connection,
        input(world, { repeatCooldownDays: 0 }),
      );

      return world.activityText("Podcast").includes("cooldown 0");
    },
    expected: true,
  },
  {
    rule: "every counter the engine reads is checked here",
    name: "a fractional cooldown is refused rather than rounded",
    run: (module, world) =>
      refused(() =>
        module.createActivity(
          world.connection,
          input(world, { repeatCooldownDays: 3.5 }),
        ),
      ),
    expected:
      "refused: a repeat cooldown is a whole number between 0 and 1000000, received 3.5",
  },
  {
    rule: "every counter the engine reads is checked here",
    name: "a negative sort order is refused",
    run: (module, world) =>
      refused(() =>
        module.createActivity(
          world.connection,
          input(world, { sortOrder: -1 }),
        ),
      ),
    expected:
      "refused: a sort order is a whole number between 0 and 1000000, received -1",
  },
  {
    rule: "every counter the engine reads is checked here",
    name: "a grade flag is stored as it was sent",
    run: (module, world) => {
      module.createActivity(
        world.connection,
        input(world, {
          categoryId: world.categoryId(CASA),
          calcMode: "delivery",
          maxSessionMinutes: null,
          qualityGraded: true,
          repeatCooldownDays: 7,
        }),
      );

      return world.activityText("Podcast");
    },
    expected:
      "Podcast em Casa · delivery 2 · limite null · nota true · cooldown 7 · ordem 5 · on",
  },
  {
    rule: "every counter the engine reads is checked here",
    name: "a refused create writes nothing at all",
    run: (module, world) => {
      refused(() =>
        module.createActivity(world.connection, input(world, { value: -2 })),
      );

      return module.listActivities(world.connection, world.categoryId(MENTE))
        .length;
    },
    expected: 4,
  },

  // --- D37: nada muda de preço debaixo de uma entrada que já espera ---------
  {
    rule: "a waiting entry is priced by the table it was written under",
    name: "raising the value is refused, and the entry is named",
    // Measured before this rule: the same one-hour session paid 3 h approved as
    // it was registered and 15 h after `value` 2 → 10, with nothing about the
    // entry touched. Four sessions parked in the queue went from 9 h to 13,50 h.
    run: (module, world) => {
      const logId = world.addPending({ activity: "Ler livro" });

      return refused(() =>
        module.updateActivity(world.connection, world.activityId("Ler livro"), {
          ...input(world, { name: "Ler livro", value: 10 }),
          categoryId: world.categoryId(MENTE),
        }),
      ).includes(`a entrada ${logId} (Ler livro,`);
    },
    expected: true,
  },
  {
    rule: "a waiting entry is priced by the table it was written under",
    name: "changing the way it counts is refused",
    run: (module, world) => {
      world.addPending({ activity: "Ler livro" });

      return refused(() =>
        module.updateActivity(world.connection, world.activityId("Ler livro"), {
          ...input(world, {
            name: "Ler livro",
            calcMode: "fixed",
            value: 1.5,
            maxSessionMinutes: null,
          }),
          categoryId: world.categoryId(MENTE),
        }),
      ).startsWith("refused: Ler livro: não dá para mudar");
    },
    expected: true,
  },
  {
    rule: "a waiting entry is priced by the table it was written under",
    name: "turning the grade on is refused",
    // Left alone this took the whole approval queue down with an HTTP 500: the
    // engine refuses a graded entry with no grade, and the queue priced every
    // row without tolerance.
    run: (module, world) => {
      world.addPending({ activity: "Ler livro" });

      return refused(() =>
        module.updateActivity(world.connection, world.activityId("Ler livro"), {
          ...input(world, {
            name: "Ler livro",
            value: 1.5,
            qualityGraded: true,
          }),
          categoryId: world.categoryId(MENTE),
        }),
      ).startsWith("refused: Ler livro: não dá para mudar");
    },
    expected: true,
  },
  {
    rule: "a waiting entry is priced by the table it was written under",
    name: "changing the cooldown is refused",
    run: (module, world) => {
      world.addPending({ activity: "Ler livro" });

      return refused(() =>
        module.updateActivity(world.connection, world.activityId("Ler livro"), {
          ...input(world, {
            name: "Ler livro",
            value: 1.5,
            repeatCooldownDays: 7,
          }),
          categoryId: world.categoryId(MENTE),
        }),
      ).startsWith("refused: Ler livro: não dá para mudar");
    },
    expected: true,
  },
  {
    rule: "a waiting entry is priced by the table it was written under",
    name: "moving another activity is allowed, and does not move the price",
    // There used to be a second refusal here, for the categories a move travels
    // between. It protected nothing once D37's second half stamped
    // `category_id` on the log — measured, the pending entry priced 1,00 h
    // before and after — and it refused 96 of 192 legal moves with one pending
    // entry per boy, on the very operation this phase exists to allow without a
    // deploy. The case that replaces it holds the bound: the move goes through,
    // and the waiting entry does not move.
    run: (module, world) => {
      const logId = world.addPending({ activity: "Ler quadrinhos ou HQ" });
      const before = world.previewOf(logId);

      module.updateActivity(world.connection, world.activityId("Ler livro"), {
        ...input(world, { name: "Ler livro", sortOrder: 1 }),
        categoryId: world.categoryId("Criativo"),
      });

      return `${before} → ${world.previewOf(logId)}`;
    },
    expected: "1.5 → 1.5",
  },
  {
    rule: "a waiting entry is priced by the table it was written under",
    name: "switching it off while one waits is refused, not silently stranding it",
    // D33 refuses to approve an entry whose activity is off, so switching one
    // off with an entry waiting left the boy's real session unapprovable.
    run: (module, world) => {
      world.addPending({ activity: "Ler livro" });

      return refused(() =>
        module.setActivityActive(
          world.connection,
          world.activityId("Ler livro"),
          false,
        ),
      ).startsWith("refused: Ler livro: não dá para mudar");
    },
    expected: true,
  },
  {
    rule: "a waiting entry is priced by the table it was written under",
    name: "an open stopwatch session refuses the edit too, before anything is filed",
    // The line is `startTimer`, not `stopTimer`. Left at the filing, everything
    // this rule refuses was reachable one step earlier: 120 min of Ler livro
    // paid 6,75 h after `value` 2 → 3, 120,00 h after three fields, and
    // 750.000,00 h at the column's ceiling on a 30-minute session — against a
    // calibrated asymptote of 4,00 h, with no proration and repeatable daily.
    run: (module, world) => {
      world.startSession("Ler livro");

      return refused(() =>
        module.updateActivity(world.connection, world.activityId("Ler livro"), {
          ...input(world, { name: "Ler livro", value: 180 }),
          categoryId: world.categoryId(MENTE),
        }),
      );
    },
    expected:
      "refused: Ler livro: não dá para mudar taxa, modo, nota, cooldown ou categoria agora, porque Ler livro está com o cronômetro aberto e seria paga pelo valor novo. Decida essa primeiro.",
  },
  {
    rule: "a waiting entry is priced by the table it was written under",
    name: "a paused session is still a session",
    // Pausing is not finishing: the minutes already on the clock are still
    // going to be priced by whatever the table says when the boy stops.
    run: (module, world) => {
      world.startSession("Ler livro", { paused: true });

      return refused(() =>
        module.updateActivity(world.connection, world.activityId("Ler livro"), {
          ...input(world, { name: "Ler livro", value: 10 }),
          categoryId: world.categoryId(MENTE),
        }),
      ).includes("cronômetro aberto");
    },
    expected: true,
  },
  {
    rule: "a waiting entry is priced by the table it was written under",
    name: "a rename is still free with a session open",
    // The bound: the rule is about what changes a price, not about freezing the
    // screen whenever a boy touches the stopwatch.
    run: (module, world) => {
      world.startSession("Ler livro");

      module.updateActivity(world.connection, world.activityId("Ler livro"), {
        ...input(world, { name: "Ler devagar", value: 1.5, sortOrder: 1 }),
        categoryId: world.categoryId(MENTE),
      });

      return world.activityText("Ler devagar");
    },
    expected:
      "Ler devagar em Mente · duration 1.5 · limite 120 · nota false · cooldown 0 · ordem 1 · on",
  },
  {
    rule: "a waiting entry is priced by the table it was written under",
    name: "a rename, a reorder and a session limit are not repricing, and go through",
    // The bound that keeps the rule from being "nothing may ever be edited".
    // None of these three can change what a waiting entry is worth: its minutes
    // are already on the row.
    run: (module, world) => {
      world.addPending({ activity: "Ler livro" });

      module.updateActivity(world.connection, world.activityId("Ler livro"), {
        ...input(world, {
          name: "Ler livro devagar",
          value: 1.5,
          maxSessionMinutes: 45,
          sortOrder: 9,
        }),
        categoryId: world.categoryId(MENTE),
      });

      return world.activityText("Ler livro devagar");
    },
    expected:
      "Ler livro devagar em Mente · duration 1.5 · limite 45 · nota false · cooldown 0 · ordem 9 · on",
  },
  {
    rule: "a waiting entry is priced by the table it was written under",
    name: "an entry waiting on another category does not block the edit",
    // The other bound: the rule is about the entries this edit could reprice,
    // not about the queue being empty.
    run: (module, world) => {
      world.addPending({
        activity: "Lavar o carro",
        durationMinutes: null,
        quality: 1,
      });

      module.updateActivity(world.connection, world.activityId("Ler livro"), {
        ...input(world, { name: "Ler livro", value: 10, sortOrder: 1 }),
        categoryId: world.categoryId(MENTE),
      });

      return world.activityText("Ler livro");
    },
    expected:
      "Ler livro em Mente · duration 10 · limite 120 · nota false · cooldown 0 · ordem 1 · on",
  },
  {
    rule: "a waiting entry is priced by the table it was written under",
    name: "once the entry is decided, the edit goes through",
    // The rule is a wait, not a lock: it says "decide that one first", the same
    // sentence D32 says, and then the field is free.
    run: (module, world) => {
      const logId = world.addPending({ activity: "Ler livro" });
      world.reject(logId);

      module.updateActivity(world.connection, world.activityId("Ler livro"), {
        ...input(world, { name: "Ler livro", value: 10, sortOrder: 1 }),
        categoryId: world.categoryId(MENTE),
      });

      return world.activityText("Ler livro");
    },
    expected:
      "Ler livro em Mente · duration 10 · limite 120 · nota false · cooldown 0 · ordem 1 · on",
  },

  // --- D15: mudar a taxa não reescreve o passado ----------------------------
  {
    rule: "changing the rate does not rewrite the past",
    name: "the frozen value of an entry does not move when the rate doubles",
    run: (module, world) => {
      const logId = world.credit("Ler livro", 3);

      module.updateActivity(world.connection, world.activityId("Ler livro"), {
        categoryId: world.categoryId(MENTE),
        name: "Ler livro",
        calcMode: "duration",
        value: 4,
        maxSessionMinutes: 120,
        minSessionMinutes: 5,
        qualityGraded: false,
        repeatCooldownDays: 0,
        sortOrder: 1,
      });

      return world.frozenText(logId);
    },
    expected: "approved 3 h · Ler livro / Mente · ledger earn 3",
  },
  {
    rule: "changing the rate does not rewrite the past",
    name: "the balance does not move when the rate is changed",
    run: (module, world) => {
      world.credit("Ler livro", 3);
      const before = world.balance();

      module.updateActivity(world.connection, world.activityId("Ler livro"), {
        categoryId: world.categoryId(MENTE),
        name: "Ler livro",
        calcMode: "fixed",
        value: 0,
        maxSessionMinutes: null,
        minSessionMinutes: 5,
        qualityGraded: false,
        repeatCooldownDays: 0,
        sortOrder: 1,
      });

      return `${before} then ${world.balance()}`;
    },
    expected: "3 then 3",
  },
  {
    rule: "changing the rate does not rewrite the past",
    name: "the balance does not move when the activity is switched off",
    run: (module, world) => {
      world.credit("Ler livro", 3);
      const before = world.balance();

      module.setActivityActive(
        world.connection,
        world.activityId("Ler livro"),
        false,
      );

      return `${before} then ${world.balance()}`;
    },
    expected: "3 then 3",
  },
  {
    rule: "changing the rate does not rewrite the past",
    name: "moving the activity does not move what it already paid",
    run: (module, world) => {
      const logId = world.credit("Ler livro", 3);

      module.updateActivity(world.connection, world.activityId("Ler livro"), {
        categoryId: world.categoryId("Criativo"),
        name: "Ler livro",
        calcMode: "duration",
        value: 2,
        maxSessionMinutes: 120,
        minSessionMinutes: 5,
        qualityGraded: false,
        repeatCooldownDays: 0,
        sortOrder: 1,
      });

      // The history follows the activity through the foreign key, which is what
      // D14 keeps readable; the number does not move, which is D15.
      return world.frozenText(logId);
    },
    expected: "approved 3 h · Ler livro / Criativo · ledger earn 3",
  },
  {
    rule: "changing the rate does not rewrite the past",
    name: "no ledger row is added or removed by any of it",
    run: (module, world) => {
      world.credit("Ler livro", 3);
      const id = world.activityId("Ler livro");

      module.updateActivity(world.connection, id, {
        categoryId: world.categoryId(MENTE),
        name: "Ler livro",
        calcMode: "duration",
        value: 9,
        maxSessionMinutes: 30,
        minSessionMinutes: 5,
        qualityGraded: true,
        repeatCooldownDays: 5,
        sortOrder: 3,
      });
      module.setActivityActive(world.connection, id, false);
      module.setActivityActive(world.connection, id, true);

      return world.ledgerRows().length;
    },
    expected: 1,
  },

  // --- a lista que a tela desenha ------------------------------------------
  {
    rule: "the list is the one the screen draws",
    name: "one category's activities, in the picker's order",
    run: (module, world) => world.activityListText(module, MENTE),
    expected:
      "Ler livro(on) | Ler quadrinhos ou HQ(on) | Jogo de tabuleiro, xadrez ou baralho(on) | Curso ou aula extra(on)",
  },
  {
    rule: "the list is the one the screen draws",
    name: "it carries no other category's activities",
    run: (module, world) =>
      module.listActivities(world.connection, world.categoryId("Curinga"))
        .length,
    expected: 1,
  },
  {
    rule: "the list is the one the screen draws",
    name: "a new activity takes its place by sort order",
    run: (module, world) => {
      module.createActivity(world.connection, input(world, { sortOrder: 0 }));

      return world.activityListText(module, MENTE);
    },
    expected:
      "Podcast(on) | Ler livro(on) | Ler quadrinhos ou HQ(on) | Jogo de tabuleiro, xadrez ou baralho(on) | Curso ou aula extra(on)",
  },
];

/** The cases the given implementation gets wrong. */
export function failingActivityCases(
  module: ActivityModule,
  worlds: () => ActivityWorld,
): ActivityCase[] {
  return ACTIVITY_CASES.filter((activityCase) => {
    const world = worlds();

    try {
      return activityCase.run(module, world) !== activityCase.expected;
    } catch (thrown) {
      return `threw: ${(thrown as Error).message}` !== activityCase.expected;
    } finally {
      world.connection.sqlite.close();
    }
  });
}
