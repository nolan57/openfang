CREATE TABLE `character_consistency` (
	`id` text PRIMARY KEY,
	`character_name` text NOT NULL,
	`character_description` text NOT NULL,
	`reference_image_url` text,
	`embedding` text NOT NULL,
	`attributes` text NOT NULL,
	`style_guide` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`scene_count` integer DEFAULT 0 NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scene_graph` (
	`id` text PRIMARY KEY,
	`episode` text NOT NULL,
	`scene` text NOT NULL,
	`sequence_order` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`characters` text NOT NULL,
	`location` text,
	`time_of_day` text,
	`mood` text,
	`camera_angle` text,
	`transition_from_prev` text,
	`embedding` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vector_memory` (
	`id` text PRIMARY KEY,
	`node_type` text NOT NULL,
	`node_id` text NOT NULL,
	`entity_title` text NOT NULL,
	`vector_type` text NOT NULL,
	`embedding` text NOT NULL,
	`model` text DEFAULT 'simple' NOT NULL,
	`dimensions` integer DEFAULT 1536 NOT NULL,
	`metadata` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `vec_vector_memory` USING vec0(
  id TEXT,
  embedding float[1536]
);
