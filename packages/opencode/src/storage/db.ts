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
import { readFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, statSync, unlinkSync, realpathSync } from "fs"
import * as schema from "./schema"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number }[] | undefined

// ============================================================================
// Vector Dimension Guard
// ============================================================================

/**
 * Default embedding dimension
 * Can be overridden via EMBEDDING_DIM environment variable
 */
const DEFAULT_EMBEDDING_DIM = 384

/**
 * Get configured embedding dimension from environment or default
 */
export function getConfiguredEmbeddingDim(): number {
  const envDim = process.env.EMBEDDING_DIM
  if (envDim) {
    const dim = parseInt(envDim, 10)
    if (isNaN(dim) || dim <= 0) {
      log.warn("invalid EMBEDDING_DIM environment variable, using default", {
        value: envDim,
        default: DEFAULT_EMBEDDING_DIM,
      })
      return DEFAULT_EMBEDDING_DIM
    }
    return dim
  }
  return DEFAULT_EMBEDDING_DIM
}

/**
 * Error thrown when vector dimension mismatch is detected
 */
export const VectorDimensionMismatchError = NamedError.create(
  "VectorDimensionMismatchError",
  z.object({
    storedDimension: z.number(),
    configuredDimension: z.number(),
    hint: z.string(),
  }),
)

/**
 * System metadata table name for storing embedding dimension
 */
const SYSTEM_METADATA_TABLE = "system_metadata"
const EMBEDDING_DIM_KEY = "embedding_dimension"

/**
 * Ensure system_metadata table exists
 */
