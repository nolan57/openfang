import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

export const collab_agents = sqliteTable("collab_agents", {
  id: text().primaryKey(),
  name: text().notNull(),
  type: text().notNull(),
  role: text().notNull(),
  state: text().notNull().default("idle"),
  capabilities: text().notNull(),
  config: text().notNull(),
  createdAt: text().notNull(),
  lastActiveAt: text().notNull(),
})

export const collab_tasks = sqliteTable("collab_tasks", {
  id: text().primaryKey(),
  agentId: text().notNull(),
  action: text().notNull(),
  payload: text().notNull(),
  requirements: text().notNull(),
  priority: text().notNull().default("normal"),
  timeout: integer(),
  dependencies: text(),
  status: text().notNull().default("pending"),
  result: text(),
  error: text(),
  createdAt: text().notNull(),
  startedAt: text(),
  completedAt: text(),
})

export const collab_messages = sqliteTable("collab_messages", {
  id: text().primaryKey(),
  type: text().notNull(),
  from: text().notNull(),
  to: text(),
  content: text().notNull(),
  timestamp: text().notNull(),
})
