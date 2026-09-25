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
import type { Locks } from "../../db/pending";
import { currentLocks } from "../../db/pending";
import type { Refused } from "../../db/refusal";
import { refusedOr } from "../../db/refusal";

/**
 * `requireAdmin`, not `requireAccess`: a category belongs to nobody, so there is
 * no `targetUserId` to guard. Mutations answer with the whole list, so the
 * asymptote is never stale, or with D37's refusal, word for word (#7).
 */

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
  input: CategoryInput,
): Promise<CategoryRow[]> {
  await requireAdmin();

  createCategory(getConnection(), input);

  return listCategories(getConnection());
}

/** Nothing already credited moves (D15). */
export async function updateCategoryAction(
  categoryId: number,
  input: CategoryInput,
): Promise<CategoryRow[] | Refused> {
  await requireAdmin();

  return refusedOr(() => {
    updateCategory(getConnection(), categoryId, input);

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
  input: ActivityInput,
): Promise<ActivityRow[]> {
  await requireAdmin();

  createActivity(getConnection(), input);

  return listActivities(getConnection(), input.categoryId);
}

/**
 * `categoryId` is the list on screen, not `input.categoryId`: they differ when
 * the activity moves. Nothing already credited moves (D15).
 */
export async function updateActivityAction(
  categoryId: number,
  activityId: number,
  input: ActivityInput,
): Promise<ActivityRow[] | Refused> {
  await requireAdmin();

  return refusedOr(() => {
    updateActivity(getConnection(), activityId, input);

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
