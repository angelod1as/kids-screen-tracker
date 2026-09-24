import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

export type Connection = {
  sqlite: Database.Database;
  db: ReturnType<typeof drizzle<typeof schema>>;
};

/** Exported so a step can be factored out without a nested `BEGIN IMMEDIATE`. */
export type Transaction = Parameters<
  Parameters<Connection["db"]["transaction"]>[0]
>[0];

/** Two admins at once is the normal case here, not a rare race. */
export const BUSY_TIMEOUT_MS = 5_000;

/**
 * Per connection, in order. `foreign_keys` and `busy_timeout` are set even
 * where better-sqlite3 defaults them: a decision, not a dependency default.
 * WAL lets a reader and a writer coexist; `FULL` because WAL defaults to `NORMAL`.
 */
export const CONNECTION_PRAGMAS = [
  "foreign_keys = ON",
  "journal_mode = WAL",
  `busy_timeout = ${BUSY_TIMEOUT_MS}`,
  "synchronous = FULL",
] as const;

/**
 * Creates the directory for a first run. Takes the path, never `ENV`, so the
 * tests and the CLI can load it.
 */
export function openDatabase(databasePath: string): Connection {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const sqlite = new Database(databasePath);
  for (const pragma of CONNECTION_PRAGMAS) {
    sqlite.pragma(pragma);
  }

  return { sqlite, db: drizzle(sqlite, { schema }) };
}

/**
 * `BEGIN IMMEDIATE`: every write reads first, and a deferred reader's upgrade
 * fails at once with `SQLITE_BUSY`, ignoring `busy_timeout`.
 */
export function writeTransaction<T>(
  connection: Connection,
  body: (tx: Transaction) => T,
): T {
  return connection.db.transaction(body, { behavior: "immediate" });
}
