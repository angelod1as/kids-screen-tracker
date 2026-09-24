import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BUSY_TIMEOUT_MS,
  CONNECTION_PRAGMAS,
  openDatabase,
  writeTransaction,
} from "./client";
import { migrateDatabase } from "./migrate";
import { users } from "./schema";

/**
 * The connection, not the schema: which pragmas every handle is opened with,
 * and whether two of them can work on the same file at the same time — which is
 * the normal case here, two admins with the app open.
 */

let root: string;
let databasePath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-client-"));
  databasePath = join(root, "data", "kids.db");
  migrateDatabase(databasePath);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("connection pragmas", () => {
  it("reports the pragmas the app depends on", () => {
    const { sqlite } = openDatabase(databasePath);

    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(sqlite.pragma("busy_timeout", { simple: true })).toBe(
      BUSY_TIMEOUT_MS,
    );
    // 2 is FULL. A connection opened on a file that is already in WAL starts
    // at 1 (NORMAL) unless something asks otherwise, and every connection but
    // the very first is that connection.
    expect(sqlite.pragma("synchronous", { simple: true })).toBe(2);

    sqlite.close();
  });

  /**
   * `journal_mode` and `busy_timeout` are provable from their effect: WAL is
   * not the SQLite default and the concurrency tests below go red without it.
   * `foreign_keys` is not, and saying so is the point of this test.
   *
   * better-sqlite3 compiles SQLite with `SQLITE_DEFAULT_FOREIGN_KEYS=1`, so a
   * connection it opens reports `foreign_keys = 1` whether or not this project
   * asks for it. Deleting the line from `openDatabase` changes no observable
   * behaviour of any database this driver opens — measured: the whole suite
   * stayed green with it removed. There is no behavioural test that can fail,
   * because there is no behaviour to observe until the day the driver changes
   * its default, which is precisely the day the line starts mattering.
   *
   * So this asserts the call itself. It is the only assertion in the file that
   * looks at how `openDatabase` works rather than at what it produces, and it
   * exists because the alternative is a test that passes with the guarantee
   * deleted.
   */
  it("issues every pragma itself instead of inheriting a driver default", () => {
    const pragma = vi.spyOn(Database.prototype, "pragma");

    const { sqlite } = openDatabase(databasePath);

    // Written out literally rather than compared against CONNECTION_PRAGMAS:
    // a test that reads the list it is checking moves with the sabotage and
    // stays green when a line is deleted from it.
    expect(pragma.mock.calls.map(([source]) => source)).toEqual([
      "foreign_keys = ON",
      "journal_mode = WAL",
      "busy_timeout = 5000",
      "synchronous = FULL",
    ]);
    expect([...CONNECTION_PRAGMAS]).toEqual(
      pragma.mock.calls.map(([source]) => source),
    );

    pragma.mockRestore();
    sqlite.close();
  });

  /**
   * The complement of the test above: the day this goes red is the day the
   * driver stops turning foreign keys on for us and `openDatabase`'s pragma
   * becomes the only thing holding the twelve `ON DELETE RESTRICT` clauses up.
   */
  it("does not rely on the driver default being what it is today", () => {
    const raw = new Database(databasePath);

    expect(raw.pragma("foreign_keys", { simple: true })).toBe(1);

    raw.close();
  });
});

describe("two connections on the same file", () => {
  it("lets one connection write while another holds an open read transaction", () => {
    const admin1 = openDatabase(databasePath);
    const admin2 = openDatabase(databasePath);

    // Admin2 has the pending queue open: a read transaction, still uncommitted.
    admin2.sqlite.prepare("begin").run();
    admin2.sqlite.prepare("select count(*) from users").get();

    // Under the default rollback journal this blocks for the whole busy
    // timeout and then throws SQLITE_BUSY. Under WAL it just writes.
    const startedAt = Date.now();
    admin1.sqlite
      .prepare(
        "insert into users (username, display_name, role) values ('admin1', 'Admin1', 'admin')",
      )
      .run();
    expect(Date.now() - startedAt).toBeLessThan(BUSY_TIMEOUT_MS);

    admin2.sqlite.prepare("rollback").run();
    admin1.sqlite.close();
    admin2.sqlite.close();
  });

  it("takes the write lock at BEGIN, so a second writer waits instead of racing", () => {
    const admin1 = openDatabase(databasePath);
    const admin2 = openDatabase(databasePath);
    // Do not wait for the lock: this test is about who holds it, not about how
    // long the loser is willing to queue.
    admin2.sqlite.pragma("busy_timeout = 0");

    const write = () =>
      admin2.sqlite
        .prepare(
          "insert into users (username, display_name, role) values ('admin2', 'Admin2', 'admin')",
        )
        .run();

    writeTransaction(admin1, (tx) => {
      // Before the transaction has written anything at all, the lock is
      // already Admin1's. With BEGIN DEFERRED it would not be, and Admin2 would
      // slip a write in between Admin1's read and Admin1's write.
      tx.select().from(users).all();
      expect(write).toThrowError(/database is locked/);
    });

    // Once Admin1 commits, Admin2 gets his turn.
    expect(write).not.toThrow();

    admin1.sqlite.close();
    admin2.sqlite.close();
  });

  it("makes the deferred default lose that same race", () => {
    const admin1 = openDatabase(databasePath);
    const admin2 = openDatabase(databasePath);
    admin2.sqlite.pragma("busy_timeout = 0");

    // The control for the test above: drizzle's default transaction starts as
    // a reader, so Admin2 is free to write while Admin1 is mid-transaction.
    admin1.db.transaction((tx) => {
      tx.select().from(users).all();
      expect(() =>
        admin2.sqlite
          .prepare(
            "insert into users (username, display_name, role) values ('admin2', 'Admin2', 'admin')",
          )
          .run(),
      ).not.toThrow();
    });

    admin1.sqlite.close();
    admin2.sqlite.close();
  });
});
