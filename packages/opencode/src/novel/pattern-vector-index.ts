import { Log } from "../util/log"
import type { EnhancedPattern, Archetype, Motif } from "./pattern-miner-enhanced"
import { NovelVectorBridge, type SimilarityResult } from "./novel-learning-bridge"

const log = Log.create({ service: "pattern-vector-index" })

export interface VectorIndexConfig {
  useBridge: boolean
  similarityThreshold: number
  maxResults: number
  embeddingModelId?: string
}

const DEFAULT_CONFIG: VectorIndexConfig = {
  useBridge: true,
  similarityThreshold: 0.7,
  maxResults: 10,
  embeddingModelId: "text-embedding-3-small",
}

export class PatternVectorIndex {
  private bridge: NovelVectorBridge
  private config: VectorIndexConfig
  private initialized: boolean = false

  constructor(config: Partial<VectorIndexConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.bridge = new NovelVectorBridge({
      enabled: this.config.useBridge,
      fallbackToLocal: !this.config.useBridge,
      modelId: this.config.embeddingModelId,
    })
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      await this.bridge.initialize()
      this.initialized = true
      log.info("pattern_vector_index_initialized", {
        useBridge: this.config.useBridge,
      })
    } catch (error) {
      log.error("pattern_vector_index_init_failed", { error: String(error) })
      throw error
    }
  }

  async indexPattern(pattern: EnhancedPattern): Promise<void> {
    if (!this.initialized) await this.initialize()

    const id = await this.bridge.indexPattern(pattern)
    if (id) {
      log.info("pattern_indexed", { id, patternId: pattern.id })
    } else {
      log.warn("pattern_index_failed", { patternId: pattern.id })
    }
  }

  async indexArchetype(archetype: Archetype): Promise<void> {
    if (!this.initialized) await this.initialize()

    const pattern: EnhancedPattern = {
      id: archetype.id,
      category: "archetype",
      name: archetype.name,
      description: archetype.description,
      strength: archetype.strength,
      decay_rate: 0.1,
      occurrences: 1,
      cross_story_valid: false,
      metadata: {
        type: archetype.type,
        traits: archetype.traits,
        narrative_role: archetype.narrative_role,
      },
      last_reinforced: archetype.last_reinforced,
    }

    const id = await this.bridge.indexPattern(pattern)
    if (id) {
      log.info("archetype_indexed", { id, archetypeId: archetype.id })
    } else {
      log.warn("archetype_index_failed", { archetypeId: archetype.id })
    }
  }

  async indexMotif(motif: Motif): Promise<void> {
    if (!this.initialized) await this.initialize()

    const latestOccurrence = motif.occurrences.length > 0 ? motif.occurrences[motif.occurrences.length - 1].chapter : 0

    const pattern: EnhancedPattern = {
      id: motif.id,
      category: "motif",
      name: motif.name,
      description: motif.description,
      strength: motif.strength,
      decay_rate: motif.decay_rate,
      occurrences: motif.occurrences.length,
      cross_story_valid: false,
      metadata: {
        type: motif.type,
        occurrences: motif.occurrences.length,
        evolution: motif.evolution,
      },
      last_reinforced: latestOccurrence * 1000,
    }

    const id = await this.bridge.indexPattern(pattern)
    if (id) {
      log.info("motif_indexed", { id, motifId: motif.id })
    } else {
      log.warn("motif_index_failed", { motifId: motif.id })
    }
  }

  async searchSimilar(queryText: string, patternType?: string, limit?: number): Promise<SimilarityResult[]> {
    if (!this.initialized) await this.initialize()

    const maxResults = limit || this.config.maxResults
    const results = await this.bridge.searchSimilarPatterns(queryText, {
      limit: maxResults,
      minSimilarity: this.config.similarityThreshold,
    })

    if (patternType) {
      return results.filter((r) => r.patternType === patternType)
    }

    return results
  }

  async updateStrength(id: string, newStrength: number): Promise<boolean> {
    log.info("strength_update_not_supported_with_bridge", { id, newStrength })
    return false
  }

  async removePattern(id: string): Promise<boolean> {
    log.info("pattern_removal_not_supported_with_bridge", { id })
    return false
  }

  async getPatternsByType(patternType: string): Promise<SimilarityResult[]> {
    if (!this.initialized) await this.initialize()
    return []
  }

  async getTopPatterns(limit: number = 20): Promise<SimilarityResult[]> {
    if (!this.initialized) await this.initialize()
    return []
  }

  async getStats(): Promise<{
    total: number
    byType: Record<string, number>
    avgStrength: number
  }> {
    return {
      total: 0,
      byType: {},
      avgStrength: 0,
    }
  }

  async clear(): Promise<void> {
    log.info("pattern_vector_index_clear_not_supported_with_bridge")
  }

  async close(): Promise<void> {
    await this.bridge.close()
    this.initialized = false
    log.info("pattern_vector_index_closed")
  }
}

export const patternVectorIndex = new PatternVectorIndex()
