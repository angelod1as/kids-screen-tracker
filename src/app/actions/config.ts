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

/**
 * The Configuration screen's endpoints (#26, #27).
 *
 * **Every one of them is admin-only**, and `requireAdmin` rather than
 * `requireAccess` is the right guard for the same reason `listKidsAction` uses
 * it: none of these answers is about one person. A category is not Kid1's or
 * Kid2's — it is the table both of them are measured by — so there is no
 * `targetUserId` for the rule to be about, and #13's list of what `write` covers
 * names "configuração" outright. `isAllowed` gives `write` to nobody but an
 * admin either way; what `requireAdmin` avoids is inventing a user id so that a
 * guard has something to take.
 *
 * Each mutation answers with the whole list rather than with nothing. The
 * screen is a list an adult is editing in place, and a second round trip to
 * find out what he just did is a round trip in which the numbers on screen are
 * stale — including the asymptote he is calibrating against.
 */

/** Every category, switched on first (#26). */
export async function fetchCategoriesAction(): Promise<CategoryRow[]> {
  await requireAdmin();

  return listCategories(getConnection());
}

/**
 * What is waiting or running right now, so the screen can say why a field will
 * not move (D37).
 *
 * Its own endpoint rather than a field on the category list, because the two
 * answer different questions and go stale at different speeds: the list changes
 * when an adult edits it, and this changes when a boy taps *Começar*. Every
 * mutation below refetches both together.
 */
export async function fetchLocksAction(): Promise<Locks> {
  await requireAdmin();

  return currentLocks(getConnection());
}

/** Creates a category (#26). */
export async function createCategoryAction(
  input: CategoryInput,
): Promise<CategoryRow[]> {
  await requireAdmin();

  createCategory(getConnection(), input);

  return listCategories(getConnection());
}

/**
 * Corrects what a category says (#26).
 *
 * Nothing already credited moves (D15) — see `src/db/categories.ts`, which
 * reads no log and writes none.
 */
export async function updateCategoryAction(
  categoryId: number,
  input: CategoryInput,
): Promise<CategoryRow[]> {
  await requireAdmin();

  updateCategory(getConnection(), categoryId, input);

  return listCategories(getConnection());
}

/** Switches a category on or off (#26, D14). Nothing is deleted. */
export async function setCategoryActiveAction(
  categoryId: number,
  active: boolean,
): Promise<CategoryRow[]> {
  await requireAdmin();

  setCategoryActive(getConnection(), categoryId, active);

  return listCategories(getConnection());
}

/** One category's activities, switched on first (#27). */
export async function fetchActivitiesAction(
  categoryId: number,
): Promise<ActivityRow[]> {
  await requireAdmin();

  return listActivities(getConnection(), categoryId);
}

/**
 * Creates an activity (#27).
 *
 * The value that arrives is the value that is stored, whatever the category's
 * `base_rate` says (D11). The suggestion is a field the screen fills in; by the
 * time it reaches here it is a number an adult left there, and nothing on this
 * path may second-guess it.
 */
export async function createActivityAction(
  input: ActivityInput,
): Promise<ActivityRow[]> {
  await requireAdmin();

  createActivity(getConnection(), input);

  return listActivities(getConnection(), input.categoryId);
}

/**
 * Corrects what an activity says (#27).
 *
 * `categoryId` is the list the screen is looking at, and it is a parameter of
 * its own rather than `input.categoryId` — the two differ exactly when an
 * activity is being moved, and answering with the destination's list would
 * redraw the card of Mente with the activities of Criativo under it. The same
 * shape as `setActivityActiveAction` below, and for the same reason.
 *
 * Nothing already credited moves (D15) — see `src/db/activities.ts`.
 */
export async function updateActivityAction(
  categoryId: number,
  activityId: number,
  input: ActivityInput,
): Promise<ActivityRow[]> {
  await requireAdmin();

  updateActivity(getConnection(), activityId, input);

  return listActivities(getConnection(), categoryId);
}

/** Switches an activity on or off (#27, D14). Nothing is deleted. */
export async function setActivityActiveAction(
  categoryId: number,
  activityId: number,
  active: boolean,
): Promise<ActivityRow[]> {
  await requireAdmin();

  setActivityActive(getConnection(), activityId, active);

  return listActivities(getConnection(), categoryId);
}
