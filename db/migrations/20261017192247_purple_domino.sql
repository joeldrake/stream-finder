CREATE TABLE `imdb_ratings` (
	`tmdb_key` text PRIMARY KEY NOT NULL,
	`imdb_id` text,
	`checked_at` text NOT NULL,
	`rating` real,
	`votes` integer,
	`rated_at` text
);
--> statement-breakpoint
CREATE INDEX `imdb_ratings_imdb_id_idx` ON `imdb_ratings` (`imdb_id`);