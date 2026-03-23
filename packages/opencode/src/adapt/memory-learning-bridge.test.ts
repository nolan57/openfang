import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { MemoryLearningBridge, DEFAULT_MEMORY_BRIDGE_CONFIG } from "./memory-learning-bridge"
import { TypeMapper, BridgeEventBus, SyncManager } from "./bridge-core"

describe("MemoryLearningBridge", () => {
  let bridge: MemoryLearningBridge

  beforeEach(() => {
    bridge = new MemoryLearningBridge(new TypeMapper(), new BridgeEventBus(), new SyncManager(), {
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

  test("should skip session sync when KG disabled", async () => {
    const sessionData = {
      id: "test-session",
      type: "session",
      content: "Test session content",
    }
    const result = await bridge.syncSessionMemory("session-1", sessionData)
    expect(result).toBeNull()
  })

  test("should skip evolution sync when KG disabled", async () => {
    const evolutionData = {
      id: "test-evolution",
      type: "evolution",
      content: "Test evolution content",
    }
    const result = await bridge.syncEvolutionMemory("evolution-1", evolutionData)
    expect(result).toBeNull()
  })

  test("should return empty array for search when vector disabled", async () => {
    const results = await bridge.searchMemories("test query")
    expect(results).toEqual([])
  })

  test("should return empty array for duplicate check when disabled", async () => {
    const duplicates = await bridge.findDuplicateMemories("test content")
    expect(duplicates).toEqual([])
  })

  test("should skip memory linking when disabled", async () => {
    const result = await bridge.linkMemories("id1", "id2", "related_to")
    expect(result).toBeNull()
  })

  test("should skip memory storage when vector disabled", async () => {
    const result = await bridge.storeMemory("id", "content", {})
    expect(result).toBeNull()
  })

  test("should use custom config when provided", () => {
    const customBridge = new MemoryLearningBridge(undefined, undefined, undefined, {
      deduplication: true,
      deduplicationThreshold: 0.9,
    })
    const status = customBridge.getStatus()
    expect(status.config.deduplication).toBe(true)
    expect(status.config.deduplicationThreshold).toBe(0.9)
  })
})

describe("DEFAULT_MEMORY_BRIDGE_CONFIG", () => {
  test("should have correct structure", () => {
    expect(DEFAULT_MEMORY_BRIDGE_CONFIG).toEqual({
      enabled: true,
      syncToKnowledgeGraph: false,
      useVectorSearch: true,
      deduplication: false,
      deduplicationThreshold: 0.85,
      crossMemoryLinking: false,
    })
  })

  test("should have progressive enablement", () => {
    expect(DEFAULT_MEMORY_BRIDGE_CONFIG.syncToKnowledgeGraph).toBe(false)
    expect(DEFAULT_MEMORY_BRIDGE_CONFIG.deduplication).toBe(false)
    expect(DEFAULT_MEMORY_BRIDGE_CONFIG.crossMemoryLinking).toBe(false)
  })
})

describe("Memory Type Mappings", () => {
  test("should have session mapping", async () => {
    const { MEMORY_TYPE_MAPPINGS } = await import("./memory-learning-bridge")
    const sessionMapping = MEMORY_TYPE_MAPPINGS.find((m) => m.sourceType === "memory.session")
    expect(sessionMapping).toBeDefined()
  })

  test("should have evolution mapping", async () => {
    const { MEMORY_TYPE_MAPPINGS } = await import("./memory-learning-bridge")
    const evolutionMapping = MEMORY_TYPE_MAPPINGS.find((m) => m.sourceType === "memory.evolution")
    expect(evolutionMapping).toBeDefined()
  })

  test("should have project mapping", async () => {
    const { MEMORY_TYPE_MAPPINGS } = await import("./memory-learning-bridge")
    const projectMapping = MEMORY_TYPE_MAPPINGS.find((m) => m.sourceType === "memory.project")
    expect(projectMapping).toBeDefined()
  })
})
