# Learning Bridge Design: Novel-Learning Integration Architecture

## Executive Summary

This document outlines a bidirectional integration architecture between the `novel` engine and the `learning` module. The design introduces a layered adapter system that enables:

1. **Novel → Learning**: Leverage learning's capabilities (vector search, knowledge graph, memory critic) without code duplication
2. **Learning → Novel**: Enable learning to actively improve novel code based on accumulated knowledge
3. **Extensibility**: A reusable adapter layer for other modules requiring similar integration

---

## Problem Statement

### Current State Analysis

The `novel` engine currently operates in isolation from the `learning` module:

| Novel Component | Learning Equivalent | Current State |
|-----------------|---------------------|---------------|
| `StoryKnowledgeGraph` | `KnowledgeGraph` | Independent implementation, no integration |
| `StoryWorldMemory` | `HierarchicalMemory` | Independent implementation, no vector support |
| `PatternVectorIndex` | `VectorStore` + `EmbeddingService` | Minimal integration (only imports EmbeddingService) |
| (none) | `Safety` | Not utilized |
| (none) | `MemoryCritic` | Not utilized |

### Learning's Self-Improvement Gap

The `SelfRefactor` component in learning uses only regex-based pattern matching:

```typescript
this.patterns = new Map([
  [/import\s+.*\s+from\s+['"]\.\.?\/[^'"]+['"];?\s*$/gm, "unused_import"],
  [/\bconsole\.(log|warn|error|info)\s*\(/g, "console_log"],
  // ...
])
```

It completely ignores:
- Knowledge stored in `KnowledgeGraph`
- Semantic similarity in `VectorStore`
- Historical improvement patterns

### Module Dependency Map

The following modules directly depend on `learning`:

```
┌─────────────────────────────────────────────────────────────┐
│                    Learning Module Consumers                 │
├─────────────────────────────────────────────────────────────┤
│  Module        │ Learning Components Used                    │
├────────────────┼────────────────────────────────────────────┤
│  cli           │ SelfEvolutionScheduler, HierarchicalMemory, │
│                │ EvolutionTrigger, KnowledgeGraph, Safety    │
│  evolution     │ SkillSandbox                                │
│  memory        │ VectorStore, KnowledgeGraph                 │
│  novel         │ EmbeddingService, EmbeddingGenerator        │
│  project       │ (various)                                   │
│  tool          │ (various)                                   │
│  observability │ (various)                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Architecture Overview

### Design Principles

1. **Unidirectional Dependency**: `novel` → `bridge` → `learning` (no changes to learning)
2. **Progressive Enablement**: Features can be independently toggled without affecting existing behavior
3. **Data Isolation**: Novel's SQLite databases remain independent from learning's databases
4. **Observability**: All bridge operations are traced and logged
5. **Graceful Degradation**: Fallback to local implementation when learning is unavailable

### Layered Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│              Domain-Specific Adapter Layer (Per Module)             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  novel-learning-bridge    memory-bridge     evolution-bridge       │
│  (Story data adapter)     (Memory adapter)  (Evolution adapter)    │
│       │                        │                   │               │
│       └────────────────────────┼───────────────────┘               │
│                                ▼                                    │
├─────────────────────────────────────────────────────────────────────┤
│                  Generic Adapter Layer (Future: adapt/)             │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ TypeMapper   │  │ EventBus     │  │ SyncManager  │              │
│  │ Type mapping │  │ Cross-module │  │ Bidirectional│              │
│  │ registry     │  │ communication│  │ sync engine  │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ VectorProxy  │  │ KnowledgeProx│  │ MemoryProxy  │              │
│  │ Vector store │  │ Knowledge    │  │ Memory store │              │
│  │ proxy        │  │ graph proxy  │  │ proxy        │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│                                │                                    │
│                                ▼                                    │
├─────────────────────────────────────────────────────────────────────┤
│                      Learning Module (Unchanged)                    │
├─────────────────────────────────────────────────────────────────────┤
│  VectorStore │ KnowledgeGraph │ HierarchicalMemory │ Safety │ ...   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Novel-Learning Bridge (Immediate Implementation)

### Component Design

#### 1. NovelVectorBridge

**Purpose**: Proxy vector search operations through learning's `VectorStore` and `EmbeddingService`.

**Benefits**:
- Eliminates ~200 lines of duplicated embedding/vector logic in `pattern-vector-index.ts`
- Unified embedding model across all modules
- Automatic embedding dimension management

```typescript
// novel-learning-bridge.ts

