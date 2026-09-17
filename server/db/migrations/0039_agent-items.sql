CREATE TABLE `agent_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`followup_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`kind` text,
	`status` text,
	`input` text,
	`output` text,
	`diff` text,
	`locations` text,
	`cost` real,
	`tokens` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`followup_id`) REFERENCES `followups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_items_followup_id_idx` ON `agent_items` (`followup_id`);--> statement-breakpoint
CREATE INDEX `agent_items_session_id_idx` ON `agent_items` (`session_id`);