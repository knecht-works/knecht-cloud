UPDATE `runs` SET `trigger_id` = NULL WHERE `trigger_id` IN (SELECT `id` FROM `triggers` WHERE `source` = 'github' AND json_extract(`config`, '$.event') = 'push');--> statement-breakpoint
DELETE FROM `triggers` WHERE `source` = 'github' AND json_extract(`config`, '$.event') = 'push';
