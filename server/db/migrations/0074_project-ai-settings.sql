CREATE TABLE `project_ai_settings` (
	`project_id` integer PRIMARY KEY NOT NULL,
	`ai_provider` text,
	`ai_region` text,
	`ai_key_enc` text,
	`ai_model` text,
	`ai_subtask_model` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
