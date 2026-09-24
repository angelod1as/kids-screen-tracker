import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

export type Connection = {
  sqlite: Database.Database;
  db: ReturnType<typeof drizzle<typeof schema>>;
};

/**
 * The handle `writeTransaction` hands its body.
 *
 * Exported so a module can factor a step out of a transaction without either
 * opening a second one — SQLite has no nested `BEGIN IMMEDIATE` — or writing
 * this type out again.
 */
export type Transaction = Parameters<
  Parameters<Connection["db"]["transaction"]>[0]
>[0];

/**
 * How long a connection waits for a lock before giving up. Two admins using the
 * app at the same time is the normal case here, not a rare race.
 */
export const BUSY_TIMEOUT_MS = 5_000;

/**
 * The pragmas every connection is opened with, in the order they are applied.
 *
 * - **`foreign_keys`** is per connection, not per database file. It is off by
 *   default in SQLite itself, and a pragma written into a migration would apply
 *   to the connection that ran the migration and to nothing else afterwards. It
 *   also silently does nothing while a transaction is open. So it belongs
 *   exactly here: on every connection, right after opening it.
 *
 *   better-sqlite3 happens to turn it on already — verified, `new Database(...)`
 *   reports `foreign_keys = 1` with no pragma at all. Setting it anyway is the
 *   difference between a guarantee this project makes and a default a
 *   dependency happens to have today; `sqlite3` on the command line, for one,
 *   opens the same file with foreign keys off.
 * - **`journal_mode = WAL`** is what lets a reader and a writer coexist. With
 *   the default rollback journal, measured on this schema: an open read
 *   transaction on one connection blocks a write on another for the whole busy
 *   timeout and then fails it with `SQLITE_BUSY`. Two admins with the app open,
 *   one reading the queue and one approving, is exactly that shape. WAL is a
 *   property of the file rather than of the connection, but asking for it on
 *   every open is what makes it true for a file created by other tooling.
 * - **`busy_timeout`** is 5000 ms in better-sqlite3 by default too. Same
 *   argument as `foreign_keys`: written down it is a decision, left out it is a
 *   dependency default that can move.
 * - **`synchronous = FULL`** is here *because* of WAL, not despite it. SQLite
 *   keeps a separate compile-time default for a database already in WAL
 *   (`SQLITE_DEFAULT_WAL_SYNCHRONOUS`), and this build sets it to `NORMAL`.
 *   Measured: a fresh connection to a fresh file reports `synchronous = 2`, and
 *   a fresh connection to that same file once it is in WAL reports `1`. Every
 *   connection the app opens after the first one is the second case, so turning
 *   WAL on quietly pays for write throughput with durability. Under `NORMAL` a
 *   power cut can lose the last committed transactions without corrupting the
 *   file — here that is an approval the boy watched land being gone the next
 *   morning. This database takes a handful of writes a day; there is nothing
 *   worth buying with that trade.
 */
export const CONNECTION_PRAGMAS = [
  "foreign_keys = ON",
  "journal_mode = WAL",
  `busy_timeout = ${BUSY_TIMEOUT_MS}`,
  "synchronous = FULL",
] as const;

/**
 * Opens `databasePath`, creating the directory above it when it is missing so a
 * first run against an empty volume works, and applies `CONNECTION_PRAGMAS`.
 *
 * This module deliberately takes the path as an argument and never reads `ENV`:
 * the migration CLI and the tests both open databases of their own, and a
 * module that resolves the environment at import time cannot be loaded by
 * either.
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
 * Runs `body` in a transaction that takes the write lock at `BEGIN`.
 *
 * Every write this app makes reads first — an approval reads the day's bucket
 * before it writes the log and the ledger row. `drizzle-orm/better-sqlite3`
 * emits `BEGIN DEFERRED` by default, which starts such a transaction as a
 * reader and only asks for the write lock at the first `INSERT`. SQLite refuses
 * to upgrade a reader that another writer has overtaken, and it refuses
 * **immediately**: `busy_timeout` does not apply to that upgrade, so the
 * approval dies in milliseconds instead of waiting its turn. Measured on this
 * schema before this existed: `SQLITE_BUSY` after 5 ms.
 *
 * `BEGIN IMMEDIATE` asks for the write lock up front, which is the one thing
 * `busy_timeout` does cover. The second admin waits and then commits.
 */
export function writeTransaction<T>(
  connection: Connection,
  body: (tx: Transaction) => T,
): T {
  return connection.db.transaction(body, { behavior: "immediate" });
}
