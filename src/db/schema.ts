import { type SQL, sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * The seven tables of the data model.
 *
 * Two conventions run through the whole file and are worth reading once:
 *
 * - **Dates are text, instants are integers (D13).** `occurred_on` and
 *   `started_on` are `TEXT` in `YYYY-MM-DD`, in `America/Sao_Paulo`, and never
 *   a timestamp: a Saturday-night entry that drifts into Sunday is the classic
 *   bug this avoids. Only `started_at`, `ended_at`, `paused_at` and the audit
 *   stamps are real instants, and those are stored as epoch milliseconds so
 *   the two kinds can never be confused for one another.
 * - **Nothing is deleted (D14).** Categories and activities carry `active`, and
 *   every foreign key is `ON DELETE RESTRICT`: a three-month-old log has to
 *   keep knowing which activity it came from, because `computed_hours` is
 *   frozen at approval time (D15).
 *
 * Primary keys are `AUTOINCREMENT` rather than plain rowid aliases so an id is
 * never handed out twice. The ledger and the logs are an audit trail; a reused
 * id there would silently re-point an old reference at a new row.
 */

/**
 * A guard for a column whose value ends up in an arithmetic expression.
 *
 * SQLite has no static typing, and a one-sided range CHECK does not stand in
 * for one. Measured on this schema before this existed, all accepted:
 *
 *     ledger.hours = 'abc'            -- text sorts above every number, so
 *                                        'abc' > 0 is true and the CHECK passes
 *     ledger.hours = 9e999            -- Infinity is a real, and 1e308 > 0
 *     activity_logs.computed_hours    -- same, and the same for every other
 *     timers.accumulated_seconds         column that had a >= or > CHECK
 *     categories.decay_step_hours
 *     activities.value
 *     regimes.hours_per_day
 *     timers.started_at               -- no CHECK at all
 *
 * Neither failure is loud. `SUM()` reads the text as zero, so the hour just
 * disappears from the balance; the infinity makes the balance `Infinity`. So
 * every column that enters a sum or a formula gets three things and not one: a
 * `typeof` that keeps text and blobs out, a floor, and a ceiling that rejects
 * anything not finite.
 *
 * `sort_order` is deliberately not on the list — it orders pickers and enters
 * no calculation.
 *
 * Bounds are written with `sql.raw` on purpose, and the glob pattern in
 * `calendarDate` below is written literally for the same reason: an
 * interpolated value becomes a bound `?`, and a CHECK constraint carrying a `?`
 * is not valid DDL.
 */
function numeric(
  column: AnySQLiteColumn,
  {
    min,
    max,
    exclusiveMin = false,
    integers = false,
    nullable = false,
  }: {
    min: number;
    max: number;
    exclusiveMin?: boolean;
    integers?: boolean;
    nullable?: boolean;
  },
): SQL {
  const kind = integers
    ? sql`typeof(${column}) = 'integer'`
    : sql`typeof(${column}) in ('integer', 'real')`;
  const guard = sql`${kind} and ${column} ${sql.raw(exclusiveMin ? ">" : ">=")} ${sql.raw(String(min))} and ${column} <= ${sql.raw(String(max))}`;

  return nullable ? sql`${column} is null or (${guard})` : guard;
}

/**
 * A guard for a `YYYY-MM-DD` calendar date (D13).
 *
 * The glob alone validates the shape and not the calendar: `2026-13-45`,
 * `2026-02-30` and `0000-00-00` were all accepted by all three date columns
 * before this existed. All three terms are needed, and each covers what the
 * others miss:
 *
 * - `glob` rejects anything that is not ten characters of the right shape.
 * - `date(col) is not null` rejects `2026-13-45`, where `date()` returns null —
 *   and a CHECK whose expression is null passes, so the equality alone would
 *   let it through.
 * - `col = date(col)` rejects `2026-02-30`, which `date()` happily normalises
 *   to `2026-03-02`.
 *
 * `2024-02-29` and `2026-12-31` still pass, which is the point.
 */
function calendarDate(column: AnySQLiteColumn): SQL {
  return sql`${column} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' and date(${column}) is not null and ${column} = date(${column})`;
}

/** Hours, rates and multipliers. 1e6 hours is 114 years; Infinity is not. */
const HOURS = 1e6;
/** Minute and day counters. */
const COUNT = 1e6;
/** Seconds in a minute, so the second counter's bound is not a bare 60. */
const SECONDS_PER_MINUTE = 60;
/** Epoch milliseconds. 1e15 lands in the year 33658. */
const INSTANT = 1e15;

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

/**
 * Written only by hand, with SQL on the database file; no code path writes
 * here (D45). A `null` hash is an account nobody can log into.
 */
export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["admin", "kid"] }).notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    /** `scrypt$N$r$p$salt$hash`, from `pnpm auth:hash` (D45). */
    passwordHash: text("password_hash"),
  },
  (table) => [
    // Partial, for the same reason as `categories_name_unique` below: under
    // D14 a deactivated row keeps its name forever, and a plain unique index
    // makes the name unusable rather than free.
    uniqueIndex("users_username_unique")
      .on(table.username)
      .where(sql`${table.active} = 1`),
    // `enum` above is a TypeScript-only refinement; without this the database
    // would accept any string from a raw INSERT.
    check("users_role_check", sql`${table.role} in ('admin', 'kid')`),
  ],
);

