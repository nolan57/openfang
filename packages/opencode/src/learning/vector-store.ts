/**
 * VectorStore - Backward compatible facade
 * 
 * This module re-exports the interface and implementation for backward compatibility.
 * New code should import from:
 *   - "./vector-store-interface" for IVectorStore interface
 *   - "./sqlite-vec-store" for SqliteVecStore implementation
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
import type { IVectorStore, VectorEntry, SearchResult, SearchOptions, VectorType, EmbeddingModel } from "./vector-store-interface"

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