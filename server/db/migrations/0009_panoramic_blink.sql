CREATE TABLE `jira_connection` (
	`id` integer PRIMARY KEY NOT NULL,
	`site_url` text NOT NULL,
	`email` text NOT NULL,
	`api_token_enc` text NOT NULL,
	`account_name` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `triggers` ADD `config` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `triggers` ADD `state` text DEFAULT '{}' NOT NULL;