// ---------------------------------------------------------------------------
// categories
// ---------------------------------------------------------------------------

/**
 * D2 replaced `full_up_to`, `half_up_to` and `decay_enabled` with a single
 * `decay_step_hours`: every `decay_step_hours` hours of *activity* accumulated
 * in the category on the day, the next hour is worth half the previous one.
 * Null turns decay off. There is no weekly window (D4).
 */
export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    /**
     * D11: nullable, and only a suggestion for the Configuration screen when
     * creating a `duration` activity. Convívio, Casa and Curinga declare no
     * rate at all. The activity's own `value` is what the engine reads.
     */
    baseRate: real("base_rate"),
    /**
     * D2: hours of activity per halving. Null disables decay — Convívio, Casa
     * and Curinga (D5, D12).
     */
    decayStepHours: real("decay_step_hours"),
    returnBonusPct: real("return_bonus_pct").notNull().default(0),
    returnBonusAfterDays: integer("return_bonus_after_days")
      .notNull()
      .default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    /** D14: deactivating hides the row from the pickers; it never removes it. */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [
    // D14 says a category is deactivated, never deleted — and a plain
    // `UNIQUE(name)` turns that into "the name is burnt". Reproduced on the
    // database this PR shipped:
    //
    //     insert into categories (name) values ('Corpo');   -- ok
    //     update categories set active = 0 where name = 'Corpo';
    //     insert into categories (name) values ('Corpo');
    //     -- UNIQUE constraint failed: categories.name
    //
    // Nothing in the spec or in the decisions asks for that. Scoped to the
    // active rows, the rule the Configuration screen actually needs — no two
    // live categories share a name — survives, and recreating a deactivated
    // one works.
    uniqueIndex("categories_name_unique")
      .on(table.name)
      .where(sql`${table.active} = 1`),
    // A step of zero would divide by zero in the decay formula, and a negative
    // one would grow the reward instead of shrinking it. Null is the off switch.
    check(
      "categories_decay_step_hours_check",
      numeric(table.decayStepHours, {
        min: 0,
        exclusiveMin: true,
        max: HOURS,
        nullable: true,
      }),
    ),
    check(
      "categories_base_rate_check",
      numeric(table.baseRate, { min: 0, max: HOURS, nullable: true }),
    ),
    check(
      "categories_return_bonus_pct_check",
      numeric(table.returnBonusPct, { min: 0, max: HOURS }),
    ),
    check(
      "categories_return_bonus_after_days_check",
      numeric(table.returnBonusAfterDays, {
        min: 0,
        max: COUNT,
        integers: true,
      }),
    ),
  ],
);

// ---------------------------------------------------------------------------
// activities
// ---------------------------------------------------------------------------

/**
 * `calc_mode` decides how the base value is read:
 *
 * - `duration` — hours × `value` (the rate)
 * - `fixed` — `value`, whatever the duration
 * - `delivery` — `value` × the quality grade
 * - `free` — the admin types the value at launch time, so `value` is null
 */
