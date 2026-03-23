CREATE TABLE `archive_snapshot` (
	`id` text PRIMARY KEY,
	`snapshot_type` text NOT NULL,
	`description` text NOT NULL,
	`state` text NOT NULL,
	`checksum` text NOT NULL,
	`parent_id` text,
	`is_golden` integer DEFAULT 0 NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `knowledge` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`source` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`tags` text NOT NULL,
	`value_score` integer DEFAULT 0 NOT NULL,
	`action` text NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_knowledge_run_id_learning_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `learning_run`(`id`)
);
--> statement-breakpoint
CREATE TABLE `learning_run` (
	`id` text PRIMARY KEY,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`topics` text NOT NULL,
	`items_collected` integer DEFAULT 0 NOT NULL,
	`notes_created` integer DEFAULT 0 NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `negative_memory` (
	`id` text PRIMARY KEY,
	`failure_type` text NOT NULL,
	`description` text NOT NULL,
	`context` text NOT NULL,
	`severity` integer DEFAULT 1 NOT NULL,
	`times_encountered` integer DEFAULT 1 NOT NULL,
	`blocked_items` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
