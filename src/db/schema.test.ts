import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "./client";
import { migrateDatabase } from "./migrate";
import {
  activities,
  activityLogs,
  categories,
  ledger,
  regimes,
  timers,
  users,
} from "./schema";

/**
 * Every test here runs against a database built the way production builds one:
 * `pnpm db:migrate` on an empty directory, then a connection from
 * `openDatabase`. Nothing is created with `CREATE TABLE` inline, so the
 * committed migration is what is under test and not a second copy of the DDL.
 */

let root: string;
let databasePath: string;
let connection: ReturnType<typeof openDatabase>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-"));
  // Two levels below an empty directory: the migration has to create the path,
  // not just the file.
  databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);
  connection = openDatabase(databasePath);
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

/** The rows the foreign keys need before anything interesting can be inserted. */
function seedMinimum() {
  const { db } = connection;

  const [admin] = db
    .insert(users)
    .values({ username: "admin1", displayName: "Admin1", role: "admin" })
    .returning()
    .all();
  const [kid] = db
    .insert(users)
    .values({ username: "kid1", displayName: "Kid1", role: "kid" })
    .returning()
    .all();
  const [category] = db
    .insert(categories)
    .values({ name: "Mente", baseRate: 2, decayStepHours: 1 })
    .returning()
    .all();
  if (!admin || !kid || !category) throw new Error("insert returned no row");

  const [activity] = db
    .insert(activities)
    .values({
      categoryId: category.id,
      name: "Ler livro",
      calcMode: "duration",
      value: 2,
      maxSessionMinutes: 120,
    })
    .returning()
    .all();
  if (!activity) throw new Error("insert returned no row");

  return { admin, kid, category, activity };
}

describe("migrations", () => {
  it("builds the seven tables from zero in an empty directory", () => {
    const names = connection.sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(names).toEqual([
      "activities",
      "activity_logs",
      "categories",
      "ledger",
      "regimes",
      "timers",
      "users",
    ]);
  });

  it("is idempotent — running it again applies nothing and keeps the data", () => {
    const { kid } = seedMinimum();

    migrateDatabase(databasePath);

    const stillThere = connection.db.select().from(users).all();
    expect(stillThere.map((row) => row.username)).toContain(kid.username);
  });
});

describe("foreign keys", () => {
  // The connection's pragmas, including `foreign_keys`, are covered in
  // `client.test.ts`. The test that used to live here asserted
  // `pragma("foreign_keys") === 1` and passed with the pragma deleted from
  // `openDatabase`, because better-sqlite3 turns it on by itself — it measured
  // the driver's default and read as if it measured this project's guarantee.
  // What is left here is the part of that guarantee the DDL owns: the four
  // tests below all go red when the FOREIGN KEY clauses come out of the
  // migration.

  it("rejects a log pointing at a user that does not exist", () => {
    const { admin, activity } = seedMinimum();

    expect(() =>
      connection.db
        .insert(activityLogs)
        .values({
          userId: 9999,
          activityId: activity.id,
          source: "admin",
          occurredOn: "2026-03-14",
          createdBy: admin.id,
        })
        .run(),
    ).toThrowError(/FOREIGN KEY constraint failed/);
  });

  it("rejects a ledger row pointing at an activity log that does not exist", () => {
    const { admin, kid } = seedMinimum();

    expect(() =>
      connection.db
        .insert(ledger)
        .values({
          userId: kid.id,
          kind: "earn",
          hours: 2,
          occurredOn: "2026-03-14",
          activityLogId: 9999,
          createdBy: admin.id,
        })
        .run(),
    ).toThrowError(/FOREIGN KEY constraint failed/);
  });

  it("rejects a timer pointing at an activity that does not exist", () => {
    const { kid } = seedMinimum();

    expect(() =>
      connection.db
        .insert(timers)
        .values({
          userId: kid.id,
          activityId: 9999,
          startedAt: new Date("2026-03-14T18:00:00Z"),
          status: "running",
        })
        .run(),
    ).toThrowError(/FOREIGN KEY constraint failed/);
  });

  it("refuses to delete a category an activity still points at (D14)", () => {
    const { category } = seedMinimum();

    expect(() =>
      connection.sqlite
        .prepare("delete from categories where id = ?")
        .run(category.id),
    ).toThrowError(/FOREIGN KEY constraint failed/);
  });
});

/** An approved log, ready to be credited. */
function seedApprovedLog() {
  const seed = seedMinimum();
  const [log] = connection.db
    .insert(activityLogs)
    .values({
      userId: seed.kid.id,
      activityId: seed.activity.id,
      // D37: `activity_logs_category_id_status_check` ties this to `status`.
      categoryId: seed.category.id,
      status: "approved",
      source: "admin",
      occurredOn: "2026-03-14",
      computedHours: 2,
      createdBy: seed.admin.id,
      reviewedBy: seed.admin.id,
      reviewedAt: new Date("2026-03-14T19:00:00.000Z"),
    })
    .returning()
    .all();
  if (!log) throw new Error("insert returned no row");

  return { ...seed, log };
}