export const activities = sqliteTable(
  "activities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    calcMode: text("calc_mode", {
      enum: ["duration", "fixed", "delivery", "free"],
    }).notNull(),
    /** Null only for `free`, where the value is typed at launch time. */
    value: real("value"),
    /** D16: the timer stops itself here. Only meaningful for `duration`. */
    maxSessionMinutes: integer("max_session_minutes"),
    /** D44: a timed session shorter than this is not filed. */
    minSessionMinutes: integer("min_session_minutes").notNull().default(5),
    qualityGraded: integer("quality_graded", { mode: "boolean" })
      .notNull()
      .default(false),
    repeatCooldownDays: integer("repeat_cooldown_days").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    /** D14. */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [
    index("activities_category_id_idx").on(table.categoryId),
    check(
      "activities_calc_mode_check",
      sql`${table.calcMode} in ('duration', 'fixed', 'delivery', 'free')`,
    ),
    // Every mode but `free` reads `value`, so a missing one there is a silent
    // zero in someone's balance.
    check(
      "activities_value_check",
      sql`(${table.calcMode} = 'free' and ${table.value} is null) or (${table.calcMode} <> 'free' and ${table.value} is not null)`,
    ),
    check(
      "activities_value_range_check",
      numeric(table.value, { min: 0, max: HOURS, nullable: true }),
    ),
    check(
      "activities_max_session_minutes_check",
      numeric(table.maxSessionMinutes, {
        min: 0,
        exclusiveMin: true,
        max: COUNT,
        integers: true,
        nullable: true,
      }),
    ),
    check(
      "activities_min_session_minutes_check",
      numeric(table.minSessionMinutes, { min: 1, max: COUNT, integers: true }),
    ),
    // D44: a limit under the floor would discard every session it cuts.
    check(
      "activities_min_under_max_session_check",
      sql`${table.maxSessionMinutes} is null or ${table.minSessionMinutes} <= ${table.maxSessionMinutes}`,
    ),
    check(
      "activities_repeat_cooldown_days_check",
      numeric(table.repeatCooldownDays, {
        min: 0,
        max: COUNT,
        integers: true,
      }),
    ),
  ],
);

// ---------------------------------------------------------------------------
// activity_logs
// ---------------------------------------------------------------------------

/**
 * One row per thing that was done. D8 fixes the canonical ordering as
 * `(occurred_on, created_at, id)`, which is why all three are indexed together.
 */
