ALTER TABLE `projects` ADD `php_version` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `node_version` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `dev_server` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `preview_port` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `preview_port` integer;