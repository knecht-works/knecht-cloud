PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`idle_stop_minutes` integer DEFAULT 1440 NOT NULL,
	`preview_retention_days` integer DEFAULT 7 NOT NULL,
	`archive_retention_days` integer DEFAULT 30 NOT NULL,
	`workflows_seeded` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_settings`("id", "idle_stop_minutes", "preview_retention_days", "archive_retention_days", "workflows_seeded") SELECT "id", "idle_stop_minutes", "preview_retention_days", "archive_retention_days", "workflows_seeded" FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
UPDATE `settings` SET `idle_stop_minutes` = 1440;