describe("an approval is creditable exactly once", () => {
  it("refuses a second earn row for the same activity log", () => {
    const { admin, kid, log } = seedApprovedLog();
    const earn = () =>
      connection.db
        .insert(ledger)
        .values({
          userId: kid.id,
          kind: "earn",
          hours: 2,
          occurredOn: "2026-03-14",
          activityLogId: log.id,
          createdBy: admin.id,
        })
        .run();

    earn();

    // The retry after a SQLITE_BUSY, the double tap, the second admin.
    expect(earn).toThrowError(/UNIQUE constraint failed/);
    expect(
      connection.sqlite
        .prepare("select sum(hours) as total from ledger where user_id = ?")
        .get(kid.id),
    ).toEqual({ total: 2 });
  });

  it("indexes only the rows that carry a log", () => {
    // SQLite counts nulls as distinct, so the WHERE clause changes no insert
    // the schema accepts and no behavioural test can see it. What it does is
    // keep the spend and refund rows out of the index and say in the DDL which
    // rows the rule is about, so this reads the index back from the database.
    expect(
      connection.sqlite
        .prepare(
          "select partial from pragma_index_list('ledger') where name = 'ledger_activity_log_id_unique'",
        )
        .get(),
    ).toEqual({ partial: 1 });
  });

  it("still takes any number of rows that carry no log (D10)", () => {
    const { admin, kid } = seedApprovedLog();

    for (const destination of ["Xbox", "TV", "WhatsApp"]) {
      connection.db
        .insert(ledger)
        .values({
          userId: kid.id,
          kind: "spend",
          hours: 1,
          occurredOn: "2026-03-14",
          destination,
          createdBy: admin.id,
        })
        .run();
    }

    expect(connection.db.select().from(ledger).all()).toHaveLength(3);
  });
});

describe("dates are text, never timestamps (D13)", () => {
  it("stores occurred_on as YYYY-MM-DD text", () => {
    const { admin, kid, activity, category } = seedMinimum();

    connection.db
      .insert(activityLogs)
      .values({
        userId: kid.id,
        activityId: activity.id,
        categoryId: category.id,
        status: "approved",
        source: "admin",
        occurredOn: "2026-03-14",
        computedHours: 2,
        createdBy: admin.id,
        reviewedBy: admin.id,
        reviewedAt: new Date("2026-03-14T19:00:00.000Z"),
      })
      .run();

    const row = connection.sqlite
      .prepare(
        "select occurred_on, typeof(occurred_on) as kind from activity_logs",
      )
      .get() as { occurred_on: string; kind: string };

    expect(row).toEqual({ occurred_on: "2026-03-14", kind: "text" });
  });

  it("rejects a timestamp where a date belongs", () => {
    const { admin, kid, activity } = seedMinimum();

    expect(() =>
      connection.sqlite
        .prepare(
          "insert into activity_logs (user_id, activity_id, source, occurred_on, created_by) values (?, ?, 'admin', ?, ?)",
        )
        .run(kid.id, activity.id, "2026-03-14T18:00:00.000Z", admin.id),
    ).toThrowError(/CHECK constraint failed/);
  });

  const dateColumns: ReadonlyArray<{
    column: string;
    insert: (value: string) => void;
  }> = [
    {
      column: "activity_logs.occurred_on",
      insert: (value) => {
        const { admin, kid, activity } = seedMinimum();
        connection.sqlite
          .prepare(
            "insert into activity_logs (user_id, activity_id, source, occurred_on, created_by) values (?, ?, 'admin', ?, ?)",
          )
          .run(kid.id, activity.id, value, admin.id);
      },
    },
    {
      column: "ledger.occurred_on",
      insert: (value) => {
        const { admin, kid } = seedMinimum();
        connection.sqlite
          .prepare(
            "insert into ledger (user_id, kind, hours, occurred_on, created_by) values (?, 'spend', 1, ?, ?)",
          )
          .run(kid.id, value, admin.id);
      },
    },
    {
      column: "regimes.started_on",
      insert: (value) => {
        const { kid } = seedMinimum();
        connection.sqlite
          .prepare(
            "insert into regimes (user_id, label, hours_per_day, started_on) values (?, 'X', 2, ?)",
          )
          .run(kid.id, value);
      },
    },
  ];

  // The shape was already guarded; the calendar was not. Each of these was
  // accepted by all three columns before the check grew its other two terms,
  // and each one fails for a different reason: 2026-13-45 makes date() return
  // null, 2026-02-30 makes it return 2026-03-02, and 0000-00-00 both.
  for (const value of ["2026-13-45", "2026-02-30", "0000-00-00"]) {
    it.each(dateColumns)(`$column rejects ${value}`, ({ insert }) => {
      expect(() => insert(value)).toThrowError(/CHECK constraint failed/);
    });
  }

  for (const value of ["2024-02-29", "2026-12-31"]) {
    it.each(dateColumns)(`$column still accepts ${value}`, ({ insert }) => {
      expect(() => insert(value)).not.toThrow();
    });
  }

  it("keeps instants as epoch milliseconds, not text", () => {
    const { kid, activity } = seedMinimum();
    const startedAt = new Date("2026-03-14T18:00:00.000Z");

    connection.db
      .insert(timers)
      .values({
        userId: kid.id,
        activityId: activity.id,
        startedAt,
        status: "running",
      })
      .run();

    const row = connection.sqlite
      .prepare("select started_at, typeof(started_at) as kind from timers")
      .get() as { started_at: number; kind: string };

    expect(row).toEqual({ started_at: startedAt.getTime(), kind: "integer" });

    const [readBack] = connection.db.select().from(timers).all();
    expect(readBack?.startedAt).toEqual(startedAt);
  });
});

