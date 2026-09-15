DELETE FROM `triggers` WHERE `source` = 'jira';--> statement-breakpoint
ALTER TABLE `triggers` DROP COLUMN `state`;
