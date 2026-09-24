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

/** Pragmas, and two handles on one file at once: two admins is the normal case. */

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
    // 2 is FULL; a connection to a file already in WAL starts at 1 (NORMAL).
    expect(sqlite.pragma("synchronous", { simple: true })).toBe(2);

    sqlite.close();
  });

  /**
   * Asserts the call itself: better-sqlite3 turns foreign keys on by default,
   * so no behavioural test fails with the line deleted.
   */
  it("issues every pragma itself instead of inheriting a driver default", () => {
    const pragma = vi.spyOn(Database.prototype, "pragma");

    const { sqlite } = openDatabase(databasePath);

    // Literal, not `CONNECTION_PRAGMAS`: a test reading its own input moves with the sabotage.
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

  /** Goes red the day the driver stops turning foreign keys on for us. */
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

    // Admin2 has the queue open: an uncommitted read transaction.
    admin2.sqlite.prepare("begin").run();
    admin2.sqlite.prepare("select count(*) from users").get();

    // The rollback journal would block, then throw SQLITE_BUSY.
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
    // About who holds the lock, not how long the loser queues.
    admin2.sqlite.pragma("busy_timeout = 0");

    const write = () =>
      admin2.sqlite
        .prepare(
          "insert into users (username, display_name, role) values ('admin2', 'Admin2', 'admin')",
        )
        .run();

    writeTransaction(admin1, (tx) => {
      // Admin1 holds the lock before writing; BEGIN DEFERRED would let Admin2 in.
      tx.select().from(users).all();
      expect(write).toThrowError(/database is locked/);
    });

    expect(write).not.toThrow();

    admin1.sqlite.close();
    admin2.sqlite.close();
  });

  it("makes the deferred default lose that same race", () => {
    const admin1 = openDatabase(databasePath);
    const admin2 = openDatabase(databasePath);
    admin2.sqlite.pragma("busy_timeout = 0");

    // The control: drizzle's default transaction starts as a reader.
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
