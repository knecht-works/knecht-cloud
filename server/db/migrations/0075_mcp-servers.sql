CREATE TABLE `mcp_servers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer,
	`name` text NOT NULL,
	`catalog_id` text,
	`url` text,
	`auth` text DEFAULT 'none' NOT NULL,
	`headers` text DEFAULT '[]' NOT NULL,
	`secrets_enc` text DEFAULT '{}' NOT NULL,
	`oauth_enc` text,
	`connected_by` text,
	`connected_at` integer,
	`auth_error` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_name_idx` ON `mcp_servers` (coalesce(`project_id`, 0),`name`);