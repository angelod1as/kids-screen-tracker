import { ENV } from "varlock/env";

import {
  auditDisabledActivities,
  deleteNeverUsedActivities,
} from "../src/db/activity-audit";
import { openDatabase } from "../src/db/client";
import { migrateDatabase } from "../src/db/migrate";

/**
 * #83 one-shot: audits the switched-off activities, then with `--delete` removes
 * the ones nothing points at (D14 emenda). Audit always prints first, so the run
 * shows what it is about to delete.
 */
const databasePath = ENV.DATABASE_PATH;
const deleting = process.argv.includes("--delete");

migrateDatabase(databasePath);

const connection = openDatabase(databasePath);

try {
  const audit = auditDisabledActivities(connection);

  console.log(`Disabled activities in ${databasePath}: ${audit.length}`);
  for (const row of audit) {
    const safe = row.logCount === 0 && row.timerCount === 0;
    console.log(
      `  #${row.id} ${row.name} — ${row.logCount} logs, ` +
        `${row.timerCount} timers${safe ? " — deletable" : ""}`,
    );
  }

  if (!deleting) {
    const deletable = audit.filter(
      (row) => row.logCount === 0 && row.timerCount === 0,
    ).length;
    console.log(
      `${deletable} never-used; run with \`--delete\` to remove them.`,
    );
  } else {
    const removed = deleteNeverUsedActivities(connection);
    console.log(`Deleted ${removed.length} never-used disabled activities:`);
    for (const row of removed) {
      console.log(`  #${row.id} ${row.name}`);
    }
  }
} finally {
  connection.sqlite.close();
}
