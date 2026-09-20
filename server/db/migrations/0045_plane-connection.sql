CREATE TABLE `plane_connection` (
	`id` integer PRIMARY KEY NOT NULL,
	`site_url` text NOT NULL,
	`workspace_slug` text NOT NULL,
	`api_key_enc` text NOT NULL,
	`account_name` text,
	`account_id` text,
	`webhook_secret_enc` text,
	`last_delivery_at` integer,
	`last_delivery_summary` text,
	`last_rejected_at` integer,
	`last_rejected_reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
