CREATE TABLE `svt_matches` (
	`svt_id` text PRIMARY KEY NOT NULL,
	`tmdb_kind` text,
	`tmdb_id` integer,
	`title` text,
	`original_title` text,
	`year` integer,
	`poster` text,
	`popularity` real,
	`checked_at` text NOT NULL
);
