import { z } from "zod"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { resolve, dirname } from "path"
import { mkdir } from "fs/promises"
import { EmbeddingService } from "../learning/embedding-service"
import type { EmbeddingGenerator } from "../learning/vector-store-interface"
import type { EnhancedPattern, Archetype, Motif } from "./pattern-miner-enhanced"
import { getPatternVectorDbPath } from "./novel-config"

const log = Log.create({ service: "pattern-vector-index" })

// Lazy-initialized database path
let DB_PATH: string | null = null

function getDbPath(): string {
  if (!DB_PATH) {
    DB_PATH = getPatternVectorDbPath()
  }
  return DB_PATH
}

export const PatternVectorSchema = z.object({
  id: z.string(),
  pattern_type: z.enum(["pattern", "archetype", "motif"]),
  name: z.string(),
  description: z.string(),
  embedding: z.string(),
  metadata: z.string(),
  strength: z.number(),
  created_at: z.number(),
})

export type PatternVector = z.infer<typeof PatternVectorSchema>

export interface ParsedPatternVector {
  id: string
  pattern_type: "pattern" | "archetype" | "motif"
  name: string
  description: string
  embedding: number[]
  metadata: Record<string, unknown>
  strength: number
  created_at: number
}

export interface SimilarityResult {
  id: string
  patternType: string
  name: string
  description: string
  similarity: number
  strength: number
}

export interface VectorIndexConfig {
  embeddingDimension: number
  similarityThreshold: number
  maxResults: number
  embeddingModelId?: string // 使用 learning 模块的 embedding 模型
}

const DEFAULT_CONFIG: VectorIndexConfig = {
  embeddingDimension: 1536, // OpenAI text-embedding-3-small
  similarityThreshold: 0.7,
  maxResults: 10,
  embeddingModelId: "text-embedding-3-small",
}

export class PatternVectorIndex {
  private db: any = null
  private config: VectorIndexConfig
  private initialized: boolean = false
  private embeddingGenerator: EmbeddingGenerator | null = null

  constructor(config: Partial<VectorIndexConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      const dbPath = getDbPath()
      await mkdir(dirname(dbPath), { recursive: true })

      const { Database } = await import("bun:sqlite")
      this.db = new Database(dbPath)

      this.db.run(`
        CREATE TABLE IF NOT EXISTS pattern_vectors (
          id TEXT PRIMARY KEY,
          pattern_type TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          embedding TEXT NOT NULL,
          metadata TEXT,
          strength REAL DEFAULT 50,
          created_at INTEGER NOT NULL
        )
      `)

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_pattern_type ON pattern_vectors(pattern_type)
      `)

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_strength ON pattern_vectors(strength)
      `)

      await this.initializeEmbeddingGenerator()

