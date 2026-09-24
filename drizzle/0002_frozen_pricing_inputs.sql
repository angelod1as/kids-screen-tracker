-- Hand-edited after `drizzle-kit generate`, for two reasons the generator
-- cannot know about. The snapshot beside this file is the generated one and is
-- what `schema-drift.test.ts` compares against; only the SQL is hand-written,
-- exactly as in 0001.
--
-- 1. `activity_logs.category_id` has to be BACKFILLED. Every existing row
--    already counted under a category — the one its activity points at today —
--    and leaving the column null would empty the daily bucket (D3) of every
--    entry ever approved. The generator emits a bare `ADD COLUMN`.
--
-- 2. `timers.max_session_minutes` has to be backfilled too, from the activity
--    the session is running. The generator's rebuild selects the column from
--    the old table, where it does not exist yet, and fails.
--
-- Both columns are the same decision seen twice (D37, D38): a number the engine
-- reads to price an entry is a stamp on the entry, not a live read of a table
-- an adult can edit while the entry is waiting.

-- The three triggers of 0001 all name `activity_logs`, and the rebuild below
-- drops it. SQLite validates a trigger body against the schema, so leaving them
-- in place makes the DROP fail outright:
--   `error in trigger ledger_owner_guard_insert: no such table: main.activity_logs`
-- They are dropped here and recreated verbatim at the end. Their rules are
-- unchanged by this migration; only the table underneath them is rewritten.
DROP TRIGGER `ledger_owner_guard_insert`;--> statement-breakpoint
DROP TRIGGER `ledger_owner_guard_update`;--> statement-breakpoint
DROP TRIGGER `activity_logs_credited_guard`;
--> statement-breakpoint
-- `defer_foreign_keys`, not `foreign_keys=OFF`, and the difference is the whole
-- reason this migration runs at all. The migrator wraps every migration in a
-- transaction, and `PRAGMA foreign_keys` is silently ignored while one is open
-- — the same trap `src/db/client.ts` documents about turning it *on*. So the
-- generated `foreign_keys=OFF` did nothing, and dropping `activity_logs` failed
-- with `FOREIGN KEY constraint failed`, because `ledger.activity_log_id` points
-- at it. `defer_foreign_keys` does work inside a transaction: it postpones every
-- check to COMMIT, by which point the table is back with the same ids.
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
	CONSTRAINT "activity_logs_source_check" CHECK("__new_activity_logs"."source" in ('timer', 'admin')),
	CONSTRAINT "activity_logs_occurred_on_check" CHECK("__new_activity_logs"."occurred_on" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' and date("__new_activity_logs"."occurred_on") is not null and "__new_activity_logs"."occurred_on" = date("__new_activity_logs"."occurred_on")),
	CONSTRAINT "activity_logs_quality_check" CHECK("__new_activity_logs"."quality" is null or "__new_activity_logs"."quality" in (0, 0.3, 0.5, 0.7, 1.0)),
	CONSTRAINT "activity_logs_started_at_check" CHECK("__new_activity_logs"."started_at" is null or (typeof("__new_activity_logs"."started_at") = 'integer' and "__new_activity_logs"."started_at" >= 0 and "__new_activity_logs"."started_at" <= 1000000000000000)),
	CONSTRAINT "activity_logs_ended_at_check" CHECK("__new_activity_logs"."ended_at" is null or (typeof("__new_activity_logs"."ended_at") = 'integer' and "__new_activity_logs"."ended_at" >= 0 and "__new_activity_logs"."ended_at" <= 1000000000000000)),
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
-- `category_id` is BACKFILLED here rather than copied: the old table has no
-- such column. Every approved entry counted under the category its activity
-- points at now, because until this migration that join *was* the rule, so
-- reading it off the join once is exactly the state being frozen. Pending and
-- rejected rows stay null — `activity_logs_category_id_status_check` requires
-- it, and neither has consumed a bucket.
INSERT INTO `__new_activity_logs`("id", "user_id", "activity_id", "category_id", "status", "source", "occurred_on", "started_at", "ended_at", "duration_minutes", "quality", "free_value", "computed_hours", "note", "auto_stopped", "created_by", "reviewed_by", "created_at", "reviewed_at")
SELECT l."id", l."user_id", l."activity_id",
       CASE WHEN l."status" = 'approved' THEN a."category_id" ELSE NULL END,
       l."status", l."source", l."occurred_on", l."started_at", l."ended_at",
       l."duration_minutes", l."quality", l."free_value", l."computed_hours",
       l."note", l."auto_stopped", l."created_by", l."reviewed_by",
       l."created_at", l."reviewed_at"
FROM `activity_logs` l JOIN `activities` a ON a."id" = l."activity_id";--> statement-breakpoint
DROP TABLE `activity_logs`;--> statement-breakpoint
ALTER TABLE `__new_activity_logs` RENAME TO `activity_logs`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
CREATE INDEX `activity_logs_user_day_idx` ON `activity_logs` (`user_id`,`occurred_on`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `activity_logs_status_idx` ON `activity_logs` (`status`);--> statement-breakpoint
CREATE INDEX `activity_logs_activity_id_idx` ON `activity_logs` (`activity_id`);--> statement-breakpoint
CREATE INDEX `activity_logs_category_id_idx` ON `activity_logs` (`category_id`);--> statement-breakpoint
CREATE TABLE `__new_timers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`activity_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`paused_at` integer,
	`accumulated_seconds` integer DEFAULT 0 NOT NULL,
	`max_session_minutes` integer,
	`status` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "timers_status_check" CHECK("__new_timers"."status" in ('running', 'paused', 'stopped', 'abandoned')),
	CONSTRAINT "timers_accumulated_seconds_check" CHECK(typeof("__new_timers"."accumulated_seconds") = 'integer' and "__new_timers"."accumulated_seconds" >= 0 and "__new_timers"."accumulated_seconds" <= 1000000),
	CONSTRAINT "timers_started_at_check" CHECK(typeof("__new_timers"."started_at") = 'integer' and "__new_timers"."started_at" >= 0 and "__new_timers"."started_at" <= 1000000000000000),
	CONSTRAINT "timers_max_session_minutes_check" CHECK("__new_timers"."max_session_minutes" is null or (typeof("__new_timers"."max_session_minutes") = 'integer' and "__new_timers"."max_session_minutes" > 0 and "__new_timers"."max_session_minutes" <= 1000000)),
	CONSTRAINT "timers_paused_at_check" CHECK("__new_timers"."paused_at" is null or (typeof("__new_timers"."paused_at") = 'integer' and "__new_timers"."paused_at" >= 0 and "__new_timers"."paused_at" <= 1000000000000000))
);
--> statement-breakpoint
INSERT INTO `__new_timers`("id", "user_id", "activity_id", "started_at", "paused_at", "accumulated_seconds", "max_session_minutes", "status")
SELECT t."id", t."user_id", t."activity_id", t."started_at", t."paused_at", t."accumulated_seconds", a."max_session_minutes", t."status"
FROM `timers` t JOIN `activities` a ON a."id" = t."activity_id";--> statement-breakpoint
DROP TABLE `timers`;--> statement-breakpoint
ALTER TABLE `__new_timers` RENAME TO `timers`;--> statement-breakpoint
CREATE INDEX `timers_user_status_idx` ON `timers` (`user_id`,`status`);
--> statement-breakpoint
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
