ALTER TABLE `activity_logs` ADD `voided_at` integer;--> statement-breakpoint
ALTER TABLE `activity_logs` ADD `voided_by` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `ledger` ADD `voided_at` integer;--> statement-breakpoint
ALTER TABLE `ledger` ADD `voided_by` integer REFERENCES users(id);