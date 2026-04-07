import { Log } from "../util/log"
import type { EnhancedPattern } from "./pattern-miner-enhanced"
import type { MemoryEntry, MemoryLevel } from "./story-world-memory"
import type { GraphNode, GraphEdge } from "./story-knowledge-graph"

const log = Log.create({ service: "novel-learning-bridge" })

// ============================================================================
// Type Imports from Learning Module
// ============================================================================

let VectorStoreModule: any = null
let KnowledgeGraphModule: any = null
let MemoryCriticModule: any = null

async function loadLearningModules() {
  if (!VectorStoreModule) {
    VectorStoreModule = await import("../learning/vector-store")
  }
  if (!KnowledgeGraphModule) {
    KnowledgeGraphModule = await import("../learning/knowledge-graph")
  }
  if (!MemoryCriticModule) {
    MemoryCriticModule = await import("../learning/memory-critic")
  }
}

// ============================================================================
// Configuration Interfaces
// ============================================================================

export interface LearningBridgeConfig {
  enabled: boolean
  vector: {
    enabled: boolean
    fallbackToLocal: boolean
    modelId?: string
  }
  knowledge: {
    enabled: boolean
    syncNodes: boolean
    syncEdges: boolean
    linkToCode: boolean
  }
  memory: {
    enabled: boolean
    qualityFilter: boolean
    minQualityScore: number
    deduplication: boolean
  }
  improvement: {
    enabled: boolean
    autoSuggest: boolean
    requireReview: boolean
  }
}

export const DEFAULT_LEARNING_BRIDGE_CONFIG: LearningBridgeConfig = {
  enabled: true,
  vector: {
    enabled: true,
    fallbackToLocal: true,
  },
  knowledge: {
    enabled: true,
    syncNodes: true,
    syncEdges: true,
    linkToCode: true,
  },
  memory: {
    enabled: true,
    qualityFilter: true,
    minQualityScore: 0.5,
    deduplication: true,
  },
  improvement: {
    enabled: true,
    autoSuggest: true,
    requireReview: false,
  },
}

// ============================================================================
// NovelVectorBridge — Unified Embedding Entry Point
//
// All real AI embedding calls in the novel engine go through this path:
//   NovelVectorBridge → VectorStore → SqliteVecStore → EmbeddingService → AI SDK
//
// Other "embedding" references in the codebase are local hash-based signatures:
//   - branch-storage.ts: generateBranchSignature() / calculateSignatureSimilarity()
//     These are deterministic hashes + eval scores for fast local similarity search,
//     NOT AI embedding vectors.
// ============================================================================

export interface SimilarityResult {
  id: string
  patternType: string
  name: string
  description: string
  similarity: number
  strength: number
  metadata?: Record<string, unknown>
  node_id?: string
  entity_title?: string
}

export class NovelVectorBridge {
  private vectorStore: any = null
  private config: LearningBridgeConfig["vector"]
  private initialized: boolean = false

  constructor(config: Partial<LearningBridgeConfig["vector"]> = {}) {
    this.config = {
      enabled: true,
      fallbackToLocal: true,
      modelId: "text-embedding-3-small",
      ...config,
    }
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled || this.initialized) return

    try {
      await loadLearningModules()
      this.vectorStore = await VectorStoreModule.getSharedVectorStore({
        defaultModel: this.config.modelId as any,
      })
      this.initialized = true
      log.info("novel_vector_bridge_initialized", {
        modelId: this.config.modelId,
      })
    } catch (error) {
      log.warn("vector_store_unavailable", { error: String(error) })
      if (!this.config.fallbackToLocal) {
        throw error
      }
    }
  }

  async searchSimilarPatterns(
    query: string,
    options?: { limit?: number; minSimilarity?: number },
  ): Promise<SimilarityResult[]> {
    if (!this.vectorStore) {
      if (this.config.fallbackToLocal) {
        return this.fallbackSearch(query, options)
      }
      return []
    }

    try {
      const results = await this.vectorStore.search(query, {
        limit: options?.limit ?? 10,
        min_similarity: options?.minSimilarity ?? 0.7,
        node_type: "novel_pattern",
      })

      return results.map((r: any) => ({
        id: r.id,
        patternType: r.entity_type || "pattern",
        name: r.title,
        description: r.content || "",
        similarity: r.similarity,
        strength: r.metadata?.strength || 50,
        metadata: r.metadata,
        node_id: r.id,
        entity_title: r.title,
      }))
    } catch (error) {
      log.error("vector_search_failed", { error: String(error) })
      return this.config.fallbackToLocal ? this.fallbackSearch(query, options) : []
    }
  }

  async indexPattern(pattern: EnhancedPattern): Promise<string | null> {
    if (!this.vectorStore) return null

    try {
      const id = await this.vectorStore.store({
        node_type: "novel_pattern",
        entity_type: `novel_${pattern.category}`,
        entity_id: pattern.id,
        title: pattern.name,
        content: pattern.description,
        memory_type: "project" as any,
        metadata: {
          category: pattern.category,
          description: pattern.description,
          strength: pattern.strength,
          ...pattern.metadata,
        },
      })
      log.info("pattern_indexed", { id, patternId: pattern.id })
      return id
    } catch (error) {
      log.error("pattern_index_failed", { id: pattern.id, error: String(error) })
      return null
    }
  }

  private fallbackSearch(query: string, options?: { limit?: number; minSimilarity?: number }): SimilarityResult[] {
    log.info("using_fallback_search")
    return []
  }

  async close(): Promise<void> {
    if (this.vectorStore && this.vectorStore.close) {
      await this.vectorStore.close()
    }
    this.initialized = false
    log.info("novel_vector_bridge_closed")
  }
}