export const activityLogs = sqliteTable(
  "activity_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    activityId: integer("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "restrict" }),
    /**
     * The category this entry counts under, written when the entry is created
     * and never re-read from `activities` (D37).
     *
     * The daily bucket of D3 is "hours of activity of the **category**, on the
     * day". Resolved through a live join to `activities.category_id`, moving an
     * activity took its already-approved logs out of the bucket they had
     * already been paid from: measured on the seeded database, two hours of
     * reading approved at 4,50 h, then the activity moved, and two hours of
     * comics on the same afternoon went from 0,56 h to 3,38 h — Mente paying
     * 7,88 h against a calibrated asymptote of 4,00 h, with the return bonus
     * granted twice in one afternoon.
     *
     * This is not a second copy of D3: the rule stays in the engine, and what
     * is stored is which bucket this row went into, which is a fact about the
     * row and about nothing else. It is the same shape as `computed_hours` —
     * the answer is frozen, the rule is not.
     *
     * A correction that moves an entry to another activity moves this with it
     * (`approveLog`), because the entry then genuinely counts elsewhere.
     *
     * Nullable, and null until the entry is frozen — exactly like
     * `computed_hours` beside it, and for the same reason. A pending entry has
     * not consumed any bucket yet, and D3's bucket is read from approved rows
     * only; writing a category onto a row that has not been priced would be
     * recording an answer nobody has given. The CHECK below keeps the two in
     * step with `status`.
     */
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "restrict",
    }),
    /** D18: an admin's own entry is born `approved`. */
    status: text("status", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    source: text("source", { enum: ["timer", "admin"] }).notNull(),
    /** D13: `YYYY-MM-DD` in `America/Sao_Paulo`. Never a timestamp. */
    occurredOn: text("occurred_on").notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    /**
     * D17 (emenda #71): the active seconds themselves, as measured. Pauses
     * excluded.
     *
     * This is what the session actually lasted; `duration_minutes` beside it is
     * that number rounded, and is what the engine reads. Storing only the
     * minutes lost the difference between a ten-second misfire and a real
     * session, which is the whole reason the floor of one could round the first
     * one up to the second.
     */
    durationSeconds: integer("duration_seconds"),
    /**
     * D17 (emenda #71): `duration_seconds` rounded to the nearest minute, with
     * no floor. Zero is what the rounding answers for a session under half a
     * minute, and no row ever carries it: such a session is refused before it
     * is filed, and the CHECK below requires more than zero.
     */
    durationMinutes: integer("duration_minutes"),
    /** 0 · 0,3 · 0,5 · 0,7 · 1,0 when the activity is `quality_graded`. */
    quality: real("quality"),
    /** The value the admin typed, for a `free` activity. */
    freeValue: real("free_value"),
    /**
     * D9: rounded to 2 decimals once, at the end. D15: never recomputed.
     *
     * Nullable, and null until the log is approved. `NOT NULL DEFAULT 0` made
     * "nobody has calculated this yet" and "calculated, and it is worth zero"
     * the same row — and D10 makes the second one a real, legitimate state: a
     * `delivery` graded zero is an approved log worth 0h with no ledger line.
     * The CHECK below keeps the two in step with `status`.
     */
    computedHours: real("computed_hours"),
    note: text("note"),
    /**
     * D16: set when the timer hit `max_session_minutes` and stopped itself, so
     * the queue can show the admin that the boy did not end the session.
     */
    autoStopped: integer("auto_stopped", { mode: "boolean" })
      .notNull()
      .default(false),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reviewedBy: integer("reviewed_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    // D3 and D8: the daily bucket is "this user, this day, approved only",
    // walked in canonical order.
    index("activity_logs_user_day_idx").on(
      table.userId,
      table.occurredOn,
      table.createdAt,
      table.id,
    ),
    // The pending counter is on both home screens.
    index("activity_logs_status_idx").on(table.status),
    // D6: the cooldown and the return bonus look back by activity.
    index("activity_logs_activity_id_idx").on(table.activityId),
    // D3: the daily bucket is read by category, and now off this column rather
    // than through a join.
    index("activity_logs_category_id_idx").on(table.categoryId),
    check(
      "activity_logs_status_check",
      sql`${table.status} in ('pending', 'approved', 'rejected')`,
    ),
    check(
      "activity_logs_source_check",
      sql`${table.source} in ('timer', 'admin')`,
    ),
    check("activity_logs_occurred_on_check", calendarDate(table.occurredOn)),
    // The spec enumerates five grades — 0 · 0,3 · 0,5 · 0,7 · 1,0 — and every
    // other enumeration in this schema reached the database as a list. A range
    // let 0,4 in, which no screen can produce and the engine has no rule for.
    check(
      "activity_logs_quality_check",
      sql`${table.quality} is null or ${table.quality} in (0, 0.3, 0.5, 0.7, 1.0)`,
    ),
    check(
      "activity_logs_started_at_check",
      numeric(table.startedAt, {
        min: 0,
        max: INSTANT,
        integers: true,
        nullable: true,
      }),
    ),
    check(
      "activity_logs_ended_at_check",
      numeric(table.endedAt, {
        min: 0,
        max: INSTANT,
        integers: true,
        nullable: true,
      }),
    ),
    // D17, amended by #71: the seconds a session lasted. Zero is allowed and a
    // negative number is not — negative minutes would shrink the day's bucket
    // and inflate the next log's decay.
    check(
      "activity_logs_duration_seconds_check",
      numeric(table.durationSeconds, {
        min: 0,
        max: COUNT * SECONDS_PER_MINUTE,
        integers: true,
        nullable: true,
      }),
    ),
    // D17, amended by #71: the seconds rounded to the *nearest* minute, and
    // still above zero. The rounding lost its floor — `durationMinutes` in the
    // engine returns 0 for a session under half a minute — but a record of zero
    // minutes is refused outright rather than filed, so no row ever carries one.
    // The column is where that is guaranteed: a session too short to be worth a
    // minute never reaches the queue (`stopTimer`).
    check(
      "activity_logs_duration_minutes_check",
      numeric(table.durationMinutes, {
        min: 0,
        exclusiveMin: true,
        max: COUNT,
        integers: true,
        nullable: true,
      }),
    ),
    check(
      "activity_logs_free_value_check",
      numeric(table.freeValue, { min: 0, max: HOURS, nullable: true }),
    ),
    check(
      "activity_logs_computed_hours_check",
      numeric(table.computedHours, { min: 0, max: HOURS, nullable: true }),
    ),
    // The value exists exactly when the log is approved: a pending log has not
    // been calculated, a rejected one never will be (D19), and an approved one
    // has a number even when that number is zero (D10).
    check(
      "activity_logs_computed_hours_status_check",
      sql`(${table.status} = 'approved') = (${table.computedHours} is not null)`,
    ),
    // The bucket a frozen entry counted under exists exactly when the entry is
    // frozen, for the reason the column's own docstring gives (D37).
    check(
      "activity_logs_category_id_status_check",
      sql`(${table.status} = 'approved') = (${table.categoryId} is not null)`,
    ),
    check(
      "activity_logs_created_at_check",
      numeric(table.createdAt, { min: 0, max: INSTANT, integers: true }),
    ),
    // A session that ended before it started is not a session. `ended_at`
    // without `started_at` is not one either.
    check(
      "activity_logs_session_check",
      sql`${table.endedAt} is null or (${table.startedAt} is not null and ${table.endedAt} > ${table.startedAt})`,
    ),
    // D18: an admin's own entry is born approved *with* `reviewed_by` filled,
    // and D19's rejection is a review too. Pending is the only state nobody has
    // looked at, and the two review stamps go together.
    check(
      "activity_logs_review_check",
      sql`(${table.status} = 'pending') = (${table.reviewedBy} is null) and (${table.reviewedBy} is null) = (${table.reviewedAt} is null)`,
    ),
    check(
      "activity_logs_reviewed_at_check",
      numeric(table.reviewedAt, {
        min: 0,
        max: INSTANT,
        integers: true,
        nullable: true,
      }),
    ),
  ],
);