/**
 * One row per numeric column that enters a sum or a formula, with the two
 * values SQLite lets through a one-sided range CHECK: text, which sorts above
 * every number, and `9e999`, which is `Infinity`. Every one of these was
 * accepted before the `typeof` guards existed.
 */
const numericColumns: ReadonlyArray<{
  column: string;
  insert: (value: unknown) => void;
}> = [
  {
    column: "ledger.hours",
    insert: (value) => {
      const { admin, kid } = seedMinimum();
      connection.sqlite
        .prepare(
          "insert into ledger (user_id, kind, hours, occurred_on, created_by) values (?, 'earn', ?, '2026-03-14', ?)",
        )
        .run(kid.id, value, admin.id);
    },
  },
  {
    column: "ledger.created_at",
    insert: (value) => {
      const { admin, kid } = seedMinimum();
      connection.sqlite
        .prepare(
          "insert into ledger (user_id, kind, hours, occurred_on, created_by, created_at) values (?, 'earn', 1, '2026-03-14', ?, ?)",
        )
        .run(kid.id, admin.id, value);
    },
  },
  {
    column: "activity_logs.computed_hours",
    insert: (value) => {
      const { admin, kid, activity } = seedMinimum();
      connection.sqlite
        .prepare(
          "insert into activity_logs (user_id, activity_id, status, source, occurred_on, computed_hours, created_by, reviewed_by, reviewed_at) values (?, ?, 'approved', 'admin', '2026-03-14', ?, ?, ?, 1)",
        )
        .run(kid.id, activity.id, value, admin.id, admin.id);
    },
  },
  {
    column: "activity_logs.duration_minutes",
    insert: (value) => {
      const { admin, kid, activity } = seedMinimum();
      connection.sqlite
        .prepare(
          "insert into activity_logs (user_id, activity_id, source, occurred_on, duration_minutes, created_by) values (?, ?, 'timer', '2026-03-14', ?, ?)",
        )
        .run(kid.id, activity.id, value, admin.id);
    },
  },
  {
    column: "activity_logs.free_value",
    insert: (value) => {
      const { admin, kid, activity } = seedMinimum();
      connection.sqlite
        .prepare(
          "insert into activity_logs (user_id, activity_id, source, occurred_on, free_value, created_by) values (?, ?, 'admin', '2026-03-14', ?, ?)",
        )
        .run(kid.id, activity.id, value, admin.id);
    },
  },
  {
    column: "activity_logs.started_at",
    insert: (value) => {
      const { admin, kid, activity } = seedMinimum();
      connection.sqlite
        .prepare(
          "insert into activity_logs (user_id, activity_id, source, occurred_on, started_at, created_by) values (?, ?, 'timer', '2026-03-14', ?, ?)",
        )
        .run(kid.id, activity.id, value, admin.id);
    },
  },
  {
    column: "activity_logs.ended_at",
    insert: (value) => {
      const { admin, kid, activity } = seedMinimum();
      connection.sqlite
        .prepare(
          "insert into activity_logs (user_id, activity_id, source, occurred_on, started_at, ended_at, created_by) values (?, ?, 'timer', '2026-03-14', 1000, ?, ?)",
        )
        .run(kid.id, activity.id, value, admin.id);
    },
  },
  {
    column: "activity_logs.reviewed_at",
    insert: (value) => {
      const { admin, kid, activity } = seedMinimum();
      connection.sqlite
        .prepare(
          "insert into activity_logs (user_id, activity_id, status, source, occurred_on, computed_hours, created_by, reviewed_by, reviewed_at) values (?, ?, 'approved', 'admin', '2026-03-14', 2, ?, ?, ?)",
        )
        .run(kid.id, activity.id, admin.id, admin.id, value);
    },
  },
  {
    column: "activity_logs.created_at",
    insert: (value) => {
      const { admin, kid, activity } = seedMinimum();
      connection.sqlite
        .prepare(
          "insert into activity_logs (user_id, activity_id, source, occurred_on, created_by, created_at) values (?, ?, 'timer', '2026-03-14', ?, ?)",
        )
        .run(kid.id, activity.id, admin.id, value);
    },
  },
  {
    column: "categories.base_rate",
    insert: (value) => {
      connection.sqlite
        .prepare("insert into categories (name, base_rate) values ('X', ?)")
        .run(value);
    },
  },
  {
    column: "categories.decay_step_hours",
    insert: (value) => {
      connection.sqlite
        .prepare(
          "insert into categories (name, decay_step_hours) values ('X', ?)",
        )
        .run(value);
    },
  },
  {
    column: "categories.return_bonus_pct",
    insert: (value) => {
      connection.sqlite
        .prepare(
          "insert into categories (name, return_bonus_pct) values ('X', ?)",
        )
        .run(value);
    },
  },
  {
    column: "categories.return_bonus_after_days",
    insert: (value) => {
      connection.sqlite
        .prepare(
          "insert into categories (name, return_bonus_after_days) values ('X', ?)",
        )
        .run(value);
    },
  },
  {
    column: "activities.value",
    insert: (value) => {
      const { category } = seedMinimum();
      connection.sqlite
        .prepare(
          "insert into activities (category_id, name, calc_mode, value) values (?, 'X', 'duration', ?)",
        )
        .run(category.id, value);
    },
  },
  {
    column: "activities.max_session_minutes",
    insert: (value) => {
      const { category } = seedMinimum();
      connection.sqlite
        .prepare(
          "insert into activities (category_id, name, calc_mode, value, max_session_minutes) values (?, 'X', 'duration', 2, ?)",
        )
        .run(category.id, value);
    },
  },
  {
    column: "activities.repeat_cooldown_days",
    insert: (value) => {
      const { category } = seedMinimum();
      connection.sqlite
        .prepare(
          "insert into activities (category_id, name, calc_mode, value, repeat_cooldown_days) values (?, 'X', 'duration', 2, ?)",
        )
        .run(category.id, value);
    },
  },
  {
    column: "regimes.hours_per_day",
    insert: (value) => {
      const { kid } = seedMinimum();
      connection.sqlite
        .prepare(
          "insert into regimes (user_id, label, hours_per_day, started_on) values (?, 'X', ?, '2026-03-14')",
        )
        .run(kid.id, value);
    },
  },
  {
    column: "timers.accumulated_seconds",
    insert: (value) => {
      const { kid, activity } = seedMinimum();
      connection.sqlite
        .prepare(
          "insert into timers (user_id, activity_id, started_at, accumulated_seconds, status) values (?, ?, 1, ?, 'running')",
        )
        .run(kid.id, activity.id, value);
    },
  },
  {
    column: "timers.started_at",
    insert: (value) => {
      const { kid, activity } = seedMinimum();
      connection.sqlite
        .prepare(
          "insert into timers (user_id, activity_id, started_at, status) values (?, ?, ?, 'running')",
        )
        .run(kid.id, activity.id, value);
    },
  },
  {
    column: "timers.paused_at",
    insert: (value) => {
      const { kid, activity } = seedMinimum();
      connection.sqlite
        .prepare(
          "insert into timers (user_id, activity_id, started_at, paused_at, status) values (?, ?, 1, ?, 'paused')",
        )
        .run(kid.id, activity.id, value);
    },
  },
];

