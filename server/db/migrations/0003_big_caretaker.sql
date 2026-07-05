ALTER TABLE `settings` ADD `openrouter_key_enc` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `ai_model` text DEFAULT 'openrouter/auto' NOT NULL;