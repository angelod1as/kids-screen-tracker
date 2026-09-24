import { asc, desc, eq } from "drizzle-orm";

import { DEFAULT_MIN_SESSION_MINUTES } from "../engine/timer";
import type { Connection, Transaction } from "./client";
import { writeTransaction } from "./client";
import { requireCount, requireNonNegativeHours, requireText } from "./input";
import { refuseWhileWaiting } from "./pending";
import { activities, categories } from "./schema";

/**
 * The activities, configured by hand (#27). `value` is always explicit (D11)
 * and editing never recalculates (D15). A rename relabels past extract lines,
 * on purpose: a stamped name would keep today's typo fix out of them.
 */

/** As the Configuration screen draws it (#27). */
export type ActivityRow = {
  id: number;
  categoryId: number;
  name: string;
  calcMode: "duration" | "fixed" | "delivery" | "free";
  /** Null only for `free`. */
  value: number | null;
  /** D16. */
  maxSessionMinutes: number | null;
  /** D44. */
  minSessionMinutes: number;
  qualityGraded: boolean;
  repeatCooldownDays: number;
  sortOrder: number;
  active: boolean;
};

/** The form's input (#27). */
export type ActivityInput = {
  categoryId: number;
  name: string;
  calcMode: ActivityRow["calcMode"];
  /** D11. */
  value: number | null;
  maxSessionMinutes: number | null;
  minSessionMinutes: number;
  qualityGraded: boolean;
  repeatCooldownDays: number;
  sortOrder: number;
};

type Db = Connection["db"] | Transaction;

/** So a raw POST cannot invent a fifth mode. */
const CALC_MODES: readonly ActivityRow["calcMode"][] = [
  "duration",
  "fixed",
  "delivery",
  "free",
];

/** Switched-off ones stay listed so they can be switched back on (D14). */
export function listActivities(
  connection: Connection,
  categoryId: number,
): ActivityRow[] {
  return connection.db
    .select({
      id: activities.id,
      categoryId: activities.categoryId,
      name: activities.name,
      calcMode: activities.calcMode,
      value: activities.value,
      maxSessionMinutes: activities.maxSessionMinutes,
      minSessionMinutes: activities.minSessionMinutes,
      qualityGraded: activities.qualityGraded,
      repeatCooldownDays: activities.repeatCooldownDays,
      sortOrder: activities.sortOrder,
      active: activities.active,
    })
    .from(activities)
    .where(eq(activities.categoryId, categoryId))
    .orderBy(
      desc(activities.active),
      asc(activities.sortOrder),
      asc(activities.id),
    )
    .all();
}

/**
 * Each rule is also a column CHECK; this one names the field. The tests assert
 * the sentences, since the constraints alone would refuse the same inputs.
 */
function requireActivity(input: ActivityInput): ActivityInput {
  const name = input.name.trim();

  requireText(name, "an activity name");

  if (name === "") {
    throw new Error("an activity needs a name: it is what the pickers show");
  }

  if (!CALC_MODES.includes(input.calcMode)) {
    throw new Error(
      `${input.calcMode} is not a way of counting: it is one of ${CALC_MODES.join(", ")}`,
    );
  }

  // D11, D12: a missing value on any other mode is a silent zero.
  if (input.calcMode === "free") {
    if (input.value !== null) {
      throw new Error(
        "a free activity has no value of its own: the adult types it when he launches it (D11, D12)",
      );
    }
  } else if (input.value === null) {
    throw new Error(
      `a ${input.calcMode} activity needs a value: it is what the engine reads, and it is never taken from the category (D11)`,
    );
  }

  // D16: stored as null for other modes, so a mode change leaves no stale limit.
  const maxSessionMinutes =
    input.calcMode === "duration" && input.maxSessionMinutes !== null
      ? requireCount(input.maxSessionMinutes, "a session limit", { min: 1 })
      : null;
  // D44.
  const minSessionMinutes =
    input.calcMode === "duration"
      ? requireCount(input.minSessionMinutes, "a minimum session", { min: 1 })
      : DEFAULT_MIN_SESSION_MINUTES;

  // D44.
  if (maxSessionMinutes !== null && minSessionMinutes > maxSessionMinutes) {
    throw new Error(
      `a minimum session of ${minSessionMinutes} minutes is longer than the session limit of ${maxSessionMinutes} (D44)`,
    );
  }

  return {
    categoryId: input.categoryId,
    name,
    calcMode: input.calcMode,
    value:
      input.value === null
        ? null
        : requireNonNegativeHours(input.value, "an activity value"),
    maxSessionMinutes,
    minSessionMinutes,
    qualityGraded: input.qualityGraded,
    repeatCooldownDays: requireCount(
      input.repeatCooldownDays,
      "a repeat cooldown",
    ),
    sortOrder: requireCount(input.sortOrder, "a sort order"),
  };
}

