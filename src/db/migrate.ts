import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { openDatabase } from "./client";

/**
 * Where `drizzle-kit generate` writes the SQL. Resolved from this file rather
 * than from `process.cwd()`, so `pnpm db:migrate` behaves the same whichever
 * directory it is invoked from.
 */
export const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

/**
 * Brings `databasePath` up to the latest migration, creating the file and the
 * directory above it if they do not exist yet.
 *
 * The migrator is idempotent: it reads the `__drizzle_migrations` table and
 * applies only what is missing, so running it against an existing database is
 * safe and running it against an empty directory builds the schema from zero.
 */
export function migrateDatabase(databasePath: string) {
  const { sqlite, db } = openDatabase(databasePath);

  try {
    migrate(db, { migrationsFolder });
  } finally {
    sqlite.close();
  }
}
