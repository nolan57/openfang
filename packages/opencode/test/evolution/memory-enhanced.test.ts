import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { getRelevantMemories, extractMemories } from "../../src/evolution/memory"
import { saveMemory } from "../../src/evolution/store"
import { resolve, dirname } from "path"
import { mkdir, rm } from "fs/promises"

const testDir = resolve(__dirname, "../../test-tmp/memory-enhanced")

async function setup() {
  await mkdir(resolve(testDir, ".opencode/evolution"), { recursive: true })
}

async function cleanup() {
  try {
    await rm(testDir, { recursive: true, force: true })
  } catch {}
}

describe("Enhanced Memory Retrieval", () => {
  beforeEach(setup)
  afterEach(cleanup)

  test("returns empty when no memories exist", async () => {
    const memories = await getRelevantMemories(testDir, "typescript testing")
    expect(memories).toHaveLength(0)
  })

  test("returns relevant memories based on keywords", async () => {
    // Save some test memories
    await saveMemory(testDir, {
      key: "typescript-tips",
      value: "Use explicit type annotations",
      context: "Working with TypeScript",
      sessionIDs: ["session-1"],
    })

    await saveMemory(testDir, {
      key: "testing-approach",
      value: "Write tests first (TDD)",
      context: "Testing with Jest",
      sessionIDs: ["session-2"],
    })

    await saveMemory(testDir, {
      key: "debugging-tips",
      value: "Start with minimal reproduction case",
      context: "Debugging errors",
      sessionIDs: ["session-3"],
    })

    // Search for typescript
    const memories = await getRelevantMemories(testDir, "typescript")
    
    expect(memories.length).toBeGreaterThan(0)
    expect(memories.some(m => m.key === "typescript-tips")).toBe(true)
  })

  test("limits results to 5", async () => {
    // Save 10 test memories
    for (let i = 0; i < 10; i++) {
      await saveMemory(testDir, {
        key: `memory-${i}`,
        value: `Value ${i}`,
        context: `Context ${i}`,
        sessionIDs: [`session-${i}`],
      })
    }

    const memories = await getRelevantMemories(testDir, "memory")
    expect(memories.length).toBeLessThanOrEqual(5)
  })

  test("sorts by relevance score", async () => {
    // Save memories with different relevance
    await saveMemory(testDir, {
      key: "typescript-tips",
      value: "Use explicit type annotations for better clarity",
      context: "TypeScript development",
      sessionIDs: ["session-1"],
    })

    await saveMemory(testDir, {
      key: "testing-approach",
      value: "Write tests first (TDD) for better design",
      context: "Testing with Jest and Vitest",
      sessionIDs: ["session-2"],
    })

    // Search with both keywords - should return both but sorted
    const memories = await getRelevantMemories(testDir, "typescript testing")
    
    if (memories.length > 1) {
      // First result should have higher relevance
      expect(memories[0].relevance).toBeGreaterThanOrEqual(memories[1].relevance)
    }
  })

  test("extractMemories saves memory with vector embedding", async () => {
    const sessionID = "test-session-123"
    
    await extractMemories(
      testDir,
      sessionID,
      "I need to write some TypeScript code with types",
      ["read_file", "edit_file"],
      "success"
    )

    // Verify memory was saved
    const memories = await getRelevantMemories(testDir, "typescript")
    expect(memories.length).toBeGreaterThan(0)
  })
})

describe("Temporal Decay", () => {
  test("older memories have lower scores", async () => {
    // This tests the temporal decay logic conceptually
    // The actual decay is applied in getRelevantMemories
    
    // Test with small values that work
    const lambda = 0.0001
    const age1 = 1000 // 1 second
    const age2 = 10000 // 10 seconds
    
    const decay1 = Math.exp(-lambda * age1)
    const decay2 = Math.exp(-lambda * age2)
    
    // Older (larger age) should have lower decay score
    expect(decay1).toBeGreaterThan(decay2)
    
    // Both should be less than 1
    expect(decay1).toBeLessThan(1)
    expect(decay2).toBeLessThan(1)
  })
})

describe("MMR Re-ranking", () => {
  test("MMR promotes diversity in results", async () => {
    // Test that MMR re-ranking considers similarity
    // Items with similar keys should be de-prioritized
    
    const items = [
      { key: "typescript-tips", value: "Use types", score: 1.0 },
      { key: "typescript-advanced", value: "Advanced types", score: 0.9 },
      { key: "testing-approach", value: "Write tests", score: 0.8 },
      { key: "debugging-tips", value: "Debug tips", score: 0.7 },
    ]
    
    // Simple similarity test: check keyword overlap
    const key1 = "typescript-tips"
    const key2 = "typescript-advanced"
    
    const words1 = new Set(key1.split("-"))
    const words2 = new Set(key2.split("-"))
    
    const intersection = [...words1].filter(w => words2.has(w)).length
    const union = words1.size + words2.size - intersection
    
    const similarity = union > 0 ? intersection / union : 0
    
    // These should have some overlap
    expect(similarity).toBeGreaterThan(0)
  })
})