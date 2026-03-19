/**
 * Evolution-Learning Bridge
 *
 * Integrates the evolution module with learning components:
 * - Sync evolution data (prompts, skills, memories) to knowledge graph
 * - Store evolution artifacts in vector store for retrieval
 * - Track evolution history and improvements
 *
 * @example
 * ```typescript
 * import { EvolutionLearningBridge } from "./evolution-learning-bridge"
 *
 * const bridge = new EvolutionLearningBridge()
 * await bridge.initialize()
 *
 * // Sync skill evolution
 * await bridge.syncSkill(skillData)
 *
 * // Search evolution history
 * const history = await bridge.searchEvolutionHistory("pattern matching")
 * ```
 */

import { Log } from "../util/log"
import { TypeMapper, BridgeEventBus, SyncManager, type TypeMapping } from "../adapt/bridge-core"
import type { KnowledgeGraph, RelationType, MemoryType } from "../learning/knowledge-graph"
import type { IVectorStore } from "../learning/vector-store"
import type { PromptEvolution, SkillEvolution, MemoryEntry } from "../evolution/types"

const log = Log.create({ service: "evolution-learning-bridge" })

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Evolution bridge configuration
 */
export interface EvolutionLearningBridgeConfig {
  enabled: boolean
  syncToKnowledgeGraph: boolean
  useVectorSearch: boolean
  trackEvolutionHistory: boolean
  autoIndexSkills: boolean
}

export const DEFAULT_EVOLUTION_BRIDGE_CONFIG: EvolutionLearningBridgeConfig = {
  enabled: true,
  syncToKnowledgeGraph: false,
  useVectorSearch: true,
  trackEvolutionHistory: false,
  autoIndexSkills: false,
}

/**
 * Mapped knowledge node for evolution
 */
export interface EvolutionKnowledgeNode {
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
 * Type mappings for evolution → learning integration
 */
export const EVOLUTION_TYPE_MAPPINGS: TypeMapping<any, EvolutionKnowledgeNode>[] = [
  {
    sourceType: "evolution.prompt",
    targetType: "learning.memory",
    transform: (prompt) => ({
      type: "memory" as MemoryType,
      entity_type: "prompt_evolution",
      entity_id: prompt.id,
      title: `Prompt: ${prompt.originalPrompt.substring(0, 40)}...`,
      content: prompt.optimizedPrompt,
      memory_type: "evolution",
      metadata: {
        original: prompt.originalPrompt,
        reason: prompt.reason,
        sessionID: prompt.sessionID,
        usageCount: prompt.usageCount,
        synced_at: Date.now(),
      },
    }),
    reverse: (node) => ({
      id: node.entity_id,
      originalPrompt: (node.metadata?.original as string) || "",
      optimizedPrompt: node.content,
      reason: (node.metadata?.reason as string) || "",
      sessionID: (node.metadata?.sessionID as string) || "",
      usageCount: (node.metadata?.usageCount as number) || 0,
      createdAt: (node.metadata?.synced_at as number) || Date.now(),
    }),
  },
  {
    sourceType: "evolution.skill",
    targetType: "learning.memory",
    transform: (skill) => ({
      type: "memory" as MemoryType,
      entity_type: "skill_evolution",
      entity_id: skill.id,
      title: `Skill: ${skill.name}`,
      content: skill.content,
      memory_type: "evolution",
      metadata: {
        name: skill.name,
        description: skill.description,
        triggerPatterns: skill.triggerPatterns,
        sessionID: skill.sessionID,
        status: skill.status,
        synced_at: Date.now(),
      },
    }),
    reverse: (node) => ({
      id: node.entity_id,
      name: (node.metadata?.name as string) || "",
      description: (node.metadata?.description as string) || "",
      content: node.content,
      triggerPatterns: (node.metadata?.triggerPatterns as string[]) || [],
      sessionID: (node.metadata?.sessionID as string) || "",
      status: (node.metadata?.status as "draft" | "approved" | "rejected") || "draft",
      createdAt: (node.metadata?.synced_at as number) || Date.now(),
    }),
  },
  {
    sourceType: "evolution.memory",
    targetType: "learning.memory",
    transform: (memory) => ({
      type: "memory" as MemoryType,
      entity_type: "memory_evolution",
      entity_id: memory.id,
      title: `Memory: ${memory.key}`,
      content: memory.value,
      memory_type: "evolution",
      metadata: {
        key: memory.key,
        context: memory.context,
        sessionIDs: memory.sessionIDs,
        usageCount: memory.usageCount,
        lastUsedAt: memory.lastUsedAt,
        sensitive: memory.sensitive,
        archived: memory.archived,
        synced_at: Date.now(),
      },
    }),
    reverse: (node) => ({
      id: node.entity_id,
      key: (node.metadata?.key as string) || "",
      value: node.content,
      context: (node.metadata?.context as string) || "",
      sessionIDs: (node.metadata?.sessionIDs as string[]) || [],
      createdAt: (node.metadata?.synced_at as number) || Date.now(),
      lastUsedAt: (node.metadata?.lastUsedAt as number) || 0,
      usageCount: (node.metadata?.usageCount as number) || 0,
      sensitive: (node.metadata?.sensitive as boolean) || false,
      archived: (node.metadata?.archived as boolean) || false,
    }),
  },
]

// ============================================================================
// EvolutionLearningBridge
// ============================================================================

export class EvolutionLearningBridge {
  private typeMapper: TypeMapper
  private eventBus: BridgeEventBus
  private syncManager: SyncManager
  private vectorStore: IVectorStore | null = null
  private knowledgeGraph: KnowledgeGraph | null = null
  private config: EvolutionLearningBridgeConfig
  private initialized: boolean = false

