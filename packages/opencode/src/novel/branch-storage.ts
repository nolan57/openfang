import { z } from "zod"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { resolve, dirname } from "path"
import { mkdir } from "fs/promises"
import type { Branch } from "./branch-manager"
import { getBranchStorageDbPath } from "./novel-config"

const log = Log.create({ service: "branch-storage" })

export interface BranchEvent {
  id: string
  type: string
  description: string
}

// Lazy-initialized database path
let DB_PATH: string | null = null

function getDbPath(): string {
  if (!DB_PATH) {
    DB_PATH = getBranchStorageDbPath()
  }
  return DB_PATH
}

export const BranchRecordSchema = z.object({
  id: z.string(),
  story_segment: z.string(),
  branch_point: z.string(),
  choice_made: z.string(),
  choice_rationale: z.string(),
  state_after: z.string(),
  evaluation: z.string(),
  selected: z.number(),
  created_at: z.number(),
  chapter: z.number(),
  parent_id: z.string().nullable(),
  merged_into: z.string().nullable(),
  pruned: z.number(),
  prune_reason: z.string().nullable(),
  embedding: z.string().nullable(),
  events: z.string(),
  structured_state: z.string(),
})

export type BranchRecord = z.infer<typeof BranchRecordSchema>

export interface BranchStorageConfig {
  maxBranches: number
  enableEmbeddings: boolean
}

const DEFAULT_CONFIG: BranchStorageConfig = {
  maxBranches: 100,
  enableEmbeddings: true,
}

export class BranchStorage {
  private db: any = null
  private config: BranchStorageConfig
  private initialized: boolean = false

  constructor(config: Partial<BranchStorageConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    const dbPath = getDbPath()
    try {
      await mkdir(dirname(dbPath), { recursive: true })

      const { Database } = await import("bun:sqlite")
      this.db = new Database(dbPath)

      this.db.run(`
        CREATE TABLE IF NOT EXISTS branches (
          id TEXT PRIMARY KEY,
          story_segment TEXT NOT NULL,
          branch_point TEXT NOT NULL,
          choice_made TEXT NOT NULL,
          choice_rationale TEXT,
          state_after TEXT NOT NULL,
          evaluation TEXT NOT NULL,
          selected INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          chapter INTEGER,
          parent_id TEXT,
          merged_into TEXT,
          pruned INTEGER DEFAULT 0,
          prune_reason TEXT,
          embedding TEXT,
          events TEXT NOT NULL DEFAULT '[]',
          structured_state TEXT NOT NULL DEFAULT '{}'
        )
      `)

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_chapter ON branches(chapter)
      `)

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_parent ON branches(parent_id)
      `)

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_selected ON branches(selected)
      `)

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_events ON branches(events)
      `)

