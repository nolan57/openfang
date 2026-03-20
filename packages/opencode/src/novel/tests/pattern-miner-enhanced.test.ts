import { describe, test, expect, beforeEach } from "bun:test"
import { EnhancedPatternMiner } from "../pattern-miner-enhanced"

describe("EnhancedPatternMiner", () => {
  let miner: EnhancedPatternMiner

  beforeEach(() => {
    miner = new EnhancedPatternMiner()
  })

  test("initializes with empty patterns", () => {
    const stats = miner.getStats()
    expect(stats.patterns).toBe(0)
    expect(stats.archetypes).toBe(0)
    expect(stats.templates).toBe(0)
    expect(stats.motifs).toBe(0)
  })

  test("getActiveArchetypes returns empty array when no archetypes", () => {
    const archetypes = miner.getActiveArchetypes()
    expect(archetypes).toEqual([])
  })

  test("getActiveMotifs returns empty array when no motifs", () => {
    const motifs = miner.getActiveMotifs()
    expect(motifs).toEqual([])
  })

  test("getPlotTemplates returns empty array when no templates", () => {
    const templates = miner.getPlotTemplates()
    expect(templates).toEqual([])
  })

  test("getArchetypeReport generates empty report", () => {
    const report = miner.getArchetypeReport()
    expect(report).toContain("Character Archetypes Report")
  })

  test("getMotifEvolutionReport generates empty report", () => {
    const report = miner.getMotifEvolutionReport()
    expect(report).toContain("Motif Evolution Report")
  })

  test("clear removes all patterns", () => {
    miner.clear()
    const stats = miner.getStats()
    expect(stats.patterns).toBe(0)
    expect(stats.archetypes).toBe(0)
    expect(stats.templates).toBe(0)
    expect(stats.motifs).toBe(0)
  })
})
