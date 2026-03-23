import { z } from "zod"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { resolve, dirname } from "path"
import { mkdir } from "fs/promises"
import type { CharacterState } from "../types/novel-state"
import { getStoryMemoryDbPath } from "./novel-config"

const log = Log.create({ service: "story-world-memory" })

// Lazy-initialized database path
let MEMORY_DB_PATH: string | null = null

function getDbPath(): string {
  if (!MEMORY_DB_PATH) {
    MEMORY_DB_PATH = getStoryMemoryDbPath()
  }
  return MEMORY_DB_PATH
}

export const MemoryLevelSchema = z.enum(["sentence", "scene", "chapter", "arc", "story"])

export const MemoryEntrySchema = z.object({
  id: z.string(),
  level: MemoryLevelSchema,
  content: z.string(),
  chapter: z.number(),
  scene: z.number().optional(),
  characters: z.array(z.string()),
  locations: z.array(z.string()),
  events: z.array(z.string()),
  themes: z.array(z.string()),
  emotions: z.array(z.string()).optional(),
  significance: z.number().min(1).max(10),
  createdAt: z.number(),
  parent_id: z.string().nullable(),
  embeddings: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type MemoryLevel = z.infer<typeof MemoryLevelSchema>
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>

export interface HierarchicalMemoryConfig {
  maxMemoriesPerLevel: Record<MemoryLevel, number>
  enableEmbeddings: boolean
  similarityThreshold: number
}

const DEFAULT_CONFIG: HierarchicalMemoryConfig = {
  maxMemoriesPerLevel: {
    sentence: 1000,
    scene: 500,
    chapter: 100,
    arc: 20,
    story: 5,
  },
  enableEmbeddings: false,
  similarityThreshold: 0.8,
}

export class StoryWorldMemory {
  private db: any = null
  private config: HierarchicalMemoryConfig
  private initialized: boolean = false

  constructor(config: Partial<HierarchicalMemoryConfig> = {}) {
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
        CREATE TABLE IF NOT EXISTS memory_entries (
          id TEXT PRIMARY KEY,
          level TEXT NOT NULL,
          content TEXT NOT NULL,
          chapter INTEGER NOT NULL,
          scene INTEGER,
          characters TEXT NOT NULL,
          locations TEXT NOT NULL,
          events TEXT NOT NULL,
          themes TEXT NOT NULL,
          emotions TEXT,
          significance REAL NOT NULL,
          created_at INTEGER NOT NULL,
          parent_id TEXT,
          embeddings TEXT,
          metadata TEXT
        )
      `)

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_level ON memory_entries(level)
      `)

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_chapter ON memory_entries(chapter)
      `)

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_parent ON memory_entries(parent_id)
      `)

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_characters ON memory_entries(characters)
      `)

      this.initialized = true
      log.info("story_world_memory_initialized", { path: dbPath })
    } catch (error) {
      log.error("story_world_memory_init_failed", { error: String(error) })
      throw error
    }
  }

  async storeMemory(entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<MemoryEntry> {
    if (!this.initialized) await this.initialize()

    const id = `mem_${entry.level}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const createdAt = Date.now()

    const stmt = this.db.prepare(`
      INSERT INTO memory_entries (
        id, level, content, chapter, scene, characters, locations, events,
        themes, emotions, significance, created_at, parent_id, embeddings, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      id,
      entry.level,
      entry.content,
      entry.chapter,
      entry.scene || null,
      JSON.stringify(entry.characters),
      JSON.stringify(entry.locations),
      JSON.stringify(entry.events),
      JSON.stringify(entry.themes),
      entry.emotions ? JSON.stringify(entry.emotions) : null,
      entry.significance,
      createdAt,
      entry.parent_id || null,
      null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    )

    await this.enforceMaxMemories(entry.level)

    log.info("memory_stored", { id, level: entry.level, chapter: entry.chapter })

    const storedEntry: MemoryEntry = {
      ...entry,
      id,
      createdAt,
    }

    // NEW: Trigger knowledge graph update for scene/chapter memories
    if (entry.level === "scene" || entry.level === "chapter") {
      queueMicrotask(async () => {
        try {
          await (globalThis as any).storyKnowledgeGraph?.ingestFromMemoryEntry(storedEntry)
        } catch (e) {
          log.warn("knowledge_graph_ingest_failed", { error: String(e) })
        }
      })
    }

    return storedEntry
  }

  async storeChapterSummary(
    chapter: number,
    summary: string,
    characters: string[],
    locations: string[],
    events: string[],
    themes: string[],
    parentArcId?: string,
  ): Promise<MemoryEntry> {
    const entry = await this.storeMemory({
      level: "chapter",
      content: summary,
      chapter,
      characters,
      locations,
      events,
      themes,
      significance: 8,
      parent_id: parentArcId || null,
      metadata: { type: "chapter_summary" },
    })

    // NEW: Notify thematic analyst for integration (if global instance exists)
    if ((globalThis as any).thematicAnalyst) {
      try {
        await (globalThis as any).thematicAnalyst.onChapterSummaryStored(entry)
      } catch (error) {
        log.warn("thematic_analyst_notification_failed", { error: String(error) })
      }
    }

    return entry
  }

  async storeSceneSummary(
    chapter: number,
    scene: number,
    summary: string,
    characters: string[],
    locations: string[],
    events: string[],
    parentChapterId?: string,
  ): Promise<MemoryEntry> {
    return this.storeMemory({
      level: "scene",
      content: summary,
      chapter,
      scene,
      characters,
      locations,
      events,
      themes: [],
      significance: 5,
      parent_id: parentChapterId || null,
      metadata: { type: "scene_summary" },
    })
  }

  async storeArcSummary(
    arcName: string,
    summary: string,
    startChapter: number,
    endChapter: number,
    characters: string[],
    themes: string[],
    parentStoryId?: string,
  ): Promise<MemoryEntry> {
    return this.storeMemory({
      level: "arc",
      content: summary,
      chapter: startChapter,
      characters,
      locations: [],
      events: [],
      themes,
      significance: 9,
      parent_id: parentStoryId || null,
      metadata: { type: "arc_summary", arcName, endChapter },
    })
  }

  private async enforceMaxMemories(level: MemoryLevel): Promise<void> {
    const maxCount = this.config.maxMemoriesPerLevel[level]

    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM memory_entries WHERE level = ?
    `)
    const count = (countStmt.get(level) as any).count

    if (count > maxCount) {
      const excess = count - maxCount
      const deleteStmt = this.db.prepare(`
        DELETE FROM memory_entries WHERE level = ?
        ORDER BY created_at ASC LIMIT ?
      `)
      deleteStmt.run(level, excess)

      log.info("memories_pruned", { level, removed: excess, remaining: maxCount })
    }
  }

  async getMemoriesByLevel(level: MemoryLevel, limit?: number): Promise<MemoryEntry[]> {
    if (!this.initialized) await this.initialize()

    const sql = `
      SELECT * FROM memory_entries 
      WHERE level = ? 
      ORDER BY chapter DESC, created_at DESC 
      LIMIT ?
    `
    const stmt = this.db.prepare(sql)
    const rows = stmt.all(level, limit || this.config.maxMemoriesPerLevel[level]) as any[]

    return rows.map((r) => this.rowToMemory(r))
  }

  async getMemoriesByChapter(chapter: number, level?: MemoryLevel, asOfEndOfChapter?: boolean): Promise<MemoryEntry[]> {
    if (!this.initialized) await this.initialize()

    if (asOfEndOfChapter) {
      // Get all memories up to and including this chapter
      const sql = level
        ? `SELECT * FROM memory_entries WHERE chapter <= ? AND level = ? ORDER BY chapter DESC, created_at DESC`
        : `SELECT * FROM memory_entries WHERE chapter <= ? ORDER BY chapter DESC, created_at DESC`

      const stmt = this.db.prepare(sql)
      const rows = level ? stmt.all(chapter, level) : stmt.all(chapter)

      return rows.map((r: any) => this.rowToMemory(r))
    } else {
      // Original behavior: get memories for exact chapter
      const sql = level
        ? `SELECT * FROM memory_entries WHERE chapter = ? AND level = ? ORDER BY created_at DESC`
        : `SELECT * FROM memory_entries WHERE chapter = ? ORDER BY level DESC, created_at DESC`

      const stmt = this.db.prepare(sql)
      const rows = level ? stmt.all(chapter, level) : stmt.all(chapter)

      return rows.map((r: any) => this.rowToMemory(r))
    }
  }

  async getMemoriesByCharacter(characterName: string, limit?: number): Promise<MemoryEntry[]> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`
      SELECT * FROM memory_entries 
      WHERE characters LIKE ? 
      ORDER BY chapter DESC 
      LIMIT ?
    `)

    const rows = stmt.all(`%${characterName}%`, limit || 100)

    return rows.map((r: any) => this.rowToMemory(r))
  }

  async getMemoriesByTheme(theme: string, limit?: number): Promise<MemoryEntry[]> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`
      SELECT * FROM memory_entries 
      WHERE themes LIKE ? 
      ORDER BY significance DESC 
      LIMIT ?
    `)

    const rows = stmt.all(`%${theme}%`, limit || 50)

    return rows.map((r: any) => this.rowToMemory(r))
  }

  async getMemoryHierarchy(chapter: number): Promise<{
    story: MemoryEntry[]
    arcs: MemoryEntry[]
    chapters: MemoryEntry[]
    scenes: MemoryEntry[]
  }> {
    const allMemories = await this.getMemoriesByChapter(chapter)

    return {
      story: allMemories.filter((m) => m.level === "story"),
      arcs: allMemories.filter((m) => m.level === "arc"),
      chapters: allMemories.filter((m) => m.level === "chapter"),
      scenes: allMemories.filter((m) => m.level === "scene"),
    }
  }

  async getRecentContext(
    chapter: number,
    maxChapters: number = 5,
  ): Promise<{
    summary: string
    characters: string[]
    themes: string[]
  }> {
    const memories = await this.getMemoriesByChapter(chapter)
    const recentMemories = memories.filter((m) => m.chapter >= chapter - maxChapters && m.chapter <= chapter)

    const characters = new Set<string>()
    const themes = new Set<string>()
    const summaries: string[] = []

    for (const memory of recentMemories.sort((a, b) => b.chapter - a.chapter)) {
      for (const char of memory.characters) {
        characters.add(char)
      }
      for (const theme of memory.themes) {
        themes.add(theme)
      }
      summaries.push(`[Ch.${memory.chapter}] ${memory.content}`)
    }

    return {
      summary: summaries.slice(0, 10).join("\n"),
      characters: Array.from(characters),
      themes: Array.from(themes),
    }
  }

  async updateMemorySignificance(id: string, newSignificance: number): Promise<boolean> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`
      UPDATE memory_entries SET significance = ? WHERE id = ?
    `)
    const result = stmt.run(newSignificance, id)

    return result.changes > 0
  }

  async deleteMemory(id: string): Promise<boolean> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`DELETE FROM memory_entries WHERE id = ?`)
    const result = stmt.run(id)

    log.info("memory_deleted", { id })
    return result.changes > 0
  }

  async getStats(): Promise<{
    total: number
    byLevel: Record<MemoryLevel, number>
    avgSignificance: number
  }> {
    if (!this.initialized) await this.initialize()

    const totalStmt = this.db.prepare(`SELECT COUNT(*) as count FROM memory_entries`)
    const total = (totalStmt.get() as any).count

    const levelStmt = this.db.prepare(`
      SELECT level, COUNT(*) as count FROM memory_entries GROUP BY level
    `)
    const levelRows = levelStmt.all() as Array<{ level: string; count: number }>

    const byLevel: any = {}
    for (const row of levelRows) {
      byLevel[row.level] = row.count
    }

    const avgStmt = this.db.prepare(`SELECT AVG(significance) as avg FROM memory_entries`)
    const avgSignificance = (avgStmt.get() as any).avg || 0

    return {
      total,
      byLevel: byLevel as Record<MemoryLevel, number>,
      avgSignificance,
    }
  }

  async exportToJson(): Promise<MemoryEntry[]> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`SELECT * FROM memory_entries ORDER BY chapter, level`)
    const rows = stmt.all()

    return rows.map((r: any) => this.rowToMemory(r))
  }

  async importFromJson(memories: MemoryEntry[]): Promise<number> {
    if (!this.initialized) await this.initialize()

    let imported = 0
    for (const memory of memories) {
      try {
        await this.storeMemory(memory)
        imported++
      } catch (error) {
        log.warn("memory_import_failed", { id: memory.id, error: String(error) })
      }
    }

    log.info("memories_imported", { count: imported })
    return imported
  }

  private rowToMemory(row: any): MemoryEntry {
    return {
      id: row.id,
      level: row.level as MemoryLevel,
      content: row.content,
      chapter: row.chapter,
      scene: row.scene,
      characters: JSON.parse(row.characters),
      locations: JSON.parse(row.locations),
      events: JSON.parse(row.events),
      themes: JSON.parse(row.themes),
      emotions: row.emotions ? JSON.parse(row.emotions) : [],
      significance: row.significance,
      createdAt: row.created_at,
      parent_id: row.parent_id,
      embeddings: row.embeddings,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    }
  }

  async clear(): Promise<void> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`DELETE FROM memory_entries`)
    stmt.run()

    log.info("story_world_memory_cleared")
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      this.initialized = false
      log.info("story_world_memory_closed")
    }
  }
}

export const storyWorldMemory = new StoryWorldMemory()
