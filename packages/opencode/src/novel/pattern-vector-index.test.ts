import { describe, test, expect, beforeEach } from "bun:test"
import { PatternVectorIndex } from "./pattern-vector-index"

describe("PatternVectorIndex", () => {
  let index: PatternVectorIndex

  beforeEach(async () => {
    index = new PatternVectorIndex()
    await index.initialize()
    await index.clear()
  })

  test("initializes database", async () => {
    await index.initialize()
    const stats = await index.getStats()
    expect(stats).toBeDefined()
    expect(typeof stats.total).toBe("number")
  })

  test("generateEmbedding returns array of correct dimension", async () => {
    await index.initialize()

    const embedding = await index.generateEmbedding("test text")

    expect(Array.isArray(embedding)).toBe(true)
    expect(embedding.length).toBe(384)
  })

  test("indexPattern stores pattern", async () => {
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
    expect(stats.total).toBe(1)
    expect(stats.byType["character_trait"]).toBe(1)
  })

  test("searchSimilar returns results", async () => {
    await index.initialize()

    await index.indexPattern({
      id: "pattern_search_1",
      name: "Hero's Courage",
      category: "character_trait",
      description: "The hero shows courage in the face of danger",
      strength: 70,
      decay_rate: 0.1,
      last_reinforced: Date.now(),
      occurrences: 1,
      cross_story_valid: false,
    })

    const results = await index.searchSimilar("bravery and heroism")

    expect(Array.isArray(results)).toBe(true)
  })

  test("updateStrength modifies pattern", async () => {
    await index.initialize()

    await index.indexPattern({
      id: "pattern_strength_1",
      name: "Test",
      category: "skill",
      description: "Test pattern",
      strength: 50,
      decay_rate: 0.1,
      last_reinforced: Date.now(),
      occurrences: 1,
      cross_story_valid: false,
    })

    await index.updateStrength("pattern_strength_1", 80)

    const pattern = await index.searchById("pattern_strength_1")
    expect(pattern?.strength).toBe(80)
  })

  test("removePattern deletes pattern", async () => {
    await index.initialize()

    await index.indexPattern({
      id: "pattern_remove_1",
      name: "To Remove",
      category: "tone",
      description: "Will be removed",
      strength: 50,
      decay_rate: 0.1,
      last_reinforced: Date.now(),
      occurrences: 1,
      cross_story_valid: false,
    })

    const removed = await index.removePattern("pattern_remove_1")
    expect(removed).toBe(true)

    const pattern = await index.searchById("pattern_remove_1")
    expect(pattern).toBeNull()
  })

  test("getTopPatterns returns sorted results", async () => {
    await index.initialize()

    await index.indexPattern({
      id: "top_1",
      name: "High Strength",
      category: "plot_device",
      description: "High strength pattern",
      strength: 90,
      decay_rate: 0.1,
      last_reinforced: Date.now(),
      occurrences: 1,
      cross_story_valid: false,
    })

    await index.indexPattern({
      id: "top_2",
      name: "Low Strength",
      category: "plot_device",
      description: "Low strength pattern",
      strength: 30,
      decay_rate: 0.1,
      last_reinforced: Date.now(),
      occurrences: 1,
      cross_story_valid: false,
    })

    const top = await index.getTopPatterns(2)
    expect(top.length).toBe(2)
    expect(top[0].strength).toBeGreaterThanOrEqual(top[1].strength)
  })
})
