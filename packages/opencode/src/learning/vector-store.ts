import { Database } from "../storage/db"
import { vector_memory, vector_sync_meta } from "./learning.sql"
import { knowledge_nodes } from "./knowledge-graph"
import { eq, sql, and } from "drizzle-orm"
import { Log } from "../util/log"

const log = Log.create({ service: "vector-store" })

export type VectorType = "content" | "code" | "constraint" | "character" | "scene" | "style"
export type EmbeddingModel = "simple" | "openai" | "local"

export interface VectorEntry {
  id: string
  node_type: string
  node_id: string
  entity_title: string
  vector_type: VectorType
  embedding: Float32Array
  model: EmbeddingModel
  dimensions: number
  metadata?: Record<string, unknown>
}

export interface SearchResult {
  id: string
  node_type: string
  node_id: string
  entity_title: string
  similarity: number
  metadata?: Record<string, unknown>
}

export interface SearchOptions {
  limit?: number
  min_similarity?: number
  vector_type?: VectorType
  node_type?: string
}

export class VectorStore {
  private defaultModel: EmbeddingModel = "simple"
  private defaultDimensions: number = 384
  private vecTableInitialized: boolean = false
  private initialized: boolean = false
  private readonly SYNC_VERSION = 1

  async init(): Promise<void> {
    if (this.initialized) return

    await this.ensureVecTable()
    await this.maybeSync()
    this.initialized = true
  }

