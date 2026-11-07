-- No table rebuild: better-sqlite3 enforces foreign keys, so dropping projects would cascade into runs and sessions.
-- SQLite only adds a NOT NULL column with a default; every insert sets repo_id.
DROP INDEX `projects_github_id_unique`;--> statement-breakpoint
ALTER TABLE `projects` ADD `repo_provider` text DEFAULT 'github' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `repo_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `projects` SET `repo_id` = CAST(`github_id` AS text);--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `github_id`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `clone_url`;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_repo_idx` ON `projects` (`repo_provider`,`repo_id`);
