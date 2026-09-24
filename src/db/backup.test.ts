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

// `existsSync` is otherwise the real implementation (see the `importOriginal`
// spread) — only the "reports a race" test below overrides it, and only for
// as many calls as it queues with `mockReturnValueOnce`.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});
const mockedExistsSync = vi.mocked(existsSync);

/**
 * `VACUUM INTO` is the whole point of #30: a plain `cp` of a database open
 * under WAL can copy the main file mid-write and hand back something that
 * fails to open. These tests hold a write transaction open on a second
 * connection while the backup runs, so a regression back to `cp` — or to any
 * approach that reads a torn snapshot — would show up as a failed
 * `integrity_check` or as the uncommitted row leaking into the backup, not
 * just as a thrown exception.
 */

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

    // A second connection with a write transaction open but not yet
    // committed, held open across the backup call — the shape of two admins
    // using the app while a backup runs.
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

    // The pre-existing file is untouched, not silently replaced.
    expect(readFileSync(destinationPath, "utf8")).toBe("not a database");
  });

  /**
   * `openDatabase` (`client.ts`) creates the file when it is missing — right
   * for `db-migrate`/`db-seed` against an empty volume, wrong here: a typo'd
   * or unmounted `DATABASE_PATH` must not "back up" a brand new, empty
   * database and report success. `backupDatabase` opens the source with
   * `fileMustExist` instead, and this is the case that would have passed
   * silently without it.
   */
  it("refuses to back up a database that does not exist", () => {
    const missingSource = join(root, "does-not-exist.db");

    expect(() => backupDatabase(missingSource, destinationPath)).toThrowError(
      /No such database/,
    );

    // Neither side effect that a silent success would have produced.
    expect(existsSync(missingSource)).toBe(false);
    expect(existsSync(destinationPath)).toBe(false);
  });

  it("gives a clear error when the destination directory does not exist", () => {
    const missingDirDestination = join(root, "no-such-subdir", "backup.db");

    expect(() =>
      backupDatabase(databasePath, missingDirDestination),
    ).toThrowError(/No such directory/);
  });

  /**
   * Two `db:backup` runs racing on the same destination can both pass the
   * `existsSync` check before either has written anything — simulated here by
   * making the destination check report "does not exist" once, then writing
   * the file itself before `VACUUM INTO` runs, standing in for the other
   * process winning the race. SQLite's own refusal is correct but does not
   * read like `backupDatabase`'s message for the same cause; this is the
   * normalization in the `catch` block of `backupDatabase`.
   */
  it("reports a race on the destination the same way as a pre-existing file", () => {
    mockedExistsSync.mockReturnValueOnce(true); // databasePath exists
    mockedExistsSync.mockReturnValueOnce(false); // destinationPath: race not visible yet
    mockedExistsSync.mockReturnValueOnce(true); // destinationDir exists
    // Calls after this point (inside the `catch`) fall back to the real
    // implementation `vi.mock` above wraps `existsSync` with.

    writeFileSync(destinationPath, "the other process won the race");

    expect(() => backupDatabase(databasePath, destinationPath)).toThrowError(
      /Refusing to overwrite existing file/,
    );
  });
});
