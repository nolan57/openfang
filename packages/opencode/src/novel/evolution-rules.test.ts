import { describe, test, expect } from "bun:test"
import { EvolutionRulesEngine } from "./evolution-rules"

describe("EvolutionRulesEngine", () => {
  test("rollChaos returns valid result", () => {
    const result = EvolutionRulesEngine.rollChaos()
    expect(result.roll).toBeGreaterThanOrEqual(1)
    expect(result.roll).toBeLessThanOrEqual(6)
    expect(result.description).toBeDefined()
    expect(result.category).toBeDefined()
  })

  test("checkSkillUnlocks detects technical breakthrough", () => {
    const context = {
      chapterCount: 1,
      characters: {
        TestChar: {
          stress: 50,
          trauma: [],
          skills: [],
          status: "active",
          traits: [],
        },
      },
      worldEvents: [],
      storySegment: "TestChar成功破解了系统，获取了关键数据",
    }

    const awards = EvolutionRulesEngine.checkSkillUnlocks(context)
    expect(awards.length).toBeGreaterThan(0)
    expect(awards[0].characterName).toBe("TestChar")
  })

  test("checkTraumaTriggers on high stress", () => {
    const context = {
      chapterCount: 1,
      characters: {
        TestChar: {
          stress: 95,
          trauma: [],
          skills: [],
          status: "active",
          traits: [],
        },
      },
      worldEvents: [],
      storySegment: "压力持续累积",
    }

    const awards = EvolutionRulesEngine.checkTraumaTriggers(context)
    expect(awards.length).toBeGreaterThan(0)
    expect(awards[0].trauma.severity).toBeGreaterThanOrEqual(1)
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
