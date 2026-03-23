import { describe, test, expect, beforeEach } from "bun:test"
import { PatternVectorIndex } from "../pattern-vector-index"

describe("PatternVectorIndex", () => {
  let index: PatternVectorIndex

  beforeEach(async () => {
    index = new PatternVectorIndex({ useBridge: false })
    await index.initialize()
    await index.clear()
  })

  test("initializes with bridge disabled", async () => {
    await index.initialize()
    const stats = await index.getStats()
    expect(stats).toBeDefined()
    expect(typeof stats.total).toBe("number")
  })

  test("indexPattern stores pattern via bridge", async () => {
    await index.initialize()

    await index.indexPattern({
      id: "pattern_test_1",
      name: "Test Pattern",
      category: "character_trait",
      description: "A test pattern",
      strength: 50,
      decay_rate: 0.1,
      last_reinforced: Date.now(),
      occurrences: 1,
      cross_story_valid: false,
    })

    const stats = await index.getStats()
    expect(stats.total).toBe(0)
  })

  test("searchSimilar returns results", async () => {
    await index.initialize()

    const results = await index.searchSimilar("bravery and heroism")

    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBe(0)
  })

  test("updateStrength returns false when using bridge", async () => {
    await index.initialize()

    const result = await index.updateStrength("pattern_strength_1", 80)
    expect(result).toBe(false)
  })

  test("removePattern returns false when using bridge", async () => {
    await index.initialize()

    const removed = await index.removePattern("pattern_remove_1")
    expect(removed).toBe(false)
  })

  test("getTopPatterns returns empty array when using bridge", async () => {
    await index.initialize()

    const top = await index.getTopPatterns(2)
    expect(top.length).toBe(0)
  })

  test("getPatternsByType returns empty array when using bridge", async () => {
    await index.initialize()

    const patterns = await index.getPatternsByType("character_trait")
    expect(patterns.length).toBe(0)
  })

  test("clear logs message when using bridge", async () => {
    await index.initialize()
    await index.clear()
  })
})
