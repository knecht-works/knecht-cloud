CREATE TABLE `followups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`prompt` text NOT NULL,
	`push` integer DEFAULT true NOT NULL,
	`requested_by` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `followups_run_id_idx` ON `followups` (`run_id`);--> statement-breakpoint
CREATE INDEX `followups_status_idx` ON `followups` (`status`);--> statement-breakpoint
ALTER TABLE `run_steps` ADD `origin` text DEFAULT 'workflow' NOT NULL;