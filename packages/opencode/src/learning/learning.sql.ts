import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

export const learning_runs = sqliteTable("learning_run", {
  id: text().primaryKey(),
  trigger: text().notNull(), // "cron" | "idle" | "manual"
  status: text().notNull(), // "running" | "completed" | "failed"
  topics: text().notNull(), // JSON array
  items_collected: integer().notNull().default(0),
  notes_created: integer().notNull().default(0),
  ...Timestamps,
})

export const knowledge = sqliteTable("knowledge", {
  id: text().primaryKey(),
  run_id: text()
    .notNull()
    .references(() => learning_runs.id),
  source: text().notNull(), // "search" | "arxiv" | "github" | "blog"
  url: text().notNull(),
  title: text().notNull(),
  summary: text().notNull(),
  tags: text().notNull(), // JSON array
  value_score: integer().notNull().default(0), // 0-100
  action: text().notNull(), // "note_only" | "install_skill" | "code_suggestion"
  processed: integer().notNull().default(0), // boolean
  ...Timestamps,
})

export const negative_memory = sqliteTable("negative_memory", {
  id: text().primaryKey(),
  failure_type: text().notNull(), // "install_failed" | "skill_conflict" | "performance_regression" | "security_issue" | "runtime_error"
  description: text().notNull(),
  context: text().notNull(), // JSON - relevant context (URL, skill name, error message, etc.)
  severity: integer().notNull().default(1), // 1-5
  times_encountered: integer().notNull().default(1),
  blocked_items: text().notNull(), // JSON array of blocked URLs/names
  ...Timestamps,
})

export const archive_snapshot = sqliteTable("archive_snapshot", {
  id: text().primaryKey(),
  snapshot_type: text().notNull(), // "pre_evolution" | "pre_skill_install" | "pre_code_change" | "golden"
  description: text().notNull(),
  state: text().notNull(), // JSON - serialized state (skills, config, etc.)
  checksum: text().notNull(), // SHA256 of state for integrity verification
  parent_id: text(), // reference to parent snapshot for lineage
  is_golden: integer().notNull().default(0), // boolean - golden snapshot for rollback
  ...Timestamps,
})

export const vector_memory = sqliteTable("vector_memory", {
  id: text().primaryKey(),
  node_type: text().notNull(), // "memory" | "skill" | "constraint" | "character" | "scene"
  node_id: text().notNull(), // reference to entity ID
  entity_title: text().notNull(), // entity title for display
  vector_type: text().notNull(), // "content" | "code" | "constraint" | "character" | "scene" | "style"
  embedding: text().notNull(), // JSON array of floats
  model: text().notNull().default("simple"), // "simple" | "openai" | "local"
  dimensions: integer().notNull().default(384),
  metadata: text(), // JSON - additional data
  ...Timestamps,
})

export const character_consistency = sqliteTable("character_consistency", {
  id: text().primaryKey(),
  character_name: text().notNull(),
  character_description: text().notNull(), // Detailed description for generation
  reference_image_url: text(), // Optional reference image
  embedding: text().notNull(), // Character embedding for consistency
  attributes: text().notNull(), // JSON - visual attributes (hair color, eye shape, etc.)
  style_guide: text().notNull(), // JSON - style constraints
  version: integer().notNull().default(1),
  scene_count: integer().notNull().default(0),
  ...Timestamps,
})

export const scene_graph = sqliteTable("scene_graph", {
  id: text().primaryKey(),
  episode: text().notNull(), // e.g., "ep01"
  scene: text().notNull(), // e.g., "scene_01"
  sequence_order: integer().notNull(),
  title: text().notNull(),
  description: text().notNull(),
  characters: text().notNull(), // JSON array of character IDs
  location: text(),
  time_of_day: text(),
  mood: text(),
  camera_angle: text(),
  transition_from_prev: text(), // "cut" | "fade" | "dissolve" | etc.
  embedding: text().notNull(), // Scene embedding for similarity
  ...Timestamps,
})

export const vector_sync_meta = sqliteTable("vector_sync_meta", {
  id: text().primaryKey(), // always "sync_state"
  sync_version: integer().notNull().default(1),
  last_synced_at: integer().notNull(), // timestamp
  nodes_synced_count: integer().notNull().default(0),
})
