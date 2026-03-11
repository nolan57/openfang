import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

/**
 * Session memory table - stores session-level memories with TTL support
 */
export const session_memory = sqliteTable(
  "session_memory",
  {
    id: text().primaryKey(),
    /** Agent IDs associated with this session */
    agent_ids: text().notNull(), // JSON array of agent IDs
    /** Creation timestamp */
    created_at: integer().notNull(),
    /** Expiration timestamp (for TTL cleanup) */
    expires_at: integer().notNull(),
    ...Timestamps,
  },
  (table) => [index("session_memory_expires_idx").on(table.expires_at)],
)

/**
 * Session message table - stores individual messages within a session
 */
export const session_message = sqliteTable(
  "session_message",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => session_memory.id, { onDelete: "cascade" }),
    /** Message role: user, assistant, agent, system */
    role: text().notNull(),
    /** Message content */
    content: text().notNull(),
    /** Agent ID if message is from an agent */
    agent_id: text(),
    /** Message timestamp */
    timestamp: integer().notNull(),
    ...Timestamps,
  },
  (table) => [index("session_message_session_idx").on(table.session_id)],
)

/**
 * Project memory table - stores project-level knowledge and patterns
 */
export const project_memory = sqliteTable(
  "project_memory",
  {
    id: text().primaryKey(),
    /** Entity type: file, function, class, etc. */
    entity_type: text().notNull(),
    /** Entity identifier (file path, function name, etc.) */
    entity_id: text().notNull(),
    /** Display title */
    title: text().notNull(),
    /** Content or description */
    content: text(),
    /** File path if applicable */
    file_path: text(),
    /** Line number if applicable */
    line_number: integer(),
    /** JSON metadata */
    metadata: text(),
    /** Vector embedding for semantic search */
    embedding: text(), // JSON array of floats
    ...Timestamps,
  },
  (table) => [
    index("project_memory_entity_type_idx").on(table.entity_type),
    index("project_memory_entity_id_idx").on(table.entity_id),
    index("project_memory_file_path_idx").on(table.file_path),
  ],
)

/**
 * Project memory relations - stores relationships between project entities
 */
export const project_memory_relation = sqliteTable(
  "project_memory_relation",
  {
    id: text().primaryKey(),
    source_id: text()
      .notNull()
      .references(() => project_memory.id, { onDelete: "cascade" }),
    target_id: text()
      .notNull()
      .references(() => project_memory.id, { onDelete: "cascade" }),
    /** Relation type: imports, calls, depends_on, contains, etc. */
    relation_type: text().notNull(),
    /** Weight/strength of the relation */
    weight: integer().default(1),
    ...Timestamps,
  },
  (table) => [
    index("project_memory_relation_source_idx").on(table.source_id),
    index("project_memory_relation_target_idx").on(table.target_id),
  ],
)
