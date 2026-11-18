ALTER TABLE `sessions` ADD `agent_notes` text;--> statement-breakpoint
ALTER TABLE `workflows` ADD `fresh_context` integer DEFAULT false NOT NULL;