      try {
        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_events_json_type ON branches((json_type(events)))
        `)
      } catch (error) {
        log.warn("json_expression_index_not_supported", { error: String(error) })
      }

      this.migrateTable()

      this.initialized = true
      log.info("branch_storage_initialized", { path: dbPath })
    } catch (error) {
      log.error("branch_storage_init_failed", { error: String(error) })
      throw error
    }
  }

  private migrateTable(): void {
    const requiredColumns = ["events", "structured_state"]

    for (const column of requiredColumns) {
      try {
        const stmt = this.db.prepare(`PRAGMA table_info(branches)`)
        const columns = stmt.all() as Array<{ name: string }>
        const columnExists = columns.some((c) => c.name === column)

        if (!columnExists) {
          const defaultValue = column === "events" ? "[]" : "{}"
          this.db.run(`
            ALTER TABLE branches ADD COLUMN ${column} TEXT NOT NULL DEFAULT '${defaultValue}'
          `)
          log.info("branch_table_migrated", { column, action: "added" })
        }
      } catch (error) {
        log.warn("branch_table_migration_check_failed", {
          column,
          error: String(error),
        })
      }
    }
  }

  async saveBranch(branch: Branch): Promise<void> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO branches (
        id, story_segment, branch_point, choice_made, choice_rationale,
        state_after, evaluation, selected, created_at, chapter,
        parent_id, merged_into, pruned, prune_reason, embedding,
        events, structured_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      branch.id,
      branch.storySegment,
      branch.branchPoint,
      branch.choiceMade,
      branch.choiceRationale,
      JSON.stringify(branch.stateAfter),
      JSON.stringify(branch.evaluation),
      branch.selected ? 1 : 0,
      branch.createdAt || Date.now(),
      branch.chapter || 0,
      branch.parentId || null,
      branch.mergedInto || null,
      branch.pruned ? 1 : 0,
      branch.pruneReason || null,
      null,
      JSON.stringify(branch.events || []),
      JSON.stringify(branch.structuredState || {}),
    )

    log.info("branch_saved", { id: branch.id, chapter: branch.chapter })
  }

  async loadBranch(id: string): Promise<Branch | null> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`SELECT * FROM branches WHERE id = ?`)
    const row = stmt.get(id) as BranchRecord | undefined

    if (!row) return null

    return this.recordToBranch(row)
  }

  async loadBranchesByChapter(chapter: number): Promise<Branch[]> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`
      SELECT * FROM branches WHERE chapter = ? AND pruned = 0 ORDER BY created_at DESC
    `)
    const rows = stmt.all(chapter) as BranchRecord[]

    return rows.map((r) => this.recordToBranch(r))
  }

  async loadAllBranches(includePruned: boolean = false): Promise<Branch[]> {
    if (!this.initialized) await this.initialize()

    const sql = includePruned
      ? `SELECT * FROM branches ORDER BY created_at DESC`
      : `SELECT * FROM branches WHERE pruned = 0 ORDER BY created_at DESC`

    const stmt = this.db.prepare(sql)
    const rows = stmt.all() as BranchRecord[]

    return rows.map((r) => this.recordToBranch(r))
  }

  async loadBranchesByEventType(eventType: string): Promise<Branch[]> {
    if (!this.initialized) await this.initialize()

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM branches 
        WHERE pruned = 0 
          AND json_type(events) = 'array'
          AND EXISTS (
            SELECT 1 FROM json_each(events) AS event
            WHERE json_extract(event.value, '$.type') = ?
          )
        ORDER BY created_at DESC
      `)
      const rows = stmt.all(eventType) as BranchRecord[]
      log.info("branches_loaded_by_event_type", { eventType, count: rows.length })
      return rows.map((r) => this.recordToBranch(r))
    } catch (error) {
      log.warn("load_branches_by_event_type_json_query_failed", {
        eventType,
        error: String(error),
      })

      const branches = await this.loadAllBranches(false)
      const filtered = branches.filter((b) => b.events?.some((e) => e.type === eventType))
      log.info("branches_loaded_by_event_type_fallback", {
        eventType,
        count: filtered.length,
      })
      return filtered
    }
  }

  async loadBranchTree(): Promise<Map<string | undefined, Branch[]>> {
    const branches = await this.loadAllBranches(true)
    const tree = new Map<string | undefined, Branch[]>()

    for (const branch of branches) {
      const parentKey = branch.parentId
      if (!tree.has(parentKey)) {
        tree.set(parentKey, [])
      }
      tree.get(parentKey)!.push(branch)
    }

    return tree
  }

  async updateBranch(id: string, updates: Partial<Branch>): Promise<boolean> {
    if (!this.initialized) await this.initialize()

    const setClauses: string[] = []
    const values: any[] = []

    if (updates.selected !== undefined) {
      setClauses.push("selected = ?")
      values.push(updates.selected ? 1 : 0)
    }
    if (updates.mergedInto !== undefined) {
      setClauses.push("merged_into = ?")
      values.push(updates.mergedInto)
    }
    if (updates.pruned !== undefined) {
      setClauses.push("pruned = ?")
      values.push(updates.pruned ? 1 : 0)
    }
    if (updates.pruneReason !== undefined) {
      setClauses.push("prune_reason = ?")
      values.push(updates.pruneReason)
    }

    if (setClauses.length === 0) return false

    values.push(id)

    const sql = `UPDATE branches SET ${setClauses.join(", ")} WHERE id = ?`
    const stmt = this.db.prepare(sql)
    stmt.run(...values)

    log.info("branch_updated", { id, updates: Object.keys(updates) })
    return true
  }

  async deleteBranch(id: string): Promise<boolean> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`DELETE FROM branches WHERE id = ?`)
    const result = stmt.run(id)

    log.info("branch_deleted", { id })
    return result.changes > 0
  }

  async getStats(): Promise<{
    total: number
    active: number
    pruned: number
    merged: number
    selected: number
  }> {
    if (!this.initialized) await this.initialize()

    const totalStmt = this.db.prepare(`SELECT COUNT(*) as count FROM branches`)
    const activeStmt = this.db.prepare(`SELECT COUNT(*) as count FROM branches WHERE pruned = 0`)
    const prunedStmt = this.db.prepare(`SELECT COUNT(*) as count FROM branches WHERE pruned = 1`)
    const mergedStmt = this.db.prepare(`SELECT COUNT(*) as count FROM branches WHERE merged_into IS NOT NULL`)
    const selectedStmt = this.db.prepare(`SELECT COUNT(*) as count FROM branches WHERE selected = 1`)

    return {
      total: (totalStmt.get() as any).count,
      active: (activeStmt.get() as any).count,
      pruned: (prunedStmt.get() as any).count,
      merged: (mergedStmt.get() as any).count,
      selected: (selectedStmt.get() as any).count,
    }
  }

  async clear(): Promise<void> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`DELETE FROM branches`)
    stmt.run()

    log.info("branch_storage_cleared")
  }

  async exportToJson(): Promise<Branch[]> {
    return this.loadAllBranches(true)
  }

  async importFromJson(branches: Branch[]): Promise<number> {
    if (!this.initialized) await this.initialize()

    let imported = 0
    for (const branch of branches) {
      try {
        await this.saveBranch(branch)
        imported++
      } catch (error) {
        log.warn("branch_import_failed", { id: branch.id, error: String(error) })
      }
    }

    log.info("branches_imported", { count: imported })
    return imported
  }

  private recordToBranch(record: BranchRecord): Branch {
    let events: Array<{ id: string; type: string; description: string }> = []
    let structuredState: Record<string, any> = {}
    let stateAfter: Record<string, unknown> = {}
    let evaluation: {
      narrativeQuality: number
      tensionLevel: number
      characterDevelopment: number
      plotProgression: number
      characterGrowth: number
      riskReward: number
      thematicRelevance: number
    } = {
      narrativeQuality: 5,
      tensionLevel: 5,
      characterDevelopment: 5,
      plotProgression: 5,
      characterGrowth: 5,
      riskReward: 5,
      thematicRelevance: 5,
    }

    try {
      if (record.events && record.events !== "[]") {
        events = JSON.parse(record.events)
      }
    } catch (error) {
      log.warn("branch_events_parse_failed", { id: record.id, error: String(error) })
    }

    try {
      if (record.structured_state && record.structured_state !== "{}") {
        structuredState = JSON.parse(record.structured_state)
      }
    } catch (error) {
      log.warn("branch_structured_state_parse_failed", { id: record.id, error: String(error) })
    }

    try {
      stateAfter = JSON.parse(record.state_after)
    } catch (error) {
      log.warn("branch_state_after_parse_failed", { id: record.id, error: String(error) })
    }

    try {
      evaluation = JSON.parse(record.evaluation)
    } catch (error) {
      log.warn("branch_evaluation_parse_failed", { id: record.id, error: String(error) })
    }

    return {
      id: record.id,
      storySegment: record.story_segment,
      branchPoint: record.branch_point,
      choiceMade: record.choice_made,
      choiceRationale: record.choice_rationale,
      stateAfter,
      evaluation,
      selected: record.selected === 1,
      createdAt: record.created_at,
      chapter: record.chapter,
      parentId: record.parent_id || undefined,
      mergedInto: record.merged_into || undefined,
      pruned: record.pruned === 1,
      pruneReason: record.prune_reason || undefined,
      events,
      structuredState,
    }
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      this.initialized = false
      log.info("branch_storage_closed")
    }
  }
}

export const branchStorage = new BranchStorage()