// ---------------------------------------------------------------------------
// ledger
// ---------------------------------------------------------------------------

/**
 * The balance is the sum of `earn` and `refund` minus `spend`, and it may go
 * negative without limit. `hours` is always positive; `kind` carries the sign.
 */
export const ledger = sqliteTable(
  "ledger",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: ["earn", "spend", "refund"] }).notNull(),
    hours: real("hours").notNull(),
    /** D13. */
    occurredOn: text("occurred_on").notNull(),
    /** Free text: "WhatsApp", "Xbox", "TV". */
    destination: text("destination"),
    note: text("note"),
    /**
     * D10: a `delivery` graded zero produces an approved log with
     * `computed_hours = 0` and no ledger row at all, so this stays nullable —
     * `spend` and `refund` rows have no log either.
     */
    activityLogId: integer("activity_log_id").references(
      () => activityLogs.id,
      { onDelete: "restrict" },
    ),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  },
  (table) => [
    index("ledger_user_day_idx").on(table.userId, table.occurredOn),
    // An approval credits its log exactly once. Two `earn` rows for one log is
    // the double credit that a retry after `SQLITE_BUSY`, a double tap, or two
    // admins approving the same entry produces without anyone acting in bad
    // faith — and nothing else in the schema notices it.
    //
    // Partial because `spend` and `refund` carry no log at all (D10). SQLite
    // counts nulls as distinct, so a plain unique index would also accept them
    // — measured, dropping the WHERE changes no insert this schema allows.
    // What the clause buys is that the rows that can never collide are not in
    // the index, and that the DDL says which rows the rule is about.
    uniqueIndex("ledger_activity_log_id_unique")
      .on(table.activityLogId)
      .where(sql`${table.activityLogId} is not null`),
    check(
      "ledger_kind_check",
      sql`${table.kind} in ('earn', 'spend', 'refund')`,
    ),
    // A negative `earn` and a positive `spend` would both quietly move the
    // balance the wrong way, and text or infinity would move it silently.
    check(
      "ledger_hours_check",
      numeric(table.hours, { min: 0, exclusiveMin: true, max: HOURS }),
    ),
    check(
      "ledger_created_at_check",
      numeric(table.createdAt, { min: 0, max: INSTANT, integers: true }),
    ),
    check("ledger_occurred_on_check", calendarDate(table.occurredOn)),
  ],
);

// ---------------------------------------------------------------------------
// regimes
// ---------------------------------------------------------------------------

