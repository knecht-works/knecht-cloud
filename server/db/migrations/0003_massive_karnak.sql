ALTER TABLE `runs` ADD `env_state` text DEFAULT 'down' NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `preview_last_seen` integer;