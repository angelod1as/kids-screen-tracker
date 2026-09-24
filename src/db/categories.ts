import { and, asc, count, desc, eq, ne } from "drizzle-orm";

import {
  isUsableDecayStep,
  isUsableReturnBonus,
  MIN_DECAY_STEP_HOURS,
  MIN_RETURN_BONUS_AFTER_DAYS,
} from "../engine/limits";
import type { Connection, Transaction } from "./client";
import { writeTransaction } from "./client";
import {
  requireBonusFraction,
  requireCount,
  requireNonNegativeHours,
  requireText,
} from "./input";
import { activityIdsOf, refuseWhileWaiting } from "./pending";
import { activities, categories } from "./schema";

/**
 * The categories, configured by hand (#26).
 *
 * **A central requirement, not a secondary one.** The table changes a lot in
 * the first months and none of it may need a deploy, which means this module is
 * used often and by an adult who is calibrating rather than administering. Two
 * things follow from that and are worth reading before changing anything here.
 *
 * **Every number this accepts is a number the engine has to survive.** This is
 * the only path by which a hand-typed value reaches `calculate.ts`; the seed's
 * four decaying configurations are clean, and the two that are not are
 * reachable from here and from nowhere else. Both floors live in
 * `src/engine/limits.ts`, with the measurements that produced them, and are
 * applied below — refused by the endpoint, not merely hidden from a form (D33).
 *
 * **Editing changes nothing already credited (D15).** There is no recalculation
 * anywhere in this file, deliberately and permanently: `computed_hours` is
 * frozen at approval, the ledger row is written beside it, and a rate corrected
 * on a Tuesday governs Wednesday's entries and no earlier ones. `config.test.ts`
 * proves it twice — once by editing a category under a credited log and reading
 * the balance on both sides, and once by reading this file's own source and
 * failing if it mentions `activity_logs` or `ledger` at all. The second is the
 * sharper of the two, because a recalculation added by somebody thinking about
 * something else would have to survive both.
 *
 * **Nothing is deleted (D14).** `setCategoryActive` flips a column. The logs'
 * foreign keys depend on these rows, and a three-month-old entry has to keep
 * knowing which category it came from for the history to stay readable.
 */

/** A category as the Configuration screen draws it (#26). */
export type CategoryRow = {
  id: number;
  name: string;
  /** D11: nullable, and only the suggestion offered when creating an activity. */
  baseRate: number | null;
  /** D2: null is the off switch — a category with no decay at all. */
  decayStepHours: number | null;
  /** A fraction, not percentage points: 0,5 is +50%. */
  returnBonusPct: number;
  returnBonusAfterDays: number;
  sortOrder: number;
  active: boolean;
  /**
   * How many activities hang off it, switched on or off.
   *
   * On screen so that switching a category off says what it takes with it: the
   * activities stay exactly as they are, and every one of them leaves the
   * pickers with it (D14, and `fetchLaunchDataAction`'s inner join).
   */
  activityCount: number;
};

/** What an adult typed into the category form (#26). */
export type CategoryInput = {
  name: string;
  baseRate: number | null;
  /** D2: null — an empty field on screen — is a category without decay. */
  decayStepHours: number | null;
  returnBonusPct: number;
  returnBonusAfterDays: number;
  sortOrder: number;
};

type Db = Connection["db"] | Transaction;

/**
 * Every category, switched on first, then in the order the pickers show them.
 *
 * The switched-off ones stay in the list rather than disappearing, which is the
 * screen half of D14: a category is deactivated and never deleted, and an adult
 * who wants last month's category back has to be able to read what it said and
 * switch it on again. Inside each half the order is `sort_order` then `id`, the
 * same one `fetchLaunchDataAction` uses, so the two screens agree.
 */
