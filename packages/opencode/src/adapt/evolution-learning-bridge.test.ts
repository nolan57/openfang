import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { EvolutionLearningBridge, DEFAULT_EVOLUTION_BRIDGE_CONFIG } from "./evolution-learning-bridge"
import { TypeMapper, BridgeEventBus, SyncManager } from "./bridge-core"

describe("EvolutionLearningBridge", () => {
  let bridge: EvolutionLearningBridge

  beforeEach(() => {
    bridge = new EvolutionLearningBridge(new TypeMapper(), new BridgeEventBus(), new SyncManager(), {
      enabled: false,
      syncToKnowledgeGraph: false,
      useVectorSearch: false,
    })
  })

  afterEach(async () => {
    await bridge.close()
  })

  test("should initialize with config", () => {
    expect(bridge).toBeDefined()
  })

  test("should have correct default config", () => {
    const status = bridge.getStatus()
    expect(status.config).toBeDefined()
  })

  test("should register type mappings", async () => {
    await bridge.initialize()
    const status = bridge.getStatus()
    expect(status.initialized).toBe(true)
  })

  test("should skip prompt sync when KG disabled", async () => {
    const prompt = {
      id: "test-prompt",
      originalPrompt: "Test prompt",
      optimizedPrompt: "Optimized prompt",
      reason: "Test reason",
      sessionID: "session-1",
      usageCount: 0,
      createdAt: Date.now(),
    }
    const result = await bridge.syncPrompt(prompt)
    expect(result).toBeNull()
  })

  test("should skip skill sync when KG disabled", async () => {
    const skill = {
      id: "test-skill",
      name: "Test Skill",
      description: "Test description",
      content: "Skill content",
      triggerPatterns: ["pattern1"],
      sessionID: "session-1",
      createdAt: Date.now(),
      status: "draft" as const,
    }
    const result = await bridge.syncSkill(skill)
    expect(result).toBeNull()
  })

  test("should skip memory sync when KG disabled", async () => {
    const memory = {
      id: "test-memory",
      key: "test-key",
      value: "test-value",
      context: "test-context",
      sessionIDs: ["session-1"],
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      usageCount: 0,
      sensitive: false,
      encrypted: false,
      archived: false,
    }
    const result = await bridge.syncMemory(memory)
    expect(result).toBeNull()
  })

  test("should return empty array for search when vector disabled", async () => {
    const results = await bridge.searchEvolutionHistory("test query")
    expect(results).toEqual([])
  })

  test("should skip artifact storage when vector disabled", async () => {
    const result = await bridge.storeEvolutionArtifact("id", "title", "content", "prompt", {})
    expect(result).toBeNull()
  })

  test("should skip artifact linking when disabled", async () => {
    const result = await bridge.linkArtifacts("id1", "id2", "evolves_to")
    expect(result).toBeNull()
  })

  test("should use custom config when provided", () => {
    const customBridge = new EvolutionLearningBridge(undefined, undefined, undefined, {
      trackEvolutionHistory: true,
      autoIndexSkills: true,
    })
    const status = customBridge.getStatus()
    expect(status.config.trackEvolutionHistory).toBe(true)
    expect(status.config.autoIndexSkills).toBe(true)
  })
})

describe("DEFAULT_EVOLUTION_BRIDGE_CONFIG", () => {
  test("should have correct structure", () => {
    expect(DEFAULT_EVOLUTION_BRIDGE_CONFIG).toEqual({
      enabled: true,
      syncToKnowledgeGraph: false,
      useVectorSearch: true,
      trackEvolutionHistory: false,
      autoIndexSkills: false,
    })
  })

  test("should have progressive enablement", () => {
    expect(DEFAULT_EVOLUTION_BRIDGE_CONFIG.syncToKnowledgeGraph).toBe(false)
    expect(DEFAULT_EVOLUTION_BRIDGE_CONFIG.trackEvolutionHistory).toBe(false)
    expect(DEFAULT_EVOLUTION_BRIDGE_CONFIG.autoIndexSkills).toBe(false)
  })
})

describe("Evolution Type Mappings", () => {
  test("should have prompt mapping", async () => {
    const { EVOLUTION_TYPE_MAPPINGS } = await import("./evolution-learning-bridge")
    const promptMapping = EVOLUTION_TYPE_MAPPINGS.find((m) => m.sourceType === "evolution.prompt")
    expect(promptMapping).toBeDefined()
  })

  test("should have skill mapping", async () => {
    const { EVOLUTION_TYPE_MAPPINGS } = await import("./evolution-learning-bridge")
    const skillMapping = EVOLUTION_TYPE_MAPPINGS.find((m) => m.sourceType === "evolution.skill")
    expect(skillMapping).toBeDefined()
  })

  test("should have memory mapping", async () => {
    const { EVOLUTION_TYPE_MAPPINGS } = await import("./evolution-learning-bridge")
    const memoryMapping = EVOLUTION_TYPE_MAPPINGS.find((m) => m.sourceType === "evolution.memory")
    expect(memoryMapping).toBeDefined()
  })

  test("should have bidirectional transform and reverse", async () => {
    const { EVOLUTION_TYPE_MAPPINGS } = await import("./evolution-learning-bridge")
    const mapping = EVOLUTION_TYPE_MAPPINGS[0]

    const testObj = {
      id: "test",
      originalPrompt: "test",
      optimizedPrompt: "test",
      reason: "test",
      sessionID: "test",
      usageCount: 0,
      createdAt: Date.now(),
    }

    const transformed = mapping.transform(testObj)
    expect(transformed).toBeDefined()
    expect(transformed.entity_type).toBe("prompt_evolution")

    const reversed = mapping.reverse(transformed)
    expect(reversed).toBeDefined()
    expect(reversed.id).toBe("test")
  })
})
