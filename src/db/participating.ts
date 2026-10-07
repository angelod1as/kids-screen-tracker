import { gt } from "drizzle-orm";

import type { Connection, Transaction } from "./client";
import { categories } from "./schema";

type Db = Connection["db"] | Transaction;

/**
 * `CalculationInput.participatingCategoryIds`: the categories that take the
 * alternation bonus (pct > 0), read live like the rest of the table (D56).
 */
export function participatingCategoryIds(db: Db): number[] {
  return db
    .select({ id: categories.id })
    .from(categories)
    .where(gt(categories.alternationBonusPct, 0))
    .all()
    .map((row) => row.id);
}