export function listCategories(connection: Connection): CategoryRow[] {
  return connection.db
    .select({
      id: categories.id,
      name: categories.name,
      baseRate: categories.baseRate,
      decayStepHours: categories.decayStepHours,
      returnBonusPct: categories.returnBonusPct,
      returnBonusAfterDays: categories.returnBonusAfterDays,
      sortOrder: categories.sortOrder,
      active: categories.active,
      // `count(activities.id)` and not `count(*)`: the join is a left join, so a
      // category with no activities produces one row with a null on the right,
      // and `count(*)` would count that row and answer 1 for an empty category.
      activityCount: count(activities.id),
    })
    .from(categories)
    .leftJoin(activities, eq(activities.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(
      desc(categories.active),
      asc(categories.sortOrder),
      asc(categories.id),
    )
    .all();
}

/**
 * The whole of a category, checked before anything is computed from it (#26).
 *
 * Every bound here is also a CHECK on its column, which is the backstop; this
 * is the same rule said where it can name what went wrong, on a screen where an
 * adult is trying to work out what number to type. `CHECK constraint failed:
 * categories_decay_step_hours_check` says neither which field nor what would
 * have been acceptable.
 *
 * The two floors are the exception to that: they are **not** CHECKs, because
 * they are properties of the arithmetic downstream rather than of the column,
 * and the schema has no way to say so. `src/engine/limits.ts` holds both, with
 * what was measured.
 */
function requireCategory(input: CategoryInput): CategoryInput {
  const name = input.name.trim();

  requireText(name, "a category name");

  if (name === "") {
    throw new Error("a category needs a name: it is what the pickers show");
  }

  // D2: an empty field is a category without decay, and that is a legitimate
  // answer rather than a missing one — Convívio, Casa and Curinga are exactly
  // this. Only a number that is present has to clear the floor.
  const decayStepHours =
    input.decayStepHours === null
      ? null
      : requireNonNegativeHours(input.decayStepHours, "a decay step");

  if (!isUsableDecayStep(decayStepHours)) {
    throw new Error(
      `a decay step of ${decayStepHours} h is below the floor of ${MIN_DECAY_STEP_HOURS} h: ` +
        "narrower bands than that make a longer session pay less than a shorter one, " +
        "and a category that pays nothing is switched off with `active`, not with a tiny step. " +
        "Leave the field empty for a category with no decay at all (D2)",
    );
  }

  const returnBonusPct = requireBonusFraction(
    input.returnBonusPct,
    "a return bonus",
  );
  const returnBonusAfterDays = requireCount(
    input.returnBonusAfterDays,
    "a return bonus threshold",
  );

  if (!isUsableReturnBonus(returnBonusPct, returnBonusAfterDays)) {
    throw new Error(
      `a return bonus of ${returnBonusPct} needs a threshold of at least ` +
        `${MIN_RETURN_BONUS_AFTER_DAYS} day: at zero the window is the day itself, so the ` +
        "first entry of every day counts as coming back and the bonus is permanent. " +
        "A category with no bonus has a bonus of 0",
    );
  }

  return {
    name,
    baseRate:
      input.baseRate === null
        ? null
        : requireNonNegativeHours(input.baseRate, "a base rate"),
    decayStepHours,
    returnBonusPct,
    returnBonusAfterDays,
    sortOrder: requireCount(input.sortOrder, "a sort order"),
  };
}

/**
 * That no other *live* category already answers to this name.
 *
 * `categories_name_unique` is partial — scoped to `active = 1` — so recreating
 * a category that was switched off works, which is what D14 needs. What the
 * index gives back is a `UNIQUE constraint failed` on a screen; this is the
 * same rule with the name in it.
 *
 * `exceptId` is the category being edited, which must not collide with itself.
 * A category that is switched off is not checked at all: it is not live, so it
 * is not what the index is about, and refusing it would make a deactivated name
 * burn the name after all.
 */
function requireNameIsFree(
  db: Db,
  name: string,
  exceptId: number | null,
): void {
  const clash = db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.name, name),
        eq(categories.active, true),
        exceptId === null ? undefined : ne(categories.id, exceptId),
      ),
    )
    .get();

  if (clash !== undefined) {
    throw new Error(
      `there is already a category called ${name}; switch that one off first, or pick another name`,
    );
  }
}

/** The category being changed, which has to exist. */
function requireCategoryRow(db: Db, categoryId: number) {
  const found = db
    .select({
      id: categories.id,
      name: categories.name,
      active: categories.active,
      decayStepHours: categories.decayStepHours,
      returnBonusPct: categories.returnBonusPct,
      returnBonusAfterDays: categories.returnBonusAfterDays,
    })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .get();

  if (found === undefined) {
    throw new Error(`there is no category ${categoryId}`);
  }

  return found;
}

