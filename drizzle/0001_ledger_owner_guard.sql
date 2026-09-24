-- Hand-written, because `drizzle-kit generate` does not emit triggers and these
-- three invariants cannot be written as CHECK constraints: a CHECK sees one row
-- of one table, and each of these is about two tables at once.
--
-- 1. A ledger row and the log it credits belong to the same boy. `user_id` and
--    `activity_log_id` are independent foreign keys, and nothing tied them:
--    `ledger(user_id = Kid2, activity_log_id = <a log of Kid1's>)` was
--    accepted. The credit would land in Kid2's statement and the entry detail
--    would show his brother's activity — which is the one thing the access rule
--    says must never cross.
-- 2. Only an approved log is credited. D19 says rejecting creates nothing; a
--    `rejected` log with a ledger row pointing at it was accepted.
-- 3. The two above stay true afterwards, so a credited log cannot be moved out
--    of `approved` or handed to the other boy while its ledger row exists.
--
-- SQLite has no composite foreign key without a redundant column, and a
-- redundant `user_id` on the ledger would be a second copy of the truth to keep
-- in step. A trigger states the rule once.
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
