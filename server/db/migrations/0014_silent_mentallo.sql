ALTER TABLE `runs` ADD `preview_ready` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Grandfather existing runs: their previews were built under the old rule
-- (visible as soon as the env was up), so hiding them until a re-run would
-- regress every live and restorable preview.
UPDATE `runs` SET `preview_ready` = 1 WHERE `env_state` != 'down';
