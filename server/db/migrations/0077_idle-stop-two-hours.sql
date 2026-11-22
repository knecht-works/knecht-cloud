PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`idle_stop_minutes` integer DEFAULT 120 NOT NULL,
	`preview_retention_days` integer DEFAULT 7 NOT NULL,
	`archive_retention_days` integer DEFAULT 30 NOT NULL,
	`max_concurrent_runs` integer DEFAULT 2 NOT NULL,
	`preview_access` text DEFAULT 'login' NOT NULL,
	`share_link_hours` integer,
	`ai_provider` text DEFAULT 'opencode' NOT NULL,
	`ai_region` text DEFAULT 'eu' NOT NULL,
	`ai_key_enc` text,
	`ai_model` text DEFAULT 'claude-opus-5-5',
	`ai_subtask_model` text DEFAULT 'claude-sonnet-5',
	`agent_instructions` text DEFAULT '' NOT NULL,
	`workflows_seeded` integer DEFAULT false NOT NULL,
	`ssh_target` text,
	`auto_update_cron` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_settings`("id", "idle_stop_minutes", "preview_retention_days", "archive_retention_days", "max_concurrent_runs", "preview_access", "share_link_hours", "ai_provider", "ai_region", "ai_key_enc", "ai_model", "ai_subtask_model", "agent_instructions", "workflows_seeded", "ssh_target", "auto_update_cron") SELECT "id", "idle_stop_minutes", "preview_retention_days", "archive_retention_days", "max_concurrent_runs", "preview_access", "share_link_hours", "ai_provider", "ai_region", "ai_key_enc", "ai_model", "ai_subtask_model", "agent_instructions", "workflows_seeded", "ssh_target", "auto_update_cron" FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- An install still on the old default moves with it; a value someone picked stays.
UPDATE `settings` SET `idle_stop_minutes` = 120 WHERE `idle_stop_minutes` = 1440;
