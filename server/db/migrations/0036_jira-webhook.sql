ALTER TABLE `projects` ADD `jira_project_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_jira_project_key_unique` ON `projects` (`jira_project_key`);--> statement-breakpoint
ALTER TABLE `jira_connection` ADD `account_id` text;--> statement-breakpoint
ALTER TABLE `jira_connection` ADD `webhook_secret_enc` text;
