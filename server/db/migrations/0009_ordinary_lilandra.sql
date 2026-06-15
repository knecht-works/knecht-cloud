CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`idle_stop_minutes` integer DEFAULT 30 NOT NULL,
	`max_concurrent_envs` integer DEFAULT 5 NOT NULL,
	`teardown_stopped_minutes` integer DEFAULT 180 NOT NULL
);