describe("a ledger row belongs to its log's owner and status", () => {
  /** Kid1 and Kid2, plus one approved log of Kid1's. */
  function seedBothKids() {
    const base = seedApprovedLog();
    const [other] = connection.db
      .insert(users)
      .values({ username: "kid2", displayName: "Kid2", role: "kid" })
      .returning()
      .all();
    if (!other) throw new Error("insert returned no row");

    return { ...base, other };
  }

  const credit = (userId: number, activityLogId: number, createdBy: number) =>
    connection.sqlite
      .prepare(
        "insert into ledger (user_id, kind, hours, occurred_on, activity_log_id, created_by) values (?, 'earn', 2, '2026-03-14', ?, ?)",
      )
      .run(userId, activityLogId, createdBy);

  it("refuses a credit that lands in the other boy's statement", () => {
    const { admin, log, other } = seedBothKids();

    expect(() => credit(other.id, log.id, admin.id)).toThrowError(
      /belong to different users/,
    );
  });

  it("still takes the credit that belongs to the log's owner", () => {
    const { admin, kid, log } = seedBothKids();

    expect(() => credit(kid.id, log.id, admin.id)).not.toThrow();
  });

  it("refuses a credit for a log that is not approved (D19)", () => {
    const { admin, kid, activity } = seedBothKids();
    const rejected = connection.sqlite
      .prepare(
        "insert into activity_logs (user_id, activity_id, status, source, occurred_on, created_by, reviewed_by, reviewed_at) values (?, ?, 'rejected', 'timer', '2026-03-14', ?, ?, 1)",
      )
      .run(kid.id, activity.id, admin.id, admin.id);

    expect(() =>
      credit(kid.id, Number(rejected.lastInsertRowid), admin.id),
    ).toThrowError(/only an approved log is credited/);
  });

  it("refuses moving a credited log out of approved", () => {
    const { admin, kid, log } = seedBothKids();
    credit(kid.id, log.id, admin.id);

    expect(() =>
      connection.sqlite
        .prepare("update activity_logs set status = 'rejected' where id = ?")
        .run(log.id),
    ).toThrowError(/cannot change owner or leave approved/);
  });

  it("refuses handing a credited log to the other boy", () => {
    const { admin, kid, log, other } = seedBothKids();
    credit(kid.id, log.id, admin.id);

    expect(() =>
      connection.sqlite
        .prepare("update activity_logs set user_id = ? where id = ?")
        .run(other.id, log.id),
    ).toThrowError(/cannot change owner or leave approved/);
  });

  it("leaves an uncredited log free to be rejected", () => {
    const { log } = seedBothKids();

    expect(() =>
      connection.sqlite
        .prepare(
          // `category_id` goes with `computed_hours`: both exist exactly when
          // the entry is frozen (D37), and an entry that is refused was never
          // frozen. `rejectLog` never meets this case — it only ever moves a
          // *pending* row, which carries neither — but the raw update here is
          // the trigger's own test and has to leave a legal row behind.
          "update activity_logs set status = 'rejected', computed_hours = null, category_id = null where id = ?",
        )
        .run(log.id),
    ).not.toThrow();
  });

  it("refuses repointing an existing ledger row at the other boy's log", () => {
    const { admin, kid, log, other, activity, category } = seedBothKids();
    credit(kid.id, log.id, admin.id);
    const theirs = connection.sqlite
      .prepare(
        "insert into activity_logs (user_id, activity_id, category_id, status, source, occurred_on, computed_hours, created_by, reviewed_by, reviewed_at) values (?, ?, ?, 'approved', 'admin', '2026-03-14', 2, ?, ?, 1)",
      )
      .run(other.id, activity.id, category.id, admin.id, admin.id);

    expect(() =>
      connection.sqlite
        .prepare("update ledger set activity_log_id = ? where user_id = ?")
        .run(Number(theirs.lastInsertRowid), kid.id),
    ).toThrowError(/belong to different users/);
  });
});