  constructor(
    typeMapper?: TypeMapper,
    eventBus?: BridgeEventBus,
    syncManager?: SyncManager,
    config?: Partial<EvolutionLearningBridgeConfig>,
  ) {
    this.typeMapper = typeMapper || new TypeMapper()
    this.eventBus = eventBus || new BridgeEventBus()
    this.syncManager = syncManager || new SyncManager()
    this.config = { ...DEFAULT_EVOLUTION_BRIDGE_CONFIG, ...config }

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
        log.info("evolution_bridge_vector_store_initialized")
      }

      if (this.config.syncToKnowledgeGraph) {
        const { KnowledgeGraph } = await import("../learning/knowledge-graph")
        this.knowledgeGraph = new KnowledgeGraph()
        log.info("evolution_bridge_knowledge_graph_initialized")
      }

      this.initialized = true
      log.info("evolution_learning_bridge_initialized", {
        syncToKG: this.config.syncToKnowledgeGraph,
        useVector: this.config.useVectorSearch,
        trackHistory: this.config.trackEvolutionHistory,
      })
    } catch (error) {
      log.error("evolution_bridge_init_failed", { error: String(error) })
      throw error
    }
  }

  /**
   * Register type mappings
   */
  private registerTypeMappings(): void {
    EVOLUTION_TYPE_MAPPINGS.forEach((mapping) => {
      this.typeMapper.register(mapping)
    })
    log.info("evolution_bridge_type_mappings_registered", {
      count: EVOLUTION_TYPE_MAPPINGS.length,
    })
  }

  /**
   * Sync prompt evolution to knowledge graph
   */
  async syncPrompt(prompt: PromptEvolution): Promise<string | null> {
    if (!this.knowledgeGraph || !this.config.syncToKnowledgeGraph) {
      return null
    }

    try {
      const mapped = this.typeMapper.map<PromptEvolution, EvolutionKnowledgeNode>(
        prompt,
        "evolution.prompt",
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

      log.info("prompt_evolution_synced", { promptId: prompt.id, nodeId })
      return nodeId
    } catch (error) {
      log.error("prompt_sync_failed", { promptId: prompt.id, error: String(error) })
      return null
    }
  }

  /**
   * Sync skill evolution to knowledge graph
   */
  async syncSkill(skill: SkillEvolution): Promise<string | null> {
    if (!this.knowledgeGraph || !this.config.syncToKnowledgeGraph) {
      return null
    }

    try {
      const mapped = this.typeMapper.map<SkillEvolution, EvolutionKnowledgeNode>(
        skill,
        "evolution.skill",
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

      log.info("skill_evolution_synced", { skillId: skill.id, nodeId })
      return nodeId
    } catch (error) {
      log.error("skill_sync_failed", { skillId: skill.id, error: String(error) })
      return null
    }
  }

  /**
   * Sync memory evolution to knowledge graph
   */
  async syncMemory(memory: MemoryEntry): Promise<string | null> {
    if (!this.knowledgeGraph || !this.config.syncToKnowledgeGraph) {
      return null
    }

    try {
      const mapped = this.typeMapper.map<MemoryEntry, EvolutionKnowledgeNode>(
        memory,
        "evolution.memory",
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

      log.info("memory_evolution_synced", { memoryId: memory.id, nodeId })
      return nodeId
    } catch (error) {
      log.error("memory_sync_failed", { memoryId: memory.id, error: String(error) })
      return null
    }
  }

  /**
   * Search evolution history
   */
  async searchEvolutionHistory(
    query: string,
    options?: { limit?: number; minSimilarity?: number },
  ): Promise<Array<{ id: string; title: string; content: string; similarity: number }>> {
    if (!this.vectorStore || !this.config.useVectorSearch) {
      return []
    }

    try {
      const results = await this.vectorStore.search(query, {
        limit: options?.limit ?? 10,
        min_similarity: options?.minSimilarity ?? 0.7,
        node_type: "evolution",
      })

      return results.map((r: any) => ({
        id: r.id,
        title: r.entity_title,
        content: r.content || "",
        similarity: r.similarity,
      }))
    } catch (error) {
      log.error("evolution_search_failed", { error: String(error) })
      return []
    }
  }

  /**
   * Store evolution artifact in vector store
   */
  async storeEvolutionArtifact(
    id: string,
    title: string,
    content: string,
    type: "prompt" | "skill" | "memory",
    metadata: Record<string, unknown>,
  ): Promise<string | null> {
    if (!this.vectorStore) {
      return null
    }

    try {
      const storeId = await this.vectorStore.store({
        node_type: "evolution" as any,
        node_id: id,
        entity_title: title,
        vector_type: "content" as any,
        metadata: {
          ...metadata,
          evolution_type: type,
          stored_at: Date.now(),
        },
      })

      log.info("evolution_artifact_stored", { id, storeId, type })
      return storeId
    } catch (error) {
      log.error("evolution_store_failed", { error: String(error) })
      return null
    }
  }

  /**
   * Link evolution artifacts (e.g., skill → prompt that triggered it)
   */
  async linkArtifacts(
    sourceId: string,
    targetId: string,
    relation: RelationType = "evolves_to",
  ): Promise<string | null> {
    if (!this.knowledgeGraph || !this.config.trackEvolutionHistory) {
      return null
    }

    try {
      const edgeId = await this.knowledgeGraph.linkMemories(sourceId, targetId, relation)
      log.info("evolution_artifacts_linked", { sourceId, targetId, relation })
      return edgeId
    } catch (error) {
      log.error("artifact_link_failed", { error: String(error) })
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
    config: EvolutionLearningBridgeConfig
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
    log.info("evolution_learning_bridge_closed")
  }
}

log.info("evolution_learning_bridge_loaded")
