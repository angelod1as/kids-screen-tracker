import { ENV } from "varlock/env";

import { openDatabase } from "../src/db/client";
import { clearDemoData, countDemoRows, seedDemoData } from "../src/db/demo";
import { migrateDatabase } from "../src/db/migrate";
import { saoPauloDay } from "../src/engine/calculate";

/**
 * Temporary demo data, deliberately outside `pnpm db:seed`, which runs in
 * production (docs/demo-data.md). `--clear` deletes by the `DEMO_NOTE` stamp
 * alone, so a real approval is never touched.
 */
const databasePath = ENV.DATABASE_PATH;
const clearing = process.argv.includes("--clear");

migrateDatabase(databasePath);

const connection = openDatabase(databasePath);

try {
  if (clearing) {
    const removed = clearDemoData(connection);

    console.log(
      `Demo data removed from ${databasePath} — ${removed.logs} logs ` +
        `and ${removed.ledger} ledger rows.`,
    );
  } else {
    const written = seedDemoData(connection, saoPauloDay(new Date()));

    console.log(
      `Demo data written to ${databasePath} — ${written.logs} logs ` +
        `and ${written.ledger} ledger rows.`,
    );
    console.log("Remove it with `pnpm db:demo:clear`.");
  }

  const remaining = countDemoRows(connection);
  console.log(
    `Demo rows now in the database: ${remaining.logs} logs ` +
      `and ${remaining.ledger} ledger rows.`,
  );
} finally {
  connection.sqlite.close();
}
