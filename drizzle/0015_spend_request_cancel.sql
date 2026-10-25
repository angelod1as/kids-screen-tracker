-- D59: `spend_requests.status` gains `cancelled`, the boy withdrawing his own
-- pending request. Changing a CHECK means rebuilding the table.
--
-- The snapshot beside this file is generated and is what `schema-drift.test.ts`
-- compares against; only the SQL is hand-edited, as in 0012: `defer_foreign_keys`,
-- not `foreign_keys=OFF`, which the migrator's transaction ignores.
--
-- **This migration cannot move a balance.** Every column is copied as it was;
-- `ledger` is not touched.
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_spend_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`hours` real NOT NULL,
	`destination` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`ledger_id` integer,
	`created_by` integer NOT NULL,
	`reviewed_by` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`reviewed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledger`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "spend_requests_status_check" CHECK("__new_spend_requests"."status" in ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "spend_requests_hours_check" CHECK(typeof("__new_spend_requests"."hours") in ('integer', 'real') and "__new_spend_requests"."hours" > 0 and "__new_spend_requests"."hours" <= 1000000),
	CONSTRAINT "spend_requests_review_check" CHECK(("__new_spend_requests"."status" = 'pending') = ("__new_spend_requests"."reviewed_by" is null) and ("__new_spend_requests"."reviewed_by" is null) = ("__new_spend_requests"."reviewed_at" is null)),
	CONSTRAINT "spend_requests_ledger_check" CHECK(("__new_spend_requests"."status" = 'approved') = ("__new_spend_requests"."ledger_id" is not null)),
	CONSTRAINT "spend_requests_created_at_check" CHECK(typeof("__new_spend_requests"."created_at") = 'integer' and "__new_spend_requests"."created_at" >= 0 and "__new_spend_requests"."created_at" <= 1000000000000000),
	CONSTRAINT "spend_requests_reviewed_at_check" CHECK("__new_spend_requests"."reviewed_at" is null or (typeof("__new_spend_requests"."reviewed_at") = 'integer' and "__new_spend_requests"."reviewed_at" >= 0 and "__new_spend_requests"."reviewed_at" <= 1000000000000000))
);
--> statement-breakpoint
INSERT INTO `__new_spend_requests`("id", "user_id", "hours", "destination", "note", "status", "ledger_id", "created_by", "reviewed_by", "created_at", "reviewed_at") SELECT "id", "user_id", "hours", "destination", "note", "status", "ledger_id", "created_by", "reviewed_by", "created_at", "reviewed_at" FROM `spend_requests`;--> statement-breakpoint
DROP TABLE `spend_requests`;--> statement-breakpoint
ALTER TABLE `__new_spend_requests` RENAME TO `spend_requests`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
CREATE INDEX `spend_requests_user_idx` ON `spend_requests` (`user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `spend_requests_status_idx` ON `spend_requests` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `spend_requests_ledger_id_unique` ON `spend_requests` (`ledger_id`) WHERE "spend_requests"."ledger_id" is not null;