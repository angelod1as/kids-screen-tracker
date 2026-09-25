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
 * Dates are `YYYY-MM-DD` text and instants are epoch ms (D13); nothing is
 * deleted (D14). `AUTOINCREMENT` so an audit-trail id is never handed out twice.
 */

/**
 * Type, floor and finite ceiling for a column that enters arithmetic: a
 * one-sided CHECK accepts `'abc'` and `9e999`. `sql.raw` because a bound `?`
 * is not valid DDL in a CHECK.
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
 * D13. The glob checks shape; `date() is not null` rejects `2026-13-45` (a null
 * CHECK passes); `= date()` rejects `2026-02-30`, which `date()` normalises.
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
    // Partial: under D14 a deactivated row keeps its name forever.
    uniqueIndex("users_username_unique")
      .on(table.username)
      .where(sql`${table.active} = 1`),
    // `enum` above is TypeScript-only.
    check("users_role_check", sql`${table.role} in ('admin', 'kid')`),
  ],
);

/** D2: `decay_step_hours` replaced `full_up_to`, `half_up_to`, `decay_enabled`. */
export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    /** D11: a suggestion for the Configuration screen; the engine reads `value`. */
    baseRate: real("base_rate"),
    /** D2. Null disables decay (D5, D12). */
    decayStepHours: real("decay_step_hours"),
    returnBonusPct: real("return_bonus_pct").notNull().default(0),
    returnBonusAfterDays: integer("return_bonus_after_days")
      .notNull()
      .default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    /** D14. */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [
    // Partial: D14 deactivates, and a plain UNIQUE would burn the name forever.
    uniqueIndex("categories_name_unique")
      .on(table.name)
      .where(sql`${table.active} = 1`),
    // Zero divides by zero in the decay formula; null is the off switch.
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
    /** Null only for `free`. */
    value: real("value"),
    /** D16. */
    maxSessionMinutes: integer("max_session_minutes"),
    /** D44. */
    minSessionMinutes: integer("min_session_minutes").notNull().default(5),
    /** D49: the minutes a boy's request starts from when nobody timed it. */
    presumedMinutes: integer("presumed_minutes"),
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
    // A missing `value` would be a silent zero in someone's balance.
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
    check(
      "activities_presumed_minutes_check",
      numeric(table.presumedMinutes, {
        min: 0,
        exclusiveMin: true,
        max: COUNT,
        integers: true,
        nullable: true,
      }),
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

/** D8's canonical order is `(occurred_on, created_at, id)`, indexed together. */
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
     * D37: the bucket this entry was paid from, written at freeze time and never
     * re-read from `activities`. Null until approved, like `computed_hours`.
     */
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "restrict",
    }),
    /** D18. */
    status: text("status", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    /** D49: `request` is a boy's own proposal, made without the stopwatch. */
    source: text("source", { enum: ["timer", "request", "admin"] }).notNull(),
    /** D13. */
    occurredOn: text("occurred_on").notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    /** D17: the active seconds as measured; `duration_minutes` is them rounded. */
    durationSeconds: integer("duration_seconds"),
    /** D17: nearest minute, no floor; a zero is refused before it is filed. */
    durationMinutes: integer("duration_minutes"),
    quality: real("quality"),
    freeValue: real("free_value"),
    /**
     * D9, D15. Null until approved: zero is a real approved value (D10), so it
     * cannot also mean "not calculated yet".
     */
    computedHours: real("computed_hours"),
    note: text("note"),
    /** D50: `computed_hours` is the adult's number, not the rule's; `reviewed_by` typed it. */
    overridden: integer("overridden", { mode: "boolean" })
      .notNull()
      .default(false),
    /** D16: the limit or the day ended the session, not the boy. */
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
    // D3, D8.
    index("activity_logs_user_day_idx").on(
      table.userId,
      table.occurredOn,
      table.createdAt,
      table.id,
    ),
    index("activity_logs_status_idx").on(table.status),
    // D6.
    index("activity_logs_activity_id_idx").on(table.activityId),
    // D3, D37.
    index("activity_logs_category_id_idx").on(table.categoryId),
    check(
      "activity_logs_status_check",
      sql`${table.status} in ('pending', 'approved', 'rejected')`,
    ),
    check(
      "activity_logs_source_check",
      sql`${table.source} in ('timer', 'request', 'admin')`,
    ),
    check("activity_logs_occurred_on_check", calendarDate(table.occurredOn)),
    // The spec's five grades, as a list: a range let 0,4 in.
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
    // D17.
    check(
      "activity_logs_duration_seconds_check",
      numeric(table.durationSeconds, {
        min: 0,
        max: COUNT * SECONDS_PER_MINUTE,
        integers: true,
        nullable: true,
      }),
    ),
    // D17: above zero, so a zero-minute record is never filed (`stopTimer`).
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
    // D10, D19.
    check(
      "activity_logs_computed_hours_status_check",
      sql`(${table.status} = 'approved') = (${table.computedHours} is not null)`,
    ),
    // D37.
    check(
      "activity_logs_category_id_status_check",
      sql`(${table.status} = 'approved') = (${table.categoryId} is not null)`,
    ),
    check(
      "activity_logs_created_at_check",
      numeric(table.createdAt, { min: 0, max: INSTANT, integers: true }),
    ),
    check(
      "activity_logs_session_check",
      sql`${table.endedAt} is null or (${table.startedAt} is not null and ${table.endedAt} > ${table.startedAt})`,
    ),
    // D18, D19: pending is the only unreviewed state; both stamps go together.
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

/** Balance = earn + refund − spend, unbounded below; `kind` carries the sign. */
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
    destination: text("destination"),
    note: text("note"),
    /** Null for `spend` and `refund`, and absent for a zero-hour approval (D10). */
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
    // Each log is credited once: a retry, a double tap or two admins would
    // otherwise double-credit it unnoticed.
    uniqueIndex("ledger_activity_log_id_unique")
      .on(table.activityLogId)
      .where(sql`${table.activityLogId} is not null`),
    check(
      "ledger_kind_check",
      sql`${table.kind} in ('earn', 'spend', 'refund')`,
    ),
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

/** D41: dormant; the rows stay so bringing the screen back is a revert. */
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
    /** D13. */
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

/** Server-side, so closing the tab does not lose the clock (D16). */
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
    /** D17. */
    accumulatedSeconds: integer("accumulated_seconds").notNull().default(0),
    /** D38: stamped when the session opens. Null is no limit. */
    maxSessionMinutes: integer("max_session_minutes"),
    /** D44, stamped like the limit (D38). Zero predates the floor. */
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
