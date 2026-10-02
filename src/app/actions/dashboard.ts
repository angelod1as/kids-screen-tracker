"use server";

import { and, asc, eq } from "drizzle-orm";

import { requireAdmin } from "../../auth/guard";
import { getConnection } from "../../db";
import type { Dashboard } from "../../db/dashboard";
import { readDashboard } from "../../db/dashboard";
import { requireActiveKid } from "../../db/people";
import { users } from "../../db/schema";
import { saoPauloDay, shiftDate } from "../../engine/calculate";

export type DashboardPeriod = "4w" | "all";

/** Four weeks, today included. */
const RECENT_DAYS = 28;

/** #9: admin only. The boys' numbers side by side are never a kid's to read. */
export async function fetchDashboardAction(request: {
  kidId: number | null;
  period: DashboardPeriod;
}): Promise<Dashboard> {
  await requireAdmin();

  const connection = getConnection();
  // D33: the id comes from a URL; an admin's or a deactivated one is refused.
  if (request.kidId !== null) requireActiveKid(connection.db, request.kidId);

  const kidIds =
    request.kidId !== null
      ? [request.kidId]
      : connection.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.role, "kid"), eq(users.active, true)))
          .orderBy(asc(users.id))
          .all()
          .map((row) => row.id);

  const to = saoPauloDay(new Date());

  return readDashboard(connection, {
    kidIds,
    from: request.period === "4w" ? shiftDate(to, 1 - RECENT_DAYS) : null,
    to,
  });
}
