ALTER TABLE `jira_connection` ADD `last_delivery_at` integer;--> statement-breakpoint
ALTER TABLE `jira_connection` ADD `last_delivery_summary` text;--> statement-breakpoint
ALTER TABLE `jira_connection` ADD `last_rejected_at` integer;--> statement-breakpoint
ALTER TABLE `jira_connection` ADD `last_rejected_reason` text;