describe("a log cannot describe an impossible session or review", () => {
  const insertLog = (columns: string, values: string, params: unknown[] = []) =>
    connection.sqlite
      .prepare(`insert into activity_logs (${columns}) values (${values})`)
      .run(...(params as never[]));

  it("refuses a stored duration of zero minutes (D17, #71)", () => {
    const { admin, kid, activity } = seedMinimum();

    // #71 took the floor out of the *rounding*, not out of the record: a
    // session that rounds to no minutes is refused by `stopTimer` and never
    // reaches a row, and the column is where that guarantee lives.
    expect(() =>
      insertLog(
        "user_id, activity_id, source, occurred_on, duration_seconds, duration_minutes, created_by",
        "?, ?, 'timer', '2026-03-14', ?, ?, ?",
        [kid.id, activity.id, 10, 0, admin.id],
      ),
    ).toThrowError(/CHECK constraint failed/);
    expect(() =>
      insertLog(
        "user_id, activity_id, source, occurred_on, duration_minutes, created_by",
        "?, ?, 'timer', '2026-03-14', ?, ?",
        [kid.id, activity.id, -600, admin.id],
      ),
    ).toThrowError(/CHECK constraint failed/);
    expect(() =>
      insertLog(
        "user_id, activity_id, source, occurred_on, duration_minutes, created_by",
        "?, ?, 'timer', '2026-03-14', ?, ?",
        [kid.id, activity.id, 1, admin.id],
      ),
    ).not.toThrow();
    // The seconds beside them are held to the same shape, and are asked about
    // with minutes the column accepts: paired with zero minutes the row is
    // refused whatever the seconds say, and the case would pass with no check
    // on `duration_seconds` at all.
    expect(() =>
      insertLog(
        "user_id, activity_id, source, occurred_on, duration_seconds, duration_minutes, created_by",
        "?, ?, 'timer', '2026-03-14', ?, ?, ?",
        [kid.id, activity.id, -1, 1, admin.id],
      ),
    ).toThrowError(/CHECK constraint failed/);
    expect(() =>
      insertLog(
        "user_id, activity_id, source, occurred_on, duration_seconds, duration_minutes, created_by",
        "?, ?, 'timer', '2026-03-14', ?, ?, ?",
        [kid.id, activity.id, 90.5, 2, admin.id],
      ),
    ).toThrowError(/CHECK constraint failed/);
  });

  it("refuses a session that ended before it started", () => {
    const { admin, kid, activity } = seedMinimum();

    expect(() =>
      insertLog(
        "user_id, activity_id, source, occurred_on, started_at, ended_at, created_by",
        "?, ?, 'timer', '2026-03-14', 2000, 1000, ?",
        [kid.id, activity.id, admin.id],
      ),
    ).toThrowError(/CHECK constraint failed/);
  });

  it("refuses an end stamp with no start stamp", () => {
    const { admin, kid, activity } = seedMinimum();

    expect(() =>
      insertLog(
        "user_id, activity_id, source, occurred_on, ended_at, created_by",
        "?, ?, 'timer', '2026-03-14', 2000, ?",
        [kid.id, activity.id, admin.id],
      ),
    ).toThrowError(/CHECK constraint failed/);
  });

  it("refuses a negative computed value on an approved log", () => {
    const { admin, kid, activity } = seedMinimum();

    expect(() =>
      insertLog(
        "user_id, activity_id, status, source, occurred_on, computed_hours, created_by, reviewed_by, reviewed_at",
        "?, ?, 'approved', 'admin', '2026-03-14', -50, ?, ?, 1",
        [kid.id, activity.id, admin.id, admin.id],
      ),
    ).toThrowError(/CHECK constraint failed/);
  });

  it("takes the five grades the spec lists and nothing between them", () => {
    const { admin, kid, activity } = seedMinimum();
    const withQuality = (quality: number) =>
      insertLog(
        "user_id, activity_id, source, occurred_on, quality, created_by",
        "?, ?, 'timer', '2026-03-14', ?, ?",
        [kid.id, activity.id, quality, admin.id],
      );

    for (const quality of [0, 0.3, 0.5, 0.7, 1.0]) {
      expect(() => withQuality(quality)).not.toThrow();
    }
    for (const quality of [0.4, 0.9, 0.25]) {
      expect(() => withQuality(quality)).toThrowError(
        /CHECK constraint failed/,
      );
    }
  });

  it("refuses an approved log nobody reviewed (D18)", () => {
    const { admin, kid, activity } = seedMinimum();

    expect(() =>
      insertLog(
        "user_id, activity_id, status, source, occurred_on, computed_hours, created_by",
        "?, ?, 'approved', 'admin', '2026-03-14', 2, ?",
        [kid.id, activity.id, admin.id],
      ),
    ).toThrowError(/CHECK constraint failed/);
  });

  it("refuses a rejected log nobody reviewed (D19)", () => {
    const { admin, kid, activity } = seedMinimum();

    expect(() =>
      insertLog(
        "user_id, activity_id, status, source, occurred_on, created_by",
        "?, ?, 'rejected', 'timer', '2026-03-14', ?",
        [kid.id, activity.id, admin.id],
      ),
    ).toThrowError(/CHECK constraint failed/);
  });

  it("refuses a pending log that already names a reviewer", () => {
    const { admin, kid, activity } = seedMinimum();

    expect(() =>
      insertLog(
        "user_id, activity_id, source, occurred_on, created_by, reviewed_by, reviewed_at",
        "?, ?, 'timer', '2026-03-14', ?, ?, 1",
        [kid.id, activity.id, admin.id, admin.id],
      ),
    ).toThrowError(/CHECK constraint failed/);
  });

  it("refuses a reviewer with no stamp, and a stamp with no reviewer", () => {
    const { admin, kid, activity } = seedMinimum();

    expect(() =>
      insertLog(
        "user_id, activity_id, status, source, occurred_on, computed_hours, created_by, reviewed_by",
        "?, ?, 'approved', 'admin', '2026-03-14', 2, ?, ?",
        [kid.id, activity.id, admin.id, admin.id],
      ),
    ).toThrowError(/CHECK constraint failed/);
    expect(() =>
      insertLog(
        "user_id, activity_id, status, source, occurred_on, computed_hours, created_by, reviewed_at",
        "?, ?, 'approved', 'admin', '2026-03-14', 2, ?, 1",
        [kid.id, activity.id, admin.id],
      ),
    ).toThrowError(/CHECK constraint failed/);
  });
});

