UPDATE `runs` SET `trigger_id` = NULL WHERE `trigger_id` IN (SELECT `id` FROM `triggers` WHERE `source` = 'manual');--> statement-breakpoint
DELETE FROM `triggers` WHERE `source` = 'manual';
