"use server";

import { and, asc, eq } from "drizzle-orm";

import { requireAccess, requireAdmin } from "../../auth/guard";
import { getConnection, getDb } from "../../db";
import type { EntryPreview, LaunchResult, NewEntry } from "../../db/admin";
import { launchEntry, previewEntry } from "../../db/admin";
import type { Refused } from "../../db/refusal";
import { refusedOr } from "../../db/refusal";
import { activities, categories } from "../../db/schema";
import type { EngineActivity } from "../../engine/calculate";
import { saoPauloDay } from "../../engine/calculate";
import { fetchBalanceAction } from "./balance";

/**
 * `write` (#13), so a kid's forged POST is refused for any boy's id. The preview
 * is guarded the same way: the boy asks "what would this pay" on his own screen.
 */

export type LaunchActivity = EngineActivity & {
  categoryName: string;
};

export type LaunchData = {
  activities: LaunchActivity[];
  /** D13: today in São Paulo, decided on the server, for the date field. */
  today: string;
};

export type Movement = {
  hours: number;
  /** The boy's balance with the entry in it. */
  balance: number;
};

/** `free` is in: this is the only screen that can type its value (D12). Inactive is out here and at the endpoint (D14, D33). */
export async function fetchLaunchDataAction(): Promise<LaunchData> {
  await requireAdmin();

  const rows = getDb()
    .select({
      id: activities.id,
      categoryId: activities.categoryId,
      name: activities.name,
      calcMode: activities.calcMode,
      value: activities.value,
      qualityGraded: activities.qualityGraded,
      repeatCooldownDays: activities.repeatCooldownDays,
      categoryName: categories.name,
    })
    .from(activities)
    .innerJoin(categories, eq(activities.categoryId, categories.id))
    .where(and(eq(activities.active, true), eq(categories.active, true)))
    .orderBy(
      asc(categories.sortOrder),
      asc(categories.id),
      asc(activities.sortOrder),
      asc(activities.id),
    )
    .all();

  return { activities: rows, today: saoPauloDay(new Date()) };
}

/** The number before the tap, never the one written: `launchEntryAction` recomputes in its transaction. */
export async function previewEntryAction(
  entry: NewEntry,
): Promise<EntryPreview> {
  await requireAccess({ kind: "write", targetUserId: entry.userId });

  return previewEntry(getConnection(), entry, new Date());
}

/** D18: born approved, with its ledger row. D32's refusal is returned, not thrown. */
export async function launchEntryAction(
  entry: NewEntry,
): Promise<(LaunchResult & Movement) | Refused> {
  const session = await requireAccess({
    kind: "write",
    targetUserId: entry.userId,
  });

  const result = refusedOr(() =>
    launchEntry(getConnection(), entry, session.userId, new Date()),
  );

  if ("refused" in result) {
    return result;
  }

  return { ...result, balance: await fetchBalanceAction(entry.userId) };
}
