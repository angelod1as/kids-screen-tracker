import { ENV } from "varlock/env";

import { openDatabase } from "../src/db/client";
import { migrateDatabase } from "../src/db/migrate";
import { seedDatabase } from "../src/db/seed";

/**
 * Migrates first so one command is enough on an empty volume; both halves are
 * idempotent. Runs under `varlock run`.
 */
const databasePath = ENV.DATABASE_PATH;

migrateDatabase(databasePath);

const connection = openDatabase(databasePath);

try {
  const inserted = seedDatabase(connection);

  console.log(
    `Seed applied to ${databasePath} — inserted ` +
      `${inserted.categories} categories, ${inserted.activities} activities.`,
  );
} finally {
  connection.sqlite.close();
}
