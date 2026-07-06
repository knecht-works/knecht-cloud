ALTER TABLE `settings` ADD `ai_provider` text DEFAULT 'anthropic' NOT NULL;--> statement-breakpoint
UPDATE `settings` SET `ai_provider` = substr(`ai_model`, 1, instr(`ai_model`, '/') - 1) WHERE instr(`ai_model`, '/') > 1;
