-- Sessions (ADR 0006): one session per existing run, SAME id, so the
-- physical env names (run-<id> checkouts, knecht-run-<id> ddev projects,
-- archives/run-<id>) stay valid re-keyed to sessions. Deliberately no table
-- recreations: foreign keys are enforced at runtime (better-sqlite3 default),
-- so dropping `runs` would cascade-delete run_steps and followups. The new
-- session_id columns therefore carry no REFERENCES clause (SQLite cannot add
-- one with a non-null default); the app cleans up explicitly on delete.
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`object_kind` text,
	`object_number` integer,
	`object_url` text,
	`object_title` text,
	`status` text DEFAULT 'open' NOT NULL,
	`branch` text,
	`commit_sha` text,
	`env_state` text DEFAULT 'down' NOT NULL,
	`preview_hosts` text DEFAULT '[]' NOT NULL,
	`preview_ready` integer DEFAULT false NOT NULL,
	`url_mode` text,
	`preview_last_seen` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_object_idx` ON `sessions` (`project_id`,`object_kind`,`object_number`);--> statement-breakpoint
CREATE INDEX `sessions_project_id_idx` ON `sessions` (`project_id`);--> statement-breakpoint
CREATE INDEX `sessions_env_state_idx` ON `sessions` (`env_state`);--> statement-breakpoint
INSERT INTO `sessions` (`id`, `project_id`, `object_kind`, `object_number`, `object_url`, `object_title`, `status`, `branch`, `commit_sha`, `env_state`, `preview_hosts`, `preview_ready`, `url_mode`, `preview_last_seen`, `created_at`, `closed_at`)
SELECT `id`, `project_id`, NULL, NULL, NULL, NULL,
	CASE WHEN `status` IN ('queued', 'running') THEN 'open' ELSE 'closed' END,
	`branch`, `commit_sha`, `env_state`, `preview_hosts`, `preview_ready`, `url_mode`, `preview_last_seen`, `created_at`,
	CASE WHEN `status` IN ('queued', 'running') THEN NULL ELSE COALESCE(`finished_at`, `created_at`) END
FROM `runs`;--> statement-breakpoint
ALTER TABLE `followups` ADD `session_id` integer NOT NULL DEFAULT 0;--> statement-breakpoint
UPDATE `followups` SET `session_id` = `run_id`;--> statement-breakpoint
CREATE INDEX `followups_session_id_idx` ON `followups` (`session_id`);--> statement-breakpoint
ALTER TABLE `runs` ADD `session_id` integer NOT NULL DEFAULT 0;--> statement-breakpoint
UPDATE `runs` SET `session_id` = `id`;--> statement-breakpoint
CREATE INDEX `runs_session_id_idx` ON `runs` (`session_id`);--> statement-breakpoint
ALTER TABLE `runs` DROP COLUMN `commit_sha`;--> statement-breakpoint
ALTER TABLE `runs` DROP COLUMN `env_state`;--> statement-breakpoint
ALTER TABLE `runs` DROP COLUMN `preview_hosts`;--> statement-breakpoint
ALTER TABLE `runs` DROP COLUMN `preview_ready`;--> statement-breakpoint
ALTER TABLE `runs` DROP COLUMN `url_mode`;--> statement-breakpoint
ALTER TABLE `runs` DROP COLUMN `preview_last_seen`;
