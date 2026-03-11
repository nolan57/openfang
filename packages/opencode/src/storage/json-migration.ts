import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { Global } from "../global"
import { Log } from "../util/log"
import { ProjectTable } from "../project/project.sql"
import { SessionTable, MessageTable, PartTable, TodoTable, PermissionTable } from "../session/session.sql"
import { SessionShareTable } from "../share/share.sql"
import path from "path"
import { existsSync } from "fs"
import { Filesystem } from "../util/filesystem"
import { Glob } from "../util/glob"

export namespace JsonMigration {
  const log = Log.create({ service: "json-migration" })

  /** Migration version - increment when migration logic changes significantly */
  const MIGRATION_VERSION = 1

  /** State table name for tracking migration progress */
  const STATE_TABLE = "json_migration_state"

  export type Progress = {
    current: number
    total: number
    label: string
  }

  /** Migration statistics returned after completion */
  export type MigrationStats = {
    projects: number
    sessions: number
    messages: number
    parts: number
    todos: number
    permissions: number
    shares: number
    errors: string[]
    skipped: {
      projects: number
      sessions: number
      messages: number
      parts: number
    }
    duration: number
  }

  type Options = {
    progress?: (event: Progress) => void
    /** Force re-migration even if already completed */
    force?: boolean
  }

  /**
   * Check if migration has already been completed
   * @param sqlite - SQLite database instance
   * @returns true if migration was already completed
   */
  function isMigrationCompleted(sqlite: Database): boolean {
    try {
      const result = sqlite
        .query(`SELECT completed FROM ${STATE_TABLE} WHERE version = ? LIMIT 1`)
        .get(MIGRATION_VERSION) as { completed: number } | undefined
      return result?.completed === 1
    } catch {
      // State table doesn't exist yet
      return false
    }
  }

