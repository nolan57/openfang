import { describe, test, expect, beforeEach } from "bun:test"
import { BranchManager, type Branch } from "../branch-manager"

describe("BranchManager", () => {
  let manager: BranchManager

  beforeEach(() => {
    manager = new BranchManager({ maxBranches: 5, minQualityThreshold: 4 })
  })

  const createBranch = (id: string, quality: number, chapter: number = 1): Branch => ({
    id,
    storySegment: `Story segment for ${id}`,
    branchPoint: "A decision point",
    choiceMade: `Choice for ${id}`,
    choiceRationale: "Rationale",
    stateAfter: {},
    evaluation: {
      narrativeQuality: quality,
      tensionLevel: 5,
      characterDevelopment: 5,
      plotProgression: 5,
      characterGrowth: 5,
      riskReward: 5,
      thematicRelevance: 5,
    },
    selected: false,
    chapter,
    events: [],
    structuredState: {},
  })

  test("addBranch stores branch", () => {
    const branch = createBranch("branch_1_0", 7)
    manager.addBranch(branch)

    const retrieved = manager.getBranch("branch_1_0")
    expect(retrieved).toBeDefined()
    expect(retrieved?.id).toBe("branch_1_0")
  })

  test("calculateBranchScore computes weighted score", () => {
    const branch = createBranch("test", 8)
    branch.evaluation = {
      narrativeQuality: 8,
      tensionLevel: 6,
      characterDevelopment: 7,
      plotProgression: 5,
      characterGrowth: 6,
      riskReward: 4,
      thematicRelevance: 7,
    }

    const score = manager.calculateBranchScore(branch)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(10)
  })

  test("pruneBranches removes low quality branches", () => {
    manager = new BranchManager({
      maxBranches: 3,
      minQualityThreshold: 5,
      pruneAfterChapters: 0,
    })

    for (let i = 0; i < 5; i++) {
      manager.addBranch(createBranch(`branch_${i}`, i < 2 ? 2 : 8, 1))
    }

    const pruned = manager.pruneBranches(1)

    expect(pruned.length).toBeGreaterThan(0)
    expect(pruned.every((b) => b.pruned)).toBe(true)
  })

  test("pruneBranches keeps selected branches", () => {
    manager = new BranchManager({
      maxBranches: 2,
      minQualityThreshold: 3,
      keepSelectedBranches: true,
      pruneAfterChapters: 0,
    })

    const selectedBranch = createBranch("selected", 2, 1)
    selectedBranch.selected = true
    manager.addBranch(selectedBranch)

    const highQualityBranch = createBranch("high", 9, 1)
    manager.addBranch(highQualityBranch)

    manager.pruneBranches(1)

    expect(manager.getBranch("selected")?.pruned).toBe(false)
  })

  test("detectSimilarBranches finds similar branches", () => {
    const branchA = createBranch("a", 7, 1)
    branchA.storySegment = "The hero walked into the dark forest and found a mysterious artifact"
    branchA.choiceMade = "Enter the forest"

    const branchB = createBranch("b", 7, 1)
    branchB.storySegment = "The hero walked into the dark forest and found a mysterious artifact"
    branchB.choiceMade = "Enter the forest"

    manager.addBranch(branchA)
    manager.addBranch(branchB)

    const similarities = manager.detectSimilarBranches(0.5)

    expect(similarities.length).toBeGreaterThan(0)
  })

  test("mergeBranches combines branches", () => {
    const branchA = createBranch("a", 5, 1)
    const branchB = createBranch("b", 8, 1)

    manager.addBranch(branchA)
    manager.addBranch(branchB)

    const result = manager.mergeBranches("a", "b")

    expect(result.merged).toBe(true)
    expect(manager.getBranch("a")?.mergedInto).toBe("b")
  })

  test("getStats returns correct statistics", () => {
    manager.addBranch(createBranch("a", 7, 1))
    manager.addBranch(createBranch("b", 5, 1))

    const stats = manager.getStats()

    expect(stats.total).toBe(2)
    expect(stats.active).toBe(2)
    expect(stats.avgScore).toBeGreaterThan(0)
  })

  test("getBranchPath returns path from root", () => {
    const root = createBranch("root", 7, 1)
    const child = createBranch("child", 6, 2)
    child.parentId = "root"

    manager.addBranch(root)
    manager.addBranch(child)

    const path = manager.getBranchPath("child")

    expect(path.length).toBe(2)
    expect(path[0].id).toBe("root")
    expect(path[1].id).toBe("child")
  })
})