function ensureSystemMetadataTable(sqlite: BunDatabase): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ${SYSTEM_METADATA_TABLE} (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      value_type TEXT NOT NULL DEFAULT 'string',
      description TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    )
  `)
}

/**
 * Get stored embedding dimension from database
 * Returns undefined if not stored yet
 */
function getStoredEmbeddingDim(sqlite: BunDatabase): number | undefined {
  try {
    const result = sqlite
      .query<{ value: string }, [string]>(
        `SELECT value FROM ${SYSTEM_METADATA_TABLE} WHERE key = ?`,
      )
      .get(EMBEDDING_DIM_KEY)
    if (result?.value) {
      return parseInt(result.value, 10)
    }
    return undefined
  } catch {
    // Table might not exist yet
    return undefined
  }
}

/**
 * Store embedding dimension in database
 */
function storeEmbeddingDim(sqlite: BunDatabase, dim: number): void {
  const now = Date.now()
  ensureSystemMetadataTable(sqlite)
  sqlite.exec(
    `INSERT INTO ${SYSTEM_METADATA_TABLE} (key, value, value_type, description, time_created, time_updated)
     VALUES (?, ?, 'number', 'Configured embedding vector dimension', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, time_updated = excluded.time_updated`,
    [EMBEDDING_DIM_KEY, dim.toString(), now, now],
  )
}

/**
 * Validate and initialize vector dimensions
 * This should be called during database initialization
 * 
 * @throws VectorDimensionMismatchError if dimensions don't match
 */
function validateVectorDimensions(sqlite: BunDatabase, logger: typeof log): number {
  const configuredDim = getConfiguredEmbeddingDim()
  const storedDim = getStoredEmbeddingDim(sqlite)

  logger.debug("vector_dimension_check", {
    configured: configuredDim,
    stored: storedDim,
  })

  // If no dimension stored yet, this is a fresh database
  if (storedDim === undefined) {
    logger.info("initializing_vector_dimension", { dimension: configuredDim })
    storeEmbeddingDim(sqlite, configuredDim)
    return configuredDim
  }

  // If dimensions match, we're good
  if (storedDim === configuredDim) {
    logger.debug("vector_dimension_verified", { dimension: configuredDim })
    return configuredDim
  }

  // Dimensions don't match - this is a critical error
  logger.error("vector_dimension_mismatch", {
    stored: storedDim,
    configured: configuredDim,
  })

  throw new VectorDimensionMismatchError({
    storedDimension: storedDim,
    configuredDimension: configuredDim,
    hint: `Embedding model changed. You must either:
1. Set EMBEDDING_DIM=${storedDim} to use the existing vectors, or
2. Clear the vector_memory table and rebuild with the new dimension:
   DELETE FROM vector_memory;
   DELETE FROM vec_vector_memory;
   UPDATE system_metadata SET value = '${configuredDim}' WHERE key = 'embedding_dimension';
   
After changing dimension, restart the application.`,
  })
}

export { validateVectorDimensions, storeEmbeddingDim, getStoredEmbeddingDim, ensureSystemMetadataTable }

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

// ============================================================================
// SQLite-Vec Extension Loading
// ============================================================================

/**
 * Result of sqlite-vec extension loading attempt
 */
interface VecLoadResult {
  loaded: boolean
  reason?: string
  path?: string
}

/**
 * Platform-specific configuration for sqlite-vec extension
 */
interface VecPlatformConfig {
  fileName: string
  packageName: string
  supported: boolean
}

/**
 * Get platform-specific configuration for sqlite-vec
 * @returns Platform configuration object
 */
function getVecPlatformConfig(): VecPlatformConfig {
  const platform = process.platform
  const arch = process.arch

  // Platform file name mapping
  const platformMap: Record<string, { fileName: string; packageName: string }> = {
    darwin: { fileName: "vec0.dylib", packageName: "darwin" },
    linux: { fileName: "vec0.so", packageName: "linux" },
    win32: { fileName: "vec0.dll", packageName: "windows" },
  }

  const config = platformMap[platform]
  if (!config) {
    return {
      fileName: "",
      packageName: "",
      supported: false,
    }
  }

  return {
    fileName: config.fileName,
    packageName: `${config.packageName}${arch === "arm64" ? "-arm64" : "-x64"}`,
    supported: true,
  }
}

/**
 * Attempt to load sqlite-vec extension with comprehensive error handling
 * Supports multiple path resolution strategies for dev, compiled binary, and symlink scenarios.
 * @param sqlite - The SQLite database instance
 * @param logger - Logger instance for diagnostics
 * @returns Result indicating success or failure with reason
 */
function loadSqliteVecExtension(sqlite: BunDatabase, logger: typeof log): VecLoadResult {
  const platform = process.platform
  const arch = process.arch

  // Check if running in Bun environment
  if (typeof Bun === "undefined") {
    return {
      loaded: false,
      reason: "sqlite-vec requires Bun runtime. Node.js is not supported.",
    }
  }

  // Get platform configuration
  const config = getVecPlatformConfig()
  if (!config.supported) {
    return {
      loaded: false,
      reason: `Unsupported platform: ${platform} (${arch}). Supported: darwin (x64/arm64), linux (x64/arm64), win32 (x64/arm64)`,
    }
  }

  const platformPkg = `sqlite-vec-${config.packageName}`

  // 1. Check for explicit environment variable (highest priority)
  const envVecPath = process.env.SQLITE_VEC_PATH
  if (envVecPath) {
    logger.debug("sqlite-vec using SQLITE_VEC_PATH", { path: envVecPath })
    if (existsSync(envVecPath)) {
      try {
        sqlite.loadExtension(envVecPath)
        logger.info("sqlite-vec loaded from SQLITE_VEC_PATH", { path: envVecPath })
        return { loaded: true, path: envVecPath }
      } catch (loadError) {
        const errorMsg = loadError instanceof Error ? loadError.message : String(loadError)
        return {
          loaded: false,
          reason: `Failed to load sqlite-vec from SQLITE_VEC_PATH: ${errorMsg}`,
        }
      }
    } else {
      return {
        loaded: false,
        reason: `SQLITE_VEC_PATH specified but file not found: ${envVecPath}`,
      }
    }
  }

  // 2. Build list of possible search paths with multiple strategies
  const possiblePaths: string[] = []

  // Helper to safely get real path (resolves symlinks)
  const getRealPath = (p: string): string | null => {
    try {
      return realpathSync(p)
    } catch {
      return null
    }
  }

  // Strategy 1: Relative to executable (for compiled binaries and symlinks)
  // process.execPath is the actual binary or interpreter running this code
  const execDir = path.dirname(process.execPath)
  possiblePaths.push(
    path.join(execDir, "node_modules", platformPkg, config.fileName),
    path.join(execDir, "..", "node_modules", platformPkg, config.fileName),
    // For symlinked binaries, check sibling directories
    path.join(execDir, "lib", "node_modules", platformPkg, config.fileName),
  )

  // Strategy 2: Resolve symlink and check relative to resolved location
  const realExecPath = getRealPath(process.execPath)
  if (realExecPath && realExecPath !== process.execPath) {
    const realExecDir = path.dirname(realExecPath)
    possiblePaths.push(
      path.join(realExecDir, "node_modules", platformPkg, config.fileName),
      path.join(realExecDir, "..", "node_modules", platformPkg, config.fileName),
    )
  }

  // Strategy 3: Current working directory
  const cwd = process.cwd()
  possiblePaths.push(
    path.join(cwd, "node_modules", platformPkg, config.fileName),
    path.join(cwd, "..", "node_modules", platformPkg, config.fileName),
  )

  // Strategy 4: User's home directory and common install locations
  const homeDir = process.env.HOME || process.env.USERPROFILE
  if (homeDir) {
    possiblePaths.push(
      path.join(homeDir, ".local", "share", "opencode", "node_modules", platformPkg, config.fileName),
      path.join(homeDir, ".opencode", "node_modules", platformPkg, config.fileName),
    )
  }

  // Strategy 5: Global bun install location
  const bunInstallDir = process.env.BUN_INSTALL || path.join(homeDir || "", ".bun")
  possiblePaths.push(
    path.join(bunInstallDir, "install/global", platformPkg, config.fileName),
    path.join(bunInstallDir, "node_modules", platformPkg, config.fileName),
  )

  // Strategy 6: Platform-specific global locations
  if (platform === "win32") {
    const programFiles = process.env.ProgramFiles || "C:\\Program Files"
    const appData = process.env.APPDATA || path.join(homeDir || "", "AppData", "Roaming")
    possiblePaths.push(
      path.join(programFiles, "opencode", "node_modules", platformPkg, config.fileName),
      path.join(appData, "opencode", "node_modules", platformPkg, config.fileName),
    )
  } else if (platform === "linux") {
    possiblePaths.push(
      path.join("/usr", "local", "lib", "opencode", "node_modules", platformPkg, config.fileName),
      path.join("/usr", "lib", "opencode", "node_modules", platformPkg, config.fileName),
      path.join("/opt", "opencode", "node_modules", platformPkg, config.fileName),
    )
  } else if (platform === "darwin") {
    possiblePaths.push(
      path.join("/usr", "local", "lib", "opencode", "node_modules", platformPkg, config.fileName),
      path.join("/opt", "homebrew", "lib", "opencode", "node_modules", platformPkg, config.fileName),
      path.join("/Applications", "opencode.app", "Contents", "Resources", "node_modules", platformPkg, config.fileName),
    )
  }

  // Strategy 7: import.meta.dirname (development mode) - last resort
  // This may not work correctly in compiled binaries
  try {
    const metaDir = import.meta.dirname
    if (metaDir) {
      const projectRoot = path.resolve(metaDir, "../../../..")
      possiblePaths.push(
        // Bun's hoisted node_modules with version pinning
        path.join(
          projectRoot,
          "node_modules/.bun",
          `${platformPkg}@0.1.7-alpha.2/node_modules/${platformPkg}`,
          config.fileName,
        ),
        // Standard npm/yarn node_modules
        path.join(projectRoot, "node_modules", platformPkg, config.fileName),
        // Workspace package node_modules
        path.join(projectRoot, "packages/opencode/node_modules", platformPkg, config.fileName),
        // Alternative bun install location
        path.join(projectRoot, "node_modules/.bun", "install/global", platformPkg, config.fileName),
      )
    }
  } catch {
    // import.meta.dirname may not be available in some environments
  }

  // Deduplicate paths while preserving order
  const uniquePaths = [...new Set(possiblePaths)]

  logger.debug("sqlite-vec loading attempt", {
    platform,
    arch,
    platformPkg,
    fileName: config.fileName,
    pathsToCheck: uniquePaths.length,
  })

  // Try each path
  const attemptedPaths: string[] = []
  const errors: string[] = []

  for (const vecPath of uniquePaths) {
    // Resolve symlink if applicable
    const realPath = getRealPath(vecPath) || vecPath
    
    if (!existsSync(realPath)) {
      continue
    }

    attemptedPaths.push(realPath)
    logger.debug("sqlite-vec found at path", { path: realPath, originalPath: vecPath })

    try {
      sqlite.loadExtension(realPath)

      // Verify extension is functional
      try {
        const versionResult = sqlite.query("SELECT vec0_version()").get() as { "vec0_version()": string } | undefined
        logger.info("sqlite-vec loaded successfully", {
          path: realPath,
          version: versionResult?.["vec0_version()"] ?? "unknown",
        })
        return { loaded: true, path: realPath }
      } catch (verifyError) {
        // Extension loaded but vec0_version not available (older versions)
        logger.info("sqlite-vec loaded (version query unavailable)", { path: realPath })
        return { loaded: true, path: realPath }
      }
    } catch (loadError) {
      const errorMsg = loadError instanceof Error ? loadError.message : String(loadError)
      errors.push(`${realPath}: ${errorMsg}`)
      logger.warn("sqlite-vec load failed for path", { path: realPath, error: errorMsg })
    }
  }

  // All paths failed
  if (attemptedPaths.length === 0) {
    return {
      loaded: false,
      reason: `sqlite-vec binary not found. Searched ${uniquePaths.length} locations. Install with: bun add sqlite-vec-${config.packageName} or set SQLITE_VEC_PATH environment variable.`,
    }
  }

  return {
    loaded: false,
    reason: `sqlite-vec found at ${attemptedPaths.length} location(s) but failed to load: ${errors.join("; ")}. Check file permissions and architecture compatibility.`,
  }
}

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
    const vecLoadResult = loadSqliteVecExtension(sqlite, log)
    if (!vecLoadResult.loaded) {
      log.warn("sqlite-vec extension not available - vector search will use text-based fallback", {
        reason: vecLoadResult.reason,
        platform: process.platform,
        arch: process.arch,
      })
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

    // Validate vector dimensions
    // This must happen after migrations but before any vector operations
    try {
      const embeddingDim = validateVectorDimensions(sqlite, log)
      log.info("vector_dimension_validated", { dimension: embeddingDim })
    } catch (error) {
      if (error instanceof VectorDimensionMismatchError) {
        // Re-throw with full context - this is a critical error
        throw error
      }
      // Log other errors but don't fail - vector operations may still work
      log.warn("vector_dimension_validation_failed", {
        error: error instanceof Error ? error.message : String(error),
      })
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
