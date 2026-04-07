import { z } from "zod"
import { Log } from "../util/log"
import type { Branch } from "./branch-manager"
import { dbManager } from "./db/database-manager"

const log = Log.create({ service: "branch-storage" })

interface BranchEvent {
  id: string
  type: string
  description: string
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
  /** Enable local content signature generation for branch similarity search.
   *  NOTE: These are hash-based signatures, NOT AI embeddings.
   *  Real embeddings go through NovelVectorBridge → VectorStore → EmbeddingService. */
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

    try {
      this.db = await dbManager.getDb("branches")

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
      log.info("branch_storage_initialized", { dbName: "branches" })
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

    // Generate a local content signature (hash + eval scores) for branch similarity.
    // NOTE: This is NOT an AI embedding — it's a deterministic hash-based signature
    // used for fast local similarity search without calling an embedding model.
    // Real embeddings go through NovelVectorBridge → VectorStore → EmbeddingService.
    const branchSignature = this.config.enableEmbeddings
      ? this.generateBranchSignature(branch)
      : null

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
      branchSignature,
      JSON.stringify(branch.events || []),
      JSON.stringify(branch.structuredState || {}),
    )

    log.info("branch_saved", { id: branch.id, chapter: branch.chapter, signature: !!branchSignature })
  }

  /**
   * Generate a local content signature for a branch as a compact JSON string.
   * Uses a multi-feature hash combining story content, evaluation scores, and
   * narrative themes for fast local similarity-based branch retrieval.
   * NOTE: This is NOT an AI embedding — it's a deterministic hash-based signature.
   */
  private generateBranchSignature(branch: Branch): string {
    const evalScores = branch.evaluation
      ? [
          branch.evaluation.narrativeQuality || 0,
          branch.evaluation.tensionLevel || 0,
          branch.evaluation.characterDevelopment || 0,
          branch.evaluation.plotProgression || 0,
          branch.evaluation.characterGrowth || 0,
          branch.evaluation.riskReward || 0,
          branch.evaluation.thematicRelevance || 0,
        ]
      : [0, 0, 0, 0, 0, 0, 0]

    // Generate a content-based hash for similarity matching
    const contentHash = this.simpleHash(branch.storySegment)
    const choiceHash = this.simpleHash(branch.choiceMade + branch.branchPoint)

    return JSON.stringify({
      v: 1, // signature version
      ch: contentHash,
      wh: choiceHash,
      ev: evalScores,
      cp: branch.chapter || 0,
    })
  }

  /**
   * Simple hash for text content.
   * Uses DJB2 algorithm for deterministic, fast hashing.
   */
  private simpleHash(str: string): string {
    let hash = 5381
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 33) ^ str.charCodeAt(i)
    }
    return (hash >>> 0).toString(36)
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

  /**
   * Find branches with similar content signatures to the given context.
   * Uses cosine similarity on evaluation score vectors and content hashes.
   * Returns branches sorted by similarity score (highest first).
   * NOTE: Uses local hash-based signatures, NOT AI embeddings.
   */
  async findSimilarBranches(
    context: {
      storySegment?: string
      evaluation?: {
        narrativeQuality: number
        tensionLevel: number
        characterDevelopment: number
        plotProgression: number
        characterGrowth: number
        riskReward: number
        thematicRelevance: number
      }
      chapter?: number
    },
    limit: number = 5,
    minSimilarity: number = 0.3,
  ): Promise<Array<{ branch: Branch; similarity: number }>> {
    if (!this.initialized) await this.initialize()

    const allBranches = await this.loadAllBranches(false)
    const branchesWithSignatures = allBranches.filter((b) => b.events && b.pruned === false)

    if (branchesWithSignatures.length === 0) {
      return []
    }

    const contextSignature = this.generateBranchSignature({
      id: "context",
      storySegment: context.storySegment || "",
      branchPoint: "",
      choiceMade: "",
      choiceRationale: "",
      stateAfter: {},
      evaluation: context.evaluation,
      selected: false,
      createdAt: Date.now(),
      chapter: context.chapter,
      events: [],
      structuredState: {},
    } as Branch)

    const similarities = branchesWithSignatures
      .map((branch) => {
        try {
          const branchSignature = (branch as any).embedding || "{}"
          const similarity = this.calculateSignatureSimilarity(contextSignature, branchSignature)
          return { branch, similarity }
        } catch {
          return { branch, similarity: 0 }
        }
      })
      .filter((x) => x.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)

    log.info("similar_branches_found", {
      total: branchesWithSignatures.length,
      returned: similarities.length,
      minSimilarity,
    })

    return similarities
  }

  /**
   * Calculate cosine similarity between two content signature vectors.
   * Compares evaluation scores primarily, with hash matching as bonus.
   * NOTE: Operates on local hash-based signatures, NOT AI embeddings.
   */
  private calculateSignatureSimilarity(sigA: string, sigB: string): number {
    try {
      const a = typeof sigA === "string" ? JSON.parse(sigA) : sigA
      const b = typeof sigB === "string" ? JSON.parse(sigB) : sigB

      if (!a.ev || !b.ev) return 0

      // Cosine similarity on evaluation scores
      const vecA = a.ev as number[]
      const vecB = b.ev as number[]

      const dotProduct = vecA.reduce((sum: number, val: number, i: number) => sum + val * (vecB[i] || 0), 0)
      const magnitudeA = Math.sqrt(vecA.reduce((sum: number, val: number) => sum + val * val, 0))
      const magnitudeB = Math.sqrt(vecB.reduce((sum: number, val: number) => sum + val * val, 0))

      if (magnitudeA === 0 || magnitudeB === 0) return 0

      const cosineSim = dotProduct / (magnitudeA * magnitudeB)

      // Bonus for same chapter
      const chapterBonus = a.cp === b.cp ? 0.1 : 0

      // Bonus for content hash match (exact match is rare but significant)
      const contentBonus = a.ch === b.ch ? 0.2 : 0

      return Math.min(1.0, cosineSim * 0.7 + chapterBonus + contentBonus)
    } catch {
      return 0
    }
  }

  /**
   * Get branches from a specific chapter with optional quality filtering.
   * Useful for reviewing alternative story paths at a given point.
   */
  async getBranchesByChapter(
    chapter: number,
    options?: {
      minQuality?: number
      includePruned?: boolean
      sortBy?: "quality" | "date" | "similarity"
    },
  ): Promise<Branch[]> {
    if (!this.initialized) await this.initialize()

    let branches = await this.loadBranchesByChapter(chapter)

    if (!options?.includePruned) {
      branches = branches.filter((b) => !b.pruned)
    }

    if (options?.minQuality) {
      branches = branches.filter(
        (b) =>
          b.evaluation.narrativeQuality >= options.minQuality! ||
          b.evaluation.tensionLevel >= options.minQuality! ||
          b.evaluation.characterDevelopment >= options.minQuality!,
      )
    }

    // Sort by requested criteria
    if (options?.sortBy === "quality") {
      branches.sort(
        (a, b) =>
          b.evaluation.narrativeQuality +
          b.evaluation.tensionLevel +
          b.evaluation.characterDevelopment -
          (a.evaluation.narrativeQuality + a.evaluation.tensionLevel + a.evaluation.characterDevelopment),
      )
    } else if (options?.sortBy === "date") {
      branches.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    }

    return branches
  }

  /**
   * Get branch statistics including quality distribution and timeline.
   */
  async getDetailedStats(): Promise<{
    total: number
    active: number
    pruned: number
    merged: number
    selected: number
    qualityDistribution: {
      high: number // >= 7
      medium: number // 4-6
      low: number // < 4
    }
    chapterRange: { min: number; max: number }
    avgEvaluation: {
      narrativeQuality: number
      tensionLevel: number
      characterDevelopment: number
      plotProgression: number
      characterGrowth: number
      riskReward: number
      thematicRelevance: number
    }
  }> {
    const basicStats = await this.getStats()
    const allBranches = await this.loadAllBranches(true)

    if (allBranches.length === 0) {
      return {
        ...basicStats,
        qualityDistribution: { high: 0, medium: 0, low: 0 },
        chapterRange: { min: 0, max: 0 },
        avgEvaluation: {
          narrativeQuality: 0,
          tensionLevel: 0,
          characterDevelopment: 0,
          plotProgression: 0,
          characterGrowth: 0,
          riskReward: 0,
          thematicRelevance: 0,
        },
      }
    }

    const qualityDist = { high: 0, medium: 0, low: 0 }
    const chapters: number[] = []
    const evalSums = {
      narrativeQuality: 0,
      tensionLevel: 0,
      characterDevelopment: 0,
      plotProgression: 0,
      characterGrowth: 0,
      riskReward: 0,
      thematicRelevance: 0,
    }

    for (const branch of allBranches) {
      const avgScore =
        (branch.evaluation.narrativeQuality +
          branch.evaluation.tensionLevel +
          branch.evaluation.characterDevelopment +
          branch.evaluation.plotProgression +
          branch.evaluation.characterGrowth +
          branch.evaluation.riskReward +
          branch.evaluation.thematicRelevance) /
        7

      if (avgScore >= 7) qualityDist.high++
      else if (avgScore >= 4) qualityDist.medium++
      else qualityDist.low++

      if (branch.chapter) chapters.push(branch.chapter)

      evalSums.narrativeQuality += branch.evaluation.narrativeQuality
      evalSums.tensionLevel += branch.evaluation.tensionLevel
      evalSums.characterDevelopment += branch.evaluation.characterDevelopment
      evalSums.plotProgression += branch.evaluation.plotProgression
      evalSums.characterGrowth += branch.evaluation.characterGrowth
      evalSums.riskReward += branch.evaluation.riskReward
      evalSums.thematicRelevance += branch.evaluation.thematicRelevance
    }

    const count = allBranches.length
    return {
      ...basicStats,
      qualityDistribution: qualityDist,
      chapterRange: {
        min: Math.min(...chapters),
        max: Math.max(...chapters),
      },
      avgEvaluation: {
        narrativeQuality: evalSums.narrativeQuality / count,
        tensionLevel: evalSums.tensionLevel / count,
        characterDevelopment: evalSums.characterDevelopment / count,
        plotProgression: evalSums.plotProgression / count,
        characterGrowth: evalSums.characterGrowth / count,
        riskReward: evalSums.riskReward / count,
        thematicRelevance: evalSums.thematicRelevance / count,
      },
    }
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
    if (this.initialized) {
      dbManager.close("branches")
      this.db = null
      this.initialized = false
      log.info("branch_storage_closed")
    }
  }
}

export const branchStorage = new BranchStorage()