/**
 * Dormant since #83 (D41): nothing reads or writes it, and the rows stay where
 * they are so that bringing the screen back is a revert and not a migration.
 */
export const regimes = sqliteTable(
  "regimes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    hoursPerDay: real("hours_per_day").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    /** D13: the boy's screen shows "ligado desde terça" from this date. */
    startedOn: text("started_on").notNull(),
    note: text("note"),
  },
  (table) => [
    index("regimes_user_active_idx").on(table.userId, table.active),
    check("regimes_started_on_check", calendarDate(table.startedOn)),
    check(
      "regimes_hours_per_day_check",
      numeric(table.hoursPerDay, { min: 0, max: HOURS }),
    ),
  ],
);

// ---------------------------------------------------------------------------
// timers
// ---------------------------------------------------------------------------

/**
 * Server-side state: closing the tab must not lose the running clock.
 *
 * D16 reconciles lazily — every read of a timer settles the state before
 * answering, cutting at `started_at + max_session_minutes` or marking a timer
 * paused for over 12h as `abandoned`. The cut is computed from the stamps, so
 * the result does not depend on when someone opened the app.
 */
export const timers = sqliteTable(
  "timers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    activityId: integer("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "restrict" }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    pausedAt: integer("paused_at", { mode: "timestamp_ms" }),
    /** D17: active seconds only. Time spent paused never enters. */
    accumulatedSeconds: integer("accumulated_seconds").notNull().default(0),
    /**
     * D16's limit, as it stood when the session was opened.
     *
     * Frozen here rather than read live off `activities`, and that reverses a
     * declaration of Phase 4 — see D38. The reconciliation is lazy: nothing
     * settles a session until somebody reads it. With the limit read live, an
     * adult who *raises* it before anybody opens the app brings a session back
     * that had already stopped itself hours earlier. Measured: a session opened
     * at 09:00 under a 120-minute limit, unread until 19:00, recorded 120
     * minutes and paid 4,50 h; with the limit raised to 600 in the meantime it
     * recorded 600 minutes and paid 8,99 h.
     *
     * D16 says the cut "é calculado a partir dos carimbos, não do momento da
     * leitura — então o resultado independe de quando alguém abriu o app". A
     * limit that can move between the stamps and the read is a limit that makes
     * that sentence false, so it is a stamp too.
     *
     * Null is an activity with no limit at all, which is legitimate.
     */
    maxSessionMinutes: integer("max_session_minutes"),
    /**
     * D44's floor, stamped when the session opens for the same reason as the
     * limit above (D37, D38). Zero is a session opened before the floor existed.
     */
    minSessionMinutes: integer("min_session_minutes").notNull().default(0),
    status: text("status", {
      enum: ["running", "paused", "stopped", "abandoned"],
    }).notNull(),
  },
  (table) => [
    index("timers_user_status_idx").on(table.userId, table.status),
    check(
      "timers_status_check",
      sql`${table.status} in ('running', 'paused', 'stopped', 'abandoned')`,
    ),
    check(
      "timers_accumulated_seconds_check",
      numeric(table.accumulatedSeconds, {
        min: 0,
        max: COUNT,
        integers: true,
      }),
    ),
    check(
      "timers_started_at_check",
      numeric(table.startedAt, { min: 0, max: INSTANT, integers: true }),
    ),
    check(
      "timers_max_session_minutes_check",
      numeric(table.maxSessionMinutes, {
        min: 0,
        exclusiveMin: true,
        max: COUNT,
        integers: true,
        nullable: true,
      }),
    ),
    check(
      "timers_min_session_minutes_check",
      numeric(table.minSessionMinutes, { min: 0, max: COUNT, integers: true }),
    ),
    check(
      "timers_paused_at_check",
      numeric(table.pausedAt, {
        min: 0,
        max: INSTANT,
        integers: true,
        nullable: true,
      }),
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type NewActivityLog = typeof activityLogs.$inferInsert;
export type LedgerEntry = typeof ledger.$inferSelect;
export type NewLedgerEntry = typeof ledger.$inferInsert;
export type Regime = typeof regimes.$inferSelect;
export type NewRegime = typeof regimes.$inferInsert;
export type Timer = typeof timers.$inferSelect;
export type NewTimer = typeof timers.$inferInsert;