// ============================================================================
// NovelKnowledgeBridge
// ============================================================================

export class NovelKnowledgeBridge {
  protected kg: any = null
  private initialized: boolean = false

  private static NODE_TYPE_MAP: Record<string, any> = {
    character: "memory",
    location: "memory",
    event: "memory",
    faction: "constraint",
    theme: "agenda",
    concept: "memory",
    item: "memory",
  }

  private static EDGE_TYPE_MAP: Record<string, any> = {
    knows: "related_to",
    allied_with: "related_to",
    opposes: "conflicts_with",
    memberOf: "derives_from",
    influenced_by: "references",
    leads: "derives_from",
    visits: "references",
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      await loadLearningModules()
      const { KnowledgeGraph } = KnowledgeGraphModule
      this.kg = new KnowledgeGraph()
      this.initialized = true
      log.info("novel_knowledge_bridge_initialized")
    } catch (error) {
      log.error("knowledge_graph_unavailable", { error: String(error) })
      throw error
    }
  }

  async syncNode(node: GraphNode): Promise<string | null> {
    if (!this.kg) {
      try {
        await this.initialize()
      } catch {
        return null
      }
    }

    try {
      const learningType = NovelKnowledgeBridge.NODE_TYPE_MAP[node.type] || "memory"

      const id = await this.kg.addNode({
        type: learningType,
        entity_type: `novel_${node.type}`,
        entity_id: node.id,
        title: node.name,
        content: node.description || "",
        memory_type: "project",
        metadata: {
          novel_type: node.type,
          status: node.status,
          first_appearance: node.firstAppearance || 0,
          last_appearance: node.lastAppearance || 0,
        },
      })

      log.info("node_synced", { id, nodeId: node.id, type: node.type })
      return id
    } catch (error) {
      log.error("node_sync_failed", { nodeId: node.id, error: String(error) })
      return null
    }
  }

  async syncEdge(edge: GraphEdge): Promise<string | null> {
    if (!this.kg) return null

    try {
      const learningRelation = NovelKnowledgeBridge.EDGE_TYPE_MAP[edge.type] || "related_to"

      const sourceNode = await this.findLearningNode(edge.source)
      const targetNode = await this.findLearningNode(edge.target)

      if (!sourceNode || !targetNode) {
        log.warn("edge_sync_missing_nodes", {
          edgeId: edge.id,
          source: edge.source,
          target: edge.target,
        })
        return null
      }

      const id = await this.kg.linkMemories(sourceNode.id, targetNode.id, learningRelation, edge.strength)
      log.info("edge_synced", { id, edgeId: edge.id })
      return id
    } catch (error) {
      log.error("edge_sync_failed", { edgeId: edge.id, error: String(error) })
      return null
    }
  }

  async linkNovelToCode(novelNodeId: string, codeNodeId: string, relation: any): Promise<string | null> {
    if (!this.kg) return null

    try {
      const id = await this.kg.linkMemories(novelNodeId, codeNodeId, relation)
      log.info("novel_code_linked", { novelNodeId, codeNodeId, relation })
      return id
    } catch (error) {
      log.error("novel_code_link_failed", { error: String(error) })
      return null
    }
  }

  async findRelatedCode(novelNodeId: string): Promise<any[]> {
    if (!this.kg) return []

    try {
      const results = await this.kg.getLinkedMemories(novelNodeId, {
        relation: "references",
        direction: "both",
      })
      return results || []
    } catch (error) {
      log.error("find_related_code_failed", { error: String(error) })
      return []
    }
  }

  private async findLearningNode(novelNodeId: string): Promise<any | null> {
    if (!this.kg) return null

    try {
      const results = await this.kg.searchByContent(novelNodeId, 1)
      return results?.[0] || null
    } catch {
      return null
    }
  }

  async close(): Promise<void> {
    this.kg = null
    this.initialized = false
    log.info("novel_knowledge_bridge_closed")
  }
}

