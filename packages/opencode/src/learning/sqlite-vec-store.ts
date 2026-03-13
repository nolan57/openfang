/**
 * SQLite-vec implementation of the VectorStore interface
 * 
 * Uses the sqlite-vec extension for fast vector similarity search.
 * Falls back to text-based search when the extension is not available.
 */

import { Database } from "../storage/db"
import { vector_memory, vector_sync_meta } from "./learning.sql"
import { knowledge_nodes } from "./knowledge-graph"
import { eq, sql } from "drizzle-orm"
import { Log } from "../util/log"
import type {
  IVectorStore,
  VectorEntry,
  SearchResult,
  SearchOptions,
  VectorStats,
  VectorStoreConfig,
  VectorType,
  EmbeddingModel,
} from "./vector-store-interface"

const log = Log.create({ service: "sqlite-vec-store" })

/**
 * SQLite-vec implementation of IVectorStore
 */
export class SqliteVecStore implements IVectorStore {
  private config: VectorStoreConfig
  private vecTableInitialized: boolean = false
  private initialized: boolean = false
  private readonly SYNC_VERSION = 1

  constructor(config: VectorStoreConfig = {}) {
    this.config = {
      defaultModel: config.defaultModel ?? "simple",
      defaultDimensions: config.defaultDimensions ?? 384,
      initializeVecTable: config.initializeVecTable ?? true,
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return

    try {
      if (this.config.initializeVecTable) {
        await this.ensureVecTable()
      }
    } catch (error) {
      log.warn("vec_table_init_failed", { error: String(error) })
    }

    if (this.vecTableInitialized) {
      await this.maybeSync()
    }

    this.initialized = true
  }

  isInitialized(): boolean {
    return this.initialized
  }

  private async ensureVecTable(): Promise<void> {
    if (this.vecTableInitialized) return

    const sqlite = Database.raw()
    try {
      sqlite.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_vector_memory USING vec0(
          embedding float[${this.config.defaultDimensions}]
        )
      `)
      this.vecTableInitialized = true
      log.info("vec_table_created")
    } catch (error) {
      log.warn("vec_table_not_available", {
        error: error instanceof Error ? error.message : String(error),
        note: "Vector search will use text-based fallback",
      })
    }
  }

  private async maybeSync(): Promise<void> {
    const needsSync = Database.use((db) => {
      const nodesCount = db.select({ count: sql<number>`count(*)` }).from(knowledge_nodes).get() as { count: number } | undefined
      const totalNodes = nodesCount?.count ?? 0

      if (totalNodes === 0) return false

      const syncMeta = db.select().from(vector_sync_meta).where(eq(vector_sync_meta.id, "sync_state")).get()

      if (!syncMeta) return true

      if (syncMeta.sync_version !== this.SYNC_VERSION) {
        log.info("sync_version_mismatch", { stored: syncMeta.sync_version, current: this.SYNC_VERSION })
        return true
      }

      if (syncMeta.nodes_synced_count !== totalNodes) {
        log.info("node_count_mismatch", { synced: syncMeta.nodes_synced_count, total: totalNodes })
        return true
      }

      return false
    })

    if (needsSync) {
      log.info("starting_knowledge_nodes_sync")
      const result = await this.syncKnowledgeNodes()
      log.info("sync_complete", result)

      const cleanupResult = await this.cleanupOrphanedVectors()
      if (cleanupResult.removed > 0) {
        log.info("cleanup_after_sync", cleanupResult)
      }
    }
  }

  private async updateSyncMeta(syncedCount: number): Promise<void> {
    const now = Date.now()
    Database.use((db) => {
      db.insert(vector_sync_meta)
        .values({
          id: "sync_state",
          sync_version: this.SYNC_VERSION,
          last_synced_at: now,
          nodes_synced_count: syncedCount,
        })
        .onConflictDoUpdate({
          target: vector_sync_meta.id,
          set: {
            sync_version: this.SYNC_VERSION,
            last_synced_at: now,
            nodes_synced_count: syncedCount,
          },
        })
    })
  }

  async store(entry: Omit<VectorEntry, "id">): Promise<string> {
    if (!this.initialized) await this.init()

    const id = crypto.randomUUID()
    const embedding = entry.embedding ?? await this.generateEmbedding(entry.entity_title, entry.vector_type)
    const embeddingJson = JSON.stringify(Array.from(embedding))

    Database.use((db) => {
      db.insert(vector_memory).values({
        id,
        node_type: entry.node_type,
        node_id: entry.node_id,
        entity_title: entry.entity_title,
        vector_type: entry.vector_type,
        embedding: embeddingJson,
        model: entry.model ?? this.config.defaultModel!,
        dimensions: embedding.length,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      })
    })

    if (this.vecTableInitialized) {
      const sqlite = Database.raw()
      sqlite.prepare("INSERT INTO vec_vector_memory(rowid, embedding) VALUES (?, vec_f32(?))").run(id, embeddingJson)
    }

    log.info("vector_stored", { id, node_type: entry.node_type, vector_type: entry.vector_type })
    return id
  }

  async storeBatch(entries: Omit<VectorEntry, "id">[]): Promise<string[]> {
    const ids: string[] = []
    for (const entry of entries) {
      const id = await this.store(entry)
      ids.push(id)
    }
    return ids
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    if (!this.initialized) await this.init()

    const vecResults = this.vecTableInitialized ? await this.searchVec(query, options) : []
    const fallbackResults = await this.searchFallback(query, { ...options, limit: options.limit ? options.limit * 2 : 20 })

    const merged = new Map<string, SearchResult>()

    for (const r of vecResults) {
      merged.set(r.id, { ...r, source: "vec" })
    }

    for (const r of fallbackResults) {
      if (!merged.has(r.id)) {
        merged.set(r.id, { ...r, source: "fallback" })
      }
    }

    const results = Array.from(merged.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, options.limit ?? 10)

    log.info("vector_search_combined", {
      query: query.slice(0, 50),
      total: results.length,
      from_vec: vecResults.length,
      from_fallback: fallbackResults.length,
    })

    return results
  }

  private async searchVec(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const limit = options.limit ?? 10
    const minSimilarity = options.min_similarity ?? 0.3

    const queryEmbedding = await this.generateEmbedding(query, "content")
    const embeddingJson = JSON.stringify(Array.from(queryEmbedding))

    const sqlite = Database.raw()
    const vecResults = sqlite
      .prepare(`
        SELECT rowid, vec_distance_cosine(embedding, vec_f32(?)) as distance
        FROM vec_vector_memory
        WHERE rowid IS NOT NULL
        ORDER BY distance ASC
        LIMIT ?
      `)
      .all(embeddingJson, limit * 2) as { rowid: string; distance: number }[]

    const results: SearchResult[] = []
    for (const vec of vecResults) {
      if (vec.distance === null) continue
      const similarity = 1 - vec.distance
      if (similarity < minSimilarity) continue

      const row = Database.use((db) =>
        db.select({
          id: vector_memory.id,
          node_type: vector_memory.node_type,
          node_id: vector_memory.node_id,
          entity_title: vector_memory.entity_title,
          metadata: vector_memory.metadata,
        })
          .from(vector_memory)
          .where(eq(vector_memory.id, vec.rowid))
          .get()
      ) as any

      if (row) {
        results.push({
          id: row.id,
          node_type: row.node_type,
          node_id: row.node_id,
          entity_title: row.entity_title,
          similarity,
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        })
      }

      if (results.length >= limit) break
    }

    return results
  }

  private async searchFallback(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const limit = options.limit ?? 10
    const minSimilarity = options.min_similarity ?? 0.3

    let queryBuilder = Database.use((db) =>
      db.select({
        id: knowledge_nodes.id,
        type: knowledge_nodes.type,
        entity_type: knowledge_nodes.entity_type,
        entity_id: knowledge_nodes.entity_id,
        title: knowledge_nodes.title,
        content: knowledge_nodes.content,
        embedding: knowledge_nodes.embedding,
        metadata: knowledge_nodes.metadata,
      }).from(knowledge_nodes)
    )

    if (options.node_type) {
      queryBuilder = queryBuilder.where(eq(knowledge_nodes.type, options.node_type)) as any
    }

    const results = queryBuilder.all() as any[]
    const queryEmbedding = await this.generateEmbedding(query, "content")

    const scored = results
      .map((row) => {
        let similarity = 0
        if (row.embedding) {
          try {
            const storedEmbedding = new Float32Array(JSON.parse(row.embedding))
            similarity = this.cosineSimilarity(queryEmbedding, storedEmbedding)
          } catch {
            similarity = this.textSimilarity(query.toLowerCase(), `${row.title} ${row.content || ""}`.toLowerCase())
          }
        } else {
          similarity = this.textSimilarity(query.toLowerCase(), `${row.title} ${row.content || ""}`.toLowerCase())
        }

        return {
          id: row.id,
          node_type: row.type,
          node_id: row.entity_id,
          entity_title: row.title,
          similarity,
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        }
      })
      .filter((r) => r.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)

    return scored
  }

  async getById(id: string): Promise<VectorEntry | null> {
    const row = Database.use((db) =>
      db.select().from(vector_memory).where(eq(vector_memory.id, id)).get()
    )

    if (!row) return null

    return {
      id: row.id,
      node_type: row.node_type,
      node_id: row.node_id,
      entity_title: row.entity_title,
      vector_type: row.vector_type as VectorType,
      embedding: new Float32Array(JSON.parse(row.embedding)),
      model: row.model as EmbeddingModel,
      dimensions: row.dimensions,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }
  }

  async deleteById(id: string): Promise<void> {
    Database.use((db) => db.delete(vector_memory).where(eq(vector_memory.id, id)))

    if (this.vecTableInitialized) {
      const sqlite = Database.raw()
      sqlite.prepare("DELETE FROM vec_vector_memory WHERE rowid = ?").run(id)
    }

    log.info("vector_deleted", { id })
  }

  async deleteByNodeId(nodeId: string): Promise<void> {
    await this.deleteById(nodeId)
  }

  async getStats(): Promise<VectorStats> {
    const all = Database.use((db) => db.select().from(vector_memory).all())

    const by_type: Record<string, number> = {}
    const by_model: Record<string, number> = {}

    for (const v of all) {
      by_type[v.vector_type] = (by_type[v.vector_type] || 0) + 1
      by_model[v.model] = (by_model[v.model] || 0) + 1
    }

    return { total_vectors: all.length, by_type, by_model }
  }

  async clear(): Promise<void> {
    Database.use((db) => db.delete(vector_memory))

    if (this.vecTableInitialized) {
      const sqlite = Database.raw()
      sqlite.exec("DELETE FROM vec_vector_memory")
    }

    log.info("vector_store_cleared")
  }

  getConfig(): VectorStoreConfig {
    return { ...this.config }
  }

  setConfig(config: Partial<VectorStoreConfig>): void {
    this.config = { ...this.config, ...config }
  }

  async syncKnowledgeNodes(): Promise<{ synced: number; skipped: number }> {
    const nodes = Database.use((db) => db.select().from(knowledge_nodes).all()) as {
      id: string
      type: string
      entity_type: string
      entity_id: string
      title: string
      content: string | null
      embedding: string | null
    }[]

    if (nodes.length === 0) {
      await this.updateSyncMeta(0)
      return { synced: 0, skipped: 0 }
    }

    const existingIds = new Set(
      Database.use((db) => db.select({ id: vector_memory.id }).from(vector_memory).all()).map((r) => r.id)
    )

    const nodesToSync: typeof nodes = []
    let skipped = 0

    for (const node of nodes) {
      if (existingIds.has(node.id)) {
        skipped++
      } else {
        nodesToSync.push(node)
      }
    }

    if (nodesToSync.length === 0) {
      await this.updateSyncMeta(nodes.length)
      return { synced: 0, skipped }
    }

    const BATCH_SIZE = 50
    const sqlite = Database.raw()

    for (let i = 0; i < nodesToSync.length; i += BATCH_SIZE) {
      const batch = nodesToSync.slice(i, i + BATCH_SIZE)
      const now = Date.now()

      const vectorMemoryValues = batch.map((node) => {
        let embedding: Float32Array
        if (node.embedding) {
          try {
            embedding = new Float32Array(JSON.parse(node.embedding))
          } catch {
            embedding = this.simpleEmbedding(`${node.title} ${node.content || ""}`)
          }
        } else {
          embedding = this.simpleEmbedding(`${node.title} ${node.content || ""}`)
        }

        return {
          id: node.id,
          node_type: node.type,
          node_id: node.entity_id,
          entity_title: node.title,
          vector_type: "content" as const,
          embedding: JSON.stringify(Array.from(embedding)),
          model: this.config.defaultModel!,
          dimensions: embedding.length,
          metadata: null,
          time_created: now,
          time_updated: now,
        }
      })

      Database.use((db) => {
        db.transaction(() => {
          for (const values of vectorMemoryValues) {
            db.insert(vector_memory).values(values)
          }
        })
      })

      if (this.vecTableInitialized) {
        const insertStmt = sqlite.prepare("INSERT INTO vec_vector_memory(rowid, embedding) VALUES (?, vec_f32(?))")
        for (const values of vectorMemoryValues) {
          insertStmt.run(values.id, values.embedding)
        }
      }
    }

    await this.updateSyncMeta(nodes.length)

    log.info("knowledge_nodes_synced", { synced: nodesToSync.length, skipped })
    return { synced: nodesToSync.length, skipped }
  }

  async cleanupOrphanedVectors(): Promise<{ removed: number }> {
    const vectorIds = new Set(
      Database.use((db) => db.select({ id: vector_memory.id }).from(vector_memory).all()).map((r) => r.id)
    )

    const nodeIds = new Set(
      Database.use((db) => db.select({ id: knowledge_nodes.id }).from(knowledge_nodes).all()).map((r) => r.id)
    )

    const orphanedIds = [...vectorIds].filter((id) => !nodeIds.has(id))

    if (orphanedIds.length === 0) return { removed: 0 }

    const sqlite = Database.raw()

    if (this.vecTableInitialized) {
      const deleteStmt = sqlite.prepare("DELETE FROM vec_vector_memory WHERE rowid = ?")
      for (const id of orphanedIds) {
        deleteStmt.run(id)
      }
    }

    Database.use((db) => {
      db.delete(vector_memory).where(sql`${vector_memory.id} IN (${orphanedIds.map((id) => sql`${id}`)})`)
    })

    await this.updateSyncMeta(nodeIds.size)

    log.info("orphaned_vectors_cleaned", { removed: orphanedIds.length })
    return { removed: orphanedIds.length }
  }

  async generateEmbedding(text: string, _vectorType: VectorType): Promise<Float32Array> {
    return this.simpleEmbedding(text)
  }

  private simpleEmbedding(text: string): Float32Array {
    const words = text.toLowerCase().split(/\W+/)
    const wordFreq: Record<string, number> = {}

    for (const word of words) {
      if (word.length > 2) {
        wordFreq[word] = (wordFreq[word] || 0) + 1
      }
    }

    const hash1 = this.hashString(text)
    const hash2 = this.hashString(text.split("").reverse().join(""))
    const dimensions = this.config.defaultDimensions!

    const embedding: number[] = []
    for (let i = 0; i < dimensions; i++) {
      const freqSum = Object.values(wordFreq).reduce((a, b) => a + b, 0)

      const value =
        Math.sin(hash1 * (i + 1) * 0.1) * 0.3 +
        Math.cos(hash2 * (i + 1) * 0.1) * 0.3 +
        (freqSum > 0
          ? (Object.entries(wordFreq).reduce(
              (sum, [w, f]) => sum + Math.sin(this.hashString(w) * (i + 1) * 0.01) * f,
              0
            ) / freqSum) * 0.4
          : 0)

      embedding.push(Math.tanh(value))
    }

    return new Float32Array(this.normalize(embedding))
  }

  private hashString(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i)
      hash = hash & hash
    }
    return Math.abs(hash)
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0

    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    if (normA === 0 || normB === 0) return 0
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  private textSimilarity(a: string, b: string): number {
    const setA = new Set(a.split(/\W+/).filter((w) => w.length > 2))
    const setB = new Set(b.split(/\W+/).filter((w) => w.length > 2))

    if (setA.size === 0 && setB.size === 0) return 0

    const intersection = new Set([...setA].filter((x) => setB.has(x)))
    const union = new Set([...setA, ...setB])

    return intersection.size / union.size
  }

  private normalize(vec: number[]): number[] {
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
    if (magnitude === 0) return vec
    return vec.map((v) => v / magnitude)
  }
}

/**
 * Factory function to create a SqliteVecStore instance
 */
export function createSqliteVecStore(config?: VectorStoreConfig): IVectorStore {
  return new SqliteVecStore(config)
}
