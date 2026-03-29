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
import os from "os"
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  statSync,
  unlinkSync,
  realpathSync,
  writeFileSync,
} from "fs"
import * as schema from "./schema"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number }[] | undefined

// ============================================================================
// Vector Dimension Guard
// ============================================================================

/**
 * Default embedding dimension
 * Can be overridden via EMBEDDING_DIM environment variable
 * Using OpenAI text-embedding-3-small dimensions (1536)
 */
const DEFAULT_EMBEDDING_DIM = 1536

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
      .query<{ value: string }, [string]>(`SELECT value FROM ${SYSTEM_METADATA_TABLE} WHERE key = ?`)
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
 * Logic:
 * 1. If EMBEDDING_DIM env is set, use it (user explicit config)
 * 2. If database has stored dimension, use it (preserve existing vectors)
 * 3. Otherwise use default (fresh database)
 *
 * Only throws error when user explicitly sets EMBEDDING_DIM that conflicts
 * with the stored dimension in database.
 *
 * @throws VectorDimensionMismatchError if user explicitly sets EMBEDDING_DIM that conflicts with stored dimension
 */
function validateVectorDimensions(sqlite: BunDatabase, logger: typeof log): number {
  const envDim = process.env.EMBEDDING_DIM
  const storedDim = getStoredEmbeddingDim(sqlite)

  // Parse environment variable if set
  const configuredDim = envDim ? parseInt(envDim, 10) : undefined
  const hasExplicitConfig = envDim !== undefined && !isNaN(configuredDim!) && configuredDim! > 0

  logger.debug("vector_dimension_check", {
    envDim,
    configured: configuredDim,
    stored: storedDim,
    hasExplicitConfig,
  })

  // If no dimension stored yet, this is a fresh database
  if (storedDim === undefined) {
    const dimToUse = configuredDim ?? DEFAULT_EMBEDDING_DIM
    logger.info("initializing_vector_dimension", {
      dimension: dimToUse,
      source: hasExplicitConfig ? "env" : "default",
    })
    storeEmbeddingDim(sqlite, dimToUse)
    return dimToUse
  }

  // If user explicitly set EMBEDDING_DIM, check if it matches stored
  if (hasExplicitConfig) {
    if (storedDim === configuredDim) {
      logger.debug("vector_dimension_verified", { dimension: configuredDim, source: "env" })
      return configuredDim!
    }

    // User explicitly set a conflicting dimension - this is an error
    logger.error("vector_dimension_mismatch", {
      stored: storedDim,
      configured: configuredDim,
    })

    throw new VectorDimensionMismatchError({
      storedDimension: storedDim,
      configuredDimension: configuredDim!,
      hint: `Embedding model changed. You must either:
1. Set EMBEDDING_DIM=${storedDim} to use the existing vectors, or
2. Clear the vector_memory table and rebuild with the new dimension:
   DELETE FROM vector_memory;
   DELETE FROM vec_vector_memory;
   UPDATE system_metadata SET value = '${configuredDim}' WHERE key = 'embedding_dimension';
   
After changing dimension, restart the application.`,
    })
  }

  // No explicit config - use stored dimension to preserve existing vectors
  logger.info("vector_dimension_using_stored", {
    dimension: storedDim,
    source: "database",
    hint: "Set EMBEDDING_DIM env to override",
  })

  // Update env var so EmbeddingService picks up the correct dimension
  process.env.EMBEDDING_DIM = String(storedDim)

  return storedDim
}

export { validateVectorDimensions, storeEmbeddingDim, getStoredEmbeddingDim, ensureSystemMetadataTable }

// ====== Database Backup & Recovery Logic ======
const DB_PATH = path.join(Global.Path.data, "opencode.db")
const BACKUP_DIR = path.join(Global.Path.data, "backups")
const MAX_BACKUPS = 3
const MAX_CORRUPTED = 3
const OLD_DATA_DIRS = [
  path.join(os.homedir(), ".local", "share", "opencode"),
  path.join(os.homedir(), "Library", "Application Support", "opencode"),
]

