CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`stage` text NOT NULL,
	`pending` integer NOT NULL,
	`error` text
);
