CREATE TABLE `knowledge_edge` (
	`id` text PRIMARY KEY,
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`relation` text NOT NULL,
	`weight` integer DEFAULT 1,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `knowledge_node` (
	`id` text PRIMARY KEY,
	`type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text,
	`embedding` text,
	`metadata` text,
	`memory_type` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `knowledge_node_type_idx` ON `knowledge_node` (`type`);
CREATE INDEX IF NOT EXISTS `knowledge_node_entity_idx` ON `knowledge_node` (`entity_type`, `entity_id`);
CREATE INDEX IF NOT EXISTS `knowledge_node_memory_type_idx` ON `knowledge_node` (`memory_type`);
--> statement-breakpoint
CREATE TABLE `vector_sync_meta` (
	`id` text PRIMARY KEY,
	`sync_version` integer DEFAULT 1 NOT NULL,
	`last_synced_at` integer NOT NULL,
	`nodes_synced_count` integer DEFAULT 0 NOT NULL
);
