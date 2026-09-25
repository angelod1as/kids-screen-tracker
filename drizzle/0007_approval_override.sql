ALTER TABLE `activity_logs` ADD `overridden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `activity_logs` ADD `rule_hours` real;--> statement-breakpoint
ALTER TABLE `activity_logs` ADD `override_reason` text;