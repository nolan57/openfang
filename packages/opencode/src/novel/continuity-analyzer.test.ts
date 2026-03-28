import { describe, test, expect, beforeEach } from "bun:test"
import { ContinuityAnalyzer, type ContinuityAnalysis } from "./continuity-analyzer"
import { loadVisualConfig } from "./config"
import type { VisualPanelSpec } from "./types"

describe("ContinuityAnalyzer", () => {
  let analyzer: ContinuityAnalyzer

  beforeEach(async () => {
    // Load config before creating analyzer
    await loadVisualConfig()
    analyzer = new ContinuityAnalyzer()
  })

  const createMockPanel = (outfit: string, location: string, timeOfDay: string): VisualPanelSpec => ({
    id: "test-panel-1",
    panelIndex: 0,
    camera: {
      shot: "medium",
      angle: "eye-level",
      movement: "static",
      depthOfField: "shallow",
    },
    lighting: "natural",
    composition: "rule-of-thirds",
    visualPrompt: "test prompt",
    negativePrompt: "test negative",
    controlNetSignals: {
      poseReference: null,
      depthReference: null,
      characterRefUrl: null,
    },
    styleModifiers: [],
    character: {
      name: "Lin Mo",
      emotionalState: "tired",
      outfitDetails: outfit,
      injuryDetails: "none",
    },
    beat: {
      location,
      timeOfDay,
      description: "test beat",
    },
  })

  describe("analyze", () => {
    test("should return valid analysis structure", async () => {
      const currentSegment = `林默继续审问嫌疑人。他的眼神锐利，手中的笔记本已经写满了问题。`

      const previousPanel = createMockPanel("灰色西装，白色衬衫", "office", "night")

      const result = await analyzer.analyze(currentSegment, {
        previousSegment: "林默坐在办公室里，审视着桌上的文件。灰色的西装有些皱褶，但他毫不在意。",
        previousPanels: [previousPanel],
        chapterContext: {
          chapterCount: 1,
          totalPanelsGenerated: 1,
        },
      })

      expect(result).toBeDefined()
      expect(result.timeContext).toBeDefined()
      expect(result.locationContext).toBeDefined()
      expect(result.narrativeContext).toBeDefined()
      expect(result.llmJudgement).toBeDefined()
      expect(result.llmJudgement.confidence).toBeGreaterThanOrEqual(0)
      expect(result.llmJudgement.confidence).toBeLessThanOrEqual(1)
    })

    test("should handle first panel (no previous context)", async () => {
      const currentSegment = "林默站在犯罪现场，仔细观察周围的环境。这是他的新案子。"

      const result = await analyzer.analyze(currentSegment, {
        previousSegment: null,
        previousPanels: [],
        chapterContext: {
          chapterCount: 1,
          totalPanelsGenerated: 0,
        },
      })

      expect(result).toBeDefined()
      // First panel should use fallback
      expect(result.llmJudgement.confidence).toBeLessThanOrEqual(0.5)
    })

    test("should use fallback when LLM fails", async () => {
      const currentSegment = "Test segment"

      const result = await analyzer.analyze(currentSegment, {
        previousSegment: "Previous segment",
        previousPanels: [createMockPanel("outfit", "location", "day")],
        chapterContext: {
          chapterCount: 1,
          totalPanelsGenerated: 1,
        },
      })

      expect(result).toBeDefined()
      expect(result.llmJudgement).toBeDefined()
    })
  })

  describe("extractInstruction", () => {
    test("should generate maintain instruction", () => {
      const analysis: ContinuityAnalysis = {
        timeContext: {
          isContinuousWithPrevious: true,
          timePassed: "minutes",
          sleepOccurred: false,
          explicitTimeMarkers: [],
        },
        locationContext: {
          isSameLocation: true,
          locationDescription: "office",
          locationType: "office",
          explicitLocationMarkers: [],
        },
        narrativeContext: {
          outfitChangeMentioned: false,
          outfitChangeDescription: null,
          significantEvents: [],
          characterState: "focused",
        },
        llmJudgement: {
          shouldMaintainOutfit: true,
          confidence: 0.9,
          reasoning: "Same scene, continuous time, no outfit change mentioned",
          outfitDescription: "grey suit, white shirt",
        },
      }

      const instruction = analyzer.extractInstruction(analysis)

      expect(instruction).toContain("MAINTAIN")
      expect(instruction).toContain("SAME OUTFIT")
    })

    test("should generate change instruction", () => {
      const analysis: ContinuityAnalysis = {
        timeContext: {
          isContinuousWithPrevious: false,
          timePassed: "days",
          sleepOccurred: true,
          explicitTimeMarkers: ["第二天"],
        },
        locationContext: {
          isSameLocation: false,
          locationDescription: "police station locker room",
          locationType: "locker_room",
          explicitLocationMarkers: ["警局"],
        },
        narrativeContext: {
          outfitChangeMentioned: true,
          outfitChangeDescription: "changed into fresh uniform",
          significantEvents: ["new day", "shift change"],
          characterState: "refreshed",
        },
        llmJudgement: {
          shouldMaintainOutfit: false,
          confidence: 0.95,
          reasoning: "New day, slept, explicit outfit change",
          outfitDescription: "fresh police uniform",
        },
      }

      const instruction = analyzer.extractInstruction(analysis)

      expect(instruction).toContain("OUTFIT CHANGE")
      expect(instruction).not.toContain("MAINTAIN")
    })
  })

  describe("summarize", () => {
    test("should create readable summary", () => {
      const analysis: ContinuityAnalysis = {
        timeContext: {
          isContinuousWithPrevious: true,
          timePassed: "minutes",
          sleepOccurred: false,
          explicitTimeMarkers: [],
        },
        locationContext: {
          isSameLocation: true,
          locationDescription: "office",
          locationType: "office",
          explicitLocationMarkers: [],
        },
        narrativeContext: {
          outfitChangeMentioned: false,
          outfitChangeDescription: null,
          significantEvents: [],
          characterState: "focused",
        },
        llmJudgement: {
          shouldMaintainOutfit: true,
          confidence: 0.85,
          reasoning: "Same scene, continuous time",
          outfitDescription: "grey suit",
        },
      }

      const summary = analyzer.summarize(analysis)

      expect(summary).toContain("minutes")
      expect(summary).toContain("same location")
      expect(summary).toContain("MAINTAIN outfit")
      expect(summary).toContain("85%")
    })
  })
})
