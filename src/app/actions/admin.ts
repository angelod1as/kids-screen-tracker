"use server";

import { and, asc, eq } from "drizzle-orm";

import { requireAccess, requireAdmin } from "../../auth/guard";
import { getConnection, getDb } from "../../db";
import type { EntryPreview, LaunchResult, NewEntry } from "../../db/admin";
import { launchEntry, previewEntry } from "../../db/admin";
import { activities, categories } from "../../db/schema";
import type { EngineActivity } from "../../engine/calculate";
import { saoPauloDay } from "../../engine/calculate";
import { fetchBalanceAction } from "./balance";

/**
 * Launching an activity in a boy's name (#22): the pickers, the preview, and
 * the write.
 *
 * **Every one of them is admin-only, and the guard says so with the boy's id in
 * its hand.** `write` is the kind #13 created for exactly this list — "aprovar,
 * lançar, liberar, estornar, configuração" — and `isAllowed` gives it to nobody
 * but an admin. A kid who forges the POST is refused whichever boy's
 * id he puts in it, including his own, and `admin.test.ts` sends both requests.
 *
 * The preview is guarded the same way, on purpose. It is not a read of the
 * boy's data in the sense `view` is about: it is the answer to "what would this
 * pay", asked with a date and a duration nobody has done yet, and the boy has
 * his own screen for that question (#17) with its own rules about whose day it
 * may run against.
 */

/** One activity as the launch screen offers it (#22). */
export type LaunchActivity = EngineActivity & {
  categoryName: string;
};

/** Everything the launch screen needs to draw its pickers (#22). */
export type LaunchData = {
  activities: LaunchActivity[];
  /** D13: today in São Paulo, decided on the server, for the date field. */
  today: string;
};

/** What the launch screen shows once the entry has landed (#22). */
export type Movement = {
  hours: number;
  /** The boy's balance with the entry in it. */
  balance: number;
};

/**
 * The activities an adult may launch, and today's date.
 *
 * Wider than the boy's calculator in one way and narrower in none: `free` is
 * included, because Curinga's "Atividade avulsa" is D12's escape hatch and this
 * is the only screen that can type the value it needs. Inactive activities and
 * activities hanging off an inactive category are out (D14) — and out of the
 * endpoint too (D33), which is the half that matters.
 */
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

/**
 * What launching this entry would credit, before anything is written (#22).
 *
 * The number on screen before the tap, and never the number that is written:
 * `launchEntryAction` computes it again inside its own transaction. See the
 * module docstring of `src/db/admin.ts`.
 */
export async function previewEntryAction(
  entry: NewEntry,
): Promise<EntryPreview> {
  await requireAccess({ kind: "write", targetUserId: entry.userId });

  return previewEntry(getConnection(), entry, new Date());
}

/** Launches the entry, born approved, with its ledger row (#22, D18). */
export async function launchEntryAction(
  entry: NewEntry,
): Promise<LaunchResult & Movement> {
  const session = await requireAccess({
    kind: "write",
    targetUserId: entry.userId,
  });

  const result = launchEntry(
    getConnection(),
    entry,
    session.userId,
    new Date(),
  );

  return { ...result, balance: await fetchBalanceAction(entry.userId) };
}
