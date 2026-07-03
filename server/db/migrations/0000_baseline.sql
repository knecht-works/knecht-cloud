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
--> statement-breakpoint
CREATE TABLE `members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`login` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`is_owner` integer DEFAULT false NOT NULL,
	`invited_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_login_unique` ON `members` (`login`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`github_id` integer NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`full_name` text NOT NULL,
	`default_branch` text NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`clone_url` text NOT NULL,
	`framework` text,
	`framework_version` text,
	`ddev_env` text,
	`env_vars` text DEFAULT '[]' NOT NULL,
	`db_dump_path` text,
	`db_imported` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_github_id_unique` ON `projects` (`github_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`workflow` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`trigger` text,
	`trigger_id` integer,
	`branch` text,
	`commit_sha` text,
	`pr_url` text,
	`log` text DEFAULT '' NOT NULL,
	`env_state` text DEFAULT 'down' NOT NULL,
	`preview_hosts` text DEFAULT '[]' NOT NULL,
	`preview_last_seen` integer,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trigger_id`) REFERENCES `triggers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `runs_project_id_idx` ON `runs` (`project_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`idle_stop_minutes` integer DEFAULT 1440 NOT NULL,
	`preview_retention_days` integer DEFAULT 7 NOT NULL,
	`archive_retention_days` integer DEFAULT 30 NOT NULL,
	`workflows_seeded` integer DEFAULT false NOT NULL
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
--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflows_name_unique` ON `workflows` (`name`);