import { getSharedVectorStore, type IVectorStore } from "../learning/vector-store"
import { EmbeddingService } from "../learning/embedding-service"
import { Log } from "../util/log"

const log = Log.create({ service: "novel-vector-bridge" })

export interface NovelVectorBridgeConfig {
  enabled: boolean
  fallbackToLocal: boolean
  modelId?: string
}

export class NovelVectorBridge {
  private vectorStore: IVectorStore | null = null
  private config: NovelVectorBridgeConfig

  constructor(config: Partial<NovelVectorBridgeConfig> = {}) {
    this.config = {
      enabled: true,
      fallbackToLocal: true,
      modelId: "text-embedding-3-small",
      ...config,
    }
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) return

    try {
      this.vectorStore = await getSharedVectorStore({
        defaultModel: this.config.modelId as any,
      })
      log.info("novel_vector_bridge_initialized")
    } catch (error) {
      log.warn("vector_store_unavailable", { error: String(error) })
      if (!this.config.fallbackToLocal) {
        throw error
      }
    }
  }

  async searchSimilarPatterns(
    query: string,
    options?: { limit?: number; minSimilarity?: number }
  ): Promise<SimilarityResult[]> {
    if (!this.vectorStore) {
      if (this.config.fallbackToLocal) {
        return this.fallbackSearch(query, options)
      }
      return []
    }

    try {
      return await this.vectorStore.search(query, {
        limit: options?.limit ?? 10,
        min_similarity: options?.minSimilarity ?? 0.7,
        node_type: "novel_pattern",
      })
    } catch (error) {
      log.error("vector_search_failed", { error: String(error) })
      return this.config.fallbackToLocal ? this.fallbackSearch(query, options) : []
    }
  }

  async indexPattern(pattern: EnhancedPattern): Promise<string | null> {
    if (!this.vectorStore) return null

    try {
      return await this.vectorStore.store({
        node_type: "novel_pattern",
        node_id: pattern.id,
        entity_title: pattern.name,
        vector_type: "semantic",
        metadata: {
          category: pattern.category,
          description: pattern.description,
          strength: pattern.strength,
        },
      })
    } catch (error) {
      log.error("pattern_index_failed", { id: pattern.id, error: String(error) })
      return null
    }
  }

  private fallbackSearch(
    query: string,
    options?: { limit?: number; minSimilarity?: number }
  ): SimilarityResult[] {
    // Fallback to local implementation
    // This uses the existing pattern-vector-index.ts logic
    log.info("using_fallback_search")
    return []
  }
}
```

#### 2. NovelKnowledgeBridge

**Purpose**: Map novel's domain types to learning's knowledge graph, enabling cross-domain linking.

**Type Mappings**:

| Novel Type | Learning NodeType | Notes |
|------------|-------------------|-------|
| `character` | `memory` | Stored as project-level memory |
| `location` | `memory` | Stored as project-level memory |
| `event` | `memory` | Stored as project-level memory |
| `faction` | `constraint` | Represents organizational constraints |
| `theme` | `agenda` | Represents narrative goals |

| Novel Edge | Learning Relation | Notes |
|------------|-------------------|-------|
| `knows` | `related_to` | General relationship |
| `allied_with` | `related_to` | Positive relationship |
| `opposes` | `conflicts_with` | Conflict relationship |
| `memberOf` | `derives_from` | Membership hierarchy |
| `influenced_by` | `references` | Cross-reference |

```typescript
export class NovelKnowledgeBridge {
  private kg: KnowledgeGraph | null = null

  private static NODE_TYPE_MAP: Record<string, NodeType> = {
    character: "memory",
    location: "memory",
    event: "memory",
    faction: "constraint",
    theme: "agenda",
    concept: "memory",
    item: "memory",
  }

  private static EDGE_TYPE_MAP: Record<string, RelationType> = {
    knows: "related_to",
    allied_with: "related_to",
    opposes: "conflicts_with",
    memberOf: "derives_from",
    influenced_by: "references",
    leads: "derives_from",
    visits: "references",
  }

