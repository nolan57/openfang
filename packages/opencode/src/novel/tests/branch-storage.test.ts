import { describe, test, expect, beforeEach } from "bun:test"
import { BranchStorage } from "../branch-storage"
import type { Branch } from "../branch-manager"

describe("BranchStorage", () => {
  let storage: BranchStorage

  beforeEach(async () => {
    storage = new BranchStorage()
    await storage.initialize()
    await storage.clear()
  })

  const createBranch = (id: string, chapter: number = 1): Branch => ({
    id,
    storySegment: `Story for ${id}`,
    branchPoint: "Decision point",
    choiceMade: `Choice ${id}`,
    choiceRationale: "Rationale",
    stateAfter: { test: true },
    evaluation: {
      narrativeQuality: 7,
      tensionLevel: 5,
      characterDevelopment: 6,
      plotProgression: 5,
      characterGrowth: 6,
      riskReward: 5,
      thematicRelevance: 6,
    },
    selected: false,
    createdAt: Date.now(),
    chapter,
    events: [],
    structuredState: {},
  })

  test("initializes database", async () => {
    await storage.initialize()
    const stats = await storage.getStats()
    expect(stats).toBeDefined()
    expect(typeof stats.total).toBe("number")
  })

  test("saveBranch and loadBranch", async () => {
    await storage.initialize()

    const branch = createBranch("test_branch_1")
    await storage.saveBranch(branch)

    const loaded = await storage.loadBranch("test_branch_1")

    expect(loaded).toBeDefined()
    expect(loaded?.id).toBe("test_branch_1")
    expect(loaded?.choiceMade).toBe("Choice test_branch_1")
  })

  test("loadBranchesByChapter", async () => {
    await storage.initialize()

    await storage.saveBranch(createBranch("branch_1_1", 1))
    await storage.saveBranch(createBranch("branch_1_2", 1))
    await storage.saveBranch(createBranch("branch_2_1", 2))

    const chapter1 = await storage.loadBranchesByChapter(1)
    const chapter2 = await storage.loadBranchesByChapter(2)

    expect(chapter1.length).toBe(2)
    expect(chapter2.length).toBe(1)
  })

  test("updateBranch", async () => {
    await storage.initialize()

    const branch = createBranch("update_test")
    await storage.saveBranch(branch)

    await storage.updateBranch("update_test", { selected: true, pruned: true })

    const loaded = await storage.loadBranch("update_test")
    expect(loaded?.selected).toBe(true)
    expect(loaded?.pruned).toBe(true)
  })

  test("deleteBranch", async () => {
    await storage.initialize()

    const branch = createBranch("delete_test")
    await storage.saveBranch(branch)

    const deleted = await storage.deleteBranch("delete_test")
    expect(deleted).toBe(true)

    const loaded = await storage.loadBranch("delete_test")
    expect(loaded).toBeNull()
  })

  test("getStats", async () => {
    await storage.initialize()

    await storage.saveBranch(createBranch("stat_1"))
    await storage.saveBranch(createBranch("stat_2"))

    const selectedBranch = createBranch("stat_3")
    selectedBranch.selected = true
    await storage.saveBranch(selectedBranch)

    const stats = await storage.getStats()

    expect(stats.total).toBe(3)
    expect(stats.selected).toBe(1)
  })

  test("exportToJson and importFromJson", async () => {
    await storage.initialize()

    await storage.saveBranch(createBranch("export_1"))
    await storage.saveBranch(createBranch("export_2"))

    const exported = await storage.exportToJson()
    expect(exported.length).toBe(2)

    await storage.clear()

    const imported = await storage.importFromJson(exported)
    expect(imported).toBe(2)
  })
})
