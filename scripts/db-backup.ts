import { ENV } from "varlock/env";

import { backupDatabase } from "../src/db/backup";

/** Runs under `varlock run`, which validates the environment first. */
const destinationPath = process.argv[2];

if (!destinationPath) {
  console.error("Usage: db-backup <destination-path>");
  process.exit(1);
}

const databasePath = ENV.DATABASE_PATH;

backupDatabase(databasePath, destinationPath);

console.log(`Backup of ${databasePath} written to ${destinationPath}`);