  async syncNode(node: GraphNode): Promise<string | null> {
    const kg = await this.getKnowledgeGraph()
    if (!kg) return null

    const learningType = NovelKnowledgeBridge.NODE_TYPE_MAP[node.type] || "memory"

    return kg.addNode({
      type: learningType,
      entity_type: `novel_${node.type}`,
      entity_id: node.id,
      title: node.name,
      content: node.description,
      memory_type: "project",
      metadata: {
        novel_type: node.type,
        status: node.status,
        first_appearance: node.firstAppearance,
        last_appearance: node.lastAppearance,
      },
    })
  }

  async syncEdge(edge: GraphEdge): Promise<string | null> {
    const kg = await this.getKnowledgeGraph()
    if (!kg) return null

    const learningRelation = NovelKnowledgeBridge.EDGE_TYPE_MAP[edge.type] || "related_to"

    // Get learning node IDs for source and target
    const sourceNode = await this.findLearningNode(edge.source)
    const targetNode = await this.findLearningNode(edge.target)

    if (!sourceNode || !targetNode) return null

    return kg.linkMemories(sourceNode.id, targetNode.id, learningRelation, edge.strength)
  }

  async linkNovelToCode(
    novelNodeId: string,
    codeNodeId: string,
    relation: RelationType
  ): Promise<string | null> {
    // Link novel entities to code entities (e.g., character → character generator code)
    const kg = await this.getKnowledgeGraph()
    if (!kg) return null

    return kg.linkMemories(novelNodeId, codeNodeId, relation)
  }

  async findRelatedCode(novelNodeId: string): Promise<KnowledgeNode[]> {
    const kg = await this.getKnowledgeGraph()
    if (!kg) return []

    return kg.getLinkedMemories(novelNodeId, {
      relation: "references",
      direction: "both",
    })
  }

  private async findLearningNode(novelNodeId: string): Promise<KnowledgeNode | null> {
    const kg = await this.getKnowledgeGraph()
    if (!kg) return null

    // Search by entity_id which contains the novel node ID
    const results = await kg.searchByContent(novelNodeId, 1)
    return results[0] || null
  }

  private async getKnowledgeGraph(): Promise<KnowledgeGraph | null> {
    if (this.kg) return this.kg

    try {
      const { KnowledgeGraph } = await import("../learning/knowledge-graph")
      this.kg = new KnowledgeGraph()
      return this.kg
    } catch (error) {
      log.error("knowledge_graph_unavailable", { error: String(error) })
      return null
    }
  }
}
```

#### 3. NovelMemoryBridge

**Purpose**: Use learning's `MemoryCritic` to evaluate and filter story memories.

```typescript
export interface NovelMemoryBridgeConfig {
  enabled: boolean
  useQualityFilter: boolean
  minQualityScore: number
  deduplicationThreshold: number
}

export class NovelMemoryBridge {
  private critic: MemoryCritic | null = null
  private vectorBridge: NovelVectorBridge
  private config: NovelMemoryBridgeConfig

  constructor(config: Partial<NovelMemoryBridgeConfig> = {}) {
    this.config = {
      enabled: true,
      useQualityFilter: false,
      minQualityScore: 0.5,
      deduplicationThreshold: 0.85,
      ...config,
    }
    this.vectorBridge = new NovelVectorBridge()
  }

  async shouldStoreMemory(entry: MemoryEntry): Promise<{
    store: boolean
    reason: string
    quality?: MemoryQualityScore
  }> {
    if (!this.config.enabled || !this.config.useQualityFilter) {
      return { store: true, reason: "Quality filter disabled" }
    }

    const critic = await this.getCritic()
    if (!critic) {
      return { store: true, reason: "Critic unavailable" }
    }

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
  }

  async findDuplicateMemories(content: string): Promise<MemoryEntry[]> {
    const similar = await this.vectorBridge.searchSimilarPatterns(content, {
      minSimilarity: this.config.deduplicationThreshold,
    })

    // Convert search results back to MemoryEntry format
    return similar.map((s) => ({
      id: s.node_id,
      level: s.metadata?.level as MemoryLevel,
      content: s.metadata?.content || "",
      chapter: s.metadata?.chapter || 0,
      characters: s.metadata?.characters || [],
      locations: s.metadata?.locations || [],
      events: s.metadata?.events || [],
      themes: s.metadata?.themes || [],
      significance: s.metadata?.significance || 5,
      createdAt: s.metadata?.createdAt || 0,
    }))
  }

