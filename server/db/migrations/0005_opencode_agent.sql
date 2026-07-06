PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`idle_stop_minutes` integer DEFAULT 1440 NOT NULL,
	`preview_retention_days` integer DEFAULT 7 NOT NULL,
	`archive_retention_days` integer DEFAULT 30 NOT NULL,
	`max_concurrent_runs` integer DEFAULT 2 NOT NULL,
	`ai_key_enc` text,
	`ai_model` text DEFAULT 'anthropic/claude-sonnet-4-5' NOT NULL,
	`workflows_seeded` integer DEFAULT false NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_settings`(`id`, `idle_stop_minutes`, `preview_retention_days`, `archive_retention_days`, `max_concurrent_runs`, `ai_model`, `workflows_seeded`)
SELECT `id`, `idle_stop_minutes`, `preview_retention_days`, `archive_retention_days`, `max_concurrent_runs`, `ai_model`, `workflows_seeded` FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
UPDATE `settings` SET `ai_model` = 'anthropic/claude-sonnet-4-5' WHERE `ai_model` = 'openrouter/auto';
