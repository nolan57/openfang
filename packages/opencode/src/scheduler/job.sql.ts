import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

/**
 * Scheduler job table - stores scheduled task definitions
 */
export const scheduler_job = sqliteTable(
  "scheduler_job",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    description: text(),

    // Schedule configuration
    schedule_type: text().notNull(), // "cron" | "interval" | "once"
    schedule_expr: text().notNull(), // JSON of schedule config

    // Payload configuration
    payload_type: text().notNull(), // "agentTurn" | "systemEvent"
    payload: text({ mode: "json" }).notNull(), // JSON of payload config

    // Options
    options: text({ mode: "json" }),

    // State
    enabled: integer({ mode: "boolean" }).notNull().default(true),
    last_run_at: integer(),
    next_run_at: integer(),
    last_status: text(), // "success" | "failed" | "running"
    last_error: text(),
    consecutive_errors: integer().notNull().default(0),

    ...Timestamps,
  },
  (table) => [
    index("scheduler_job_enabled_idx").on(table.enabled),
    index("scheduler_job_next_run_idx").on(table.next_run_at),
  ]
)

/**
 * Scheduler execution table - stores execution records
 */
export const scheduler_execution = sqliteTable(
  "scheduler_execution",
  {
    id: text().primaryKey(),
    job_id: text()
      .notNull()
      .references(() => scheduler_job.id, { onDelete: "cascade" }),

    status: text().notNull().default("pending"), // "pending" | "running" | "success" | "failed" | "paused" | "cancelled"
    started_at: integer(),
    finished_at: integer(),
    duration_ms: integer(),

    output: text(), // Execution output
    error: text(), // Error message

    heartbeat_at: integer(), // Last heartbeat timestamp

    ...Timestamps,
  },
  (table) => [
    index("scheduler_execution_job_idx").on(table.job_id),
    index("scheduler_execution_status_idx").on(table.status),
  ]
)

/**
 * Scheduler log table - stores execution logs
 */
export const scheduler_log = sqliteTable(
  "scheduler_log",
  {
    id: text().primaryKey(),
    execution_id: text()
      .notNull()
      .references(() => scheduler_execution.id, { onDelete: "cascade" }),

    level: text().notNull(), // "info" | "error" | "warn" | "debug" | "stream"
    message: text().notNull(),
    timestamp: integer().notNull(),
  },
  (table) => [index("scheduler_log_execution_idx").on(table.execution_id)]
)