function isDatabaseHealthy(dbPath: string): boolean {
  try {
    const db = new BunDatabase(dbPath)
    const result = db.query("PRAGMA quick_check;").all()
    db.close()
    return (
      result.length === 0 || (result.length === 1 && (result[0] as Record<string, unknown>)["quick_check"] === "ok")
    )
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

function getFallbackBackups(): string[] {
  const fallbacks: { path: string; time: number }[] = []

  const fallbackPatterns = ["opencode.db.backup", "opencode.db.old", "opencode.db.old2", "opencode.db.bak"]

  for (const pattern of fallbackPatterns) {
    const fallbackPath = path.join(Global.Path.data, pattern)
    if (existsSync(fallbackPath)) {
      fallbacks.push({ path: fallbackPath, time: statSync(fallbackPath).mtimeMs })
    }
  }

  for (const oldDir of OLD_DATA_DIRS) {
    if (oldDir === Global.Path.data) continue
    const oldDbPath = path.join(oldDir, "opencode.db")
    if (existsSync(oldDbPath)) {
      fallbacks.push({ path: oldDbPath, time: statSync(oldDbPath).mtimeMs })
    }
    for (const pattern of fallbackPatterns) {
      const fallbackPath = path.join(oldDir, pattern)
      if (existsSync(fallbackPath)) {
        fallbacks.push({ path: fallbackPath, time: statSync(fallbackPath).mtimeMs })
      }
    }
  }

  return fallbacks.sort((a, b) => b.time - a.time).map((f) => f.path)
}

function tryRestoreFromBackup(): boolean {
  const latestBackup = getLatestBackup()
  if (latestBackup) {
    log.info("attempting to restore from backup directory", { backup: latestBackup })
    try {
      copyFileSync(latestBackup, DB_PATH)
      if (isDatabaseHealthy(DB_PATH)) {
        log.info("database restored from backup directory")
        return true
      }
      log.warn("backup from backup directory is corrupted, trying fallbacks")
    } catch (e) {
      log.warn("failed to restore from backup directory", { error: e })
    }
  }

  const fallbacks = getFallbackBackups()
  for (const fallback of fallbacks) {
    log.info("attempting to restore from fallback", { fallback })
    try {
      copyFileSync(fallback, DB_PATH)
      if (isDatabaseHealthy(DB_PATH)) {
        log.info("database restored from fallback", { fallback })
        return true
      }
      log.warn("fallback is corrupted, trying next", { fallback })
    } catch (e) {
      log.warn("failed to restore from fallback", { fallback, error: e })
    }
  }

  return false
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

    // Perform WAL checkpoint before backup to ensure consistency
    // TRUNCATE mode merges all WAL content into the main database and resets the WAL file
    // This guarantees the backup is a consistent snapshot without needing to copy the WAL file
    try {
      const sqlite = Database.raw()
      sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)")
      log.debug("wal checkpoint completed before backup")
    } catch (checkpointErr) {
      // Log but don't fail - the backup may still be usable
      log.warn("wal checkpoint failed before backup, proceeding anyway", { error: checkpointErr })
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

/**
 * Default backup interval in milliseconds (30 minutes)
 */
const DEFAULT_BACKUP_INTERVAL = 30 * 60 * 1000

/**
 * Start periodic database backup using the scheduler
 * @param intervalMs - Backup interval in milliseconds (default: 30 minutes)
 */
export function startPeriodicBackup(intervalMs: number = DEFAULT_BACKUP_INTERVAL): void {
  // Import Scheduler lazily to avoid circular dependencies
  import("../scheduler")
    .then(({ Scheduler }) => {
      Scheduler.register({
        id: "database-backup",
        interval: intervalMs,
        scope: "global",
        run: async () => {
          createBackup()
        },
      })
      log.info("periodic database backup started", { intervalMs })
    })
    .catch((err) => {
      log.error("failed to start periodic backup", { error: err })
    })
}

function ensureDatabaseIntegrity(): void {
  if (!existsSync(DB_PATH)) {
    log.info("database does not exist, attempting to restore from backup...")
    if (tryRestoreFromBackup()) {
      log.info("database restored successfully")
      return
    }
    log.info("no valid backup found, database will be created on first use")
    return
  }

  if (isDatabaseHealthy(DB_PATH)) {
    log.info("database is healthy")
    return
  }

  log.warn("database is corrupted or unreadable, attempting recovery...")

  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true })

  const corruptedPath = path.join(BACKUP_DIR, `opencode.db.corrupted.${Date.now()}`)
  try {
    copyFileSync(DB_PATH, corruptedPath)
    log.info("corrupted database saved for inspection", { path: corruptedPath })
  } catch (e) {
    log.error("failed to save corrupted database", { error: e })
  }

  try {
    unlinkSync(DB_PATH)
  } catch (e) {
    log.error("failed to delete corrupted database", { error: e })
    return
  }

  if (tryRestoreFromBackup()) {
    log.info("database recovery successful!")
    return
  }

  log.warn("all recovery attempts failed, database will be recreated on next use")
  cleanupOldCorruptedFiles()
}

function cleanupOldCorruptedFiles(): void {
  if (!existsSync(BACKUP_DIR)) return

  const corruptedFiles = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("opencode.db.corrupted."))
    .map((f) => ({ name: f, time: statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time)

  if (corruptedFiles.length > MAX_CORRUPTED) {
    corruptedFiles.slice(MAX_CORRUPTED).forEach((f) => {
      try {
        unlinkSync(path.join(BACKUP_DIR, f.name))
        log.debug("removed old corrupted file", { name: f.name })
      } catch (e) {
        log.warn("failed to remove old corrupted file", { name: f.name, error: e })
      }
    })
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

// ============================================================================
// SQLite-Vec Extension Path Cache
// ============================================================================

/**
 * Cache file path for storing successfully loaded sqlite-vec extension path
 * Uses user's home directory for cross-platform compatibility
 */
const VEC_CACHE_FILE = path.join(os.homedir(), ".opencode", "db-config.json")

/**
 * Structure of the sqlite-vec extension cache
 */
interface VecCacheData {
  vecExtensionPath: string
  mtimeMs?: number
  cachedAt: number
}

/**
 * Read cached sqlite-vec extension path
 * Returns null if cache doesn't exist, is invalid, or read fails
 */
function readVecCache(logger: typeof log): VecCacheData | null {
  try {
    if (!existsSync(VEC_CACHE_FILE)) {
      return null
    }

    const content = readFileSync(VEC_CACHE_FILE, "utf-8")
    const data = JSON.parse(content) as VecCacheData

    // Validate cached path is absolute
    if (!data.vecExtensionPath || !path.isAbsolute(data.vecExtensionPath)) {
      logger.debug("vec cache contains invalid path, ignoring", { path: data.vecExtensionPath })
      return null
    }

    return data
  } catch (err) {
    logger.debug("failed to read vec cache, will proceed with scan", { error: String(err) })
    return null
  }
}

/**
 * Write sqlite-vec extension path to cache
 * Silently logs warnings on failure, never throws
 */
function writeVecCache(vecPath: string, logger: typeof log): void {
  try {
    const cacheDir = path.dirname(VEC_CACHE_FILE)

    // Ensure cache directory exists
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true })
    }

    // Get file modification time for version change detection
    let mtimeMs: number | undefined
    try {
      mtimeMs = statSync(vecPath).mtimeMs
    } catch {
      // mtime is optional, continue without it
    }

    const cacheData: VecCacheData = {
      vecExtensionPath: vecPath,
      mtimeMs,
      cachedAt: Date.now(),
    }

    writeFileSync(VEC_CACHE_FILE, JSON.stringify(cacheData, null, 2), "utf-8")
    logger.debug("vec extension path cached", { path: vecPath, cacheFile: VEC_CACHE_FILE })
  } catch (err) {
    // Log warning but don't interrupt startup
    logger.warn("failed to cache vec extension path", { error: String(err) })
  }
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
        // Cache the successful path for future startups
        writeVecCache(envVecPath, logger)
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

  // 2. Check cached path (second priority - avoid full scan if cached path is valid)
  const cached = readVecCache(logger)
  if (cached?.vecExtensionPath && existsSync(cached.vecExtensionPath)) {
    logger.debug("sqlite-vec trying cached path", { path: cached.vecExtensionPath })
    try {
      sqlite.loadExtension(cached.vecExtensionPath)

      // Verify extension is functional
      try {
        const versionResult = sqlite.query("SELECT vec0_version()").get() as { "vec0_version()": string } | undefined
        logger.info("sqlite-vec loaded from cache", {
          path: cached.vecExtensionPath,
          version: versionResult?.["vec0_version()"] ?? "unknown",
        })
        return { loaded: true, path: cached.vecExtensionPath }
      } catch {
        // Extension loaded but version check failed - still valid
        logger.info("sqlite-vec loaded from cache (version query unavailable)", { path: cached.vecExtensionPath })
        return { loaded: true, path: cached.vecExtensionPath }
      }
    } catch (loadError) {
      // Cached path failed, continue with full scan
      logger.debug("cached vec path failed to load, proceeding with scan", {
        path: cached.vecExtensionPath,
        error: loadError instanceof Error ? loadError.message : String(loadError),
      })
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

      // Dynamic version scanning for Bun's hoisted node_modules
      const bunModulesDir = path.join(projectRoot, "node_modules", ".bun")
      try {
        if (existsSync(bunModulesDir)) {
          const bunDirs = readdirSync(bunModulesDir, { withFileTypes: true })
          // Find all sqlite-vec platform package directories and sort by version (newest first)
          const vecVersions = bunDirs
            .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${platformPkg}@`))
            .map((entry) => {
              // Extract version from directory name: "sqlite-vec-darwin-x64@0.1.7-alpha.2"
              const versionMatch = entry.name.match(/@(.+)$/)
              return {
                name: entry.name,
                version: versionMatch ? versionMatch[1] : "0.0.0",
                path: path.join(bunModulesDir, entry.name, "node_modules", platformPkg, config.fileName),
              }
            })
            .filter((v) => existsSync(v.path))
            .sort((a, b) => {
              // Sort by semantic version (newest first)
              const parseVer = (v: string) => {
                const parts = v.split(/[-.]/).map((p) => parseInt(p, 10) || 0)
                return parts[0] * 1000000 + (parts[1] || 0) * 10000 + (parts[2] || 0) * 100 + (parts[3] || 0)
              }
              return parseVer(b.version) - parseVer(a.version)
            })

          // Add the newest version first
          if (vecVersions.length > 0) {
            possiblePaths.push(vecVersions[0].path)
            logger.debug("found sqlite-vec versions in bun cache", {
              versions: vecVersions.map((v) => v.version),
              selected: vecVersions[0].version,
            })
          }
        }
      } catch (scanErr) {
        logger.warn("failed to scan bun modules for sqlite-vec versions", { error: String(scanErr) })
      }

      // Standard npm/yarn node_modules
      possiblePaths.push(
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
        // Cache the successful path for future startups
        writeVecCache(realPath, logger)
        return { loaded: true, path: realPath }
      } catch (verifyError) {
        // Extension loaded but vec0_version not available (older versions)
        logger.info("sqlite-vec loaded (version query unavailable)", { path: realPath })
        // Cache the successful path for future startups
        writeVecCache(realPath, logger)
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

// ============================================================================
// macOS Custom SQLite Detection
// ============================================================================

/**
 * Find Homebrew SQLite dylib path on macOS
 * Apple's system SQLite doesn't support dynamic extensions,
 * so we need to use Homebrew's vanilla SQLite.
 *
 * Strategy:
 * 1. Check SQLITE_CUSTOM_PATH environment variable
 * 2. Auto-detect from Homebrew Cellar (Intel and Apple Silicon paths)
 * 3. Try common version paths
 */
function findMacOSSQLitePath(): string | null {
  // 1. Check environment variable first
  const envPath = process.env.SQLITE_CUSTOM_PATH
  if (envPath && existsSync(envPath)) {
    log.info("using SQLITE_CUSTOM_PATH", { path: envPath })
    return envPath
  }

  // 2. Possible Homebrew installation directories
  const homebrewBaseDirs = [
    "/opt/homebrew/Cellar/sqlite", // Apple Silicon (M1/M2/M3)
    "/usr/local/Cellar/sqlite", // Intel Mac
  ]

  for (const baseDir of homebrewBaseDirs) {
    if (!existsSync(baseDir)) continue

    try {
      // Get all version directories and sort by version (descending)
      const versions = readdirSync(baseDir)
        .filter((name) => {
          const fullPath = path.join(baseDir, name, "lib", "libsqlite3.dylib")
          return existsSync(fullPath)
        })
        .sort((a, b) => {
          // Sort by semantic version (newest first)
          const parseVer = (v: string) => {
            const parts = v.split(/[._]/).map((p) => parseInt(p, 10) || 0)
            return parts[0] * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0)
          }
          return parseVer(b) - parseVer(a)
        })

      if (versions.length > 0) {
        const selectedPath = path.join(baseDir, versions[0], "lib", "libsqlite3.dylib")
        log.info("found homebrew sqlite", {
          path: selectedPath,
          version: versions[0],
          searched: baseDir,
        })
        return selectedPath
      }
    } catch (e) {
      log.warn("failed to search homebrew sqlite", { dir: baseDir, error: String(e) })
    }
  }

  // 3. Try known common paths as fallback
  const fallbackPaths = [
    "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib", // Apple Silicon symlink
    "/usr/local/opt/sqlite/lib/libsqlite3.dylib", // Intel Mac symlink
  ]

  for (const fallbackPath of fallbackPaths) {
    if (existsSync(fallbackPath)) {
      log.info("using fallback sqlite path", { path: fallbackPath })
      return fallbackPath
    }
  }

  log.warn("no suitable sqlite found for extension support", {
    hint: "Install sqlite via homebrew: brew install sqlite, or set SQLITE_CUSTOM_PATH environment variable",
  })
  return null
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
      const sqlitePath = findMacOSSQLitePath()
      if (sqlitePath) {
        try {
          BunDatabase.setCustomSQLite(sqlitePath)
          log.info("custom sqlite set successfully", { path: sqlitePath })
        } catch (e) {
          log.error("failed to set custom sqlite", { path: sqlitePath, error: String(e) })
        }
      }
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
        // Not in an existing transaction context - creating a new database session
        // This is safe for read operations but effects will execute immediately
        log.debug("starting new database session (no transaction context)")
        const effects: (() => void | Promise<void>)[] = []
        const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
        // Effects are executed after the callback completes successfully
        // If callback throws, effects array is discarded (not executed)
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
      // Not in a transaction context - execute effect immediately
      fn()
    }
  }

  export function transaction<T>(callback: (tx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        // Not in an existing transaction - starting a new transaction root
        // This creates an atomic transaction that will commit or rollback as a unit
        log.debug("starting new transaction root")
        const effects: (() => void | Promise<void>)[] = []
        // Drizzle's transaction() wraps the callback in BEGIN/COMMIT/ROLLBACK
        // If callback throws, the transaction is rolled back automatically
        // Effects array is only processed if transaction commits successfully
        let transactionSucceeded = false
        try {
          const result = Client().transaction((tx) => {
            return ctx.provide({ tx, effects }, () => callback(tx))
          })
          transactionSucceeded = true
          // Execute effects only after successful commit
          // IMPORTANT: effects are NOT executed if transaction is rolled back
          // because an exception would jump past this loop
          for (const effect of effects) effect()
          return result
        } catch (txErr) {
          // Transaction was rolled back - explicitly clear effects to prevent any leakage
          // This is a safety measure; effects would not be executed anyway due to the exception
          effects.length = 0
          log.debug("transaction rolled back, effects cleared")
          throw txErr
        }
      }
      throw err
    }
  }
}