describe("computed_hours says whether it was computed (D10)", () => {
  it("leaves a pending log with no computed value at all", () => {
    const { admin, kid, activity } = seedMinimum();

    connection.db
      .insert(activityLogs)
      .values({
        userId: kid.id,
        activityId: activity.id,
        source: "timer",
        occurredOn: "2026-03-14",
        createdBy: admin.id,
      })
      .run();

    const [row] = connection.db.select().from(activityLogs).all();
    expect(row?.status).toBe("pending");
    expect(row?.computedHours).toBeNull();
  });

  it("keeps zero as a real approved value (a delivery graded zero)", () => {
    const { admin, kid, activity, category } = seedMinimum();

    connection.db
      .insert(activityLogs)
      .values({
        userId: kid.id,
        activityId: activity.id,
        categoryId: category.id,
        status: "approved",
        source: "admin",
        occurredOn: "2026-03-14",
        quality: 0,
        computedHours: 0,
        createdBy: admin.id,
        reviewedBy: admin.id,
        reviewedAt: new Date("2026-03-14T19:00:00.000Z"),
      })
      .run();

    const [row] = connection.db.select().from(activityLogs).all();
    expect(row?.computedHours).toBe(0);
  });

  it("refuses an approved log with no computed value", () => {
    const { admin, kid, activity } = seedMinimum();

    expect(() =>
      connection.sqlite
        .prepare(
          "insert into activity_logs (user_id, activity_id, status, source, occurred_on, created_by, reviewed_by, reviewed_at) values (?, ?, 'approved', 'admin', '2026-03-14', ?, ?, 1)",
        )
        .run(kid.id, activity.id, admin.id, admin.id),
    ).toThrowError(/CHECK constraint failed/);
  });

  it("refuses a pending log that already carries one", () => {
    const { admin, kid, activity } = seedMinimum();

    expect(() =>
      connection.sqlite
        .prepare(
          "insert into activity_logs (user_id, activity_id, source, occurred_on, computed_hours, created_by) values (?, ?, 'timer', '2026-03-14', 2, ?)",
        )
        .run(kid.id, activity.id, admin.id),
    ).toThrowError(/CHECK constraint failed/);
  });
});

describe("soft delete frees the name again (D14)", () => {
  it("recreates a category whose name was deactivated", () => {
    const insert = (name: string) =>
      connection.sqlite
        .prepare("insert into categories (name) values (?)")
        .run(name);

    insert("Corpo");
    connection.sqlite
      .prepare("update categories set active = 0 where name = 'Corpo'")
      .run();

    expect(() => insert("Corpo")).not.toThrow();
    expect(
      connection.sqlite
        .prepare("select count(*) as n from categories where name = 'Corpo'")
        .get(),
    ).toEqual({ n: 2 });
  });

  it("still refuses two live categories with the same name", () => {
    connection.sqlite
      .prepare("insert into categories (name) values ('Mente')")
      .run();

    expect(() =>
      connection.sqlite
        .prepare("insert into categories (name) values ('Mente')")
        .run(),
    ).toThrowError(/UNIQUE constraint failed/);
  });

  it("recreates a username that was deactivated", () => {
    const insert = () =>
      connection.sqlite
        .prepare(
          "insert into users (username, display_name, role) values ('kid1', 'Kid1', 'kid')",
        )
        .run();

    insert();
    connection.sqlite
      .prepare("update users set active = 0 where username = 'kid1'")
      .run();

    expect(insert).not.toThrow();
  });

  it("still refuses two live users with the same username", () => {
    const insert = () =>
      connection.sqlite
        .prepare(
          "insert into users (username, display_name, role) values ('kid1', 'Kid1', 'kid')",
        )
        .run();

    insert();

    expect(insert).toThrowError(/UNIQUE constraint failed/);
  });
});

