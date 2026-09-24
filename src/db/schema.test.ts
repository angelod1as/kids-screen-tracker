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

/** Built by the committed migration, never inline DDL, so the migration is under test. */

let root: string;
let databasePath: string;
let connection: ReturnType<typeof openDatabase>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-"));
  // Two levels down: the migration creates the path, not just the file.
  databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);
  connection = openDatabase(databasePath);
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

/** The rows the foreign keys need first. */
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
  // The pragma is `client.test.ts`'s: better-sqlite3 turns it on by itself.
  // These four go red when the FOREIGN KEY clauses leave the migration.

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

function seedApprovedLog() {
  const seed = seedMinimum();
  const [log] = connection.db
    .insert(activityLogs)
    .values({
      userId: seed.kid.id,
      activityId: seed.activity.id,
      // D37.
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

    // A retry after SQLITE_BUSY, a double tap, a second admin.
    expect(earn).toThrowError(/UNIQUE constraint failed/);
    expect(
      connection.sqlite
        .prepare("select sum(hours) as total from ledger where user_id = ?")
        .get(kid.id),
    ).toEqual({ total: 2 });
  });

  it("indexes only the rows that carry a log", () => {
    // No insert can see the WHERE (nulls are distinct), so read the DDL back.
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

  // Each fails a different term: 2026-13-45, 2026-02-30, and 0000-00-00 both.
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

/** Text sorts above every number and `9e999` is Infinity: both pass a one-sided CHECK. */
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
  /** Kid1, Kid2 and one approved log of Kid1's. */
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
          // D37: `category_id` goes with `computed_hours`, so the row stays legal.
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

    // D17: a session rounding to zero never reaches a row (`stopTimer`).
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
    // With legal minutes: zero minutes would refuse the row whatever the seconds.
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
   * The `typeof` half is redundant while the ceilings stand (text sorts above
   * numbers); it stays so a widened range is not left bare. Read from the DDL.
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
            // Reviewed and uncomputed, so only the status list can reject it.
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

  // A drizzle `enum` never reaches the database; a typo would migrate cleanly.
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
    // The `free` half of `activities_value_check`, which had no case (D11).
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
    // Exclusive of zero. D35's floor makes zero unreachable via the CRUD, which
    // is why the CHECK needs a case of its own.
    expect(() =>
      connection.db
        .insert(categories)
        .values({ name: "Passo zero", decayStepHours: 0 })
        .run(),
    ).toThrowError(/CHECK constraint failed/);
  });

  it("rejects a session limit of exactly zero (D16)", () => {
    // Exclusive of zero; `requireCount` covers it from above.
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

    // Raw SQL: drizzle inlines the default, so it would never test the DDL's.
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