/** D33: an activity under a switched-off category is in no picker at all. */
function requireLiveCategory(db: Db, categoryId: number): void {
  const found = db
    .select({ active: categories.active, name: categories.name })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .get();

  if (found === undefined) {
    throw new Error(`there is no category ${categoryId}`);
  }

  if (!found.active) {
    throw new Error(
      `${found.name} is switched off: an activity under it would be in no picker at all (D14, D33)`,
    );
  }
}

function requireActivityRow(db: Db, activityId: number) {
  const found = db
    .select({
      id: activities.id,
      name: activities.name,
      categoryId: activities.categoryId,
      calcMode: activities.calcMode,
      value: activities.value,
      qualityGraded: activities.qualityGraded,
      repeatCooldownDays: activities.repeatCooldownDays,
    })
    .from(activities)
    .where(eq(activities.id, activityId))
    .get();

  if (found === undefined) {
    throw new Error(`there is no activity ${activityId}`);
  }

  return found;
}

/** Born switched on (#27). */
export function createActivity(
  connection: Connection,
  input: ActivityInput,
): number {
  const checked = requireActivity(input);

  return writeTransaction(connection, (tx) => {
    requireLiveCategory(tx, checked.categoryId);

    return tx
      .insert(activities)
      .values({
        categoryId: checked.categoryId,
        name: checked.name,
        calcMode: checked.calcMode,
        value: checked.value,
        maxSessionMinutes: checked.maxSessionMinutes,
        minSessionMinutes: checked.minSessionMinutes,
        qualityGraded: checked.qualityGraded,
        repeatCooldownDays: checked.repeatCooldownDays,
        sortOrder: checked.sortOrder,
        active: true,
      })
      .returning({ id: activities.id })
      .get().id;
  });
}

/**
 * Corrects an activity (#27); nothing credited moves (D15). A move needs a
 * live destination, and past logs keep their stamped category (D37).
 */
export function updateActivity(
  connection: Connection,
  activityId: number,
  input: ActivityInput,
): void {
  const checked = requireActivity(input);

  writeTransaction(connection, (tx) => {
    const found = requireActivityRow(tx, activityId);
    requireLiveCategory(tx, checked.categoryId);

    // D37: only the fields that price a waiting entry; a rename is free.
    const repriced =
      checked.calcMode !== found.calcMode ||
      checked.value !== found.value ||
      checked.qualityGraded !== found.qualityGraded ||
      checked.repeatCooldownDays !== found.repeatCooldownDays ||
      checked.categoryId !== found.categoryId;

    if (repriced) {
      refuseWhileWaiting(tx, [activityId], `${found.name}`);
    }

    // No refusal for the categories a move travels between: the stamped
    // `category_id` (D37) already protects the waiting entry (D37, last paragraph).

    tx.update(activities)
      .set({
        categoryId: checked.categoryId,
        name: checked.name,
        calcMode: checked.calcMode,
        value: checked.value,
        maxSessionMinutes: checked.maxSessionMinutes,
        minSessionMinutes: checked.minSessionMinutes,
        qualityGraded: checked.qualityGraded,
        repeatCooldownDays: checked.repeatCooldownDays,
        sortOrder: checked.sortOrder,
      })
      .where(eq(activities.id, activityId))
      .run();
  });
}

/** Off is a column, not a deletion (D14, D33). On needs a live category. */
export function setActivityActive(
  connection: Connection,
  activityId: number,
  active: boolean,
): void {
  writeTransaction(connection, (tx) => {
    const found = requireActivityRow(tx, activityId);

    if (active) {
      requireLiveCategory(tx, found.categoryId);
    }

    // D37: switching off would strand a waiting entry (D33).
    if (!active) {
      refuseWhileWaiting(tx, [activityId], `${found.name}`);
    }

    tx.update(activities)
      .set({ active })
      .where(eq(activities.id, activityId))
      .run();
  });
}
