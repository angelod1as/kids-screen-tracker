"use server";

import { requireAdmin } from "../../auth/guard";
import { getConnection } from "../../db";
import type { ActivityInput, ActivityRow } from "../../db/activities";
import {
  createActivity,
  listActivities,
  setActivityActive,
  updateActivity,
} from "../../db/activities";
import type { CategoryInput, CategoryRow } from "../../db/categories";
import {
  createCategory,
  listCategories,
  setCategoryActive,
  updateCategory,
} from "../../db/categories";
import type { HoursMinutes } from "../../db/input";
import { hoursFromTime, requireHoursMinutes, requireId } from "../../db/input";
import type { Locks } from "../../db/pending";
import { currentLocks } from "../../db/pending";
import type { Refused } from "../../db/refusal";
import { refusedOr } from "../../db/refusal";

/**
 * `requireAdmin`, not `requireAccess`: a category belongs to nobody, so there is
 * no `targetUserId` to guard. Mutations answer with the whole list, so the
 * asymptote is never stale, or with D37's refusal, word for word (#7).
 */

/**
 * #48: every time is typed as hours and minutes and converted here, at the
 * edge. The rate stays a decimal: hours of screen per hour of activity, not a time.
 */
export type CategoryRequest = Omit<CategoryInput, "decayStepHours"> & {
  /** D2: null is no decay. */
  decayStep: HoursMinutes | null;
};

export type ActivityRequest = Omit<
  ActivityInput,
  "value" | "maxSessionMinutes" | "minSessionMinutes" | "presumedMinutes"
> & {
  /** D11: a `duration` activity's rate; read for no other mode. */
  rate: number | null;
  /** A `fixed` or `delivery` activity's hours; read for no other mode. */
  amount: HoursMinutes | null;
  maxSession: HoursMinutes | null;
  minSession: HoursMinutes;
  presumed?: HoursMinutes | null;
};

function categoryInputOf({
  decayStep,
  ...request
}: CategoryRequest): CategoryInput {
  return {
    ...request,
    decayStepHours:
      decayStep === null ? null : hoursFromTime(decayStep, "a decay step"),
  };
}

function activityInputOf({
  rate,
  amount,
  maxSession,
  minSession,
  presumed,
  ...request
}: ActivityRequest): ActivityInput {
  const minutesOf = (time: HoursMinutes | null | undefined, what: string) =>
    time === undefined || time === null
      ? null
      : requireHoursMinutes(time, what);

  return {
    ...request,
    value:
      request.calcMode === "duration"
        ? rate
        : request.calcMode === "free" || amount === null
          ? null
          : hoursFromTime(amount, "an activity value"),
    maxSessionMinutes: minutesOf(maxSession, "a session limit"),
    minSessionMinutes: requireHoursMinutes(minSession, "a minimum session"),
    presumedMinutes: minutesOf(presumed, "a presumed duration"),
  };
}

export async function fetchCategoriesAction(): Promise<CategoryRow[]> {
  await requireAdmin();

  return listCategories(getConnection());
}

/** Its own endpoint: it goes stale when a boy taps *Começar*, not when an adult edits (D37). */
export async function fetchLocksAction(): Promise<Locks> {
  await requireAdmin();

  return currentLocks(getConnection());
}

export async function createCategoryAction(
  input: CategoryRequest,
): Promise<CategoryRow[]> {
  await requireAdmin();

  createCategory(getConnection(), categoryInputOf(input));

  return listCategories(getConnection());
}

/** Nothing already credited moves (D15). */
export async function updateCategoryAction(
  categoryId: number,
  input: CategoryRequest,
): Promise<CategoryRow[] | Refused> {
  await requireAdmin();

  return refusedOr(() => {
    updateCategory(getConnection(), categoryId, categoryInputOf(input));

    return listCategories(getConnection());
  });
}

/** D14: nothing is deleted. */
export async function setCategoryActiveAction(
  categoryId: number,
  active: boolean,
): Promise<CategoryRow[] | Refused> {
  await requireAdmin();

  return refusedOr(() => {
    setCategoryActive(getConnection(), categoryId, active);

    return listCategories(getConnection());
  });
}

export async function fetchActivitiesAction(
  categoryId: number,
): Promise<ActivityRow[]> {
  await requireAdmin();

  return listActivities(getConnection(), categoryId);
}

/** The value stored is the value that arrives, whatever `base_rate` suggests (D11). */
export async function createActivityAction(
  input: ActivityRequest,
): Promise<ActivityRow[]> {
  await requireAdmin();

  createActivity(getConnection(), activityInputOf(input));

  return listActivities(getConnection(), input.categoryId);
}

/**
 * `categoryId` is the list on screen, not `input.categoryId`: they differ when
 * the activity moves. Nothing already credited moves (D15).
 */
export async function updateActivityAction(
  categoryId: number,
  activityId: number,
  input: ActivityRequest,
): Promise<ActivityRow[] | Refused> {
  await requireAdmin();
  // #58: the list is read after the write, so a bad id would fail a saved edit.
  requireId(categoryId, "a category");

  return refusedOr(() => {
    updateActivity(getConnection(), activityId, activityInputOf(input));

    return listActivities(getConnection(), categoryId);
  });
}

/** D14: nothing is deleted. */
export async function setActivityActiveAction(
  categoryId: number,
  activityId: number,
  active: boolean,
): Promise<ActivityRow[] | Refused> {
  await requireAdmin();

  return refusedOr(() => {
    setActivityActive(getConnection(), activityId, active);

    return listActivities(getConnection(), categoryId);
  });
}