// ============================================================================
// NovelMemoryBridge
// ============================================================================

export interface NovelMemoryBridgeConfig {
  enabled: boolean
  useQualityFilter: boolean
  minQualityScore: number
  deduplicationThreshold: number
}

export class NovelMemoryBridge {
  private critic: any = null
  private vectorBridge: NovelVectorBridge
  private config: NovelMemoryBridgeConfig

  constructor(config: Partial<NovelMemoryBridgeConfig> = {}, vectorBridge?: NovelVectorBridge) {
    this.config = {
      enabled: true,
      useQualityFilter: false,
      minQualityScore: 0.5,
      deduplicationThreshold: 0.85,
      ...config,
    }
    this.vectorBridge = vectorBridge || new NovelVectorBridge()
  }

  async shouldStoreMemory(entry: MemoryEntry): Promise<{
    store: boolean
    reason: string
    quality?: any
  }> {
    if (!this.config.enabled || !this.config.useQualityFilter) {
      return { store: true, reason: "Quality filter disabled" }
    }

    const critic = await this.getCritic()
    if (!critic) {
      return { store: true, reason: "Critic unavailable" }
    }

    try {
      const decision = await critic.evaluateCandidate({
        type: "novel_memory",
        entity_type: entry.level,
        entity_id: entry.id,
        title: `${entry.level}: Ch.${entry.chapter}`,
        content: entry.content,
        metadata: {
          characters: entry.characters,
          themes: entry.themes,
          significance: entry.significance,
        },
      })

      return {
        store: decision.should_store,
        reason: decision.reason,
        quality: decision.quality,
      }
    } catch (error) {
      log.error("memory_evaluation_failed", { error: String(error) })
      return { store: true, reason: "Evaluation failed" }
    }
  }

  async findDuplicateMemories(content: string): Promise<MemoryEntry[]> {
    try {
      const similar = await this.vectorBridge.searchSimilarPatterns(content, {
        minSimilarity: this.config.deduplicationThreshold,
      })

      return similar.map((s) => ({
        id: s.node_id || s.id,
        level: (s.metadata?.level as MemoryLevel) || "scene",
        content: (s.metadata?.content as string) || s.description,
        chapter: (s.metadata?.chapter as number) || 0,
        characters: (s.metadata?.characters as string[]) || [],
        locations: (s.metadata?.locations as string[]) || [],
        events: (s.metadata?.events as string[]) || [],
        themes: (s.metadata?.themes as string[]) || [],
        significance: (s.metadata?.significance as number) || 5,
        createdAt: (s.metadata?.createdAt as number) || 0,
        parent_id: null,
      }))
    } catch (error) {
      log.error("duplicate_search_failed", { error: String(error) })
      return []
    }
  }

  private async getCritic(): Promise<any | null> {
    if (this.critic) return this.critic

    try {
      await loadLearningModules()
      const { MemoryCritic } = MemoryCriticModule
      this.critic = new MemoryCritic(0.3, 0.4, this.config.minQualityScore, this.config.deduplicationThreshold)
      return this.critic
    } catch (error) {
      log.error("memory_critic_unavailable", { error: String(error) })
      return null
    }
  }
}

// ============================================================================
// NovelImprovementApi
// ============================================================================

export interface ImprovementSuggestion {
  type: "refactor" | "optimize" | "enhance" | "fix_pattern"
  targetFile: string
  targetLine?: number
  description: string
  confidence: number
  relatedKnowledge: string[]
  codeExample?: string
}

export class NovelImprovementApi {
  private vectorBridge: NovelVectorBridge
  private knowledgeBridge: NovelKnowledgeBridge

  constructor() {
    this.vectorBridge = new NovelVectorBridge()
    this.knowledgeBridge = new NovelKnowledgeBridge()
  }

  async analyzeAndSuggest(modulePath: string): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = []

    let code: string
    try {
      code = await this.readFile(modulePath)
    } catch (error) {
      log.error("read_file_failed", { path: modulePath, error: String(error) })
      return []
    }

    const similarPatterns = await this.vectorBridge.searchSimilarPatterns(code, { limit: 5 })

    for (const pattern of similarPatterns) {
      if (pattern.similarity > 0.8) {
        suggestions.push({
          type: "enhance",
          targetFile: modulePath,
          description: `Detected similarity to known optimization pattern: ${pattern.name}`,
          confidence: pattern.similarity,
          relatedKnowledge: [pattern.id],
        })
      }
    }

