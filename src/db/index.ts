import { ENV } from "varlock/env";

import { openDatabase } from "./client";

/**
 * Server-side only: `ENV` imported from a `"use client"` file builds green and
 * Varlock kills the process on the first request. One handle per process.
 */
let connection: ReturnType<typeof openDatabase> | undefined;

/** The whole connection, because `writeTransaction` needs it (`BEGIN IMMEDIATE`). */
export function getConnection() {
  connection ??= openDatabase(ENV.DATABASE_PATH);

  return connection;
}

/** For reads. */
export function getDb() {
  return getConnection().db;
}
