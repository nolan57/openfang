/**
 * Memory-Learning Bridge
 *
 * Integrates the memory module with learning components:
 * - Sync session/evolution/project memories to knowledge graph
 * - Use vector store for semantic memory search
 * - Cross-memory linking and deduplication
 *
 * @example
 * ```typescript
 * import { MemoryLearningBridge } from "./memory-learning-bridge"
 *
 * const bridge = new MemoryLearningBridge()
 * await bridge.initialize()
 *
 * // Sync session memory to knowledge graph
 * await bridge.syncSessionMemory(sessionId)
 *
 * // Search across memory types
 * const results = await bridge.searchMemories("typescript patterns")
 * ```
 */

import { Log } from "../util/log"
import { TypeMapper, BridgeEventBus, SyncManager, type TypeMapping } from "../adapt/bridge-core"
import type { KnowledgeGraph, KnowledgeNode, RelationType, MemoryType } from "../learning/knowledge-graph"
import type { IVectorStore, SearchOptions } from "../learning/vector-store"

const log = Log.create({ service: "memory-learning-bridge" })

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Memory bridge configuration
 */
export interface MemoryLearningBridgeConfig {
  enabled: boolean
  syncToKnowledgeGraph: boolean
  useVectorSearch: boolean
  deduplication: boolean
  deduplicationThreshold: number
  crossMemoryLinking: boolean
}

export const DEFAULT_MEMORY_BRIDGE_CONFIG: MemoryLearningBridgeConfig = {
  enabled: true,
  syncToKnowledgeGraph: false,
  useVectorSearch: true,
  deduplication: false,
  deduplicationThreshold: 0.85,
  crossMemoryLinking: false,
}

/**
 * Memory entry from memory service
 */
export interface MemoryServiceEntry {
  id: string
  type: string
  content: string
  metadata?: Record<string, unknown>
  createdAt?: number
}

/**
 * Mapped knowledge node for memory
 */
export interface MemoryKnowledgeNode {
  type: MemoryType
  entity_type: string
  entity_id: string
  title: string
  content: string
  memory_type: MemoryType
  metadata: Record<string, unknown>
}

// ============================================================================
// Type Mappings
// ============================================================================

/**
 * Type mappings for memory → learning integration
 */
export const MEMORY_TYPE_MAPPINGS: TypeMapping<MemoryServiceEntry, MemoryKnowledgeNode>[] = [
  {
    sourceType: "memory.session",
    targetType: "learning.memory",
    transform: (session) => ({
      type: "memory" as MemoryType,
      entity_type: "session_memory",
      entity_id: session.id,
      title: `Session: ${session.id.substring(0, 8)}`,
      content: session.content,
      memory_type: "session",
      metadata: {
        ...session.metadata,
        source: "memory_service",
        synced_at: Date.now(),
      },
    }),
    reverse: (node) => ({
      id: node.entity_id,
      type: "session",
      content: node.content,
      metadata: node.metadata,
      createdAt: node.metadata?.synced_at as number,
    }),
  },
  {
    sourceType: "memory.evolution",
    targetType: "learning.memory",
    transform: (evolution) => ({
      type: "memory" as MemoryType,
      entity_type: "evolution_memory",
      entity_id: evolution.id,
      title: `Evolution: ${evolution.id.substring(0, 8)}`,
      content: evolution.content,
      memory_type: "evolution",
      metadata: {
        ...evolution.metadata,
        source: "memory_service",
        synced_at: Date.now(),
      },
    }),
    reverse: (node) => ({
      id: node.entity_id,
      type: "evolution",
      content: node.content,
      metadata: node.metadata,
      createdAt: node.metadata?.synced_at as number,
    }),
  },
  {
    sourceType: "memory.project",
    targetType: "learning.memory",
    transform: (project) => ({
      type: "memory" as MemoryType,
      entity_type: "project_memory",
      entity_id: project.id,
      title: `Project: ${project.id}`,
      content: project.content,
      memory_type: "project",
      metadata: {
        ...project.metadata,
        source: "memory_service",
        synced_at: Date.now(),
      },
    }),
    reverse: (node) => ({
      id: node.entity_id,
      type: "project",
      content: node.content,
      metadata: node.metadata,
      createdAt: node.metadata?.synced_at as number,
    }),
  },
]

