/**
 * VectorStore - Backward compatible facade with shared instance management
 * 
 * This module provides:
 * - Shared singleton instance for memory efficiency
 * - Backward compatibility with existing code
 * - Dependency injection support for new code
 * 
 * New code should use:
 *   - `getSharedVectorStore()` for shared instance
 *   - `IVectorStore` interface for type hints
 *   - `createSqliteVecStore()` for custom instances
 */

// Re-export interface types
export type {
  IVectorStore,
  VectorEntry,
  SearchResult,
  SearchOptions,
  VectorStats,
  VectorStoreConfig,
  VectorType,
  EmbeddingModel,
} from "./vector-store-interface"

// Re-export implementation
export { SqliteVecStore, createSqliteVecStore } from "./sqlite-vec-store"

// Import for backward compatibility class
import { SqliteVecStore } from "./sqlite-vec-store"
import type { IVectorStore, VectorEntry, VectorStoreConfig, VectorType, EmbeddingModel } from "./vector-store-interface"

// ============================================================================
// Shared Instance Management
// ============================================================================

/** Shared singleton instance for memory efficiency */
let sharedInstance: IVectorStore | null = null

/** Initialization promise to prevent concurrent init */
let initPromise: Promise<void> | null = null

/**
 * Get the shared VectorStore instance
 * 
 * This is the recommended way to obtain a VectorStore instance.
 * It ensures all modules share the same instance for:
 * - Memory efficiency (single connection pool)
 * - Consistent configuration
 * - Shared vec0 virtual table
 * 
 * @param config - Optional configuration (only applied on first call)
 * @returns Initialized shared VectorStore instance
 * 
 * @example
 * ```typescript
 * const vs = await getSharedVectorStore()
 * const results = await vs.search("my query")
 * ```
 */
export async function getSharedVectorStore(config?: VectorStoreConfig): Promise<IVectorStore> {
  if (sharedInstance && sharedInstance.isInitialized()) {
    return sharedInstance
  }

  // Prevent concurrent initialization
  if (initPromise) {
    await initPromise
    return sharedInstance!
  }

  sharedInstance = new SqliteVecStore(config)
  initPromise = sharedInstance.init()
  
  try {
    await initPromise
  } finally {
    initPromise = null
  }

  return sharedInstance
}

/**
 * Reset the shared instance (mainly for testing)
 * 
 * @internal
 */
export function resetSharedVectorStore(): void {
  sharedInstance = null
  initPromise = null
}

/**
 * Check if shared instance is initialized
 */
export function isSharedVectorStoreInitialized(): boolean {
  return sharedInstance?.isInitialized() ?? false
}

/**
 * VectorStore class - Backward compatible wrapper around SqliteVecStore
 * 
 * @deprecated Use `SqliteVecStore` or `IVectorStore` interface instead
 */
export class VectorStore extends SqliteVecStore {
  // Additional backward compatibility methods
  
  /**
   * Embed and store a vector entry
   * @deprecated Use `store()` directly instead
   */
  async embedAndStore(entry: Omit<VectorEntry, "id" | "embedding" | "model" | "dimensions">): Promise<string> {
    return this.store(entry as Omit<VectorEntry, "id">)
  }

  /**
   * Set the default embedding model
   * @deprecated Use `setConfig({ defaultModel })` instead
   */
  setModel(model: EmbeddingModel): void {
    this.setConfig({ defaultModel: model })
  }

  /**
   * Set the default dimensions
   * @deprecated Use `setConfig({ defaultDimensions })` instead
   */
  setDimensions(dimensions: number): void {
    this.setConfig({ defaultDimensions: dimensions })
  }
}

/**
 * Create a VectorStore instance (backward compatible)
 * @deprecated Use `createSqliteVecStore()` instead
 */
export function createVectorStore(config?: { defaultModel?: EmbeddingModel; defaultDimensions?: number }): IVectorStore {
  return new SqliteVecStore(config)
}