describe("numeric columns are guarded by type, not only by range", () => {
  it.each(numericColumns)(
    "$column rejects text, which SQLite sorts above every number",
    ({ insert }) => {
      expect(() => insert("abc")).toThrowError(/CHECK constraint failed/);
    },
  );

  it.each(numericColumns)(
    "$column rejects a value that is not finite",
    ({ insert }) => {
      expect(() => insert(Number.POSITIVE_INFINITY)).toThrowError(
        /CHECK constraint failed/,
      );
    },
  );

  /**
   * Measured, and worth writing down: with both bounds in place the `typeof`
   * half is behaviourally redundant. Text and blobs sort above every number in
   * SQLite, so the ceiling rejects them on its own — neutralising every
   * `typeof(...)` in the migration leaves this whole file green. The reverse is
   * not true: dropping the ceilings fails eight of the cases above, because
   * `Infinity` passes `>= 0` and only the `typeof` of an integer column catches
   * it.
   *
   * The guard stays because the two halves fail differently and a later hand
   * that widens one range should not be left with nothing. Since no INSERT can
   * see it, this reads it out of the DDL the database actually holds.
   */
  it.each(numericColumns)(
    "$column states its type in the DDL",
    ({ column }) => {
      const [table, name] = column.split(".");
      const ddl = connection.sqlite
        .prepare(
          "select sql from sqlite_master where type = 'table' and name = ?",
        )
        .get(table) as { sql: string };

      expect(ddl.sql).toContain(`typeof("${table}"."${name}")`);
    },
  );

  it("keeps the balance a number when the guards do their job", () => {
    const { admin, kid } = seedMinimum();
    connection.sqlite
      .prepare(
        "insert into ledger (user_id, kind, hours, occurred_on, created_by) values (?, 'earn', 2, '2026-03-14', ?)",
      )
      .run(kid.id, admin.id);

    expect(
      connection.sqlite
        .prepare("select sum(hours) as total from ledger where user_id = ?")
        .get(kid.id),
    ).toEqual({ total: 2 });
  });
});

describe("categories follow D2 and D11", () => {
  it("has decay_step_hours and none of the columns D2 removed", () => {
    const columns = connection.sqlite
      .prepare("select name from pragma_table_info('categories')")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(columns).toContain("decay_step_hours");
    expect(columns).not.toContain("full_up_to");
    expect(columns).not.toContain("half_up_to");
    expect(columns).not.toContain("decay_enabled");
  });

  it("accepts a category with no base_rate and no decay (D11, D12)", () => {
    const [curinga] = connection.db
      .insert(categories)
      .values({ name: "Curinga", returnBonusPct: 0 })
      .returning()
      .all();

    expect(curinga?.baseRate).toBeNull();
    expect(curinga?.decayStepHours).toBeNull();
  });
});

