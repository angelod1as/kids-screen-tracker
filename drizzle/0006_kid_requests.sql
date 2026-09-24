-- Hand-edited after `drizzle-kit generate`, for the reasons 0003 and 0004 give.
-- The snapshot beside this file is the generated one and is what
-- `schema-drift.test.ts` compares against; only the SQL is hand-written.
--
-- D49: `activity_logs.source` gains `request`, a boy's proposal made without the
-- stopwatch, and `activities` gains `presumed_minutes`. Changing a CHECK means
-- rebuilding both tables.
--
-- 1. The three triggers of 0001 name `activity_logs`; they are dropped before
--    the rebuild and recreated verbatim at the end.
-- 2. `defer_foreign_keys`, not `foreign_keys=OFF`, which the migrator's
--    transaction ignores: `ledger` and `timers` point at the rebuilt tables.
-- 3. `presumed_minutes` is BACKFILLED: null everywhere except the seed's
--    "Curso ou aula extra" (id 8, the seed's identity), which gets 60 (#18).
--
-- **This migration cannot move a balance.** Every column of both tables is
-- copied as it was; `ledger` is not touched.

DROP TRIGGER `ledger_owner_guard_insert`;--> statement-breakpoint
DROP TRIGGER `ledger_owner_guard_update`;--> statement-breakpoint
DROP TRIGGER `activity_logs_credited_guard`;--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_activity_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`activity_id` integer NOT NULL,
	`category_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text NOT NULL,
	`occurred_on` text NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`duration_seconds` integer,
	`duration_minutes` integer,
	`quality` real,
	`free_value` real,
	`computed_hours` real,
	`note` text,
	`auto_stopped` integer DEFAULT false NOT NULL,
	`created_by` integer NOT NULL,
	`reviewed_by` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`reviewed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "activity_logs_status_check" CHECK("__new_activity_logs"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "activity_logs_source_check" CHECK("__new_activity_logs"."source" in ('timer', 'request', 'admin')),
	CONSTRAINT "activity_logs_occurred_on_check" CHECK("__new_activity_logs"."occurred_on" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' and date("__new_activity_logs"."occurred_on") is not null and "__new_activity_logs"."occurred_on" = date("__new_activity_logs"."occurred_on")),
	CONSTRAINT "activity_logs_quality_check" CHECK("__new_activity_logs"."quality" is null or "__new_activity_logs"."quality" in (0, 0.3, 0.5, 0.7, 1.0)),
	CONSTRAINT "activity_logs_started_at_check" CHECK("__new_activity_logs"."started_at" is null or (typeof("__new_activity_logs"."started_at") = 'integer' and "__new_activity_logs"."started_at" >= 0 and "__new_activity_logs"."started_at" <= 1000000000000000)),
	CONSTRAINT "activity_logs_ended_at_check" CHECK("__new_activity_logs"."ended_at" is null or (typeof("__new_activity_logs"."ended_at") = 'integer' and "__new_activity_logs"."ended_at" >= 0 and "__new_activity_logs"."ended_at" <= 1000000000000000)),
	CONSTRAINT "activity_logs_duration_seconds_check" CHECK("__new_activity_logs"."duration_seconds" is null or (typeof("__new_activity_logs"."duration_seconds") = 'integer' and "__new_activity_logs"."duration_seconds" >= 0 and "__new_activity_logs"."duration_seconds" <= 60000000)),
	CONSTRAINT "activity_logs_duration_minutes_check" CHECK("__new_activity_logs"."duration_minutes" is null or (typeof("__new_activity_logs"."duration_minutes") = 'integer' and "__new_activity_logs"."duration_minutes" > 0 and "__new_activity_logs"."duration_minutes" <= 1000000)),
	CONSTRAINT "activity_logs_free_value_check" CHECK("__new_activity_logs"."free_value" is null or (typeof("__new_activity_logs"."free_value") in ('integer', 'real') and "__new_activity_logs"."free_value" >= 0 and "__new_activity_logs"."free_value" <= 1000000)),
	CONSTRAINT "activity_logs_computed_hours_check" CHECK("__new_activity_logs"."computed_hours" is null or (typeof("__new_activity_logs"."computed_hours") in ('integer', 'real') and "__new_activity_logs"."computed_hours" >= 0 and "__new_activity_logs"."computed_hours" <= 1000000)),
	CONSTRAINT "activity_logs_computed_hours_status_check" CHECK(("__new_activity_logs"."status" = 'approved') = ("__new_activity_logs"."computed_hours" is not null)),
	CONSTRAINT "activity_logs_category_id_status_check" CHECK(("__new_activity_logs"."status" = 'approved') = ("__new_activity_logs"."category_id" is not null)),
	CONSTRAINT "activity_logs_created_at_check" CHECK(typeof("__new_activity_logs"."created_at") = 'integer' and "__new_activity_logs"."created_at" >= 0 and "__new_activity_logs"."created_at" <= 1000000000000000),
	CONSTRAINT "activity_logs_session_check" CHECK("__new_activity_logs"."ended_at" is null or ("__new_activity_logs"."started_at" is not null and "__new_activity_logs"."ended_at" > "__new_activity_logs"."started_at")),
	CONSTRAINT "activity_logs_review_check" CHECK(("__new_activity_logs"."status" = 'pending') = ("__new_activity_logs"."reviewed_by" is null) and ("__new_activity_logs"."reviewed_by" is null) = ("__new_activity_logs"."reviewed_at" is null)),
	CONSTRAINT "activity_logs_reviewed_at_check" CHECK("__new_activity_logs"."reviewed_at" is null or (typeof("__new_activity_logs"."reviewed_at") = 'integer' and "__new_activity_logs"."reviewed_at" >= 0 and "__new_activity_logs"."reviewed_at" <= 1000000000000000))
);
--> statement-breakpoint
INSERT INTO `__new_activity_logs`("id", "user_id", "activity_id", "category_id", "status", "source", "occurred_on", "started_at", "ended_at", "duration_seconds", "duration_minutes", "quality", "free_value", "computed_hours", "note", "auto_stopped", "created_by", "reviewed_by", "created_at", "reviewed_at") SELECT "id", "user_id", "activity_id", "category_id", "status", "source", "occurred_on", "started_at", "ended_at", "duration_seconds", "duration_minutes", "quality", "free_value", "computed_hours", "note", "auto_stopped", "created_by", "reviewed_by", "created_at", "reviewed_at" FROM `activity_logs`;--> statement-breakpoint
DROP TABLE `activity_logs`;--> statement-breakpoint
ALTER TABLE `__new_activity_logs` RENAME TO `activity_logs`;--> statement-breakpoint
CREATE INDEX `activity_logs_user_day_idx` ON `activity_logs` (`user_id`,`occurred_on`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `activity_logs_status_idx` ON `activity_logs` (`status`);--> statement-breakpoint
CREATE INDEX `activity_logs_activity_id_idx` ON `activity_logs` (`activity_id`);--> statement-breakpoint
CREATE INDEX `activity_logs_category_id_idx` ON `activity_logs` (`category_id`);--> statement-breakpoint
CREATE TABLE `__new_activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`name` text NOT NULL,
	`calc_mode` text NOT NULL,
	`value` real,
	`max_session_minutes` integer,
	`min_session_minutes` integer DEFAULT 5 NOT NULL,
	`presumed_minutes` integer,
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
	CONSTRAINT "activities_presumed_minutes_check" CHECK("__new_activities"."presumed_minutes" is null or (typeof("__new_activities"."presumed_minutes") = 'integer' and "__new_activities"."presumed_minutes" > 0 and "__new_activities"."presumed_minutes" <= 1000000)),
	CONSTRAINT "activities_min_under_max_session_check" CHECK("__new_activities"."max_session_minutes" is null or "__new_activities"."min_session_minutes" <= "__new_activities"."max_session_minutes"),
	CONSTRAINT "activities_repeat_cooldown_days_check" CHECK(typeof("__new_activities"."repeat_cooldown_days") = 'integer' and "__new_activities"."repeat_cooldown_days" >= 0 and "__new_activities"."repeat_cooldown_days" <= 1000000)
);
--> statement-breakpoint
INSERT INTO `__new_activities`("id", "category_id", "name", "calc_mode", "value", "max_session_minutes", "min_session_minutes", "presumed_minutes", "quality_graded", "repeat_cooldown_days", "sort_order", "active") SELECT "id", "category_id", "name", "calc_mode", "value", "max_session_minutes", "min_session_minutes", CASE WHEN "id" = 8 AND "calc_mode" = 'duration' THEN 60 END, "quality_graded", "repeat_cooldown_days", "sort_order", "active" FROM `activities`;--> statement-breakpoint
DROP TABLE `activities`;--> statement-breakpoint
ALTER TABLE `__new_activities` RENAME TO `activities`;--> statement-breakpoint
CREATE INDEX `activities_category_id_idx` ON `activities` (`category_id`);--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
CREATE TRIGGER `ledger_owner_guard_insert`
BEFORE INSERT ON `ledger`
WHEN NEW.`activity_log_id` IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'ledger: the row and its activity log belong to different users')
	WHERE (SELECT `user_id` FROM `activity_logs` WHERE `id` = NEW.`activity_log_id`) <> NEW.`user_id`;
	SELECT RAISE(ABORT, 'ledger: only an approved log is credited')
	WHERE (SELECT `status` FROM `activity_logs` WHERE `id` = NEW.`activity_log_id`) <> 'approved';
END;
--> statement-breakpoint
CREATE TRIGGER `ledger_owner_guard_update`
BEFORE UPDATE ON `ledger`
WHEN NEW.`activity_log_id` IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'ledger: the row and its activity log belong to different users')
	WHERE (SELECT `user_id` FROM `activity_logs` WHERE `id` = NEW.`activity_log_id`) <> NEW.`user_id`;
	SELECT RAISE(ABORT, 'ledger: only an approved log is credited')
	WHERE (SELECT `status` FROM `activity_logs` WHERE `id` = NEW.`activity_log_id`) <> 'approved';
END;
--> statement-breakpoint
CREATE TRIGGER `activity_logs_credited_guard`
BEFORE UPDATE ON `activity_logs`
WHEN (NEW.`status` <> OLD.`status` OR NEW.`user_id` <> OLD.`user_id`)
BEGIN
	SELECT RAISE(ABORT, 'activity_logs: a credited log cannot change owner or leave approved')
	WHERE EXISTS (SELECT 1 FROM `ledger` WHERE `activity_log_id` = OLD.`id`)
	  AND (NEW.`status` <> 'approved' OR NEW.`user_id` <> OLD.`user_id`);
END;
