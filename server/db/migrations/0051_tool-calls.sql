CREATE TABLE `tool_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text,
	`channel` text NOT NULL,
	`tool` text NOT NULL,
	`input` text,
	`error` text,
	`duration_ms` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tool_calls_created_at_idx` ON `tool_calls` (`created_at`);