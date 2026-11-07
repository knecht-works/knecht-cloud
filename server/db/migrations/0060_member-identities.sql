-- Only a login fills avatar_url, so a member without one was invited but never logged in.
CREATE TABLE `member_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`provider` text NOT NULL,
	`subject` text,
	`username` text NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_identities_member_provider_idx` ON `member_identities` (`member_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `member_identities_subject_idx` ON `member_identities` (`provider`,`subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `member_identities_username_idx` ON `member_identities` (`provider`,`username`);--> statement-breakpoint
INSERT INTO `member_identities` (`member_id`, `provider`, `username`, `verified`) SELECT `id`, 'github', `login`, `avatar_url` IS NOT NULL FROM `members`;
