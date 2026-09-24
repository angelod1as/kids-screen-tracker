import { ENV } from "varlock/env";

import { migrateDatabase } from "../src/db/migrate";

/** Runs under `varlock run`, which validates the environment first. */
const databasePath = ENV.DATABASE_PATH;

migrateDatabase(databasePath);

console.log(`Migrations applied to ${databasePath}`);
