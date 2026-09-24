import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backupDatabase } from "./backup";
import { openDatabase } from "./client";
import { migrateDatabase } from "./migrate";

// Real `existsSync` except where the race test queues `mockReturnValueOnce`.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});
const mockedExistsSync = vi.mocked(existsSync);

/** An open write transaction runs across the backup, so a torn snapshot shows. */

let root: string;
let databasePath: string;
let destinationPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-backup-"));
  databasePath = join(root, "data", "kids.db");
  destinationPath = join(root, "backup.db");
  migrateDatabase(databasePath);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function insertUser(sqlite: Database.Database, username: string) {
  sqlite
    .prepare(
      "insert into users (username, display_name, role) values (?, ?, 'admin')",
    )
    .run(username, username);
}

describe("backupDatabase", () => {
  it("captures committed rows and excludes a concurrent, uncommitted write", () => {
    const committed = openDatabase(databasePath);
    insertUser(committed.sqlite, "admin1");
    insertUser(committed.sqlite, "admin2");

    // Two admins writing while the backup runs.
    const inFlight = openDatabase(databasePath);
    inFlight.sqlite.prepare("begin immediate").run();
    insertUser(inFlight.sqlite, "kid1");

    backupDatabase(databasePath, destinationPath);

    inFlight.sqlite.prepare("rollback").run();
    committed.sqlite.close();
    inFlight.sqlite.close();

    const backup = new Database(destinationPath);
    try {
      expect(backup.pragma("integrity_check", { simple: true })).toBe("ok");

      const usernames = backup
        .prepare("select username from users order by username")
        .all()
        .map((row) => (row as { username: string }).username);
      expect(usernames).toEqual(["admin1", "admin2"]);
    } finally {
      backup.close();
    }
  });

  it("refuses to overwrite an existing destination file", () => {
    writeFileSync(destinationPath, "not a database");

    expect(() => backupDatabase(databasePath, destinationPath)).toThrowError(
      /Refusing to overwrite/,
    );

    expect(readFileSync(destinationPath, "utf8")).toBe("not a database");
  });

  /** A mistyped `DATABASE_PATH` must not back up a brand new empty database. */
  it("refuses to back up a database that does not exist", () => {
    const missingSource = join(root, "does-not-exist.db");

    expect(() => backupDatabase(missingSource, destinationPath)).toThrowError(
      /No such database/,
    );

    expect(existsSync(missingSource)).toBe(false);
    expect(existsSync(destinationPath)).toBe(false);
  });

  it("gives a clear error when the destination directory does not exist", () => {
    const missingDirDestination = join(root, "no-such-subdir", "backup.db");

    expect(() =>
      backupDatabase(databasePath, missingDirDestination),
    ).toThrowError(/No such directory/);
  });

  /** Simulates losing the race to another `db:backup`, for the `catch`'s message. */
  it("reports a race on the destination the same way as a pre-existing file", () => {
    mockedExistsSync.mockReturnValueOnce(true); // databasePath exists
    mockedExistsSync.mockReturnValueOnce(false); // destinationPath: race not visible yet
    mockedExistsSync.mockReturnValueOnce(true); // destinationDir exists

    writeFileSync(destinationPath, "the other process won the race");

    expect(() => backupDatabase(databasePath, destinationPath)).toThrowError(
      /Refusing to overwrite existing file/,
    );
  });
});
