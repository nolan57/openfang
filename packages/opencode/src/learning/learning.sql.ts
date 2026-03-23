import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
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

export const knowledge = sqliteTable(
  "knowledge",
  {
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
  },
  (table) => ({
    // 索引：按来源过滤知识条目
    source_idx: index("knowledge_source_idx").on(table.source),
    // 索引：查找未处理的知识条目
    processed_idx: index("knowledge_processed_idx").on(table.processed),
  }),
)

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
  // [ENH] TTL: Optional expiration timestamp (Unix milliseconds)
  expires_at: integer(), // null means no expiration
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

// Renamed to plural form for consistency with usage across the codebase
export const knowledge_nodes = sqliteTable(
  "knowledge_node",
  {
    id: text().primaryKey(),
    type: text().notNull(), // "file" | "skill" | "memory" | "constraint" | "agenda"
    entity_type: text().notNull(),
    entity_id: text().notNull(),
    title: text().notNull(),
    content: text(),
    embedding: text(), // JSON vector for semantic search
    metadata: text(), // JSON additional data
    // [ENH] Target 2: Memory type for cross-type linking
    memory_type: text(), // "session" | "evolution" | "project" | "media" | null
    ...Timestamps,
  },
  (table) => ({
    // 索引：按类型查找节点（findNodesByType 使用）
    type_idx: index("knowledge_node_type_idx").on(table.type),
    // 索引：按实体查找（去重检查）
    entity_idx: index("knowledge_node_entity_idx").on(table.entity_type, table.entity_id),
    // [ENH] 索引：按记忆类型查找（跨类型关联使用）
    memory_type_idx: index("knowledge_node_memory_type_idx").on(table.memory_type),
  }),
)

export const knowledge_edges = sqliteTable(
  "knowledge_edge",
  {
    id: text().primaryKey(),
    source_id: text().notNull(),
    target_id: text().notNull(),
    relation: text().notNull(), // "depends_on" | "related_to" | "conflicts_with" | "derives_from"
    weight: integer().default(1),
    ...Timestamps,
  },
  (table) => ({
    // 索引：查找节点的出边（getRelatedNodes 使用）
    source_idx: index("knowledge_edge_source_idx").on(table.source_id),
    // 索引：查找节点的入边（依赖检查、deleteNode 使用）
    target_idx: index("knowledge_edge_target_idx").on(table.target_id),
    // 索引：按关系类型过滤（getRelatedNodes 过滤使用）
    relation_idx: index("knowledge_edge_relation_idx").on(table.relation),
  }),
)

// Backward compatibility aliases (deprecated, use plural forms)
/** @deprecated Use `knowledge_nodes` instead */
export const knowledge_node = knowledge_nodes
/** @deprecated Use `knowledge_edges` instead */
export const knowledge_edge = knowledge_edges

export const vector_sync_meta = sqliteTable("vector_sync_meta", {
  id: text().primaryKey(), // always "sync_state"
  sync_version: integer().notNull().default(1),
  last_synced_at: integer().notNull(), // timestamp
  nodes_synced_count: integer().notNull().default(0),
})
