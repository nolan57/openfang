/**
 * System metadata table for storing configuration values
 * Used for vector dimension tracking and other system-level settings
 */

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const Timestamps = {
  time_created: integer()
    .notNull()
    .$default(() => Date.now()),
  time_updated: integer()
    .notNull()
    .$onUpdate(() => Date.now()),
}

/**
 * System metadata table for storing key-value configuration
 */
export const system_metadata = sqliteTable("system_metadata", {
  key: text().primaryKey(),
  value: text().notNull(),
  value_type: text().notNull().default("string"), // "string" | "number" | "json"
  description: text(),
  ...Timestamps,
})
