ALTER TABLE `projects` ADD `url_mode` text DEFAULT 'env' NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `url_mode` text;