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
 * The categories, configured by hand (#26): the only path by which a typed
 * number reaches the engine, so the floors in `limits.ts` are refused here (D33).
 * No recalculation, ever (D15); nothing is deleted (D14).
 */

/** As the Configuration screen draws it (#26). */
export type CategoryRow = {
  id: number;
  name: string;
  /** D11. */
  baseRate: number | null;
  /** D2: null is no decay. */
  decayStepHours: number | null;
  /** A fraction: 0,5 is +50%. */
  returnBonusPct: number;
  returnBonusAfterDays: number;
  sortOrder: number;
  active: boolean;
  /** So switching a category off says what leaves the pickers with it (D14). */
  activityCount: number;
};

/** The form's input (#26). */
export type CategoryInput = {
  name: string;
  baseRate: number | null;
  /** D2: an empty field is no decay. */
  decayStepHours: number | null;
  returnBonusPct: number;
  returnBonusAfterDays: number;
  sortOrder: number;
};

type Db = Connection["db"] | Transaction;

/** Switched-off ones stay listed so they can be switched back on (D14). */
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
      // Not `count(*)`: the left join gives an empty category one null row.
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
 * Each bound is also a column CHECK; this one names the field. The two floors
 * are not CHECKs: they are about the arithmetic downstream (`limits.ts`).
 */
function requireCategory(input: CategoryInput): CategoryInput {
  const name = input.name.trim();

  requireText(name, "a category name");

  if (name === "") {
    throw new Error("a category needs a name: it is what the pickers show");
  }

  // D2: empty is a legitimate answer; only a present number clears the floor.
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
 * `categories_name_unique`, said as a sentence. Only live rows clash, as in
 * the partial index (D14).
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

/** Born switched on (#26). */
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

/** Corrects a category (#26); nothing credited moves (D15). `active` is separate. */
export function updateCategory(
  connection: Connection,
  categoryId: number,
  input: CategoryInput,
): void {
  const checked = requireCategory(input);

  writeTransaction(connection, (tx) => {
    const found = requireCategoryRow(tx, categoryId);

    // D37. `name`, `base_rate` (D11) and `sort_order` price nothing.
    if (
      checked.decayStepHours !== found.decayStepHours ||
      checked.returnBonusPct !== found.returnBonusPct ||
      checked.returnBonusAfterDays !== found.returnBonusAfterDays
    ) {
      refuseWhileWaiting(tx, activityIdsOf(tx, categoryId), found.name);
    }

    // Only a live category must hold a free name, as in the partial index:
    // otherwise a switched-off "Mente" could not be edited once a new one existed.
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
 * Switches a category on or off. Off is a column, not a deletion (D14, D33).
 */
export function setCategoryActive(
  connection: Connection,
  categoryId: number,
  active: boolean,
): void {
  writeTransaction(connection, (tx) => {
    const found = requireCategoryRow(tx, categoryId);

    // D37: switching off would strand a waiting entry (D33).
    if (!active) {
      refuseWhileWaiting(tx, activityIdsOf(tx, categoryId), found.name);
    }

    // Otherwise switching one back on would give two live categories one name.
    if (active) {
      requireNameIsFree(tx, found.name, categoryId);
    }

    tx.update(categories)
      .set({ active })
      .where(eq(categories.id, categoryId))
      .run();
  });
}
