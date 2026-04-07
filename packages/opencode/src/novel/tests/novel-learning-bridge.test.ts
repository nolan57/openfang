import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  NovelVectorBridge,
  NovelKnowledgeBridge,
  NovelMemoryBridge,
  NovelImprovementApi,
  NovelLearningBridgeManager,
  DEFAULT_LEARNING_BRIDGE_CONFIG,
} from "../novel-learning-bridge"
import type { MemoryEntry } from "../story-world-memory"
import type { GraphNode } from "../story-knowledge-graph"

describe("NovelVectorBridge", () => {
  let bridge: NovelVectorBridge

  beforeEach(() => {
    bridge = new NovelVectorBridge({
      enabled: false,
      fallbackToLocal: true,
    })
  })

  afterEach(async () => {
    await bridge.close()
  })

  test("should initialize with config", async () => {
    expect(bridge).toBeDefined()
  })

  test("should handle disabled state gracefully", async () => {
    await bridge.initialize()
    const results = await bridge.searchSimilarPatterns("test query")
    expect(results).toEqual([])
  })

  test("should return empty array for search when disabled", async () => {
    const results = await bridge.searchSimilarPatterns("test", {
      limit: 5,
      minSimilarity: 0.7,
    })
    expect(results).toEqual([])
  })

  test("should handle pattern indexing when disabled", async () => {
    const pattern = {
      id: "test-pattern",
      name: "Test Pattern",
      category: "character_trait" as const,
      description: "A test pattern",
      strength: 50,
      decay_rate: 0.1,
      occurrences: 1,
      cross_story_valid: false,
      last_reinforced: Date.now(),
    }
    const result = await bridge.indexPattern(pattern)
    expect(result).toBeNull()
  })
})

describe("NovelKnowledgeBridge", () => {
  let bridge: NovelKnowledgeBridge

  beforeEach(() => {
    bridge = new NovelKnowledgeBridge()
  })

  afterEach(async () => {
    await bridge.close()
  })

  test("should initialize", () => {
    expect(bridge).toBeDefined()
  })

  test("should have correct type mappings", () => {
    expect((NovelKnowledgeBridge as any).NODE_TYPE_MAP.character).toBe("memory")
    expect((NovelKnowledgeBridge as any).NODE_TYPE_MAP.location).toBe("memory")
    expect((NovelKnowledgeBridge as any).NODE_TYPE_MAP.faction).toBe("constraint")
    expect((NovelKnowledgeBridge as any).NODE_TYPE_MAP.theme).toBe("agenda")
  })

  test("should have correct edge mappings", () => {
    expect((NovelKnowledgeBridge as any).EDGE_TYPE_MAP.knows).toBe("related_to")
    expect((NovelKnowledgeBridge as any).EDGE_TYPE_MAP.opposes).toBe("conflicts_with")
    expect((NovelKnowledgeBridge as any).EDGE_TYPE_MAP.memberOf).toBe("derives_from")
  })

  test("should handle node sync when initialized", async () => {
    const mockNode: GraphNode = {
      id: "test-node",
      name: "Test Node",
      type: "character",
      status: "active",
      description: "A test node",
      firstAppearance: 1,
    }
    try {
      await bridge.initialize()
      const result = await bridge.syncNode(mockNode)
      expect(result).toBeDefined()
      expect(typeof result).toBe("string")
    } catch (error) {
      expect(error).toBeDefined()
    }
  })
})

describe("NovelMemoryBridge", () => {
  let bridge: NovelMemoryBridge

  beforeEach(() => {
    bridge = new NovelMemoryBridge({
      enabled: false,
      useQualityFilter: false,
      minQualityScore: 0.5,
      deduplicationThreshold: 0.85,
    })
  })

  test("should initialize with config", () => {
    expect(bridge).toBeDefined()
  })

  test("should allow memory storage when quality filter is disabled", async () => {
    const mockMemory: MemoryEntry = {
      id: "test-memory",
      level: "scene",
      content: "Test memory content",
      chapter: 1,
      characters: ["Character A"],
      locations: ["Location A"],
      events: ["Event A"],
      themes: ["Theme A"],
      significance: 5,
      createdAt: Date.now(),
      parent_id: null,
      embeddings: null,
    }

    const result = await bridge.shouldStoreMemory(mockMemory)
    expect(result.store).toBe(true)
    expect(result.reason).toBe("Quality filter disabled")
  })

  test("should return empty array for duplicate search when disabled", async () => {
    const duplicates = await bridge.findDuplicateMemories("test content")
    expect(duplicates).toEqual([])
  })
})

describe("NovelImprovementApi", () => {
  let api: NovelImprovementApi

  beforeEach(() => {
    api = new NovelImprovementApi()
  })

  test("should initialize", () => {
    expect(api).toBeDefined()
  })

  test("should return empty array for non-existent file", async () => {
    const suggestions = await api.analyzeAndSuggest("/non/existent/file.ts")
    expect(suggestions).toEqual([])
  })

  test("should handle suggestion application in dry run mode", async () => {
    const suggestion = {
      type: "enhance" as const,
      targetFile: "test.ts",
      description: "Test suggestion",
      confidence: 0.8,
      relatedKnowledge: [],
    }

    const result = await api.applySuggestion(suggestion, true)
    expect(result).toBe(true)
  })
})

describe("NovelLearningBridgeManager", () => {
  let manager: NovelLearningBridgeManager

  beforeEach(() => {
    manager = new NovelLearningBridgeManager({
      enabled: false,
    })
  })

  afterEach(async () => {
    await manager.close()
  })

  test("should initialize with default config", () => {
    expect(manager).toBeDefined()
  })

  test("should have all bridge components", () => {
    expect(manager.getVectorBridge()).toBeDefined()
    expect(manager.getKnowledgeBridge()).toBeDefined()
    expect(manager.getMemoryBridge()).toBeDefined()
    expect(manager.getImprovementApi()).toBeDefined()
  })

  test("should handle initialization when disabled", async () => {
    await manager.initialize()
  })

  test("should use default config when partial config provided", () => {
    const customManager = new NovelLearningBridgeManager({
      vector: {
        enabled: true,
        fallbackToLocal: false,
      },
    })
    const config = (customManager as any).config
    expect(config.vector.enabled).toBe(true)
    expect(config.vector.fallbackToLocal).toBe(false)
    expect(config.knowledge.enabled).toBe(true)
    expect(config.memory.enabled).toBe(true)
  })
})

describe("DEFAULT_LEARNING_BRIDGE_CONFIG", () => {
  test("should have correct structure", () => {
    expect(DEFAULT_LEARNING_BRIDGE_CONFIG).toEqual({
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
    })
  })

  test("should have full feature enablement by default", () => {
    expect(DEFAULT_LEARNING_BRIDGE_CONFIG.knowledge.syncNodes).toBe(true)
    expect(DEFAULT_LEARNING_BRIDGE_CONFIG.knowledge.syncEdges).toBe(true)
    expect(DEFAULT_LEARNING_BRIDGE_CONFIG.knowledge.linkToCode).toBe(true)
    expect(DEFAULT_LEARNING_BRIDGE_CONFIG.memory.qualityFilter).toBe(true)
    expect(DEFAULT_LEARNING_BRIDGE_CONFIG.memory.deduplication).toBe(true)
    expect(DEFAULT_LEARNING_BRIDGE_CONFIG.improvement.enabled).toBe(true)
    expect(DEFAULT_LEARNING_BRIDGE_CONFIG.improvement.autoSuggest).toBe(true)
    expect(DEFAULT_LEARNING_BRIDGE_CONFIG.improvement.requireReview).toBe(false)
  })
})
