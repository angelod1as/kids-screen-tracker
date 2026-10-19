CREATE TABLE `spend_requests` (
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
	CONSTRAINT "spend_requests_status_check" CHECK("spend_requests"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "spend_requests_hours_check" CHECK(typeof("spend_requests"."hours") in ('integer', 'real') and "spend_requests"."hours" > 0 and "spend_requests"."hours" <= 1000000),
	CONSTRAINT "spend_requests_review_check" CHECK(("spend_requests"."status" = 'pending') = ("spend_requests"."reviewed_by" is null) and ("spend_requests"."reviewed_by" is null) = ("spend_requests"."reviewed_at" is null)),
	CONSTRAINT "spend_requests_ledger_check" CHECK(("spend_requests"."status" = 'approved') = ("spend_requests"."ledger_id" is not null)),
	CONSTRAINT "spend_requests_created_at_check" CHECK(typeof("spend_requests"."created_at") = 'integer' and "spend_requests"."created_at" >= 0 and "spend_requests"."created_at" <= 1000000000000000),
	CONSTRAINT "spend_requests_reviewed_at_check" CHECK("spend_requests"."reviewed_at" is null or (typeof("spend_requests"."reviewed_at") = 'integer' and "spend_requests"."reviewed_at" >= 0 and "spend_requests"."reviewed_at" <= 1000000000000000))
);
--> statement-breakpoint
CREATE INDEX `spend_requests_user_idx` ON `spend_requests` (`user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `spend_requests_status_idx` ON `spend_requests` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `spend_requests_ledger_id_unique` ON `spend_requests` (`ledger_id`) WHERE "spend_requests"."ledger_id" is not null;