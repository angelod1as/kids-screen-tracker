-- D56: the return bonus becomes the same-day alternation bonus. In the table
-- that means one rename and one drop on `categories`:
--   `return_bonus_pct`        -> `alternation_bonus_pct` (same values)
--   `return_bonus_after_days` -> gone (D36 retired; a day-threshold is meaningless)
--
-- The snapshot beside this file is generated and is what `schema-drift.test.ts`
-- compares against; only the SQL is hand-written, as in 0001 and 0002.
--
-- `defer_foreign_keys=ON`, not `foreign_keys=OFF`, for the reason 0002 spells
-- out: the migrator wraps each migration in a transaction, where `PRAGMA
-- foreign_keys` is ignored. `activities.category_id` and
-- `activity_logs.category_id` reference `categories`, so dropping it without
-- deferring fails with `FOREIGN KEY constraint failed`.
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`base_rate` real,
	`decay_step_hours` real,
	`alternation_bonus_pct` real DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	CONSTRAINT "categories_decay_step_hours_check" CHECK("__new_categories"."decay_step_hours" is null or (typeof("__new_categories"."decay_step_hours") in ('integer', 'real') and "__new_categories"."decay_step_hours" > 0 and "__new_categories"."decay_step_hours" <= 1000000)),
	CONSTRAINT "categories_base_rate_check" CHECK("__new_categories"."base_rate" is null or (typeof("__new_categories"."base_rate") in ('integer', 'real') and "__new_categories"."base_rate" >= 0 and "__new_categories"."base_rate" <= 1000000)),
	CONSTRAINT "categories_alternation_bonus_pct_check" CHECK(typeof("__new_categories"."alternation_bonus_pct") in ('integer', 'real') and "__new_categories"."alternation_bonus_pct" >= 0 and "__new_categories"."alternation_bonus_pct" <= 1000000)
);
--> statement-breakpoint
INSERT INTO `__new_categories`("id", "name", "base_rate", "decay_step_hours", "alternation_bonus_pct", "sort_order", "active")
SELECT "id", "name", "base_rate", "decay_step_hours", "return_bonus_pct", "sort_order", "active" FROM `categories`;--> statement-breakpoint
DROP TABLE `categories`;--> statement-breakpoint
ALTER TABLE `__new_categories` RENAME TO `categories`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`) WHERE "categories"."active" = 1;
