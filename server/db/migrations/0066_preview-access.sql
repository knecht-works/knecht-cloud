ALTER TABLE `projects` ADD `preview_access` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `share_link_hours` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `share_expires_at` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `preview_access` text DEFAULT 'login' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `share_link_hours` integer;
