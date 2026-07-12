CREATE TABLE `data_migrations` (
	`name` text PRIMARY KEY NOT NULL,
	`applied_at` integer DEFAULT (unixepoch()) NOT NULL
);
