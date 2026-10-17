CREATE TABLE `availability` (
	`title_id` text NOT NULL,
	`service` text NOT NULL,
	`url` text,
	`valid_to` text,
	`first_seen` text NOT NULL,
	`last_seen` text NOT NULL,
	PRIMARY KEY(`title_id`, `service`),
	FOREIGN KEY (`title_id`) REFERENCES `titles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `availability_service_idx` ON `availability` (`service`);--> statement-breakpoint
CREATE TABLE `titles` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`original_title` text,
	`year` integer,
	`popularity` real,
	`poster` text,
	`tmdb_id` integer,
	`svt_id` text
);
