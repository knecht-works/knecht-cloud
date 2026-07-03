ALTER TABLE `runs` ADD `commit_sha` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `preview_retention_days` integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `archive_retention_days` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `max_concurrent_envs`;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `teardown_stopped_minutes`;