  private async getCritic(): Promise<MemoryCritic | null> {
    if (this.critic) return this.critic

    try {
      const { MemoryCritic } = await import("../learning/memory-critic")
      this.critic = new MemoryCritic(
        0.3,  // minNoveltyScore
        0.4,  // minActionabilityScore
        this.config.minQualityScore,  // minOverallScore
        this.config.deduplicationThreshold  // similarityThreshold
      )
      return this.critic
    } catch (error) {
      log.error("memory_critic_unavailable", { error: String(error) })
      return null
    }
  }
}
```

#### 4. NovelImprovementApi

**Purpose**: Enable learning to actively improve novel code based on accumulated knowledge.

```typescript
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

    // Read code file
    const code = await this.readFile(modulePath)

    // 1. Search for semantically similar improved patterns
    const similarPatterns = await this.vectorBridge.searchSimilarPatterns(code, { limit: 5 })

    for (const pattern of similarPatterns) {
      if (pattern.similarity > 0.8) {
        suggestions.push({
          type: "enhance",
          targetFile: modulePath,
          description: `Detected similarity to known optimization pattern: ${pattern.entity_title}`,
          confidence: pattern.similarity,
          relatedKnowledge: [pattern.node_id],
        })
      }
    }

    // 2. Query knowledge graph for related code entities
    const relatedNodes = await this.knowledgeBridge.findRelatedCodeByPath(modulePath)

    for (const node of relatedNodes) {
      const improvements = await this.findImprovementHistory(node.id)
      if (improvements.length > 0) {
        suggestions.push({
          type: "refactor",
          targetFile: modulePath,
          description: `Reference improvement history from related module: ${node.title}`,
          confidence: 0.7,
          relatedKnowledge: improvements,
        })
      }
    }

    // 3. Analyze novel-specific patterns
    const novelSpecific = await this.analyzeNovelSpecificIssues(code, modulePath)
    suggestions.push(...novelSpecific)

    return suggestions.sort((a, b) => b.confidence - a.confidence)
  }

  private async analyzeNovelSpecificIssues(
    code: string,
    filePath: string
  ): Promise<ImprovementSuggestion[]> {
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
        suggestion: "Detected local vector calculation; recommend using NovelVectorBridge's unified embedding service",
        type: "enhance" as const,
      },
      {
        regex: /storyKnowledgeGraph\s*\.\s*addNode|storyWorldMemory\s*\.\s*storeMemory/g,
        suggestion: "Direct storage call detected; consider using bridge for quality filtering and deduplication",
        type: "refactor" as const,
      },
    ]

    for (const { regex, suggestion, type } of patterns) {
      const matches = code.match(regex)
      if (matches) {
        const lines = code.split("\n")
        const lineNum = lines.findIndex((l) => regex.test(l)) + 1

        suggestions.push({
          type,
          targetFile: filePath,
          targetLine: lineNum,
          description: suggestion,
          confidence: 0.6,
          relatedKnowledge: [],
        })
      }
    }

    return suggestions
  }

  async applySuggestion(
    suggestion: ImprovementSuggestion,
    dryRun: boolean = true
  ): Promise<boolean> {
    if (!dryRun) {
      await this.recordImprovement(suggestion)
    }
    // Actual code modification would happen here
    return true
  }

  private async recordImprovement(suggestion: ImprovementSuggestion): Promise<void> {
    const kg = await this.knowledgeBridge.getKnowledgeGraph()
    if (!kg) return

    await kg.addNode({
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
  }

  private async readFile(path: string): Promise<string> {
    const fs = await import("fs/promises")
    return fs.readFile(path, "utf-8")
  }

  private async findImprovementHistory(nodeId: string): Promise<string[]> {
    // Query knowledge graph for improvement records related to this node
    const kg = await this.knowledgeBridge.getKnowledgeGraph()
    if (!kg) return []

    const linked = await kg.getLinkedMemories(nodeId, {
      relation: "evolves_to",
      direction: "outgoing",
    })

    return linked
      .filter((n) => n.entity_type === "improvement")
      .map((n) => n.id)
  }
}
```

### Configuration Interface

```typescript
// novel-config.ts extension

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
    syncNodes: false,    // Opt-in
    syncEdges: false,
    linkToCode: false,
  },
  memory: {
    enabled: true,
    qualityFilter: false,  // Opt-in
    minQualityScore: 0.5,
    deduplication: false,
  },
  improvement: {
    enabled: false,  // Phase 3 feature
    autoSuggest: false,
    requireReview: true,
  },
}
```

---

## Phase 2: Generic Adapter Layer (Future Extension)

### Core Components

When other modules require similar integration patterns, extract reusable components to `adapt/bridge-core.ts`:

#### 1. TypeMapper

Generic type mapping with bidirectional support:

```typescript
// adapt/bridge-core.ts

