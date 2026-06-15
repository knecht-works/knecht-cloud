CREATE TABLE `credentials` (
	`id` integer PRIMARY KEY NOT NULL,
	`github_token` text NOT NULL,
	`github_login` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `triggers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`workflow` text NOT NULL,
	`project_ids` text DEFAULT '[]' NOT NULL,
	`cron` text,
	`next_fire_at` integer,
	`webhook_secret` text,
	`webhook_event` text,
	`active` integer DEFAULT true NOT NULL,
	`last_fired_at` integer,
	`fired_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
