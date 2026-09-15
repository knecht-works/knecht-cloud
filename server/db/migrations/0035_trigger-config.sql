UPDATE `triggers` SET `config` = json_object('event', coalesce(`webhook_event`, 'push'), 'branches', json(`webhook_branches`), 'issueActions', json(`issue_actions`), 'issueLabel', `issue_label`) WHERE `source` = 'github';--> statement-breakpoint
ALTER TABLE `triggers` DROP COLUMN `webhook_event`;--> statement-breakpoint
ALTER TABLE `triggers` DROP COLUMN `webhook_branches`;--> statement-breakpoint
ALTER TABLE `triggers` DROP COLUMN `issue_actions`;--> statement-breakpoint
ALTER TABLE `triggers` DROP COLUMN `issue_label`;
