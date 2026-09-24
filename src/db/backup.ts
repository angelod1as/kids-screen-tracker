import { existsSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

/**
 * Writes a consistent copy of `databasePath` to `destinationPath`.
 *
 * Uses `VACUUM INTO`, SQLite's own online-backup mechanism, instead of copying
 * the file: a plain `cp` of a database that is being written to — this one runs
 * under WAL (`journal_mode = WAL` in `client.ts`) with two admins possibly
 * connected at once — can copy the main file mid-write and produce a file that
 * fails to open. `VACUUM INTO` reads a single consistent snapshot through
 * SQLite's own MVCC and writes it out as a new, independent database file, so a
 * concurrent writer never corrupts it.
 *
 * Refuses to run when `destinationPath` already exists rather than overwriting
 * it, so a mistyped path never destroys a previous backup.
 *
 * Opens the source with `better-sqlite3` directly rather than `openDatabase`
 * (`client.ts`): that helper creates the file when it is missing, which is
 * exactly right for a first run against an empty volume but exactly wrong
 * here — a wrong `DATABASE_PATH` would otherwise "back up" a brand new, empty
 * database and report success. Also skips `openDatabase`'s pragmas, which
 * this one-shot connection has no use for.
 */
export function backupDatabase(databasePath: string, destinationPath: string) {
  if (!existsSync(databasePath)) {
    throw new Error(`No such database: ${databasePath}`);
  }

  if (existsSync(destinationPath)) {
    throw new Error(`Refusing to overwrite existing file: ${destinationPath}`);
  }

  const destinationDir = dirname(destinationPath);
  if (!existsSync(destinationDir)) {
    throw new Error(`No such directory: ${destinationDir}`);
  }

  const sqlite = new Database(databasePath, { fileMustExist: true });

  try {
    sqlite.prepare("VACUUM INTO ?").run(destinationPath);
  } catch (error) {
    // A second `db:backup` racing on the same destination can slip past the
    // `existsSync` check above before either has written anything — SQLite
    // itself then refuses the losing side ("output file already exists" or
    // "file is not a database", depending on how far the winner got), which
    // is accurate but does not read like the message above for the same
    // cause. Once the destination is confirmed to exist, report it the same
    // way regardless of which side of the race threw.
    if (existsSync(destinationPath)) {
      throw new Error(
        `Refusing to overwrite existing file: ${destinationPath}`,
      );
    }
    throw error;
  } finally {
    sqlite.close();
  }
}
