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
