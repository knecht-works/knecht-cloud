ALTER TABLE `sessions` ADD `object_integration` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `object_key` text;--> statement-breakpoint
UPDATE `sessions` SET `object_integration` = 'github', `object_key` = CAST(`object_number` AS TEXT) WHERE `object_kind` IS NOT NULL;--> statement-breakpoint
DROP INDEX `sessions_object_idx`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `object_number`;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_object_idx` ON `sessions` (`project_id`,`object_integration`,`object_kind`,`object_key`);