describe("column-level guarantees", () => {
  const enums: ReadonlyArray<{
    constraint: string;
    insert: (value: string) => void;
  }> = [
    {
      constraint: "users_role_check",
      insert: (value) => {
        connection.sqlite
          .prepare(
            "insert into users (username, display_name, role) values ('x', 'X', ?)",
          )
          .run(value);
      },
    },
    {
      constraint: "activities_calc_mode_check",
      insert: (value) => {
        const { category } = seedMinimum();
        connection.sqlite
          .prepare(
            "insert into activities (category_id, name, calc_mode, value) values (?, 'X', ?, 2)",
          )
          .run(category.id, value);
      },
    },
    {
      constraint: "activity_logs_status_check",
      insert: (value) => {
        const { admin, kid, activity } = seedMinimum();
        connection.sqlite
          .prepare(
            // Reviewed and uncomputed, so that the review and computed_hours
            // invariants are both satisfied and only the status list can
            // reject the row.
            "insert into activity_logs (user_id, activity_id, status, source, occurred_on, created_by, reviewed_by, reviewed_at) values (?, ?, ?, 'timer', '2026-03-14', ?, ?, 1)",
          )
          .run(kid.id, activity.id, value, admin.id, admin.id);
      },
    },
    {
      constraint: "activity_logs_source_check",
      insert: (value) => {
        const { admin, kid, activity } = seedMinimum();
        connection.sqlite
          .prepare(
            "insert into activity_logs (user_id, activity_id, source, occurred_on, created_by) values (?, ?, ?, '2026-03-14', ?)",
          )
          .run(kid.id, activity.id, value, admin.id);
      },
    },
    {
      constraint: "ledger_kind_check",
      insert: (value) => {
        const { admin, kid } = seedMinimum();
        connection.sqlite
          .prepare(
            "insert into ledger (user_id, kind, hours, occurred_on, created_by) values (?, ?, 1, '2026-03-14', ?)",
          )
          .run(kid.id, value, admin.id);
      },
    },
    {
      constraint: "timers_status_check",
      insert: (value) => {
        const { kid, activity } = seedMinimum();
        connection.sqlite
          .prepare(
            "insert into timers (user_id, activity_id, started_at, status) values (?, ?, 1, ?)",
          )
          .run(kid.id, activity.id, value);
      },
    },
  ];

  // The `enum` option on a drizzle column is a TypeScript refinement and never
  // reaches the database. Only `users_role_check` had a test that inserted a
  // value outside the list, so a typo in any of the other five — 'aproved' for
  // 'approved' — would have compiled, generated and migrated cleanly.
  it.each(enums)(
    "$constraint rejects a value outside its list",
    ({ insert }) => {
      expect(() => insert("nonsense")).toThrowError(/CHECK constraint failed/);
    },
  );

  it("rejects a role outside admin and kid", () => {
    expect(() =>
      connection.sqlite
        .prepare(
          "insert into users (username, display_name, role) values ('x', 'X', 'root')",
        )
        .run(),
    ).toThrowError(/CHECK constraint failed/);
  });

  it("rejects a negative ledger amount — kind carries the sign", () => {
    const { admin, kid } = seedMinimum();

    expect(() =>
      connection.db
        .insert(ledger)
        .values({
          userId: kid.id,
          kind: "spend",
          hours: -2,
          occurredOn: "2026-03-14",
          createdBy: admin.id,
        })
        .run(),
    ).toThrowError(/CHECK constraint failed/);
  });

  it("rejects a non-free activity with no value", () => {
    const { category } = seedMinimum();

    expect(() =>
      connection.db
        .insert(activities)
        .values({
          categoryId: category.id,
          name: "Sem taxa",
          calcMode: "duration",
        })
        .run(),
    ).toThrowError(/CHECK constraint failed/);
  });

  it("rejects a free activity that carries a value (D11, D12)", () => {
    // The other half of `activities_value_check`, and it had no case at all:
    // measured, deleting this half of the constraint from the migration and
    // both snapshots left all 1344 tests green, and a raw insert of
    // `calc_mode = 'free', value = 5` went from refused to accepted. A `free`
    // activity's value is typed at launch (D11); a stored one is a number that
    // would never be read and would contradict the one that is.
    const { category } = seedMinimum();

    expect(() =>
      connection.db
        .insert(activities)
        .values({
          categoryId: category.id,
          name: "Avulsa com taxa",
          calcMode: "free",
          value: 5,
        })
        .run(),
    ).toThrowError(/CHECK constraint failed/);
  });

  it("rejects a decay step of exactly zero (D2)", () => {
    // `categories_decay_step_hours_check` is `> 0` exclusive, and nothing
    // tested the exclusivity: measured, relaxing it to `>= 0` left all 1344
    // green. Null is D2's off switch; zero would divide by zero in the decay.
    //
    // Note this is the CHECK, not D35's floor. The floor lives in
    // `src/engine/limits.ts` and refuses anything under 0,25h with a sentence;
    // it is precisely because the floor now makes zero unreachable through the
    // CRUD that the constraint needs a case of its own — a guard that hides a
    // constraint is a constraint nobody would notice losing.
    expect(() =>
      connection.db
        .insert(categories)
        .values({ name: "Passo zero", decayStepHours: 0 })
        .run(),
    ).toThrowError(/CHECK constraint failed/);
  });

  it("rejects a session limit of exactly zero (D16)", () => {
    // `activities_max_session_minutes_check` is `> 0` exclusive, and the same
    // measurement applies: relaxing it left all 1344 green, because
    // `requireCount(..., { min: 1 })` covers it from above.
    const { category } = seedMinimum();

    expect(() =>
      connection.db
        .insert(activities)
        .values({
          categoryId: category.id,
          name: "Sessão de zero",
          calcMode: "duration",
          value: 2,
          maxSessionMinutes: 0,
        })
        .run(),
    ).toThrowError(/CHECK constraint failed/);
  });

  it("defaults active to true and soft-deletes by flipping it (D14)", () => {
    const { activity } = seedMinimum();
    expect(activity.active).toBe(true);

    connection.db.update(activities).set({ active: false }).run();

    const [row] = connection.db.select().from(activities).all();
    expect(row?.active).toBe(false);
    expect(connection.db.select().from(activities).all()).toHaveLength(1);
  });

  it("stamps created_at from the database when the caller omits it", () => {
    const { admin, kid } = seedMinimum();
    const before = Date.now();

    // Through `connection.sqlite`, not through drizzle: drizzle inlines the
    // column default into the INSERT it emits, so the DDL's DEFAULT is never
    // reached and the test would pass with the migration's default set to 0.
    // The seed and any raw script take this path, and so does anyone who
    // touches the file with the sqlite3 CLI.
    connection.sqlite
      .prepare(
        "insert into ledger (user_id, kind, hours, occurred_on, destination, created_by) values (?, 'spend', 1, '2026-03-14', 'Xbox', ?)",
      )
      .run(kid.id, admin.id);

    const [row] = connection.db.select().from(ledger).all();
    expect(row?.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row?.createdAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("accepts a regime and keeps started_on as a date", () => {
    const { kid } = seedMinimum();

    connection.db
      .insert(regimes)
      .values({
        userId: kid.id,
        label: "WhatsApp",
        hoursPerDay: 2,
        startedOn: "2026-03-10",
      })
      .run();

    const [row] = connection.db.select().from(regimes).all();
    expect(row?.startedOn).toBe("2026-03-10");
    expect(row?.active).toBe(true);
  });
});
