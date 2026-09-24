CREATE TABLE `activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`name` text NOT NULL,
	`calc_mode` text NOT NULL,
	`value` real,
	`max_session_minutes` integer,
	`quality_graded` integer DEFAULT false NOT NULL,
	`repeat_cooldown_days` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "activities_calc_mode_check" CHECK("activities"."calc_mode" in ('duration', 'fixed', 'delivery', 'free')),
	CONSTRAINT "activities_value_check" CHECK(("activities"."calc_mode" = 'free' and "activities"."value" is null) or ("activities"."calc_mode" <> 'free' and "activities"."value" is not null)),
	CONSTRAINT "activities_value_range_check" CHECK("activities"."value" is null or (typeof("activities"."value") in ('integer', 'real') and "activities"."value" >= 0 and "activities"."value" <= 1000000)),
	CONSTRAINT "activities_max_session_minutes_check" CHECK("activities"."max_session_minutes" is null or (typeof("activities"."max_session_minutes") = 'integer' and "activities"."max_session_minutes" > 0 and "activities"."max_session_minutes" <= 1000000)),
	CONSTRAINT "activities_repeat_cooldown_days_check" CHECK(typeof("activities"."repeat_cooldown_days") = 'integer' and "activities"."repeat_cooldown_days" >= 0 and "activities"."repeat_cooldown_days" <= 1000000)
);
--> statement-breakpoint
CREATE INDEX `activities_category_id_idx` ON `activities` (`category_id`);--> statement-breakpoint
CREATE TABLE `activity_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`activity_id` integer NOT NULL,
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
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "activity_logs_status_check" CHECK("activity_logs"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "activity_logs_source_check" CHECK("activity_logs"."source" in ('timer', 'admin')),
	CONSTRAINT "activity_logs_occurred_on_check" CHECK("activity_logs"."occurred_on" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' and date("activity_logs"."occurred_on") is not null and "activity_logs"."occurred_on" = date("activity_logs"."occurred_on")),
	CONSTRAINT "activity_logs_quality_check" CHECK("activity_logs"."quality" is null or "activity_logs"."quality" in (0, 0.3, 0.5, 0.7, 1.0)),
	CONSTRAINT "activity_logs_started_at_check" CHECK("activity_logs"."started_at" is null or (typeof("activity_logs"."started_at") = 'integer' and "activity_logs"."started_at" >= 0 and "activity_logs"."started_at" <= 1000000000000000)),
	CONSTRAINT "activity_logs_ended_at_check" CHECK("activity_logs"."ended_at" is null or (typeof("activity_logs"."ended_at") = 'integer' and "activity_logs"."ended_at" >= 0 and "activity_logs"."ended_at" <= 1000000000000000)),
	CONSTRAINT "activity_logs_duration_minutes_check" CHECK("activity_logs"."duration_minutes" is null or (typeof("activity_logs"."duration_minutes") = 'integer' and "activity_logs"."duration_minutes" > 0 and "activity_logs"."duration_minutes" <= 1000000)),
	CONSTRAINT "activity_logs_free_value_check" CHECK("activity_logs"."free_value" is null or (typeof("activity_logs"."free_value") in ('integer', 'real') and "activity_logs"."free_value" >= 0 and "activity_logs"."free_value" <= 1000000)),
	CONSTRAINT "activity_logs_computed_hours_check" CHECK("activity_logs"."computed_hours" is null or (typeof("activity_logs"."computed_hours") in ('integer', 'real') and "activity_logs"."computed_hours" >= 0 and "activity_logs"."computed_hours" <= 1000000)),
	CONSTRAINT "activity_logs_computed_hours_status_check" CHECK(("activity_logs"."status" = 'approved') = ("activity_logs"."computed_hours" is not null)),
	CONSTRAINT "activity_logs_created_at_check" CHECK(typeof("activity_logs"."created_at") = 'integer' and "activity_logs"."created_at" >= 0 and "activity_logs"."created_at" <= 1000000000000000),
	CONSTRAINT "activity_logs_session_check" CHECK("activity_logs"."ended_at" is null or ("activity_logs"."started_at" is not null and "activity_logs"."ended_at" > "activity_logs"."started_at")),
	CONSTRAINT "activity_logs_review_check" CHECK(("activity_logs"."status" = 'pending') = ("activity_logs"."reviewed_by" is null) and ("activity_logs"."reviewed_by" is null) = ("activity_logs"."reviewed_at" is null)),
	CONSTRAINT "activity_logs_reviewed_at_check" CHECK("activity_logs"."reviewed_at" is null or (typeof("activity_logs"."reviewed_at") = 'integer' and "activity_logs"."reviewed_at" >= 0 and "activity_logs"."reviewed_at" <= 1000000000000000))
);
--> statement-breakpoint
CREATE INDEX `activity_logs_user_day_idx` ON `activity_logs` (`user_id`,`occurred_on`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `activity_logs_status_idx` ON `activity_logs` (`status`);--> statement-breakpoint
CREATE INDEX `activity_logs_activity_id_idx` ON `activity_logs` (`activity_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`base_rate` real,
	`decay_step_hours` real,
	`return_bonus_pct` real DEFAULT 0 NOT NULL,
	`return_bonus_after_days` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	CONSTRAINT "categories_decay_step_hours_check" CHECK("categories"."decay_step_hours" is null or (typeof("categories"."decay_step_hours") in ('integer', 'real') and "categories"."decay_step_hours" > 0 and "categories"."decay_step_hours" <= 1000000)),
	CONSTRAINT "categories_base_rate_check" CHECK("categories"."base_rate" is null or (typeof("categories"."base_rate") in ('integer', 'real') and "categories"."base_rate" >= 0 and "categories"."base_rate" <= 1000000)),
	CONSTRAINT "categories_return_bonus_pct_check" CHECK(typeof("categories"."return_bonus_pct") in ('integer', 'real') and "categories"."return_bonus_pct" >= 0 and "categories"."return_bonus_pct" <= 1000000),
	CONSTRAINT "categories_return_bonus_after_days_check" CHECK(typeof("categories"."return_bonus_after_days") = 'integer' and "categories"."return_bonus_after_days" >= 0 and "categories"."return_bonus_after_days" <= 1000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`) WHERE "categories"."active" = 1;--> statement-breakpoint
CREATE TABLE `ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`hours` real NOT NULL,
	`occurred_on` text NOT NULL,
	`destination` text,
	`note` text,
	`activity_log_id` integer,
	`created_by` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`activity_log_id`) REFERENCES `activity_logs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ledger_kind_check" CHECK("ledger"."kind" in ('earn', 'spend', 'refund')),
	CONSTRAINT "ledger_hours_check" CHECK(typeof("ledger"."hours") in ('integer', 'real') and "ledger"."hours" > 0 and "ledger"."hours" <= 1000000),
	CONSTRAINT "ledger_created_at_check" CHECK(typeof("ledger"."created_at") = 'integer' and "ledger"."created_at" >= 0 and "ledger"."created_at" <= 1000000000000000),
	CONSTRAINT "ledger_occurred_on_check" CHECK("ledger"."occurred_on" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' and date("ledger"."occurred_on") is not null and "ledger"."occurred_on" = date("ledger"."occurred_on"))
);
--> statement-breakpoint
CREATE INDEX `ledger_user_day_idx` ON `ledger` (`user_id`,`occurred_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_activity_log_id_unique` ON `ledger` (`activity_log_id`) WHERE "ledger"."activity_log_id" is not null;--> statement-breakpoint
CREATE TABLE `regimes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`label` text NOT NULL,
	`hours_per_day` real NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`started_on` text NOT NULL,
	`note` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "regimes_started_on_check" CHECK("regimes"."started_on" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' and date("regimes"."started_on") is not null and "regimes"."started_on" = date("regimes"."started_on")),
	CONSTRAINT "regimes_hours_per_day_check" CHECK(typeof("regimes"."hours_per_day") in ('integer', 'real') and "regimes"."hours_per_day" >= 0 and "regimes"."hours_per_day" <= 1000000)
);
--> statement-breakpoint
CREATE INDEX `regimes_user_active_idx` ON `regimes` (`user_id`,`active`);--> statement-breakpoint
CREATE TABLE `timers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`activity_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`paused_at` integer,
	`accumulated_seconds` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "timers_status_check" CHECK("timers"."status" in ('running', 'paused', 'stopped', 'abandoned')),
	CONSTRAINT "timers_accumulated_seconds_check" CHECK(typeof("timers"."accumulated_seconds") = 'integer' and "timers"."accumulated_seconds" >= 0 and "timers"."accumulated_seconds" <= 1000000),
	CONSTRAINT "timers_started_at_check" CHECK(typeof("timers"."started_at") = 'integer' and "timers"."started_at" >= 0 and "timers"."started_at" <= 1000000000000000),
	CONSTRAINT "timers_paused_at_check" CHECK("timers"."paused_at" is null or (typeof("timers"."paused_at") = 'integer' and "timers"."paused_at" >= 0 and "timers"."paused_at" <= 1000000000000000))
);
--> statement-breakpoint
CREATE INDEX `timers_user_status_idx` ON `timers` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	CONSTRAINT "users_role_check" CHECK("users"."role" in ('admin', 'kid'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`) WHERE "users"."active" = 1;