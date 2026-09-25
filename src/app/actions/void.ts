"use server";

import { requireAdmin } from "../../auth/guard";
import { getConnection } from "../../db";
import type { Refused } from "../../db/refusal";
import { refusedOr } from "../../db/refusal";
import type { VoidTarget } from "../../db/voiding";
import { voidEntry } from "../../db/voiding";
import { fetchBalanceAction } from "./balance";

/** D52. The boy is read off the entry, never taken from the request. */
export async function voidEntryAction(
  target: VoidTarget,
): Promise<{ balance: number } | Refused> {
  const session = await requireAdmin();

  const result = refusedOr(() =>
    voidEntry(getConnection(), target, session.userId, new Date()),
  );

  if ("refused" in result) {
    return result;
  }

  return { balance: await fetchBalanceAction(result.userId) };
}
