import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ENV } from "varlock/env";

import { openDatabase } from "../src/db/client";
import { migrateDatabase, migrationsFolder } from "../src/db/migrate";

/** Runs under `varlock run`, which validates the environment first. */
const databasePath = ENV.DATABASE_PATH;

migrateDatabase(databasePath);

// Both counts, so the deploy log alone shows the real database is current (#23).
const shipped: number = JSON.parse(
  readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
).entries.length;
const { sqlite } = openDatabase(databasePath);
const { applied } = sqlite
  .prepare("select count(*) as applied from __drizzle_migrations")
  .get() as { applied: number };
sqlite.close();

console.log(
  `Migrations applied to ${databasePath}: ${applied} in the database, ${shipped} in this image`,
);
