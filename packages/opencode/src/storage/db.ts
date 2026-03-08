import { Database as BunDatabase } from "bun:sqlite"
import { drizzle, type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { Context } from "../util/context"
import { lazy } from "../util/lazy"
import { Global } from "../global"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import path from "path"
import { readFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, statSync, unlinkSync } from "fs"
import * as schema from "./schema"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number }[] | undefined

// ====== Database Backup & Recovery Logic ======
const DB_PATH = path.join(Global.Path.data, "opencode.db")
const BACKUP_DIR = path.join(Global.Path.data, "backups")
const MAX_BACKUPS = 5

function isDatabaseHealthy(dbPath: string): boolean {
  try {
    const db = new BunDatabase(dbPath)
    const result = db.query("PRAGMA quick_check;").all()
    db.close()
    return result.length === 0 || (result.length === 1 && (result[0] as Record<string, unknown>)["quick_check"] === "ok")
  } catch (err) {
    log.warn("database health check failed", { path: dbPath, error: err })
    return false
  }
}

function getLatestBackup(): string | null {
  if (!existsSync(BACKUP_DIR)) return null

  const backups = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("opencode.db.bak."))
    .map((f) => ({ name: f, time: statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time)

  return backups.length > 0 ? path.join(BACKUP_DIR, backups[0].name) : null
}

export function createBackup(): void {
  try {
    if (!existsSync(BACKUP_DIR)) {
      mkdirSync(BACKUP_DIR, { recursive: true })
    }

    if (!existsSync(DB_PATH)) {
      log.info("database does not exist, skipping backup")
      return
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backupPath = path.join(BACKUP_DIR, `opencode.db.bak.${timestamp}`)
    copyFileSync(DB_PATH, backupPath)
    log.info("database backup created", { backupPath })

    // Clean up old backups - keep only the most recent MAX_BACKUPS
    const backups = readdirSync(BACKUP_DIR).filter((f) => f.startsWith("opencode.db.bak."))
    if (backups.length > MAX_BACKUPS) {
      backups
        .map((f) => ({ name: f, time: statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
        .sort((a, b) => a.time - b.time)
        .slice(0, backups.length - MAX_BACKUPS)
        .forEach((b) => {
          try {
            unlinkSync(path.join(BACKUP_DIR, b.name))
            log.debug("removed old backup", { name: b.name })
          } catch (e) {
            log.warn("failed to remove old backup", { name: b.name, error: e })
          }
        })
    }
  } catch (err) {
    log.error("failed to create database backup", { error: err })
  }
}

function ensureDatabaseIntegrity(): void {
  // If database doesn't exist, let Drizzle create it later
  if (!existsSync(DB_PATH)) {
    log.info("database does not exist, will be created on first use")
    return
  }

  if (isDatabaseHealthy(DB_PATH)) {
    log.info("database is healthy")
    return
  }

  log.warn("database is corrupted or unreadable, attempting recovery...")

  // First, backup the corrupted database for debugging
  const corruptedPath = path.join(BACKUP_DIR, `opencode.db.corrupted.${Date.now()}`)
  try {
    if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true })
    copyFileSync(DB_PATH, corruptedPath)
    log.info("corrupted database saved for inspection", { path: corruptedPath })
  } catch (e) {
    log.error("failed to save corrupted database", { error: e })
  }

  // Try to restore from latest backup
  const latestBackup = getLatestBackup()
  if (latestBackup) {
    log.info("restoring database from backup", { backup: latestBackup })
    try {
      copyFileSync(latestBackup, DB_PATH)
      if (isDatabaseHealthy(DB_PATH)) {
        log.info("database recovery successful!")
        return
      } else {
        log.error("backup is also corrupted, will try other options")
      }
    } catch (e) {
      log.error("failed to restore from backup", { error: e })
    }
  }

  // All backups failed, delete corrupted database and let Drizzle recreate it
  try {
    unlinkSync(DB_PATH)
    log.info("deleted corrupted database, will recreate on next use")
  } catch (e) {
    log.error("failed to delete corrupted database", { error: e })
  }
}
// ====== End of Backup & Recovery Logic ======

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export namespace Database {
  export const Path = path.join(Global.Path.data, "opencode.db")
  type Schema = typeof schema
  export type Transaction = SQLiteTransaction<"sync", void, Schema>

  type Client = SQLiteBunDatabase<Schema>

  type Journal = { sql: string; timestamp: number }[]

  function time(tag: string) {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
    if (!match) return 0
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    )
  }

  function migrations(dir: string): Journal {
    const dirs = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    const sql = dirs
      .map((name) => {
        const file = path.join(dir, name, "migration.sql")
        if (!existsSync(file)) return
        return {
          sql: readFileSync(file, "utf-8"),
          timestamp: time(name),
        }
      })
      .filter(Boolean) as Journal

    return sql.sort((a, b) => a.timestamp - b.timestamp)
  }

  export const Client = lazy(() => {
    // On macOS, Apple's SQLite doesn't support dynamic extensions
    // Use Homebrew's vanilla SQLite which supports extensions
    // Must be called before any SQLite operations
    if (process.platform === "darwin") {
      BunDatabase.setCustomSQLite("/opt/homebrew/Cellar/sqlite/3.51.2_1/lib/libsqlite3.dylib")
    }

    // Ensure database integrity before first use
    ensureDatabaseIntegrity()

    const sqlite = new BunDatabase(path.join(Global.Path.data, "opencode.db"), { create: true })

    sqlite.run("PRAGMA journal_mode = WAL")
    sqlite.run("PRAGMA synchronous = NORMAL")
    sqlite.run("PRAGMA busy_timeout = 5000")
    sqlite.run("PRAGMA cache_size = -64000")
    sqlite.run("PRAGMA foreign_keys = ON")
    sqlite.run("PRAGMA wal_checkpoint(PASSIVE)")

    // Load sqlite-vec extension for vector search
    // Use Bun's native loadExtension API with the binary file path
    try {
      const platform = process.platform
      const arch = process.arch
      let vecFileName: string
      let platformName: string

      if (platform === "darwin") {
        vecFileName = "vec0.dylib"
        platformName = "darwin"
      } else if (platform === "linux") {
        vecFileName = "vec0.so"
        platformName = "linux"
      } else if (platform === "win32") {
        vecFileName = "vec0.dll"
        platformName = "windows"
      } else {
        throw new Error(`Unsupported platform: ${platform}`)
      }

      const archSuffix = arch === "arm64" ? "-arm64" : "-x64"
      const platformPkg = `sqlite-vec-${platformName}${archSuffix}`

      // Go up 4 levels from packages/opencode/src/storage/db.ts to project root
      const projectRoot = path.resolve(import.meta.dirname, "../../../..")

      log.debug("sqlite-vec loading", { platform, arch, platformName, platformPkg, projectRoot })

      const possiblePaths = [
        path.join(
          projectRoot,
          "node_modules/.bun",
          `${platformPkg}@0.1.7-alpha.2/node_modules/${platformPkg}`,
          vecFileName,
        ),
        path.join(projectRoot, "node_modules", platformPkg, vecFileName),
        path.join(projectRoot, "packages/opencode/node_modules", platformPkg, vecFileName),
      ]

      log.debug("sqlite-vec checking paths", { possiblePaths })

      let loaded = false
      for (const vecPath of possiblePaths) {
        if (existsSync(vecPath)) {
          log.info("loading sqlite-vec from", { vecPath })
          try {
            sqlite.loadExtension(vecPath)
            // Verify the extension is loaded by testing vec0 (some versions don't have vec0_version)
            try {
              sqlite.exec("SELECT vec0_version()")
              log.info("sqlite-vec loaded successfully", { vecPath })
            } catch {
              // Extension loaded but vec0_version doesn't exist - that's ok
              log.info("sqlite-vec loaded (vec0_version not available)", { vecPath })
            }
            loaded = true
            break
          } catch (loadError) {
            log.error("failed to load sqlite-vec extension", {
              vecPath,
              error: loadError instanceof Error ? loadError.message : String(loadError),
            })
          }
        }
      }

      if (!loaded) {
        log.warn("sqlite-vec binary not found or failed to load", { platform, arch, possiblePaths })
      }
    } catch (error) {
      log.error("failed to load sqlite-vec extension", { error: error instanceof Error ? error.message : String(error) })
    }

    const db = drizzle({ client: sqlite, schema })

    // Apply schema migrations
    const entries =
      typeof OPENCODE_MIGRATIONS !== "undefined"
        ? OPENCODE_MIGRATIONS
        : migrations(path.join(import.meta.dirname, "../../migration"))
    if (entries.length > 0) {
      log.info("applying migrations", {
        count: entries.length,
        mode: typeof OPENCODE_MIGRATIONS !== "undefined" ? "bundled" : "dev",
      })
      migrate(db, entries)
    }

    return db
  })

  export function raw(): BunDatabase {
    return Client().$client
  }

  export type TxOrDb = Transaction | Client

  const ctx = Context.create<{
    tx: TxOrDb
    effects: (() => void | Promise<void>)[]
  }>("database")

  export function use<T>(callback: (trx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }

  export function effect(fn: () => any | Promise<any>) {
    try {
      ctx.use().effects.push(fn)
    } catch {
      fn()
    }
  }

  export function transaction<T>(callback: (tx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = Client().transaction((tx) => {
          return ctx.provide({ tx, effects }, () => callback(tx))
        })
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }
}
