import { Database } from "bun:sqlite"
import { mkdir } from "fs/promises"
import { dirname, join } from "path"
import { getNovelDataDir } from "../novel-config"
import { Log } from "../../util/log"

const log = Log.create({ service: "database-manager" })

/**
 * Unified Novel Database Manager.
 * Manages SQLite connections for all novel modules.
 * Ensures single connection per DB file, standardizes PRAGMAs (WAL, Foreign Keys).
 */
export class NovelDatabaseManager {
  private static instance: NovelDatabaseManager
  private connections: Map<string, Database> = new Map()

  private constructor() {}

  static getInstance(): NovelDatabaseManager {
    if (!NovelDatabaseManager.instance) {
      NovelDatabaseManager.instance = new NovelDatabaseManager()
    }
    return NovelDatabaseManager.instance
  }

  /**
   * Get or create a database connection.
   * Automatically creates data directory if missing.
   * @param name Database name (without extension), e.g., "branches", "patterns", "story-memory"
   */
  async getDb(name: string): Promise<Database> {
    if (this.connections.has(name)) {
      return this.connections.get(name)!
    }

    const dbPath = join(getNovelDataDir(), "data", `${name}.db`)
    try {
      await mkdir(dirname(dbPath), { recursive: true })
    } catch (error) {
      log.error("novel_db_dir_creation_failed", { name, error: String(error) })
    }

    const db = new Database(dbPath)
    
    // Standardize settings for all DBs
    try {
      db.run("PRAGMA journal_mode = WAL")
      db.run("PRAGMA foreign_keys = ON")
      db.run("PRAGMA busy_timeout = 5000") // Wait 5s if locked
    } catch (error) {
      log.warn("novel_db_pragma_failed", { name, error: String(error) })
    }

    this.connections.set(name, db)
    log.info("novel_db_connected", { name, path: dbPath })
    return db
  }

  /**
   * Close a specific connection.
   */
  close(name: string): void {
    const db = this.connections.get(name)
    if (db) {
      try {
        db.close()
      } catch (error) {
        log.warn("novel_db_close_failed", { name, error: String(error) })
      }
      this.connections.delete(name)
    }
  }

  /**
   * Close all connections. Call this during engine shutdown.
   */
  closeAll(): void {
    for (const [name] of this.connections) {
      this.close(name)
    }
    log.info("novel_db_all_closed")
  }
}

export const dbManager = NovelDatabaseManager.getInstance()
