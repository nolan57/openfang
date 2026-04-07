import { Database } from "bun:sqlite"
import { Log } from "../../util/log"
import { dbManager } from "./database-manager"

const log = Log.create({ service: "base-repository" })

/**
 * Base Repository for unified SQLite operations.
 * Handles JSON serialization/deserialization and parameterized queries.
 */
export abstract class BaseRepository<T extends Record<string, any>> {
  protected db: Database | null = null
  protected dbName: string
  protected tableName: string
  protected jsonColumns: Set<string>

  constructor(dbName: string, tableName: string, jsonColumns: string[] = []) {
    this.dbName = dbName
    this.tableName = tableName
    this.jsonColumns = new Set(jsonColumns)
  }

  /**
   * Initialize the repository with DB connection and schema.
   */
  async init(createTableSql: string): Promise<void> {
    this.db = await dbManager.getDb(this.dbName)
    try {
      this.db.run(createTableSql)
    } catch (error) {
      log.error("table_migration_failed", { table: this.tableName, error: String(error) })
    }
  }

  /**
   * Insert or replace a record.
   */
  async upsert(data: T): Promise<void> {
    if (!this.db) throw new Error("Repository not initialized")
    
    const keys = Object.keys(data)
    const columns = keys.join(", ")
    const placeholders = keys.map(() => "?").join(", ")
    const values = keys.map(k => this.serialize(data[k]))
    
    const sql = `INSERT OR REPLACE INTO ${this.tableName} (${columns}) VALUES (${placeholders})`
    this.db.prepare(sql).run(...values)
  }

  /**
   * Insert multiple records in a transaction.
   */
  async upsertMany(dataArray: T[]): Promise<void> {
    if (!this.db || dataArray.length === 0) return
    
    const tx = this.db.transaction(() => {
      for (const data of dataArray) {
        const keys = Object.keys(data)
        const columns = keys.join(", ")
        const placeholders = keys.map(() => "?").join(", ")
        const values = keys.map(k => this.serialize(data[k]))
        const sql = `INSERT OR REPLACE INTO ${this.tableName} (${columns}) VALUES (${placeholders})`
        this.db!.prepare(sql).run(...values)
      }
    })
    tx()
    log.debug("batch_upsert_completed", { table: this.tableName, count: dataArray.length })
  }

  /**
   * Select all records.
   */
  async selectAll(condition?: string, params?: any[]): Promise<T[]> {
    if (!this.db) throw new Error("Repository not initialized")
    
    const sql = `SELECT * FROM ${this.tableName}${condition ? ` WHERE ${condition}` : ""}`
    const rows = this.db.prepare(sql).all(...(params || []))
    return rows.map((row: any) => this.deserialize(row))
  }

  /**
   * Select one record by ID.
   */
  async selectById(id: string): Promise<T | null> {
    if (!this.db) throw new Error("Repository not initialized")
    
    const row = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`).get(id)
    return row ? this.deserialize(row as any) : null
  }

  /**
   * Delete a record.
   */
  async deleteById(id: string): Promise<void> {
    if (!this.db) return
    this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`).run(id)
  }

  /**
   * Clear the table.
   */
  async clear(): Promise<void> {
    if (!this.db) return
    this.db.run(`DELETE FROM ${this.tableName}`)
  }

  /**
   * Serialize value for DB (JSON stringify if needed).
   */
  private serialize(value: any): any {
    if (typeof value === "object" && value !== null) {
      return JSON.stringify(value)
    }
    return value
  }

  /**
   * Deserialize value from DB (JSON parse if needed).
   */
  private deserialize(row: any): T {
    for (const key in row) {
      if (this.jsonColumns.has(key) && typeof row[key] === "string") {
        try {
          row[key] = JSON.parse(row[key])
        } catch {
          // If it looks like JSON but fails, leave as string
        }
      }
    }
    return row as T
  }
}