  /**
   * Mark migration as completed in the state table
   * @param sqlite - SQLite database instance
   */
  function markMigrationCompleted(sqlite: Database): void {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
        version INTEGER PRIMARY KEY,
        completed INTEGER NOT NULL DEFAULT 0,
        migrated_at INTEGER NOT NULL
      )
    `)
    sqlite.exec(
      `INSERT OR REPLACE INTO ${STATE_TABLE} (version, completed, migrated_at) VALUES (?, 1, ?)`,
      [MIGRATION_VERSION, Date.now()],
    )
  }

  /**
   * Get set of existing IDs from a table for skip-during-migration
   * @param sqlite - SQLite database instance
   * @param table - Table name to check
   * @param column - ID column name
   * @returns Set of existing IDs
   */
  function getExistingIds(sqlite: Database, table: string, column: string): Set<string> {
    try {
      const rows = sqlite.query(`SELECT ${column} FROM ${table}`).all() as Array<{ [key: string]: string }>
      return new Set(rows.map((r) => r[column]))
    } catch {
      return new Set()
    }
  }

  /**
   * Run the JSON to SQLite migration with resumable support
   * @param sqlite - SQLite database instance
   * @param options - Migration options including progress callback and force flag
   * @returns Migration statistics
   */
  export async function run(sqlite: Database, options?: Options): Promise<MigrationStats> {
    const storageDir = path.join(Global.Path.data, "storage")

    // Check if migration has already been completed
    if (!options?.force && isMigrationCompleted(sqlite)) {
      log.info("migration already completed, skipping. Use force: true to re-migrate.")
      return {
        projects: 0,
        sessions: 0,
        messages: 0,
        parts: 0,
        todos: 0,
        permissions: 0,
        shares: 0,
        errors: [],
        skipped: { projects: 0, sessions: 0, messages: 0, parts: 0 },
        duration: 0,
      }
    }

    if (!existsSync(storageDir)) {
      log.info("storage directory does not exist, marking migration as complete")
      markMigrationCompleted(sqlite)
      return {
        projects: 0,
        sessions: 0,
        messages: 0,
        parts: 0,
        todos: 0,
        permissions: 0,
        shares: 0,
        errors: [] as string[],
        skipped: { projects: 0, sessions: 0, messages: 0, parts: 0 },
        duration: 0,
      }
    }

    log.info("starting json to sqlite migration", { storageDir, version: MIGRATION_VERSION })
    const start = performance.now()

    const db = drizzle({ client: sqlite })

    // Optimize SQLite for bulk inserts
    sqlite.exec("PRAGMA journal_mode = WAL")
    sqlite.exec("PRAGMA synchronous = OFF")
    sqlite.exec("PRAGMA cache_size = 10000")
    sqlite.exec("PRAGMA temp_store = MEMORY")

    // Load existing IDs for skip-during-migration (resumable support)
    log.info("loading existing record IDs for resumable migration...")
    const existingProjectIds = getExistingIds(sqlite, "project", "id")
    const existingSessionIds = getExistingIds(sqlite, "session", "id")
    const existingMessageIds = getExistingIds(sqlite, "message", "id")
    const existingPartIds = getExistingIds(sqlite, "part", "id")

    log.info("existing records loaded", {
      projects: existingProjectIds.size,
      sessions: existingSessionIds.size,
      messages: existingMessageIds.size,
      parts: existingPartIds.size,
    })

    const stats: MigrationStats = {
      projects: 0,
      sessions: 0,
      messages: 0,
      parts: 0,
      todos: 0,
      permissions: 0,
      shares: 0,
      errors: [],
      skipped: {
        projects: 0,
        sessions: 0,
        messages: 0,
        parts: 0,
      },
      duration: 0,
    }
    const orphans = {
      sessions: 0,
      todos: 0,
      permissions: 0,
      shares: 0,
    }
    const errs = stats.errors

    const batchSize = 1000
    const now = Date.now()

    async function list(pattern: string) {
      return Glob.scan(pattern, { cwd: storageDir, absolute: true })
    }

    async function read(files: string[], startIdx: number, end: number) {
      const count = end - startIdx
      const tasks = new Array(count)
      for (let i = 0; i < count; i++) {
        tasks[i] = Filesystem.readJson(files[startIdx + i])
      }
      const results = await Promise.allSettled(tasks)
      const items = new Array(count)
      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        if (result.status === "fulfilled") {
          items[i] = result.value
          continue
        }
        errs.push(`failed to read ${files[startIdx + i]}: ${result.reason}`)
      }
      return items
    }

    function insert(values: unknown[], table: unknown, label: string): number {
      if (values.length === 0) return 0
      try {
        ;(db.insert as (table: unknown) => { values: (v: unknown[]) => { onConflictDoNothing: () => { run: () => void } }})(table).values(values).onConflictDoNothing().run()
        return values.length
      } catch (e) {
        errs.push(`failed to migrate ${label} batch: ${e}`)
        return 0
      }
    }

    // Pre-scan all files upfront to avoid repeated glob operations
    log.info("scanning files...")
    const [projectFiles, sessionFiles, messageFiles, partFiles, todoFiles, permFiles, shareFiles] = await Promise.all([
      list("project/*.json"),
      list("session/*/*.json"),
      list("message/*/*.json"),
      list("part/*/*.json"),
      list("todo/*.json"),
      list("permission/*.json"),
      list("session_share/*.json"),
    ])

    log.info("file scan complete", {
      projects: projectFiles.length,
      sessions: sessionFiles.length,
      messages: messageFiles.length,
      parts: partFiles.length,
      todos: todoFiles.length,
      permissions: permFiles.length,
      shares: shareFiles.length,
    })

    const total = Math.max(
      1,
      projectFiles.length +
        sessionFiles.length +
        messageFiles.length +
        partFiles.length +
        todoFiles.length +
        permFiles.length +
        shareFiles.length,
    )
    const progress = options?.progress
    let current = 0
    const step = (label: string, count: number) => {
      current = Math.min(total, current + count)
      progress?.({ current, total, label })
    }

    progress?.({ current, total, label: "starting" })

    sqlite.exec("BEGIN TRANSACTION")

    // Migrate projects first (no FK deps)
    // Derive all IDs from file paths, not JSON content
    const projectIds = new Set<string>(existingProjectIds)
    const projectValues: unknown[] = []
    for (let i = 0; i < projectFiles.length; i += batchSize) {
      const end = Math.min(i + batchSize, projectFiles.length)
      const batch = await read(projectFiles, i, end)
      projectValues.length = 0
      for (let j = 0; j < batch.length; j++) {
        const data = batch[j]
        if (!data) continue
        const id = path.basename(projectFiles[i + j], ".json")
        
        // Skip if already exists (resumable migration)
        if (existingProjectIds.has(id)) {
          stats.skipped.projects++
          continue
        }
        
        projectIds.add(id)
        projectValues.push({
          id,
          worktree: data.worktree ?? "/",
          vcs: data.vcs,
          name: data.name ?? undefined,
          icon_url: data.icon?.url,
          icon_color: data.icon?.color,
          time_created: data.time?.created ?? now,
          time_updated: data.time?.updated ?? now,
          time_initialized: data.time?.initialized,
          sandboxes: data.sandboxes ?? [],
          commands: data.commands,
        })
      }
      stats.projects += insert(projectValues, ProjectTable, "project")
      step("projects", end - i)
    }
    log.info("migrated projects", { count: stats.projects, duration: Math.round(performance.now() - start) })

    // Migrate sessions (depends on projects)
    // Derive all IDs from directory/file paths, not JSON content, since earlier
    // migrations may have moved sessions to new directories without updating the JSON
    const sessionProjects = sessionFiles.map((file) => path.basename(path.dirname(file)))
    const sessionIds = new Set<string>(existingSessionIds)
    const sessionValues: unknown[] = []
    for (let i = 0; i < sessionFiles.length; i += batchSize) {
      const end = Math.min(i + batchSize, sessionFiles.length)
      const batch = await read(sessionFiles, i, end)
      sessionValues.length = 0
      for (let j = 0; j < batch.length; j++) {
        const data = batch[j]
        if (!data) continue
        const id = path.basename(sessionFiles[i + j], ".json")
        
        // Skip if already exists (resumable migration)
        if (existingSessionIds.has(id)) {
          stats.skipped.sessions++
          continue
        }
        
        const projectID = sessionProjects[i + j]
        if (!projectIds.has(projectID)) {
          orphans.sessions++
          continue
        }
        sessionIds.add(id)
        sessionValues.push({
          id,
          project_id: projectID,
          parent_id: data.parentID ?? null,
          slug: data.slug ?? "",
          directory: data.directory ?? "",
          title: data.title ?? "",
          version: data.version ?? "",
          share_url: data.share?.url ?? null,
          summary_additions: data.summary?.additions ?? null,
          summary_deletions: data.summary?.deletions ?? null,
          summary_files: data.summary?.files ?? null,
          summary_diffs: data.summary?.diffs ?? null,
          revert: data.revert ?? null,
          permission: data.permission ?? null,
          time_created: data.time?.created ?? now,
          time_updated: data.time?.updated ?? now,
          time_compacting: data.time?.compacting ?? null,
          time_archived: data.time?.archived ?? null,
        })
      }
      stats.sessions += insert(sessionValues, SessionTable, "session")
      step("sessions", end - i)
    }
    log.info("migrated sessions", { count: stats.sessions })
    if (orphans.sessions > 0) {
      log.warn("skipped orphaned sessions", { count: orphans.sessions })
    }

    // Migrate messages using pre-scanned file map
    const allMessageFiles: string[] = []
    const allMessageSessions: string[] = []
    const messageSessions = new Map<string, string>()
    for (const file of messageFiles) {
      const sessionID = path.basename(path.dirname(file))
      if (!sessionIds.has(sessionID)) continue
      allMessageFiles.push(file)
      allMessageSessions.push(sessionID)
    }

    for (let i = 0; i < allMessageFiles.length; i += batchSize) {
      const end = Math.min(i + batchSize, allMessageFiles.length)
      const batch = await read(allMessageFiles, i, end)
      const values: unknown[] = []
      for (let j = 0; j < batch.length; j++) {
        const data = batch[j]
        if (!data) continue
        const file = allMessageFiles[i + j]
        const id = path.basename(file, ".json")
        
        // Skip if already exists (resumable migration)
        if (existingMessageIds.has(id)) {
          stats.skipped.messages++
          continue
        }
        
        const sessionID = allMessageSessions[i + j]
        messageSessions.set(id, sessionID)
        const rest = { ...data }
        delete rest.id
        delete rest.sessionID
        values.push({
          id,
          session_id: sessionID,
          time_created: data.time?.created ?? now,
          time_updated: data.time?.updated ?? now,
          data: rest,
        })
      }
      stats.messages += insert(values, MessageTable, "message")
      step("messages", end - i)
    }
    log.info("migrated messages", { count: stats.messages })

    // Migrate parts using pre-scanned file map
    for (let i = 0; i < partFiles.length; i += batchSize) {
      const end = Math.min(i + batchSize, partFiles.length)
      const batch = await read(partFiles, i, end)
      const values: unknown[] = []
      for (let j = 0; j < batch.length; j++) {
        const data = batch[j]
        if (!data) continue
        const file = partFiles[i + j]
        const id = path.basename(file, ".json")
        
        // Skip if already exists (resumable migration)
        if (existingPartIds.has(id)) {
          stats.skipped.parts++
          continue
        }
        
        const messageID = path.basename(path.dirname(file))
        const sessionID = messageSessions.get(messageID)
        if (!sessionID) {
          errs.push(`part missing message session: ${file}`)
          continue
        }
        if (!sessionIds.has(sessionID)) continue
        const rest = { ...data }
        delete rest.id
        delete rest.messageID
        delete rest.sessionID
        values.push({
          id,
          message_id: messageID,
          session_id: sessionID,
          time_created: data.time?.created ?? now,
          time_updated: data.time?.updated ?? now,
          data: rest,
        })
      }
      stats.parts += insert(values, PartTable, "part")
      step("parts", end - i)
    }
    log.info("migrated parts", { count: stats.parts })

    // Migrate todos
    const todoSessions = todoFiles.map((file) => path.basename(file, ".json"))
    for (let i = 0; i < todoFiles.length; i += batchSize) {
      const end = Math.min(i + batchSize, todoFiles.length)
      const batch = await read(todoFiles, i, end)
      const values: unknown[] = []
      for (let j = 0; j < batch.length; j++) {
        const data = batch[j]
        if (!data) continue
        const sessionID = todoSessions[i + j]
        if (!sessionIds.has(sessionID)) {
          orphans.todos++
          continue
        }
        if (!Array.isArray(data)) {
          errs.push(`todo not an array: ${todoFiles[i + j]}`)
          continue
        }
        for (let position = 0; position < data.length; position++) {
          const todo = data[position]
          if (!todo?.content || !todo?.status || !todo?.priority) continue
          values.push({
            session_id: sessionID,
            content: todo.content,
            status: todo.status,
            priority: todo.priority,
            position,
            time_created: now,
            time_updated: now,
          })
        }
      }
      stats.todos += insert(values, TodoTable, "todo")
      step("todos", end - i)
    }
    log.info("migrated todos", { count: stats.todos })
    if (orphans.todos > 0) {
      log.warn("skipped orphaned todos", { count: orphans.todos })
    }

    // Migrate permissions
    const permProjects = permFiles.map((file) => path.basename(file, ".json"))
    const permValues: unknown[] = []
    for (let i = 0; i < permFiles.length; i += batchSize) {
      const end = Math.min(i + batchSize, permFiles.length)
      const batch = await read(permFiles, i, end)
      permValues.length = 0
      for (let j = 0; j < batch.length; j++) {
        const data = batch[j]
        if (!data) continue
        const projectID = permProjects[i + j]
        if (!projectIds.has(projectID)) {
          orphans.permissions++
          continue
        }
        permValues.push({ project_id: projectID, data })
      }
      stats.permissions += insert(permValues, PermissionTable, "permission")
      step("permissions", end - i)
    }
    log.info("migrated permissions", { count: stats.permissions })
    if (orphans.permissions > 0) {
      log.warn("skipped orphaned permissions", { count: orphans.permissions })
    }

    // Migrate session shares
    const shareSessions = shareFiles.map((file) => path.basename(file, ".json"))
    const shareValues: unknown[] = []
    for (let i = 0; i < shareFiles.length; i += batchSize) {
      const end = Math.min(i + batchSize, shareFiles.length)
      const batch = await read(shareFiles, i, end)
      shareValues.length = 0
      for (let j = 0; j < batch.length; j++) {
        const data = batch[j]
        if (!data) continue
        const sessionID = shareSessions[i + j]
        if (!sessionIds.has(sessionID)) {
          orphans.shares++
          continue
        }
        if (!data?.id || !data?.secret || !data?.url) {
          errs.push(`session_share missing id/secret/url: ${shareFiles[i + j]}`)
          continue
        }
        shareValues.push({ session_id: sessionID, id: data.id, secret: data.secret, url: data.url })
      }
      stats.shares += insert(shareValues, SessionShareTable, "session_share")
      step("shares", end - i)
    }
    log.info("migrated session shares", { count: stats.shares })
    if (orphans.shares > 0) {
      log.warn("skipped orphaned session shares", { count: orphans.shares })
    }

    // Mark migration as completed
    markMigrationCompleted(sqlite)

    sqlite.exec("COMMIT")

    log.info("json migration complete", {
      projects: stats.projects,
      sessions: stats.sessions,
      messages: stats.messages,
      parts: stats.parts,
      todos: stats.todos,
      permissions: stats.permissions,
      shares: stats.shares,
      skipped: stats.skipped,
      errorCount: stats.errors.length,
      duration: Math.round(performance.now() - start),
    })

    if (stats.errors.length > 0) {
      log.warn("migration errors", { errors: stats.errors.slice(0, 20) })
    }

    progress?.({ current: total, total, label: "complete" })

    return stats
  }
}
