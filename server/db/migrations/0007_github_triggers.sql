ALTER TABLE `runs` ADD `inputs` text;--> statement-breakpoint
ALTER TABLE `triggers` ADD `webhook_branches` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `triggers` ADD `issue_actions` text DEFAULT '["opened"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `triggers` ADD `issue_label` text;