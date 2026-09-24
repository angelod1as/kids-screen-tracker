-- Hand-edited after `drizzle-kit generate`, for the same two reasons as 0003.
-- The snapshot beside this file is the generated one and is what
-- `schema-drift.test.ts` compares against; only the SQL is hand-written.
--
-- 1. Both new columns are BACKFILLED: the generator's rebuild selects them from
--    the old tables, where they do not exist yet, and fails outright. Every
--    activity gets the owner's floor of 5 minutes (D44), clamped to its own
--    session limit so no limit already under 5 starts discarding what it cuts.
--    Every existing timer gets 0, which is the rule it was opened under — D37
--    and D38 keep a change of configuration away from a session already open.
--
-- 2. `PRAGMA foreign_keys=OFF` is silently ignored inside the migrator's
--    transaction, and `activity_logs` and `timers` both point at `activities`.
--    `defer_foreign_keys` postpones the checks to COMMIT, when the ids are back.
--
-- **This migration cannot move a balance.** `activity_logs` and `ledger` are not
-- touched, and every pre-existing column of the two rebuilt tables is copied.

PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`name` text NOT NULL,
	`calc_mode` text NOT NULL,
	`value` real,
	`max_session_minutes` integer,
	`min_session_minutes` integer DEFAULT 5 NOT NULL,
	`quality_graded` integer DEFAULT false NOT NULL,
	`repeat_cooldown_days` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "activities_calc_mode_check" CHECK("__new_activities"."calc_mode" in ('duration', 'fixed', 'delivery', 'free')),
	CONSTRAINT "activities_value_check" CHECK(("__new_activities"."calc_mode" = 'free' and "__new_activities"."value" is null) or ("__new_activities"."calc_mode" <> 'free' and "__new_activities"."value" is not null)),
	CONSTRAINT "activities_value_range_check" CHECK("__new_activities"."value" is null or (typeof("__new_activities"."value") in ('integer', 'real') and "__new_activities"."value" >= 0 and "__new_activities"."value" <= 1000000)),
	CONSTRAINT "activities_max_session_minutes_check" CHECK("__new_activities"."max_session_minutes" is null or (typeof("__new_activities"."max_session_minutes") = 'integer' and "__new_activities"."max_session_minutes" > 0 and "__new_activities"."max_session_minutes" <= 1000000)),
	CONSTRAINT "activities_min_session_minutes_check" CHECK(typeof("__new_activities"."min_session_minutes") = 'integer' and "__new_activities"."min_session_minutes" >= 1 and "__new_activities"."min_session_minutes" <= 1000000),
	CONSTRAINT "activities_min_under_max_session_check" CHECK("__new_activities"."max_session_minutes" is null or "__new_activities"."min_session_minutes" <= "__new_activities"."max_session_minutes"),
	CONSTRAINT "activities_repeat_cooldown_days_check" CHECK(typeof("__new_activities"."repeat_cooldown_days") = 'integer' and "__new_activities"."repeat_cooldown_days" >= 0 and "__new_activities"."repeat_cooldown_days" <= 1000000)
);
--> statement-breakpoint
INSERT INTO `__new_activities`("id", "category_id", "name", "calc_mode", "value", "max_session_minutes", "min_session_minutes", "quality_graded", "repeat_cooldown_days", "sort_order", "active") SELECT "id", "category_id", "name", "calc_mode", "value", "max_session_minutes", min(5, coalesce("max_session_minutes", 5)), "quality_graded", "repeat_cooldown_days", "sort_order", "active" FROM `activities`;--> statement-breakpoint
DROP TABLE `activities`;--> statement-breakpoint
ALTER TABLE `__new_activities` RENAME TO `activities`;--> statement-breakpoint
CREATE INDEX `activities_category_id_idx` ON `activities` (`category_id`);--> statement-breakpoint
CREATE TABLE `__new_timers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`activity_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`paused_at` integer,
	`accumulated_seconds` integer DEFAULT 0 NOT NULL,
	`max_session_minutes` integer,
	`min_session_minutes` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "timers_status_check" CHECK("__new_timers"."status" in ('running', 'paused', 'stopped', 'abandoned')),
	CONSTRAINT "timers_accumulated_seconds_check" CHECK(typeof("__new_timers"."accumulated_seconds") = 'integer' and "__new_timers"."accumulated_seconds" >= 0 and "__new_timers"."accumulated_seconds" <= 1000000),
	CONSTRAINT "timers_started_at_check" CHECK(typeof("__new_timers"."started_at") = 'integer' and "__new_timers"."started_at" >= 0 and "__new_timers"."started_at" <= 1000000000000000),
	CONSTRAINT "timers_max_session_minutes_check" CHECK("__new_timers"."max_session_minutes" is null or (typeof("__new_timers"."max_session_minutes") = 'integer' and "__new_timers"."max_session_minutes" > 0 and "__new_timers"."max_session_minutes" <= 1000000)),
	CONSTRAINT "timers_min_session_minutes_check" CHECK(typeof("__new_timers"."min_session_minutes") = 'integer' and "__new_timers"."min_session_minutes" >= 0 and "__new_timers"."min_session_minutes" <= 1000000),
	CONSTRAINT "timers_paused_at_check" CHECK("__new_timers"."paused_at" is null or (typeof("__new_timers"."paused_at") = 'integer' and "__new_timers"."paused_at" >= 0 and "__new_timers"."paused_at" <= 1000000000000000))
);
--> statement-breakpoint
INSERT INTO `__new_timers`("id", "user_id", "activity_id", "started_at", "paused_at", "accumulated_seconds", "max_session_minutes", "min_session_minutes", "status") SELECT "id", "user_id", "activity_id", "started_at", "paused_at", "accumulated_seconds", "max_session_minutes", 0, "status" FROM `timers`;--> statement-breakpoint
DROP TABLE `timers`;--> statement-breakpoint
ALTER TABLE `__new_timers` RENAME TO `timers`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
CREATE INDEX `timers_user_status_idx` ON `timers` (`user_id`,`status`);
