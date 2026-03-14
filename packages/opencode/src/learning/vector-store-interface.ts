/**
 * Vector Storage Interface - Abstraction for different vector backends
 * 
 * This interface allows for different implementations:
 * - SQLite-vec (current implementation)
 * - pgvector (PostgreSQL)
 * - In-memory (for testing)
 * - External services (Pinecone, Weaviate, etc.)
 */

export type VectorType = "content" | "code" | "constraint" | "character" | "scene" | "style"
export type EmbeddingModel = "simple" | "openai" | "local"

/**
 * External embedding generator function type
 * Used to inject project's default embedding model
 */
export type EmbeddingGenerator = (text: string, vectorType: VectorType) => Promise<Float32Array>

/**
 * A vector entry to be stored
 */
export interface VectorEntry {
  id: string
  node_type: string
  node_id: string
  entity_title: string
  vector_type: VectorType
  /** Optional - auto-generated if not provided */
  embedding?: Float32Array
  model?: EmbeddingModel
  dimensions?: number
  metadata?: Record<string, unknown>
  /** [ENH] TTL: Optional expiration time for automatic cleanup */
  expires_at?: Date
}

/**
 * A search result from the vector store
 */
export interface SearchResult {
  id: string
  node_type: string
  node_id: string
  entity_title: string
  similarity: number
  metadata?: Record<string, unknown>
  source?: "vec" | "fallback" | "external"
}

/**
 * Options for vector search
 */
export interface SearchOptions {
  limit?: number
  min_similarity?: number
  vector_type?: VectorType
  node_type?: string
}

/**
 * Statistics about the vector store
 */
export interface VectorStats {
  total_vectors: number
  by_type: Record<string, number>
  by_model?: Record<string, number>
  /** [ENH] TTL: Number of expired vectors */
  expired_vectors?: number
}

/**
 * Configuration for vector store initialization
 */
export interface VectorStoreConfig {
  /** Default embedding model to use */
  defaultModel?: EmbeddingModel
  /** Default embedding dimensions */
  defaultDimensions?: number
  /** Whether to initialize vec table on startup */
  initializeVecTable?: boolean
  /** [ENH] External embedding generator - uses project's default model when provided */
  embeddingGenerator?: EmbeddingGenerator
}

/**
 * Vector storage interface - abstraction for different vector backends
 * 
 * Implementations:
 * - SqliteVecStore: Uses sqlite-vec extension for fast vector search
 * - PostgresVecStore: Uses pgvector extension (future)
 * - MemoryVecStore: In-memory storage for testing (future)
 * - ExternalVecStore: External vector database service (future)
 */
export interface IVectorStore {
  /**
   * Initialize the vector store
   * Must be called before any operations
   */
  init(): Promise<void>

  /**
   * Check if the vector store is initialized and ready
   */
  isInitialized(): boolean

  /**
   * Store a vector embedding
   * @param entry The vector entry to store
   * @returns The ID of the stored entry
   */
  store(entry: Omit<VectorEntry, "id">): Promise<string>

  /**
   * Store multiple vector embeddings in batch
   * @param entries The vector entries to store
   * @returns The IDs of the stored entries
   */
  storeBatch(entries: Omit<VectorEntry, "id">[]): Promise<string[]>

  /**
   * Search for similar vectors
   * @param query The query text to search for
   * @param options Search options
   * @returns Search results sorted by similarity
   */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>

  /**
   * Get a vector entry by ID
   * @param id The vector entry ID
   * @returns The vector entry or null if not found
   */
  getById(id: string): Promise<VectorEntry | null>

  /**
   * Delete a vector entry by ID
   * @param id The vector entry ID
   */
  deleteById(id: string): Promise<void>

  /**
   * Delete all vectors for a given node ID
   * @param nodeId The node ID to delete vectors for
   */
  deleteByNodeId(nodeId: string): Promise<void>

  /**
   * Get statistics about the vector store
   * @returns Statistics about stored vectors
   */
  getStats(): Promise<VectorStats>

  /**
   * Clear all vectors from the store
   * Use with caution - this is a destructive operation
   */
  clear(): Promise<void>

  /**
   * Get the current configuration
   * @returns The current vector store configuration
   */
  getConfig(): VectorStoreConfig

  /**
   * Update the configuration
   * @param config Partial configuration to update
   */
  setConfig(config: Partial<VectorStoreConfig>): void

  /**
   * Sync vectors from knowledge nodes
   * This is specific to implementations that need to sync with knowledge graph
   * @returns Number of synced and skipped nodes
   */
  syncKnowledgeNodes?(): Promise<{ synced: number; skipped: number }>

  /**
   * Clean up orphaned vectors
   * Remove vectors that no longer have corresponding knowledge nodes
   * @returns Number of removed vectors
   */
  cleanupOrphanedVectors?(): Promise<{ removed: number }>

  /**
   * [ENH] TTL: Clean up expired vectors
   * Remove vectors that have passed their expiration time
   * @returns Number of removed vectors
   */
  cleanupExpiredVectors?(): Promise<{ removed: number }>

  /**
   * Generate an embedding for text
   * @param text The text to generate embedding for
   * @param vectorType The type of vector
   * @returns The embedding vector
   */
  generateEmbedding(text: string, vectorType: VectorType): Promise<Float32Array>

  /**
   * Migrate vector_memory data to knowledge graph (nodes and edges)
   * This is a one-time migration for existing data
   * @returns Statistics about the migration
   */
  migrateToKnowledgeGraph?(): Promise<{
    nodesMigrated: number
    edgesCreated: number
    errors: string[]
  }>

  /**
   * Close the vector store and release resources
   */
  close?(): Promise<void>
}

/**
 * Factory function type for creating vector store instances
 */
export type VectorStoreFactory = (config?: VectorStoreConfig) => IVectorStore
