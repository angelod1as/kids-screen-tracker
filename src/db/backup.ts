import { existsSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

/**
 * `VACUUM INTO`, never `cp`: a copy of a WAL file mid-write may not open.
 * Refuses to overwrite. Not `openDatabase`, which would create a missing source.
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
    // A racing second backup can pass the check above; report it the same way.
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
