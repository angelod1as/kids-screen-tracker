import { ENV } from "varlock/env";

import { openDatabase } from "./client";

/**
 * The application's connection to the database named by `DATABASE_PATH`.
 *
 * **Server-side only.** Never import this, or anything else that reads `ENV`,
 * from a `"use client"` file: such a component compiles and builds with exit 0,
 * and Varlock only notices the leak on the first request — where its answer is
 * to kill the process, not to fail the route. The error would sail through a
 * green CI and take the app down on the first visit.
 *
 * Opened once per process and reused. Node keeps one module instance per
 * worker, and better-sqlite3 is synchronous, so a single handle is both correct
 * and the fastest thing on offer.
 */
let connection: ReturnType<typeof openDatabase> | undefined;

/**
 * The whole connection, which is what `writeTransaction` takes.
 *
 * A transaction has to be started on the connection rather than on the query
 * builder, and `BEGIN IMMEDIATE` is the reason the difference matters — see
 * `writeTransaction` in `./client`. Handing out `db` alone would leave every
 * caller that writes to reach for `db.transaction(...)` and choose the
 * behaviour again, which is the same decision written in two places.
 */
export function getConnection() {
  connection ??= openDatabase(ENV.DATABASE_PATH);

  return connection;
}

/** The query builder, for everything that only reads. */
export function getDb() {
  return getConnection().db;
}