export interface TypeMapping<S, T> {
  sourceType: string
  targetType: string
  transform: (source: S) => T
  reverse: (target: T) => S
}

export class TypeMapper {
  private mappings = new Map<string, Map<string, TypeMapping<unknown, unknown>>>()

  register<S, T>(mapping: TypeMapping<S, T>): void {
    const forwardKey = `${mapping.sourceType}→${mapping.targetType}`
    const reverseKey = `${mapping.targetType}→${mapping.sourceType}`

    if (!this.mappings.has(mapping.sourceType)) {
      this.mappings.set(mapping.sourceType, new Map())
    }
    this.mappings.get(mapping.sourceType)!.set(mapping.targetType, mapping as TypeMapping<unknown, unknown>)
  }

  map<S, T>(source: S, sourceType: string, targetType: string): T {
    const sourceMap = this.mappings.get(sourceType)
    if (!sourceMap) {
      throw new Error(`No mappings registered for source type: ${sourceType}`)
    }

    const mapping = sourceMap.get(targetType)
    if (!mapping) {
      throw new Error(`No mapping from ${sourceType} to ${targetType}`)
    }

    return mapping.transform(source) as T
  }

  reverse<T, S>(target: T, targetType: string, sourceType: string): S {
    const mapping = this.mappings.get(sourceType)?.get(targetType)
    if (!mapping) {
      throw new Error(`No mapping from ${sourceType} to ${targetType}`)
    }
    return mapping.reverse(target) as S
  }
}
```

#### 2. BridgeEventBus

Cross-module event communication:

```typescript
export interface BridgeEvent {
  id: string
  source: string      // Source module (novel, memory, evolution...)
  target: string      // Target module (learning, or another module)
  type: string        // Event type
  payload: unknown
  timestamp: number
  correlationId?: string  // For request-response patterns
}

export class BridgeEventBus {
  private handlers = new Map<string, Set<(event: BridgeEvent) => void | Promise<void>>>()
  private eventLog: BridgeEvent[] = []

  subscribe(moduleId: string, handler: (event: BridgeEvent) => void | Promise<void>): () => void {
    if (!this.handlers.has(moduleId)) {
      this.handlers.set(moduleId, new Set())
    }
    this.handlers.get(moduleId)!.add(handler)

    // Return unsubscribe function
    return () => {
      this.handlers.get(moduleId)?.delete(handler)
    }
  }

  async emit(event: Omit<BridgeEvent, "id" | "timestamp">): Promise<void> {
    const fullEvent: BridgeEvent = {
      ...event,
      id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    }

    this.eventLog.push(fullEvent)

    const handlers = this.handlers.get(event.target)
    if (handlers) {
      await Promise.all(
        Array.from(handlers).map((h) => h(fullEvent))
      )
    }
  }

  getEventLog(filter?: { source?: string; type?: string }): BridgeEvent[] {
    let log = this.eventLog
    if (filter?.source) {
      log = log.filter((e) => e.source === filter.source)
    }
    if (filter?.type) {
      log = log.filter((e) => e.type === filter.type)
    }
    return log
  }
}
```

#### 3. SyncManager

Bidirectional data synchronization:

```typescript
export interface SyncConfig {
  sourceModule: string
  targetModule: string
  syncMode: "push" | "pull" | "bidirectional"
  conflictResolution: "source_wins" | "target_wins" | "merge" | "custom"
  customMerge?: (source: unknown, target: unknown) => unknown
}

