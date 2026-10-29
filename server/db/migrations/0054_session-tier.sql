ALTER TABLE `sessions` ADD `tier` text DEFAULT 'code' NOT NULL;--> statement-breakpoint
UPDATE `sessions` SET `tier` = 'preview' WHERE `preview_ready` = 1;
