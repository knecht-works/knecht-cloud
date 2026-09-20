CREATE TABLE `integration_connections` (
	`integration` text PRIMARY KEY NOT NULL,
	`config` text NOT NULL,
	`secrets_enc` text NOT NULL,
	`account_name` text,
	`account_id` text,
	`webhook_secret_enc` text,
	`last_delivery_at` integer,
	`last_delivery_summary` text,
	`last_rejected_at` integer,
	`last_rejected_reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);

--> statement-breakpoint
INSERT INTO `integration_connections` (`integration`, `config`, `secrets_enc`, `account_name`, `account_id`, `webhook_secret_enc`, `last_delivery_at`, `last_delivery_summary`, `last_rejected_at`, `last_rejected_reason`, `created_at`)
SELECT 'jira', json_object('siteUrl', `site_url`, 'email', `email`), json_object('apiToken', `api_token_enc`), `account_name`, `account_id`, `webhook_secret_enc`, `last_delivery_at`, `last_delivery_summary`, `last_rejected_at`, `last_rejected_reason`, `created_at` FROM `jira_connection` WHERE `id` = 1;
--> statement-breakpoint
INSERT INTO `integration_connections` (`integration`, `config`, `secrets_enc`, `account_name`, `account_id`, `webhook_secret_enc`, `last_delivery_at`, `last_delivery_summary`, `last_rejected_at`, `last_rejected_reason`, `created_at`)
SELECT 'plane', json_object('siteUrl', `site_url`, 'workspaceSlug', `workspace_slug`), json_object('apiKey', `api_key_enc`), `account_name`, `account_id`, `webhook_secret_enc`, `last_delivery_at`, `last_delivery_summary`, `last_rejected_at`, `last_rejected_reason`, `created_at` FROM `plane_connection` WHERE `id` = 1;