    const novelSpecific = await this.analyzeNovelSpecificIssues(code, modulePath)
    suggestions.push(...novelSpecific)

    return suggestions.sort((a, b) => b.confidence - a.confidence)
  }

  private async analyzeNovelSpecificIssues(code: string, filePath: string): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = []

    const patterns = [
      {
        regex: /StoryKnowledgeGraph|StoryWorldMemory/g,
        suggestion: "Consider using NovelKnowledgeBridge/NovelMemoryBridge to access learning features",
        type: "enhance" as const,
      },
      {
        regex: /new\s+Database\([^)]*\)/g,
        suggestion: "Detected independent database connection; consider using learning's shared storage",
        type: "optimize" as const,
      },
      {
        regex: /generateRandomEmbedding|cosineSimilarity/g,
        suggestion: "Detected local vector calculation; recommend using NovelVectorBridge (wraps VectorStore → EmbeddingService) for unified embedding",
        type: "enhance" as const,
      },
    ]

    const lines = code.split("\n")
    for (const { regex, suggestion, type } of patterns) {
      const lineNum = lines.findIndex((l) => regex.test(l))
      if (lineNum >= 0) {
        suggestions.push({
          type,
          targetFile: filePath,
          targetLine: lineNum + 1,
          description: suggestion,
          confidence: 0.6,
          relatedKnowledge: [],
        })
      }
    }

    return suggestions
  }

  async applySuggestion(suggestion: ImprovementSuggestion, dryRun: boolean = true): Promise<boolean> {
    if (!dryRun) {
      await this.recordImprovement(suggestion)
    }
    return true
  }

  private async recordImprovement(suggestion: ImprovementSuggestion): Promise<void> {
    try {
      if (!(this.knowledgeBridge as any).kg) {
        await this.knowledgeBridge.initialize()
      }

      await (this.knowledgeBridge as any).kg.addNode({
        type: "memory",
        entity_type: "improvement",
        entity_id: `improvement_${Date.now()}`,
        title: `${suggestion.type}: ${suggestion.targetFile}`,
        content: suggestion.description,
        memory_type: "evolution",
        metadata: {
          confidence: suggestion.confidence,
          related: suggestion.relatedKnowledge,
          timestamp: Date.now(),
        },
      })
    } catch (error) {
      log.error("record_improvement_failed", { error: String(error) })
    }
  }

  private async readFile(path: string): Promise<string> {
    const fs = await import("fs/promises")
    return fs.readFile(path, "utf-8")
  }
}

// ============================================================================
// Bridge Manager (Orchestrates all bridges)
// ============================================================================

export class NovelLearningBridgeManager {
  private vectorBridge: NovelVectorBridge
  private knowledgeBridge: NovelKnowledgeBridge
  private memoryBridge: NovelMemoryBridge
  private improvementApi: NovelImprovementApi
  private config: LearningBridgeConfig
  private initialized: boolean = false

  constructor(config: Partial<LearningBridgeConfig> = {}) {
    this.config = {
      ...DEFAULT_LEARNING_BRIDGE_CONFIG,
      ...config,
    }
    this.vectorBridge = new NovelVectorBridge(this.config.vector)
    this.knowledgeBridge = new NovelKnowledgeBridge()
    this.memoryBridge = new NovelMemoryBridge(this.config.memory, this.vectorBridge)
    this.improvementApi = new NovelImprovementApi()
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled || this.initialized) return

    try {
      await loadLearningModules()
      await this.vectorBridge.initialize()
      if (this.config.knowledge.enabled) {
        await this.knowledgeBridge.initialize()
      }
      this.initialized = true
      log.info("novel_learning_bridge_manager_initialized")
    } catch (error) {
      log.error("novel_learning_bridge_manager_init_failed", { error: String(error) })
      if (this.config.vector.fallbackToLocal) {
        this.initialized = true
        log.warn("continuing_with_fallback")
      } else {
        throw error
      }
    }
  }

  getVectorBridge(): NovelVectorBridge {
    return this.vectorBridge
  }

  getKnowledgeBridge(): NovelKnowledgeBridge {
    return this.knowledgeBridge
  }

  getMemoryBridge(): NovelMemoryBridge {
    return this.memoryBridge
  }

  getImprovementApi(): NovelImprovementApi {
    return this.improvementApi
  }

  async close(): Promise<void> {
    await this.vectorBridge.close()
    await this.knowledgeBridge.close()
    this.initialized = false
    log.info("novel_learning_bridge_manager_closed")
  }
}

log.info("novel_learning_bridge_loaded")
