CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`github_id` integer NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`full_name` text NOT NULL,
	`default_branch` text NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`clone_url` text NOT NULL,
	`site_url` text,
	`env_vars` text DEFAULT '[]' NOT NULL,
	`db_dump_path` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_github_id_unique` ON `projects` (`github_id`);