ALTER TABLE `workflows` ADD `draft_steps` text;--> statement-breakpoint
ALTER TABLE `workflows` ADD `published_at` integer;--> statement-breakpoint
UPDATE `workflows` SET `published_at` = `updated_at`;--> statement-breakpoint
ALTER TABLE `runs` ADD `workflow_id` integer REFERENCES workflows(id) ON DELETE SET NULL;--> statement-breakpoint
UPDATE `runs` SET `workflow_id` = (SELECT `id` FROM `workflows` WHERE `workflows`.`name` = `runs`.`workflow`);--> statement-breakpoint
CREATE INDEX `runs_workflow_id_idx` ON `runs` (`workflow_id`);--> statement-breakpoint
CREATE TABLE `__new_triggers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`workflow_id` integer NOT NULL,
	`project_ids` text DEFAULT '[]' NOT NULL,
	`cron` text,
	`next_fire_at` integer,
	`webhook_event` text,
	`webhook_branches` text DEFAULT '[]' NOT NULL,
	`issue_actions` text DEFAULT '["opened"]' NOT NULL,
	`issue_label` text,
	`config` text DEFAULT '{}' NOT NULL,
	`state` text DEFAULT '{}' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_fired_at` integer,
	`fired_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_triggers` (`id`, `source`, `workflow_id`, `project_ids`, `cron`, `next_fire_at`, `webhook_event`, `webhook_branches`, `issue_actions`, `issue_label`, `config`, `state`, `active`, `last_fired_at`, `fired_count`, `created_at`, `updated_at`)
	SELECT t.`id`, t.`source`, w.`id`, t.`project_ids`, t.`cron`, t.`next_fire_at`, t.`webhook_event`, t.`webhook_branches`, t.`issue_actions`, t.`issue_label`, t.`config`, t.`state`, t.`active`, t.`last_fired_at`, t.`fired_count`, t.`created_at`, t.`updated_at`
	FROM `triggers` t JOIN `workflows` w ON w.`name` = t.`workflow`;--> statement-breakpoint
DROP TABLE `triggers`;--> statement-breakpoint
ALTER TABLE `__new_triggers` RENAME TO `triggers`;