  private async maybeSync(): Promise<void> {
    // Check if sync is needed using count-based approach with sync metadata
    const needsSync = Database.use((db) => {
      // Get total count of knowledge nodes
      const nodesCount = db.select({ count: sql<number>`count(*)` }).from(knowledge_nodes).get() as { count: number } | undefined
      const totalNodes = nodesCount?.count ?? 0

      if (totalNodes === 0) return false

      // Get sync metadata
      const syncMeta = db.select().from(vector_sync_meta).where(eq(vector_sync_meta.id, "sync_state")).get()

      // If no sync metadata exists, need to sync
      if (!syncMeta) {
        return true
      }

      // Check if SYNC_VERSION mismatch - need to resync if version changed
      if (syncMeta.sync_version !== this.SYNC_VERSION) {
        log.info("sync_version_mismatch", {
          stored: syncMeta.sync_version,
          current: this.SYNC_VERSION,
        })
        return true
      }

      // Check if counts match - if not, need to sync
      if (syncMeta.nodes_synced_count !== totalNodes) {
        log.info("node_count_mismatch", {
          synced: syncMeta.nodes_synced_count,
          total: totalNodes,
        })
        return true
      }

      return false
    })

    if (needsSync) {
      log.info("starting_knowledge_nodes_sync")
      const result = await this.syncKnowledgeNodes()
      log.info("sync_complete", result)

      // Also clean up orphaned vectors after sync
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

  async ensureVecTable(): Promise<void> {
    if (this.vecTableInitialized) return

    const sqlite = Database.raw()
    try {
      sqlite.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_vector_memory USING vec0(
          embedding float[${this.defaultDimensions}]
        )
      `)
      this.vecTableInitialized = true
      log.info("vec_table_created")
    } catch (error) {
      log.error("failed_to_create_vec_table", {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async embedAndStore(entry: Omit<VectorEntry, "id" | "embedding" | "model" | "dimensions">): Promise<string> {
    if (!this.initialized) {
      await this.init()
    }

    const embedding = await this.generateEmbedding(entry.entity_title, entry.vector_type)
    const id = crypto.randomUUID()
    const embeddingJson = JSON.stringify(Array.from(embedding))

    Database.use((db) => {
      db.insert(vector_memory).values({
        id,
        node_type: entry.node_type,
        node_id: entry.node_id,
        entity_title: entry.entity_title,
        vector_type: entry.vector_type,
        embedding: JSON.stringify(Array.from(embedding)),
        model: this.defaultModel,
        dimensions: embedding.length,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      })
    })

    const sqlite = Database.raw()
    // Use parameterized query to prevent SQL injection
    sqlite
      .prepare("INSERT INTO vec_vector_memory(rowid, embedding) VALUES (?, vec_f32(?))")
      .run(id, embeddingJson)

    log.info("vector_stored", { id, node_type: entry.node_type, vector_type: entry.vector_type })
    return id
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    if (!this.initialized) {
      await this.init()
    }

    // Try sqlite-vec search
    const vecResults = await this.searchVec(query, options)

    // Also search knowledge_nodes fallback and combine
    const fallbackResults = await this.searchFallback(query, {
      ...options,
      limit: options.limit ? options.limit * 2 : 20,
    })

    // Merge results, prioritize vec results by marking source
    const merged = new Map<string, SearchResult>()

    // Add vec results first (higher priority)
    for (const r of vecResults) {
      merged.set(r.id, { ...r, metadata: { ...r.metadata, _source: "vec" } })
    }

    // Add fallback results, skip if already exists from vec
    for (const r of fallbackResults) {
      if (!merged.has(r.id)) {
        merged.set(r.id, { ...r, metadata: { ...r.metadata, _source: "fallback" } })
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

  async searchFallback(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const limit = options.limit ?? 10
    const minSimilarity = options.min_similarity ?? 0.3

    // Import here to avoid circular dependency
    const { knowledge_nodes } = await import("./knowledge-graph")

    let queryBuilder = Database.use((db) =>
      db
        .select({
          id: knowledge_nodes.id,
          type: knowledge_nodes.type,
          entity_type: knowledge_nodes.entity_type,
          entity_id: knowledge_nodes.entity_id,
          title: knowledge_nodes.title,
          content: knowledge_nodes.content,
          embedding: knowledge_nodes.embedding,
          metadata: knowledge_nodes.metadata,
        })
        .from(knowledge_nodes),
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
            // If embedding is not valid JSON, use text similarity
            const textA = query.toLowerCase()
            const textB = `${row.title} ${row.content || ""}`.toLowerCase()
            similarity = this.textSimilarity(textA, textB)
          }
        } else {
          // No embedding, use text similarity
          const textA = query.toLowerCase()
          const textB = `${row.title} ${row.content || ""}`.toLowerCase()
          similarity = this.textSimilarity(textA, textB)
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

    log.info("vector_search_fallback", {
      query: query.slice(0, 50),
      results: scored.length,
      source: "knowledge_nodes",
    })

    return scored
  }

  private textSimilarity(a: string, b: string): number {
    const setA = new Set(a.split(/\W+/).filter((w) => w.length > 2))
    const setB = new Set(b.split(/\W+/).filter((w) => w.length > 2))

    if (setA.size === 0 && setB.size === 0) return 0

    const intersection = new Set([...setA].filter((x) => setB.has(x)))
    const union = new Set([...setA, ...setB])

    return intersection.size / union.size
  }

  async searchVec(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const limit = options.limit ?? 10
    const minSimilarity = options.min_similarity ?? 0.3

    const queryEmbedding = await this.generateEmbedding(query, "content")
    const embeddingJson = JSON.stringify(Array.from(queryEmbedding))

    const sqlite = Database.raw()
    const vecResults = sqlite
      .prepare(
        `
          SELECT 
            rowid,
            vec_distance_cosine(embedding, vec_f32(?)) as distance
          FROM vec_vector_memory
          WHERE rowid IS NOT NULL
          ORDER BY distance ASC
          LIMIT ?
        `,
      )
      .all(embeddingJson, limit * 2) as { rowid: string; distance: number }[]

    const results: SearchResult[] = []
    for (const vec of vecResults) {
      if (vec.distance === null) continue

      const similarity = 1 - vec.distance

      if (similarity < minSimilarity) continue

      const row = Database.use((db) =>
        db
          .select({
            id: vector_memory.id,
            node_type: vector_memory.node_type,
            node_id: vector_memory.node_id,
            entity_title: vector_memory.entity_title,
            metadata: vector_memory.metadata,
          })
          .from(vector_memory)
          .where(eq(vector_memory.id, vec.rowid))
          .get(),
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

    log.info("vector_search_vec", {
      query: query.slice(0, 50),
      results: results.length,
      top_similarity: results[0]?.similarity,
    })

    return results
  }

  async deleteByNodeId(nodeId: string): Promise<void> {
    Database.use((db) => {
      db.delete(vector_memory).where(eq(vector_memory.id, nodeId))
    })

    const sqlite = Database.raw()
    // Use parameterized query to prevent SQL injection
    sqlite.prepare("DELETE FROM vec_vector_memory WHERE rowid = ?").run(nodeId)

    log.info("vectors_deleted", { node_id: nodeId })
  }

  async getStats(): Promise<{ total_vectors: number; by_type: Record<string, number> }> {
    const all = Database.use((db) => db.select().from(vector_memory).all())

    const by_type: Record<string, number> = {}
    for (const v of all) {
      by_type[v.vector_type] = (by_type[v.vector_type] || 0) + 1
    }

    return { total_vectors: all.length, by_type }
  }

  /**
   * Clean up orphaned vectors - entries in vector_memory that no longer exist in knowledge_nodes
   */
  async cleanupOrphanedVectors(): Promise<{ removed: number }> {
    // Get all vector_memory IDs
    const vectorIds = new Set(
      Database.use((db) => db.select({ id: vector_memory.id }).from(vector_memory).all()).map((r) => r.id),
    )

    // Get all knowledge_nodes IDs
    const nodeIds = new Set(
      Database.use((db) => db.select({ id: knowledge_nodes.id }).from(knowledge_nodes).all()).map((r) => r.id),
    )

    // Find orphaned vector IDs
    const orphanedIds = [...vectorIds].filter((id) => !nodeIds.has(id))

    if (orphanedIds.length === 0) {
      return { removed: 0 }
    }

    const sqlite = Database.raw()

    // Delete orphaned vectors in batch
    const deleteStmt = sqlite.prepare("DELETE FROM vec_vector_memory WHERE rowid = ?")
    for (const id of orphanedIds) {
      deleteStmt.run(id)
    }

    // Delete from vector_memory table
    Database.use((db) => {
      db.delete(vector_memory).where(sql`${vector_memory.id} IN (${orphanedIds.map((id) => sql`${id}`)})`)
    })

    // Update sync metadata
    await this.updateSyncMeta(nodeIds.size)

    log.info("orphaned_vectors_cleaned", { removed: orphanedIds.length })
    return { removed: orphanedIds.length }
  }

  async syncKnowledgeNodes(): Promise<{ synced: number; skipped: number }> {
    // Get all knowledge nodes
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

    // Get existing vector_memory IDs in batch for efficiency
    const existingIds = new Set(
      Database.use((db) =>
        db.select({ id: vector_memory.id }).from(vector_memory).all(),
      ).map((r) => r.id),
    )

    // Separate nodes into those needing sync and those already synced
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
      log.info("knowledge_nodes_synced", { synced: 0, skipped })
      return { synced: 0, skipped }
    }

    // Process nodes in batches for better performance
    const BATCH_SIZE = 50
    const sqlite = Database.raw()

    for (let i = 0; i < nodesToSync.length; i += BATCH_SIZE) {
      const batch = nodesToSync.slice(i, i + BATCH_SIZE)
      const now = Date.now()

      // Prepare batch insert data
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
          model: this.defaultModel,
          dimensions: embedding.length,
          metadata: null,
          time_created: now,
          time_updated: now,
        }
      })

      // Batch insert into vector_memory using transaction
      Database.use((db) => {
        db.transaction(() => {
          for (const values of vectorMemoryValues) {
            db.insert(vector_memory).values(values)
          }
        })
      })

      // Batch insert into vec_vector_memory using parameterized queries
      const insertStmt = sqlite.prepare("INSERT INTO vec_vector_memory(rowid, embedding) VALUES (?, vec_f32(?))")
      for (const values of vectorMemoryValues) {
        insertStmt.run(values.id, values.embedding)
      }
    }

    const synced = nodesToSync.length

    // Update sync metadata
    await this.updateSyncMeta(nodes.length)

    log.info("knowledge_nodes_synced", { synced, skipped })
    return { synced, skipped }
  }

  private async generateEmbedding(text: string, _vectorType: VectorType): Promise<Float32Array> {
    if (this.defaultModel === "simple") {
      return this.simpleEmbedding(text)
    }

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

    const embedding: number[] = []
    for (let i = 0; i < this.defaultDimensions; i++) {
      const posHash = this.hashString(text + i)
      const freqSum = Object.values(wordFreq).reduce((a, b) => a + b, 0)

      const value =
        Math.sin(hash1 * (i + 1) * 0.1) * 0.3 +
        Math.cos(hash2 * (i + 1) * 0.1) * 0.3 +
        (freqSum > 0
          ? (Object.entries(wordFreq).reduce(
              (sum, [w, f]) => sum + Math.sin(this.hashString(w) * (i + 1) * 0.01) * f,
              0,
            ) /
              freqSum) *
            0.4
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

  private normalize(vec: number[]): number[] {
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
    if (magnitude === 0) return vec
    return vec.map((v) => v / magnitude)
  }

  setModel(model: EmbeddingModel): void {
    this.defaultModel = model
  }

  setDimensions(dimensions: number): void {
    this.defaultDimensions = dimensions
  }
}
