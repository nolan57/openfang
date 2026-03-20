import { describe, test, expect, beforeEach } from "bun:test"
import { StoryWorldMemory } from "../story-world-memory"

describe("StoryWorldMemory", () => {
  let memory: StoryWorldMemory

  beforeEach(async () => {
    memory = new StoryWorldMemory()
    await memory.initialize()
    await memory.clear()
  })

  test("initializes database", async () => {
    const stats = await memory.getStats()
    expect(stats).toBeDefined()
    expect(typeof stats.total).toBe("number")
  })

  test("storeMemory stores memory entry", async () => {
    const entry = await memory.storeMemory({
      level: "scene",
      content: "Alice meets Bob in the tavern",
      chapter: 1,
      scene: 1,
      characters: ["Alice", "Bob"],
      locations: ["Tavern"],
      events: ["Meeting"],
      themes: ["Friendship"],
      significance: 7,
      parent_id: null,
    })

    expect(entry.id).toBeDefined()
    expect(entry.content).toBe("Alice meets Bob in the tavern")
  })

  test("storeChapterSummary stores chapter summary", async () => {
    const entry = await memory.storeChapterSummary(
      1,
      "Alice begins her journey",
      ["Alice"],
      ["Village"],
      ["Departure"],
      ["Hero's journey"],
    )

    expect(entry.level).toBe("chapter")
    expect(entry.chapter).toBe(1)
  })

  test("storeSceneSummary stores scene summary", async () => {
    const entry = await memory.storeSceneSummary(
      1,
      1,
      "Alice packs her bags",
      ["Alice"],
      ["Home"],
      ["Preparation"],
      undefined,
    )

    expect(entry.level).toBe("scene")
    expect(entry.scene).toBe(1)
  })

  test("getMemoriesByLevel returns memories", async () => {
    await memory.storeMemory({
      level: "chapter",
      content: "Chapter 1",
      chapter: 1,
      characters: [],
      locations: [],
      events: [],
      themes: [],
      significance: 5,
      parent_id: null,
    })

    const memories = await memory.getMemoriesByLevel("chapter")
    expect(memories.length).toBeGreaterThan(0)
  })

  test("getMemoriesByChapter returns memories", async () => {
    await memory.storeMemory({
      level: "scene",
      content: "Scene in chapter 2",
      chapter: 2,
      characters: ["Alice"],
      locations: [],
      events: [],
      themes: [],
      significance: 5,
      parent_id: null,
    })

    const memories = await memory.getMemoriesByChapter(2)
    expect(memories.length).toBeGreaterThan(0)
  })

  test("getMemoriesByCharacter returns memories", async () => {
    await memory.storeMemory({
      level: "scene",
      content: "Alice's adventure",
      chapter: 1,
      characters: ["Alice", "Bob"],
      locations: [],
      events: [],
      themes: [],
      significance: 5,
      parent_id: null,
    })

    const memories = await memory.getMemoriesByCharacter("Alice")
    expect(memories.length).toBeGreaterThan(0)
  })

  test("getMemoryHierarchy returns hierarchical structure", async () => {
    await memory.storeChapterSummary(1, "Chapter summary", ["Alice"], [], [], [])

    const hierarchy = await memory.getMemoryHierarchy(1)
    expect(hierarchy.chapters.length).toBeGreaterThan(0)
  })

  test("getRecentContext returns context", async () => {
    await memory.storeChapterSummary(5, "Recent chapter", ["Alice", "Bob"], [], [], ["Theme1"])

    const context = await memory.getRecentContext(5, 2)
    expect(context.summary).toBeDefined()
    expect(context.characters).toContain("Alice")
  })

  test("updateMemorySignificance updates significance", async () => {
    const entry = await memory.storeMemory({
      level: "scene",
      content: "Test",
      chapter: 1,
      characters: [],
      locations: [],
      events: [],
      themes: [],
      significance: 5,
      parent_id: null,
    })

    const updated = await memory.updateMemorySignificance(entry.id, 9)
    expect(updated).toBe(true)
  })

  test("deleteMemory removes memory", async () => {
    const entry = await memory.storeMemory({
      level: "scene",
      content: "To delete",
      chapter: 1,
      characters: [],
      locations: [],
      events: [],
      themes: [],
      significance: 5,
      parent_id: null,
    })

    const deleted = await memory.deleteMemory(entry.id)
    expect(deleted).toBe(true)
  })

  test("getStats returns statistics", async () => {
    await memory.storeMemory({
      level: "chapter",
      content: "Test",
      chapter: 1,
      characters: [],
      locations: [],
      events: [],
      themes: [],
      significance: 5,
      parent_id: null,
    })

    const stats = await memory.getStats()
    expect(stats.total).toBeGreaterThan(0)
  })

  test("exportToJson and importFromJson", async () => {
    await memory.storeMemory({
      level: "scene",
      content: "Export test",
      chapter: 1,
      characters: [],
      locations: [],
      events: [],
      themes: [],
      significance: 5,
      parent_id: null,
    })

    const exported = await memory.exportToJson()
    expect(exported.length).toBeGreaterThan(0)

    await memory.clear()
    const imported = await memory.importFromJson(exported)
    expect(imported).toBe(exported.length)
  })
})
