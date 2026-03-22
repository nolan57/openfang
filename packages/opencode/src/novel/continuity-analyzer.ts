import { generateText } from "ai"
import { getNovelLanguageModel } from "./model"
import { Log } from "../util/log"
import type { VisualPanelSpec } from "./types"

const log = Log.create({ service: "continuity-analyzer" })

/**
 * Continuity analysis result from LLM
 */
export interface ContinuityAnalysis {
  /** Time continuity information */
  timeContext: {
    /** Is this scene continuous with the previous one? */
    isContinuousWithPrevious: boolean
    /** How much time has passed */
    timePassed: "immediately" | "minutes" | "hours" | "days" | "weeks" | "unknown"
    /** Did sleep occur? (important for outfit change) */
    sleepOccurred: boolean
    /** Explicit time markers found in text */
    explicitTimeMarkers: string[]
  }

  /** Location continuity information */
  locationContext: {
    /** Is the character in the same place? */
    isSameLocation: boolean
    /** Current location description */
    locationDescription: string
    /** Location type (office, home, street, etc.) */
    locationType: string
    /** Explicit location markers found in text */
    explicitLocationMarkers: string[]
  }

  /** Narrative context affecting outfit */
  narrativeContext: {
    /** Did the character explicitly change clothes? */
    outfitChangeMentioned: boolean
    /** Description of the outfit change if mentioned */
    outfitChangeDescription: string | null
    /** Significant events that might affect outfit */
    significantEvents: string[]
    /** Character's current state (calm, rushed, injured, etc.) */
    characterState: string
  }

  /** LLM's judgement and reasoning */
  llmJudgement: {
    /** Should the outfit be maintained from previous panel? */
    shouldMaintainOutfit: boolean
    /** Confidence level (0-1) */
    confidence: number
    /** Reasoning for the decision */
    reasoning: string
    /** Description of what the character should wear */
    outfitDescription: string
  }
}

/**
 * Context for continuity analysis
 */
export interface ContinuityContext {
  /** Previous story segment (if exists) */
  previousSegment: string | null
  /** Previous panels for visual reference */
  previousPanels: VisualPanelSpec[]
  /** Chapter context */
  chapterContext: {
    chapterCount: number
    totalPanelsGenerated: number
  }
}

/**
 * LLM-based continuity analyzer for visual panel generation.
 * Analyzes story segments to determine character outfit consistency.
 */
export class ContinuityAnalyzer {
  private systemPrompt: string

  constructor() {
    this.systemPrompt = `You are a continuity analyst for visual novel panel generation.
Your task is to analyze story segments and determine character outfit consistency across panels.

## Key Questions to Answer:

### 1. TIME CONTINUITY
- Is this scene continuous with the previous one?
- How much time has passed? (immediately, minutes, hours, days)
- Did the character sleep? (critical for outfit change)
- Look for explicit time markers: "第二天", "当晚", "meanwhile", "suddenly"

### 2. LOCATION CONTINUITY
- Is the character in the same place?
- Same building? Same room?
- Look for explicit location markers: "回到家", "到达办公室", "went home"

### 3. OUTFIT CHANGE INDICATORS
**High confidence outfit change triggers:**
- Explicit: "换上", "穿上", "changed into", "put on"
- Location-based: "回家" + time passed, "到家后"
- Hygiene: "洗澡", "shower", "洗漱"
- Time-based: "睡觉", "went to bed", "第二天", "woke up"
- Event-based: "宴会", "ceremony", "formal event"

**Low confidence (may not change):**
- Short time passage (< 1 hour)
- Same location, no break
- Urgent/emergency situations
- Outdoor continuous scenes

### 4. NARRATIVE LOGIC
Use common sense:
- Detective working late at office → same clothes
- Character went home and slept → changed clothes
- Rushed from meeting to event → same clothes
- Morning after → different clothes

## Output Format (JSON only):

{
  "timeContext": {
    "isContinuousWithPrevious": boolean,
    "timePassed": "immediately|minutes|hours|days|weeks|unknown",
    "sleepOccurred": boolean,
    "explicitTimeMarkers": ["marker1", "marker2"]
  },
  "locationContext": {
    "isSameLocation": boolean,
    "locationDescription": "description of current location",
    "locationType": "office|home|street|restaurant|etc",
    "explicitLocationMarkers": ["marker1", "marker2"]
  },
  "narrativeContext": {
    "outfitChangeMentioned": boolean,
    "outfitChangeDescription": "description if mentioned, null otherwise",
    "significantEvents": ["event1", "event2"],
    "characterState": "calm|rushed|injured|tired|etc"
  },
  "llmJudgement": {
    "shouldMaintainOutfit": boolean,
    "confidence": 0.0-1.0,
    "reasoning": "Explain your reasoning in 1-2 sentences",
    "outfitDescription": "Describe what the character should wear"
  }
}

## Guidelines:
- Be conservative: if unsure, maintain outfit consistency
- Prioritize explicit mentions over implied changes
- Consider narrative urgency (emergency = no time to change)
- Sleep = almost always outfit change
- Same scene, continuous time = maintain outfit`
  }

