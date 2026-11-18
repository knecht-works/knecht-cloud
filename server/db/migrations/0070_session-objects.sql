-- Objects attach to sessions instead of identifying them. Backfilled before the
-- sessions columns go; no table recreation (enforced FKs would cascade).
CREATE TABLE `session_objects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`integration` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`url` text,
	`title` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_objects_object_idx` ON `session_objects` (`project_id`,`integration`,`kind`,`key`);--> statement-breakpoint
CREATE INDEX `session_objects_session_id_idx` ON `session_objects` (`session_id`);--> statement-breakpoint
INSERT INTO `session_objects` (`session_id`, `project_id`, `integration`, `kind`, `key`, `url`, `title`, `status`, `created_at`)
SELECT `id`, `project_id`, `object_integration`, `object_kind`, `object_key`, `object_url`, `object_title`, `status`, `created_at`
FROM `sessions`
WHERE `object_integration` IS NOT NULL AND `object_kind` IS NOT NULL AND `object_key` IS NOT NULL;--> statement-breakpoint
DROP INDEX `sessions_object_idx`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `object_integration`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `object_kind`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `object_key`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `object_url`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `object_title`;--> statement-breakpoint
DROP INDEX `runs_workflow_version_idx`;--> statement-breakpoint
ALTER TABLE `runs` ADD `object_id` integer REFERENCES session_objects(id) ON DELETE set null;--> statement-breakpoint
UPDATE `runs` SET `object_id` = (SELECT `id` FROM `session_objects` WHERE `session_objects`.`session_id` = `runs`.`session_id`);--> statement-breakpoint
CREATE INDEX `runs_workflow_version_idx` ON `runs` (`workflow_id`,`session_id`,`object_id`,`object_version`);--> statement-breakpoint
ALTER TABLE `followups` ADD `object_id` integer REFERENCES session_objects(id) ON DELETE set null;--> statement-breakpoint
UPDATE `followups` SET `object_id` = (SELECT `id` FROM `session_objects` WHERE `session_objects`.`session_id` = `followups`.`session_id`) WHERE `origin` = 'mention';