CREATE TABLE `mcp_server_project_off` (
	`project_id` integer NOT NULL,
	`server_id` integer NOT NULL,
	PRIMARY KEY(`project_id`, `server_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