export interface SyncResult {
  success: boolean
  recordsProcessed: number
  conflicts: Array<{
    id: string
    source: unknown
    target: unknown
    resolution: string
  }>
  errors: Array<{ id: string; error: string }>
}

export class SyncManager {
  private syncJobs = new Map<string, SyncConfig>()

  registerSyncJob(jobId: string, config: SyncConfig): void {
    this.syncJobs.set(jobId, config)
  }

  async sync(jobId: string, data: unknown): Promise<SyncResult> {
    const config = this.syncJobs.get(jobId)
    if (!config) {
      throw new Error(`Sync job not found: ${jobId}`)
    }

    // Implementation would handle:
    // 1. Transform data using TypeMapper
    // 2. Detect conflicts
    // 3. Apply conflict resolution
    // 4. Emit events via EventBus

    return {
      success: true,
      recordsProcessed: 1,
      conflicts: [],
      errors: [],
    }
  }
}
```

#### 4. Proxy Factories

Generic proxies for learning components:

```typescript
export interface ProxyConfig {
  enabled: boolean
  fallbackHandler?: () => unknown
  retryCount?: number
  retryDelay?: number
}

export function createVectorProxy(config: ProxyConfig): IVectorStore {
  return new Proxy({} as IVectorStore, {
    get(target, prop) {
      if (!config.enabled) {
        return config.fallbackHandler?.()
      }
      // Forward to actual VectorStore
      return async (...args: unknown[]) => {
        const vs = await getSharedVectorStore()
        return (vs as any)[prop](...args)
      }
    },
  })
}

export function createKnowledgeProxy(config: ProxyConfig): KnowledgeGraph {
  // Similar implementation
}
```

### Integration Template for Other Modules

When integrating a new module (e.g., `memory`):

```typescript
// memory/memory-learning-bridge.ts

import { TypeMapper, BridgeEventBus, SyncManager } from "../adapt/bridge-core"
import { KnowledgeGraph, VectorStore } from "../learning"

// 1. Define type mappings
const MEMORY_TYPE_MAPPINGS: TypeMapping<unknown, unknown>[] = [
  {
    sourceType: "memory.session",
    targetType: "learning.memory",
    transform: (session) => ({
      type: "memory",
      entity_type: "session_memory",
      entity_id: (session as any).id,
      title: (session as any).summary,
      content: (session as any).content,
      memory_type: "session",
    }),
    reverse: (node) => ({
      id: node.entity_id,
      summary: node.title,
      content: node.content,
    }),
  },
  // ... more mappings
]

// 2. Create bridge class
export class MemoryLearningBridge {
  private typeMapper: TypeMapper
  private eventBus: BridgeEventBus
  private syncManager: SyncManager

  constructor() {
    this.typeMapper = new TypeMapper()
    MEMORY_TYPE_MAPPINGS.forEach((m) => this.typeMapper.register(m))

    this.eventBus = new BridgeEventBus()
    this.syncManager = new SyncManager()
  }

  // Module-specific methods...
}
```

---

## Data Flow Design

### Forward Flow: Module → Learning

```
┌──────────────────────────────────────────────────────────────────────┐
│  Module Data                                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │ Story Nodes     │  │ Memory Entries  │  │ Patterns        │     │
│  │ (character,     │  │ (scene, chapter)│  │ (motifs,        │     │
│  │  location, ...) │  │                 │  │  archetypes)    │     │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘     │
│           │                    │                    │               │
│           ▼                    ▼                    ▼               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Domain-Specific Bridge                    │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │   │
│  │  │ Type Mapping│  │ Validation  │  │ Event Emit  │         │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                               │                                     │
│                               ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                       Learning Module                        │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │   │
│  │  │VectorStore  │  │KnowledgeGph │  │MemoryCritic │         │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘         │   │
│  └─────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### Reverse Flow: Learning → Module (On-Demand)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Learning Knowledge Store                                            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │ Code Patterns   │  │ Improvement     │  │ Entity Relations│     │
│  │ (refactored,    │  │ History         │  │ (code ↔ domain) │     │
│  │  optimized)     │  │                 │  │                 │     │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘     │
│           │                    │                    │               │
│           ▼                    ▼                    ▼               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Improvement API                           │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │   │
│  │  │ Semantic    │  │ Pattern     │  │ Suggestion  │         │   │
│  │  │ Search      │  │ Analysis    │  │ Generation  │         │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                               │                                     │
│                               ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Module Code (novel, memory, ...)          │   │
│  │  ┌─────────────────────────────────────────────────────┐    │   │
│  │  │  Improvement Suggestions (refactor, optimize, fix)  │    │   │
│  │  └─────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Roadmap