/** Creates a category (#26). It is born switched on. */
export function createCategory(
  connection: Connection,
  input: CategoryInput,
): number {
  const checked = requireCategory(input);

  return writeTransaction(connection, (tx) => {
    requireNameIsFree(tx, checked.name, null);

    return tx
      .insert(categories)
      .values({
        name: checked.name,
        baseRate: checked.baseRate,
        decayStepHours: checked.decayStepHours,
        returnBonusPct: checked.returnBonusPct,
        returnBonusAfterDays: checked.returnBonusAfterDays,
        sortOrder: checked.sortOrder,
        active: true,
      })
      .returning({ id: categories.id })
      .get().id;
  });
}

/**
 * Corrects what a category says (#26).
 *
 * **Nothing already credited moves (D15).** No log is read here and none is
 * written; the new numbers reach `calculate.ts` the next time an entry is
 * priced, and every `computed_hours` already in the table stays exactly where
 * it was frozen. That is the whole reason the field is safe to use as often as
 * the first months will need it.
 *
 * `active` is not among the fields: switching a category off is
 * `setCategoryActive`, one tap with nothing to type, and it is a different
 * thing an adult means.
 */
export function updateCategory(
  connection: Connection,
  categoryId: number,
  input: CategoryInput,
): void {
  const checked = requireCategory(input);

  writeTransaction(connection, (tx) => {
    const found = requireCategoryRow(tx, categoryId);

    // D37: the three numbers below are read when an entry of this category is
    // approved, so they cannot move while one is waiting. `name`, `base_rate`
    // and `sort_order` are not among them — D11 keeps `base_rate` out of every
    // calculation, and the other two are labels.
    if (
      checked.decayStepHours !== found.decayStepHours ||
      checked.returnBonusPct !== found.returnBonusPct ||
      checked.returnBonusAfterDays !== found.returnBonusAfterDays
    ) {
      refuseWhileWaiting(tx, activityIdsOf(tx, categoryId), found.name);
    }

    // Only a *live* category has to hold a free name, because that is the rule
    // `categories_name_unique` states — it is a partial index over the switched
    // -on rows, and D14 is why. Checking it unconditionally was stricter than
    // the index and locked an adult out of his own data: switch "Mente" off,
    // create a new "Mente", and the old one could no longer be edited at all,
    // not even to correct its sort order, because its own name now belonged to
    // somebody else. The invariant is kept where it belongs — `setCategoryActive`
    // refuses to switch it back on while the name is taken.
    if (found.active) {
      requireNameIsFree(tx, checked.name, categoryId);
    }

    tx.update(categories)
      .set({
        name: checked.name,
        baseRate: checked.baseRate,
        decayStepHours: checked.decayStepHours,
        returnBonusPct: checked.returnBonusPct,
        returnBonusAfterDays: checked.returnBonusAfterDays,
        sortOrder: checked.sortOrder,
      })
      .where(eq(categories.id, categoryId))
      .run();
  });
}

/**
 * Switches a category on or off (#26, D14).
 *
 * Off is a column and not a deletion. The category and its activities leave
 * every picker — `fetchLaunchDataAction`, the calculator and the stopwatch all
 * join through `categories.active` — and D33 makes the endpoints refuse them
 * too. Every log ever written against it keeps working: the history reads the
 * activity's name and the category's through the same foreign keys it always
 * did, and `computed_hours` was frozen long ago.
 *
 * Switching one back on is the same call with `true`, which is what makes the
 * deactivated rows worth keeping in the list.
 */
export function setCategoryActive(
  connection: Connection,
  categoryId: number,
  active: boolean,
): void {
  writeTransaction(connection, (tx) => {
    const found = requireCategoryRow(tx, categoryId);

    // Switching a category off strands every entry waiting under it (D33
    // refuses to approve one whose category is off). Same sentence as D37's.
    if (!active) {
      refuseWhileWaiting(tx, activityIdsOf(tx, categoryId), found.name);
    }

    // Switching one back on has to clear the same bar creating it does, or the
    // partial unique index becomes a rule that only applies to new rows: switch
    // "Corpo" off, create a second "Corpo", switch the first back on, and two
    // live categories share a name. The index itself refuses that insert with a
    // constraint name; this refuses it with the sentence.
    if (active) {
      requireNameIsFree(tx, found.name, categoryId);
    }

    tx.update(categories)
      .set({ active })
      .where(eq(categories.id, categoryId))
      .run();
  });
}
