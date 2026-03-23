import { describe, test, expect } from "bun:test"
import { EvolutionRulesEngine } from "../evolution-rules"

describe("EvolutionRulesEngine", () => {
  test("rollChaos returns valid result", () => {
    const chaosEvent = EvolutionRulesEngine.rollChaos()

    expect(["positive", "negative", "neutral"]).toContain(chaosEvent.impact)
    expect(["static", "minor", "major"]).toContain(chaosEvent.magnitude)
    expect(chaosEvent.rollImpact).toBeGreaterThanOrEqual(1)
    expect(chaosEvent.rollImpact).toBeLessThanOrEqual(6)
    expect(chaosEvent.rollMagnitude).toBeGreaterThanOrEqual(1)
    expect(chaosEvent.rollMagnitude).toBeLessThanOrEqual(6)
  })

  test("enforceStressLimits caps stress", () => {
    const character = {
      stress: 120,
      trauma: [],
      skills: [],
      status: "active" as const,
      traits: [],
    }

    const result = EvolutionRulesEngine.enforceStressLimits(character)
    expect(character.stress).toBe(100)
    expect(result.breakdown).toBe(true)
  })

  test("enforceStressLimits marks stressed", () => {
    const character = {
      stress: 75,
      trauma: [],
      skills: [],
      status: "active" as const,
      traits: [],
    }

    const result = EvolutionRulesEngine.enforceStressLimits(character)
    expect(result.stressed).toBe(true)
    expect(result.breakdown).toBe(false)
  })

  test("generateTurnSummary produces markdown", () => {
    const chaosEvent = EvolutionRulesEngine.rollChaos()
    const summary = EvolutionRulesEngine.generateTurnSummary(
      {
        chapterCount: 1,
        characters: {},
        worldEvents: [],
        storySegment: "test",
      },
      {},
      chaosEvent,
    )

    expect(summary).toContain("# Turn 1 Evolution Summary")
    expect(summary).toContain("## 🎲 Chaos Event")
    expect(summary).toContain("## 📈 State Changes")
  })
})
