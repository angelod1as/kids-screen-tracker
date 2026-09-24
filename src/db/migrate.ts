import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { openDatabase } from "./client";

/** Resolved from this file, not `cwd`. */
export const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

/** Idempotent: applies only what `__drizzle_migrations` lacks. */
export function migrateDatabase(databasePath: string) {
  const { sqlite, db } = openDatabase(databasePath);

  try {
    migrate(db, { migrationsFolder });
  } finally {
    sqlite.close();
  }
}