  /**
   * Analyzes continuity between story segments
   */
  async analyze(currentSegment: string, context: ContinuityContext): Promise<ContinuityAnalysis> {
    const hasPrevious = context.previousSegment !== null && context.previousSegment.length > 0
    const hasPreviousPanels = context.previousPanels.length > 0

    // Build user prompt with context
    const userPrompt = this.buildUserPrompt(currentSegment, context)

    try {
      const languageModel = await getNovelLanguageModel()

      const result = await generateText({
        model: languageModel,
        system: this.systemPrompt,
        prompt: userPrompt,
        temperature: 0.3, // Low temperature for consistent analysis
      })

      // Parse JSON response
      const text = result.text.trim()
      const jsonMatch = text.match(/\{[\s\S]*\}/)

      if (!jsonMatch) {
        log.warn("continuity_analysis_no_json", { response: text.slice(0, 200) })
        return this.createFallbackAnalysis(currentSegment, hasPrevious, hasPreviousPanels)
      }

      const analysis: ContinuityAnalysis = JSON.parse(jsonMatch[0])

      // Validate analysis
      if (!this.validateAnalysis(analysis)) {
        log.warn("continuity_analysis_invalid", { analysis })
        return this.createFallbackAnalysis(currentSegment, hasPrevious, hasPreviousPanels)
      }

      log.info("continuity_analyzed", {
        isContinuous: analysis.timeContext.isContinuousWithPrevious,
        sameLocation: analysis.locationContext.isSameLocation,
        shouldMaintainOutfit: analysis.llmJudgement.shouldMaintainOutfit,
        confidence: analysis.llmJudgement.confidence,
      })

      return analysis
    } catch (error) {
      log.error("continuity_analysis_failed", { error: String(error) })
      return this.createFallbackAnalysis(currentSegment, hasPrevious, hasPreviousPanels)
    }
  }

  /**
   * Builds the user prompt for continuity analysis
   */
  private buildUserPrompt(currentSegment: string, context: ContinuityContext): string {
    const parts: string[] = []

    // Previous context
    if (context.previousSegment) {
      parts.push(`=== PREVIOUS PANEL CONTEXT ===`)
      parts.push(`Story: ${context.previousSegment.substring(0, 400)}`)

      if (context.previousPanels.length > 0) {
        const lastPanel = context.previousPanels[context.previousPanels.length - 1]
        parts.push(`\nPrevious Outfit: ${lastPanel.character?.outfitDetails || "Not specified"}`)
        parts.push(`Previous Location: ${lastPanel.beat?.location || "Not specified"}`)
        parts.push(`Previous Time: ${lastPanel.beat?.timeOfDay || "Not specified"}`)
        parts.push(`Previous Character State: ${lastPanel.character?.emotionalState || "Not specified"}`)
      }
    } else {
      parts.push(`=== FIRST PANEL ===`)
      parts.push("This is the first panel, no previous context.")
    }

    // Current segment
    parts.push(`\n\n=== CURRENT SEGMENT ===`)
    parts.push(currentSegment.substring(0, 600))

    // Instruction
    parts.push(`\n\nAnalyze continuity and determine if character outfit should be maintained or changed.`)

    return parts.join("\n")
  }

  /**
   * Validates the analysis result
   */
  private validateAnalysis(analysis: ContinuityAnalysis): boolean {
    // Check required fields
    if (!analysis.timeContext || !analysis.locationContext || !analysis.narrativeContext || !analysis.llmJudgement) {
      return false
    }

    // Check confidence is in valid range
    if (analysis.llmJudgement.confidence < 0 || analysis.llmJudgement.confidence > 1) {
      return false
    }

    // Check timePassed is valid enum
    const validTimePassed = ["immediately", "minutes", "hours", "days", "weeks", "unknown"]
    if (!validTimePassed.includes(analysis.timeContext.timePassed)) {
      return false
    }

    return true
  }

  /**
   * Creates a fallback analysis when LLM fails
   */
  private createFallbackAnalysis(
    currentSegment: string,
    hasPrevious: boolean,
    hasPreviousPanels: boolean,
  ): ContinuityAnalysis {
    // Conservative fallback: maintain outfit if we have previous context
    const shouldMaintain = hasPrevious && hasPreviousPanels

    return {
      timeContext: {
        isContinuousWithPrevious: hasPrevious,
        timePassed: "unknown",
        sleepOccurred: false,
        explicitTimeMarkers: [],
      },
      locationContext: {
        isSameLocation: hasPrevious,
        locationDescription: "Unknown",
        locationType: "unknown",
        explicitLocationMarkers: [],
      },
      narrativeContext: {
        outfitChangeMentioned: false,
        outfitChangeDescription: null,
        significantEvents: [],
        characterState: "unknown",
      },
      llmJudgement: {
        shouldMaintainOutfit: shouldMaintain,
        confidence: 0.5,
        reasoning: "Fallback analysis: maintaining outfit for consistency",
        outfitDescription: shouldMaintain ? "Same as previous panel" : "Not specified",
      },
    }
  }

  /**
   * Extracts continuity instruction for prompt engineering
   */
  extractInstruction(analysis: ContinuityAnalysis): string {
    if (analysis.llmJudgement.shouldMaintainOutfit) {
      return `[OUTFIT CONSISTENCY: MAINTAIN EXACT SAME OUTFIT AS PREVIOUS PANEL - ${analysis.llmJudgement.reasoning}]`
    } else {
      return `[OUTFIT CHANGE: ${analysis.llmJudgement.outfitDescription || "New outfit based on context"} - ${analysis.llmJudgement.reasoning}]`
    }
  }

  /**
   * Creates a summary for debugging/logging
   */
  summarize(analysis: ContinuityAnalysis): string {
    const time = analysis.timeContext.timePassed
    const location = analysis.locationContext.isSameLocation ? "same location" : "different location"
    const outfit = analysis.llmJudgement.shouldMaintainOutfit ? "MAINTAIN outfit" : "CHANGE outfit"
    const confidence = Math.round(analysis.llmJudgement.confidence * 100)

    return `Continuity: ${time}, ${location} → ${outfit} (${confidence}% confidence)`
  }
}
