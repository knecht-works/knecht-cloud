CREATE TABLE `run_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`step_index` integer NOT NULL,
	`step_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`params` text,
	`outputs` text,
	`error` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`log` text DEFAULT '' NOT NULL,
	`parent_step_id` text,
	`iteration` integer,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_steps_run_id_idx` ON `run_steps` (`run_id`);--> statement-breakpoint
ALTER TABLE `runs` ADD `steps` text;