// ============================================================================
// MemoryLearningBridge
// ============================================================================

export class MemoryLearningBridge {
  private typeMapper: TypeMapper
  private eventBus: BridgeEventBus
  private syncManager: SyncManager
  private vectorStore: IVectorStore | null = null
  private knowledgeGraph: KnowledgeGraph | null = null
  private config: MemoryLearningBridgeConfig
  private initialized: boolean = false

  constructor(
    typeMapper?: TypeMapper,
    eventBus?: BridgeEventBus,
    syncManager?: SyncManager,
    config?: Partial<MemoryLearningBridgeConfig>,
  ) {
    this.typeMapper = typeMapper || new TypeMapper()
    this.eventBus = eventBus || new BridgeEventBus()
    this.syncManager = syncManager || new SyncManager()
    this.config = { ...DEFAULT_MEMORY_BRIDGE_CONFIG, ...config }

    this.registerTypeMappings()
  }

  /**
   * Initialize the bridge
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      if (this.config.useVectorSearch) {
        const { getSharedVectorStore } = await import("../learning/vector-store")
        this.vectorStore = await getSharedVectorStore()
        log.info("memory_bridge_vector_store_initialized")
      }

      if (this.config.syncToKnowledgeGraph) {
        const { KnowledgeGraph } = await import("../learning/knowledge-graph")
        this.knowledgeGraph = new KnowledgeGraph()
        log.info("memory_bridge_knowledge_graph_initialized")
      }

      this.initialized = true
      log.info("memory_learning_bridge_initialized", {
        syncToKG: this.config.syncToKnowledgeGraph,
        useVector: this.config.useVectorSearch,
        deduplication: this.config.deduplication,
      })
    } catch (error) {
      log.error("memory_bridge_init_failed", { error: String(error) })
      throw error
    }
  }

  /**
   * Register type mappings
   */
  private registerTypeMappings(): void {
    MEMORY_TYPE_MAPPINGS.forEach((mapping) => {
      this.typeMapper.register(mapping)
    })
    log.info("memory_bridge_type_mappings_registered", {
      count: MEMORY_TYPE_MAPPINGS.length,
    })
  }

  /**
   * Sync session memory to knowledge graph
   */
  async syncSessionMemory(sessionId: string, sessionData: MemoryServiceEntry): Promise<string | null> {
    if (!this.knowledgeGraph || !this.config.syncToKnowledgeGraph) {
      log.debug("knowledge_graph_sync_skipped", {
        reason: this.config.syncToKnowledgeGraph ? "KG not initialized" : "Sync disabled",
      })
      return null
    }

    try {
      const mapped = this.typeMapper.map<MemoryServiceEntry, MemoryKnowledgeNode>(
        sessionData,
        "memory.session",
        "learning.memory",
      )

      const nodeId = await this.knowledgeGraph.addNode({
        type: "memory" as any,
        entity_type: mapped.entity_type,
        entity_id: mapped.entity_id,
        title: mapped.title,
        content: mapped.content,
        memory_type: mapped.memory_type,
        metadata: mapped.metadata,
      })

      log.info("session_memory_synced", { sessionId, nodeId })
      return nodeId
    } catch (error) {
      log.error("session_memory_sync_failed", { sessionId, error: String(error) })
      return null
    }
  }