      this.initialized = true
      log.info("pattern_vector_index_initialized", {
        path: dbPath,
        dimension: this.config.embeddingDimension,
      })
    } catch (error) {
      log.error("pattern_vector_index_init_failed", { error: String(error) })
      throw error
    }
  }

  private async initializeEmbeddingGenerator(): Promise<void> {
    if (this.config.embeddingModelId) {
      try {
        const service = await EmbeddingService.createService({
          modelId: this.config.embeddingModelId,
        })
        this.embeddingGenerator = service.generator
        log.info("pattern_vector_embedding_initialized", {
          modelId: this.config.embeddingModelId,
          dimensions: service.dimensions,
        })
      } catch (error) {
        log.warn("pattern_vector_embedding_init_failed_using_fallback", { error: String(error) })
        this.embeddingGenerator = null
      }
    }
  }

  private generateRandomEmbedding(): Float32Array {
    const embedding: number[] = []
    for (let i = 0; i < this.config.embeddingDimension; i++) {
      embedding.push(Math.random() * 2 - 1)
    }
    return new Float32Array(this.normalizeVector(embedding))
  }

  private normalizeVector(vec: number[]): number[] {
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
    if (magnitude === 0) return vec
    return vec.map((v) => v / magnitude)
  }

  async generateEmbedding(text: string): Promise<Float32Array> {
    if (this.embeddingGenerator) {
      try {
        return await this.embeddingGenerator(text, "content")
      } catch (error) {
        log.warn("pattern_vector_embedding_generation_failed_using_fallback", { error: String(error) })
      }
    }
    return this.generateRandomEmbedding()
  }

  async indexPattern(pattern: EnhancedPattern): Promise<void> {
    if (!this.initialized) await this.initialize()

    const text = `${pattern.name} ${pattern.description}`
    const embedding = await this.generateEmbedding(text)

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO pattern_vectors (
        id, pattern_type, name, description, embedding, metadata, strength, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      pattern.id,
      pattern.category,
      pattern.name,
      pattern.description,
      JSON.stringify(embedding),
      JSON.stringify(pattern.metadata || {}),
      pattern.strength,
      pattern.last_reinforced || Date.now(),
    )

    log.info("pattern_indexed", { id: pattern.id, type: pattern.category })
  }

  async indexArchetype(archetype: Archetype): Promise<void> {
    if (!this.initialized) await this.initialize()

    const text = `${archetype.name} ${archetype.description} ${archetype.traits.join(" ")} ${archetype.narrative_role}`
    const embedding = await this.generateEmbedding(text)

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO pattern_vectors (
        id, pattern_type, name, description, embedding, metadata, strength, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      archetype.id,
      "archetype",
      archetype.name,
      archetype.description,
      JSON.stringify(embedding),
      JSON.stringify({
        type: archetype.type,
        traits: archetype.traits,
        narrative_role: archetype.narrative_role,
      }),
      archetype.strength,
      archetype.last_reinforced,
    )

    log.info("archetype_indexed", { id: archetype.id, type: archetype.type })
  }

  async indexMotif(motif: Motif): Promise<void> {
    if (!this.initialized) await this.initialize()

    const text = `${motif.name} ${motif.description} ${motif.type}`
    const embedding = await this.generateEmbedding(text)

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO pattern_vectors (
        id, pattern_type, name, description, embedding, metadata, strength, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const latestOccurrence = motif.occurrences.length > 0 ? motif.occurrences[motif.occurrences.length - 1].chapter : 0

    stmt.run(
      motif.id,
      "motif",
      motif.name,
      motif.description,
      JSON.stringify(embedding),
      JSON.stringify({
        type: motif.type,
        occurrences: motif.occurrences.length,
        evolution: motif.evolution,
      }),
      motif.strength,
      latestOccurrence * 1000,
    )

    log.info("motif_indexed", { id: motif.id, type: motif.type })
  }

  async searchSimilar(queryText: string, patternType?: string, limit?: number): Promise<SimilarityResult[]> {
    if (!this.initialized) await this.initialize()

    const queryEmbedding = await this.generateEmbedding(queryText)
    const maxResults = limit || this.config.maxResults

    const sql = patternType
      ? `SELECT * FROM pattern_vectors WHERE pattern_type = ? AND strength >= 10`
      : `SELECT * FROM pattern_vectors WHERE strength >= 10`

    const stmt = this.db.prepare(sql)
    const rows = patternType ? (stmt.all(patternType) as PatternVector[]) : (stmt.all() as PatternVector[])

    const results: Array<{ row: PatternVector; similarity: number }> = []

    for (const row of rows) {
      const storedEmbedding = JSON.parse(row.embedding) as number[]
      const similarity = this.cosineSimilarity(queryEmbedding, storedEmbedding)

      if (similarity >= this.config.similarityThreshold) {
        results.push({ row, similarity })
      }
    }

    results.sort((a, b) => b.similarity - a.similarity)

    return results.slice(0, maxResults).map(({ row, similarity }) => ({
      id: row.id,
      patternType: row.pattern_type,
      name: row.name,
      description: row.description,
      similarity,
      strength: row.strength,
    }))
  }

  async searchById(id: string): Promise<PatternVector | null> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`SELECT * FROM pattern_vectors WHERE id = ?`)
    const row = stmt.get(id) as PatternVector | undefined

    return row || null
  }

  async updateStrength(id: string, newStrength: number): Promise<boolean> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`UPDATE pattern_vectors SET strength = ? WHERE id = ?`)
    const result = stmt.run(newStrength, id)

    return result.changes > 0
  }

  async removePattern(id: string): Promise<boolean> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`DELETE FROM pattern_vectors WHERE id = ?`)
    const result = stmt.run(id)

    log.info("pattern_removed_from_index", { id })
    return result.changes > 0
  }

  async getPatternsByType(patternType: string): Promise<PatternVector[]> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`
      SELECT * FROM pattern_vectors WHERE pattern_type = ? ORDER BY strength DESC
    `)
    return stmt.all(patternType) as PatternVector[]
  }

  async getTopPatterns(limit: number = 20): Promise<PatternVector[]> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`
      SELECT * FROM pattern_vectors ORDER BY strength DESC LIMIT ?
    `)
    return stmt.all(limit) as PatternVector[]
  }

  private cosineSimilarity(a: Float32Array, b: number[]): number {
    if (a.length !== b.length) return 0

    let dotProduct = 0
    let magnitudeA = 0
    let magnitudeB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      magnitudeA += a[i] * a[i]
      magnitudeB += b[i] * b[i]
    }

    magnitudeA = Math.sqrt(magnitudeA)
    magnitudeB = Math.sqrt(magnitudeB)

    if (magnitudeA === 0 || magnitudeB === 0) return 0

    return dotProduct / (magnitudeA * magnitudeB)
  }

  async getStats(): Promise<{
    total: number
    byType: Record<string, number>
    avgStrength: number
  }> {
    if (!this.initialized) await this.initialize()

    const totalStmt = this.db.prepare(`SELECT COUNT(*) as count FROM pattern_vectors`)
    const total = (totalStmt.get() as any).count

    const typeStmt = this.db.prepare(`
      SELECT pattern_type, COUNT(*) as count FROM pattern_vectors GROUP BY pattern_type
    `)
    const typeRows = typeStmt.all() as Array<{ pattern_type: string; count: number }>

    const byType: Record<string, number> = {}
    for (const row of typeRows) {
      byType[row.pattern_type] = row.count
    }

    const avgStmt = this.db.prepare(`SELECT AVG(strength) as avg FROM pattern_vectors`)
    const avgStrength = (avgStmt.get() as any).avg || 0

    return { total, byType, avgStrength }
  }

  async clear(): Promise<void> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`DELETE FROM pattern_vectors`)
    stmt.run()

    log.info("pattern_vector_index_cleared")
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      this.initialized = false
      log.info("pattern_vector_index_closed")
    }
  }
}

export const patternVectorIndex = new PatternVectorIndex()
