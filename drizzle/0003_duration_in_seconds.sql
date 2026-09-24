-- Hand-edited after `drizzle-kit generate`, for the same two reasons as 0002.
-- The snapshot beside this file is the generated one and is what
-- `schema-drift.test.ts` compares against; only the SQL is hand-written.
--
-- 1. `activity_logs.duration_seconds` has to be BACKFILLED. The generator's
--    rebuild selects the column from the old table, where it does not exist
--    yet, and fails outright.
--
-- 2. `PRAGMA foreign_keys=OFF` is silently ignored inside a transaction, and
--    the migrator wraps every migration in one. `ledger.activity_log_id` points
--    at the table being dropped, so the generated pragma left the DROP failing
--    with `FOREIGN KEY constraint failed`. `defer_foreign_keys` does work inside
--    a transaction: it postpones every check to COMMIT, by which point the
--    table is back with the same ids.
--
-- What this migration is for: #71 amends D17. The duration is stored in
-- SECONDS, and `duration_minutes` becomes that number rounded to the *nearest*
-- minute instead of rounded with a floor of one. `duration_minutes_check` keeps
-- its `> 0`: the floor left the rounding, not the record — a session that does
-- not reach a minute is refused before it is filed (`stopTimer`), so no row may
-- carry a zero. Adding the column at all means rebuilding the table in SQLite.
--
-- **This migration cannot move a balance, and the backfill is why.** Every
-- existing row keeps its `duration_minutes` byte for byte; the new column is
-- filled with `duration_minutes * 60`, which rounds back to exactly the same
-- minutes (`round(m*60/60) = m`). `computed_hours` is frozen (D15) and is
-- copied across untouched, so the ledger cannot move either. The old rows have
-- no finer number to recover — that is the bug #71 fixes going forward, not
-- backwards.

-- The three triggers of 0001 all name `activity_logs`, and the rebuild below
-- drops it. SQLite validates a trigger body against the schema, so leaving them
-- in place makes the DROP fail outright. They are dropped here and recreated
-- verbatim at the end; their rules are unchanged by this migration.
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
	CONSTRAINT "activity_logs_source_check" CHECK("__new_activity_logs"."source" in ('timer', 'admin')),
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
-- `duration_seconds` is BACKFILLED here rather than copied: the old table has
-- no such column. `duration_minutes * 60` is the only honest value available,
-- and it is the one that leaves every row rounding back to the minutes it
-- already had.
INSERT INTO `__new_activity_logs`("id", "user_id", "activity_id", "category_id", "status", "source", "occurred_on", "started_at", "ended_at", "duration_seconds", "duration_minutes", "quality", "free_value", "computed_hours", "note", "auto_stopped", "created_by", "reviewed_by", "created_at", "reviewed_at")
SELECT "id", "user_id", "activity_id", "category_id", "status", "source",
       "occurred_on", "started_at", "ended_at",
       CASE WHEN "duration_minutes" IS NULL THEN NULL ELSE "duration_minutes" * 60 END,
       "duration_minutes", "quality", "free_value", "computed_hours",
       "note", "auto_stopped", "created_by", "reviewed_by",
       "created_at", "reviewed_at"
FROM `activity_logs`;--> statement-breakpoint
DROP TABLE `activity_logs`;--> statement-breakpoint
ALTER TABLE `__new_activity_logs` RENAME TO `activity_logs`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
CREATE INDEX `activity_logs_user_day_idx` ON `activity_logs` (`user_id`,`occurred_on`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `activity_logs_status_idx` ON `activity_logs` (`status`);--> statement-breakpoint
CREATE INDEX `activity_logs_activity_id_idx` ON `activity_logs` (`activity_id`);--> statement-breakpoint
CREATE INDEX `activity_logs_category_id_idx` ON `activity_logs` (`category_id`);
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
