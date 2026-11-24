ALTER TABLE `sessions` ADD `base_branch` text;--> statement-breakpoint
ALTER TABLE `triggers` ADD `branch` text;--> statement-breakpoint
UPDATE `sessions` SET `base_branch` = (SELECT `default_branch` FROM `projects` WHERE `projects`.`id` = `sessions`.`project_id`);