### Phase 1: Novel-Learning Bridge (Immediate)

**Duration**: 2-3 development cycles

| Task | Priority | Description |
|------|----------|-------------|
| Create `novel-learning-bridge.ts` | P0 | Framework with all bridge components |
| Implement `NovelVectorBridge` | P0 | Vector search proxy |
| Refactor `pattern-vector-index.ts` | P0 | Use NovelVectorBridge |
| Implement `NovelKnowledgeBridge` | P1 | Knowledge graph mapping |
| Implement `NovelMemoryBridge` | P2 | Memory quality filtering |
| Unit tests | P0 | Core functionality tests |
| Integration tests | P1 | End-to-end data flow tests |

### Phase 2: Generic Adapter Layer (After Phase 1)

**Duration**: 1-2 development cycles

| Task | Priority | Description |
|------|----------|-------------|
| Create `adapt/bridge-core.ts` | P1 | Extract reusable components |
| Refactor novel-learning-bridge | P1 | Use generic adapter layer |
| Create `memory-learning-bridge` | P2 | Memory module integration |
| Create `evolution-learning-bridge` | P3 | Evolution module integration |
| Documentation | P1 | Integration guide for new modules |

### Phase 3: Reverse Improvement System (After Phase 2)

**Duration**: 2 development cycles

| Task | Priority | Description |
|------|----------|-------------|
| Implement `NovelImprovementApi` | P1 | Knowledge-driven suggestions |
| Extend `SelfEvolutionScheduler` | P1 | Call improvement APIs |
| Add CLI command `/improve-novel` | P2 | Manual trigger |
| Automated improvement scheduling | P3 | Periodic improvement runs |

### Phase 4: Safety and Rollback (After Phase 3)

**Duration**: 1 development cycle

| Task | Priority | Description |
|------|----------|-------------|
| Implement `NovelSafetyBridge` | P2 | Content safety validation |
| Story state rollback | P2 | Using learning's RollbackManager |
| Human review workflow | P3 | For high-risk improvements |

---

## Expected Benefits

| Category | Benefit |
|----------|---------|
| **Code Reuse** | Remove ~200 lines of duplicated vector/embedding logic in pattern-vector-index.ts |
| **Feature Enhancement** | Novel gains semantic search, quality evaluation, safety checking |
| **Bidirectional Improvement** | Learning can actively improve novel code based on stored knowledge |
| **Observability** | All bridge operations traceable through learning's tracing system |
| **Extensibility** | Clear pattern for other modules to integrate with learning |
| **Maintainability** | Single source of truth for vector operations, knowledge storage |

---

## Appendix: Module Integration Checklist

When integrating a new module with learning:

- [ ] **Define Type Mappings**: Map module domain types to learning types
- [ ] **Create Bridge Class**: Extend generic adapter or create specialized bridge
- [ ] **Implement Sync Logic**: Decide what data to sync (push/pull/bidirectional)
- [ ] **Add Configuration**: Module-specific bridge configuration
- [ ] **Write Tests**: Unit tests for type mapping, integration tests for data flow
- [ ] **Document**: Update module's AGENTS.md with bridge usage

---

## References

- `learning/index.ts` - Learning module exports
- `learning/knowledge-graph.ts` - Knowledge graph implementation
- `learning/vector-store.ts` - Vector store interface
- `learning/hierarchical-memory.ts` - Hierarchical memory system
- `learning/memory-critic.ts` - Memory quality evaluation
- `learning/safety.ts` - Safety mechanisms
- `novel/story-knowledge-graph.ts` - Novel's knowledge graph
- `novel/story-world-memory.ts` - Novel's memory system
- `novel/pattern-vector-index.ts` - Novel's vector index
