CREATE TABLE `project_links` (
	`project_id` integer NOT NULL,
	`integration` text NOT NULL,
	`external_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`project_id`, `integration`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_links_target_idx` ON `project_links` (`integration`,`external_key`);--> statement-breakpoint
INSERT INTO `project_links` (`project_id`, `integration`, `external_key`) SELECT `id`, 'jira', `jira_project_key` FROM `projects` WHERE `jira_project_key` IS NOT NULL;--> statement-breakpoint
DROP INDEX `projects_jira_project_key_unique`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `jira_project_key`;