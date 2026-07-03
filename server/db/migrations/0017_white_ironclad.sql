CREATE TABLE `github_app` (
	`id` integer PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`slug` text,
	`html_url` text,
	`client_id` text NOT NULL,
	`client_secret_enc` text NOT NULL,
	`private_key_enc` text NOT NULL,
	`webhook_secret_enc` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