  /**
   * Sync evolution memory to knowledge graph
   */
  async syncEvolutionMemory(evolutionId: string, evolutionData: MemoryServiceEntry): Promise<string | null> {
    if (!this.knowledgeGraph || !this.config.syncToKnowledgeGraph) {
      return null
    }

    try {
      const mapped = this.typeMapper.map<MemoryServiceEntry, MemoryKnowledgeNode>(
        evolutionData,
        "memory.evolution",
        "learning.memory",
      )

      const nodeId = (await this.knowledgeGraph.addNode({
        type: "memory",
        entity_type: mapped.entity_type,
        entity_id: mapped.entity_id,
        title: mapped.title,
        content: mapped.content,
        memory_type: mapped.memory_type,
        metadata: mapped.metadata,
      })) as any

      log.info("evolution_memory_synced", { evolutionId, nodeId })
      return nodeId
    } catch (error) {
      log.error("evolution_memory_sync_failed", { evolutionId, error: String(error) })
      return null
    }
  }

  /**
   * Search memories using vector store
   */
  async searchMemories(
    query: string,
    options?: SearchOptions,
  ): Promise<Array<{ id: string; content: string; similarity: number }>> {
    if (!this.vectorStore || !this.config.useVectorSearch) {
      log.debug("vector_search_skipped", {
        reason: this.config.useVectorSearch ? "VectorStore not initialized" : "Search disabled",
      })
      return []
    }

    try {
      const results = await this.vectorStore.search(query, {
        ...options,
        node_type: "memory",
      })

      return results.map((r: any) => ({
        id: r.id,
        content: r.content || "",
        similarity: r.similarity,
      }))
    } catch (error) {
      log.error("memory_vector_search_failed", { error: String(error) })
      return []
    }
  }

  /**
   * Check for duplicate memories
   */
  async findDuplicateMemories(
    content: string,
    threshold: number = this.config.deduplicationThreshold,
  ): Promise<string[]> {
    if (!this.config.deduplication) {
      return []
    }

    const similar = await this.searchMemories(content, {
      limit: 10,
      min_similarity: threshold,
    })

    return similar.map((r) => r.id)
  }

  /**
   * Link memories across types (session ↔ evolution ↔ project)
   */
  async linkMemories(
    sourceId: string,
    targetId: string,
    relation: RelationType = "related_to",
  ): Promise<string | null> {
    if (!this.knowledgeGraph || !this.config.crossMemoryLinking) {
      return null
    }

    try {
      const edgeId = await this.knowledgeGraph.linkMemories(sourceId, targetId, relation)
      log.info("memories_linked", { sourceId, targetId, relation })
      return edgeId
    } catch (error) {
      log.error("memory_link_failed", { error: String(error) })
      return null
    }
  }

  /**
   * Store memory in vector store
   */
  async storeMemory(id: string, content: string, metadata: Record<string, unknown>): Promise<string | null> {
    if (!this.vectorStore) {
      return null
    }

    try {
      const storeId = await this.vectorStore.store({
        node_type: "memory" as any,
        node_id: id,
        entity_title: `Memory: ${id.substring(0, 12)}`,
        vector_type: "content" as any,
        metadata: {
          ...metadata,
          type: metadata.type,
          stored_at: Date.now(),
        },
      })

      log.info("memory_stored_in_vector", { id, storeId })
      return storeId
    } catch (error) {
      log.error("memory_vector_store_failed", { error: String(error) })
      return null
    }
  }

  /**
   * Get bridge status
   */
  getStatus(): {
    initialized: boolean
    vectorStore: boolean
    knowledgeGraph: boolean
    config: MemoryLearningBridgeConfig
  } {
    return {
      initialized: this.initialized,
      vectorStore: !!this.vectorStore,
      knowledgeGraph: !!this.knowledgeGraph,
      config: this.config,
    }
  }

  /**
   * Close bridge and release resources
   */
  async close(): Promise<void> {
    this.initialized = false
    this.vectorStore = null
    this.knowledgeGraph = null
    log.info("memory_learning_bridge_closed")
  }
}

log.info("memory_learning_bridge_loaded")
