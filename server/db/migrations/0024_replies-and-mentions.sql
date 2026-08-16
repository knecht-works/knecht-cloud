ALTER TABLE `followups` ADD `origin` text DEFAULT 'dashboard' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `mentions_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `starter_workflow_id` integer REFERENCES workflows(id);--> statement-breakpoint
ALTER TABLE `workflows` ADD `replies_enabled` integer DEFAULT true NOT NULL;