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
