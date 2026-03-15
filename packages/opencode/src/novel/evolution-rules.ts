import { Log } from "../util/log"
import { generateText } from "ai"
import { TRAUMA_TAGS, SKILL_CATEGORIES, CHARACTER_STATUS } from "./types"
import { getNovelLanguageModel } from "./model"
import { createPromptBuilder, type StoryTone } from "./dynamic-prompt"
import { novelConfigManager } from "./novel-config"

const log = Log.create({ service: "evolution-rules" })

interface CharacterState {
  stress: number
  trauma: any[]
  skills: any[]
  status: string
  traits: string[]
}

interface EvolutionContext {
  chapterCount: number
  characters: Record<string, CharacterState>
  worldEvents: string[]
  storySegment: string
}

interface SkillAward {
  characterName: string
  skill: {
    name: string
    category: string
    level: number
    description: string
  }
  reason: string
}

interface TraumaAward {
  characterName: string
  trauma: {
    description: string
    tags: string[]
    severity: number
  }
  reason: string
}

export interface ChaosEvent {
  rollImpact: number // 1-6: 影响方向
  rollMagnitude: number // 1-6: 变化幅度
  impact: "positive" | "negative" | "neutral"
  magnitude: "static" | "minor" | "major"
  narrativeDirection: string // LLM 生成的方向描述
  generatedEvent?: string // LLM 生成的具体事件
}

const IMPACT_LABELS: Record<number, ChaosEvent["impact"]> = {
  1: "negative",
  2: "negative",
  3: "neutral",
  4: "neutral",
  5: "positive",
  6: "positive",
}

const MAGNITUDE_LABELS: Record<number, ChaosEvent["magnitude"]> = {
  1: "static",
  2: "static",
  3: "minor",
  4: "minor",
  5: "major",
  6: "major",
}

export class EvolutionRulesEngine {
  private static readonly STRESS_DELTA_LARGE = 20
  private static readonly DIFFICULTY_THRESHOLD_HIGH = 7

  /**
   * 掷双骰子决定混乱事件
   * @returns 包含影响方向和变化幅度的混乱事件
   */
  static rollChaos(): ChaosEvent {
    const rollImpact = Math.floor(Math.random() * 6) + 1
    const rollMagnitude = Math.floor(Math.random() * 6) + 1

    const impact = IMPACT_LABELS[rollImpact]
    const magnitude = MAGNITUDE_LABELS[rollMagnitude]

    log.info("chaos_rolled", { rollImpact, rollMagnitude, impact, magnitude })

    return {
      rollImpact,
      rollMagnitude,
      impact,
      magnitude,
      narrativeDirection: `${impact.toUpperCase()} impact, ${magnitude} change`,
    }
  }

  /**
   * 基于 LLM 动态生成混乱事件
   * 完全由 LLM 根据故事状态决定具体发生什么
   * @param chaosEvent - 基础混乱事件（包含抽象维度）
   * @param storyContext - 当前故事上下文
   * @param storyTone - 故事原初基调（可选）
   * @returns 带有具体事件的混乱事件
   */
  static async generateChaosEventWithLLM(
    chaosEvent: ChaosEvent,
    storyContext: {
      currentStory: string
      characters: string[]
      recentEvents: string[]
      themes?: string[]
    },
    storyTone?: StoryTone,
  ): Promise<ChaosEvent> {
    try {
      const config = novelConfigManager.getConfig()
      const promptBuilder = createPromptBuilder("chaosEvent", config.promptStyle)

      if (storyTone) {
        promptBuilder.withTone(storyTone)
      }

      const impactLabel =
        chaosEvent.impact === "positive"
          ? "POSITIVE (Something beneficial occurs)"
          : chaosEvent.impact === "negative"
            ? "NEGATIVE (Something harmful occurs)"
            : "NEUTRAL (Something neither clearly good nor bad occurs)"

      const magnitudeLabel =
        chaosEvent.magnitude === "major"
          ? "MAJOR (Significant change that alters the situation)"
          : chaosEvent.magnitude === "minor"
            ? "MINOR (Small but noticeable change)"
            : "STATIC (Minimal change, status quo maintained)"

      const prompt = promptBuilder
        .withVariables({
          IMPACT: impactLabel,
          MAGNITUDE: magnitudeLabel,
          STORY_CONTEXT: storyContext.currentStory.substring(0, 1500),
          CHARACTERS: storyContext.characters.join(", "),
          RECENT_EVENTS: storyContext.recentEvents.join("\n") || "None",
        })
        .build()

      const languageModel = await getNovelLanguageModel()

      const result = await generateText({
        model: languageModel,
        prompt,
      })

      chaosEvent.narrativeDirection =
        chaosEvent.impact === "positive"
          ? `正向影响 (${chaosEvent.magnitude})`
          : chaosEvent.impact === "negative"
            ? `负向影响 (${chaosEvent.magnitude})`
            : `中性影响 (${chaosEvent.magnitude})`

      chaosEvent.generatedEvent = result.text.trim()

      log.info("chaos_event_generated", {
        rollImpact: chaosEvent.rollImpact,
        rollMagnitude: chaosEvent.rollMagnitude,
        impact: chaosEvent.impact,
        magnitude: chaosEvent.magnitude,
        hasGeneratedEvent: !!chaosEvent.generatedEvent,
      })
    } catch (error) {
      log.warn("chaos_event_generation_failed", { error: String(error) })
      chaosEvent.generatedEvent = `${chaosEvent.impact} impact, ${chaosEvent.magnitude} change (LLM failed)`
    }

    return chaosEvent
  }

  static async checkStateChanges(
    context: EvolutionContext,
    storyTone?: StoryTone,
  ): Promise<{ skills: SkillAward[]; traumas: TraumaAward[] }> {
    const storyText = context.storySegment

    if (storyText.length < 20) {
      return { skills: [], traumas: [] }
    }

    try {
      const config = novelConfigManager.getConfig()
      const promptBuilder = createPromptBuilder("stateEvaluation", config.promptStyle)

      if (storyTone) {
        promptBuilder.withTone(storyTone)
      }

      const prompt = promptBuilder.withVariables({ STORY_SEGMENT: storyText }).build()

      const languageModel = await getNovelLanguageModel()

      const result = await generateText({
        model: languageModel,
        prompt,
      })

      const match = result.text.match(/\{[\s\S]*\}/)
      if (!match) {
        log.warn("llm_no_json_in_response")
        return { skills: [], traumas: [] }
      }

      const evaluation = JSON.parse(match[0])

      const skillAwards: SkillAward[] = (evaluation.skill_awards || []).map((award: any) => ({
        characterName: award.character_name,
        skill: {
          name: award.skill_name || this.generateSkillNameFromCategory(award.skill_category, award.reason_in_story),
          category: this.normalizeSkillCategory(award.skill_category),
          level: 1,
          description: `In Chapter ${context.chapterCount}: ${award.reason_in_story}`,
        },
        reason: "LLM semantic analysis",
      }))

      const traumaAwards: TraumaAward[] = (evaluation.trauma_awards || []).map((award: any) => ({
        characterName: award.character_name,
        trauma: {
          description: award.trauma_name || `Trauma from: ${award.reason_in_story}`,
          tags: award.trauma_tags || ["Psychological"],
          severity: award.severity || this.calculateTraumaSeverityFromTags(award.trauma_tags || []),
        },
        reason: "LLM semantic analysis",
      }))

      // Use config thresholds instead of hard-coded values
      const difficulty = novelConfigManager.getDifficultyPreset()
      const STRESS_THRESHOLD_CRITICAL = difficulty.stressThresholds.critical
      const STRESS_THRESHOLD_HIGH = difficulty.stressThresholds.high

      for (const [charName, char] of Object.entries(context.characters)) {
        if (char.stress >= STRESS_THRESHOLD_CRITICAL) {
          traumaAwards.push({
            characterName: charName,
            trauma: {
              description: `Cumulative stress exceeded critical threshold (${char.stress}/100), psychological breakdown`,
              tags: [TRAUMA_TAGS.PSYCHOLOGICAL_FEAR, TRAUMA_TAGS.PSYCHOLOGICAL_GUILT],
              severity: 8,
            },
            reason: `Stress level reached ${char.stress}`,
          })
        }
      }

      if (skillAwards.length > 0 || traumaAwards.length > 0) {
        log.info("llm_state_evaluation_complete", {
          skills: skillAwards.length,
          traumas: traumaAwards.length,
        })
      }

      return { skills: skillAwards, traumas: traumaAwards }
    } catch (error) {
      log.error("llm_state_evaluation_failed", { error: String(error) })
      return { skills: [], traumas: [] }
    }
  }

  static enforceStressLimits(character: CharacterState): { stressed: boolean; breakdown: boolean } {
    const result = { stressed: false, breakdown: false }

    // Use config thresholds
    const difficulty = novelConfigManager.getDifficultyPreset()
    const STRESS_THRESHOLD_CRITICAL = difficulty.stressThresholds.critical
    const STRESS_THRESHOLD_HIGH = difficulty.stressThresholds.high

    if (character.stress >= STRESS_THRESHOLD_CRITICAL) {
      result.breakdown = true
      character.status = CHARACTER_STATUS.STRESSED
      log.warn("character_breakdown", { stress: character.stress })
    } else if (character.stress >= STRESS_THRESHOLD_HIGH) {
      result.stressed = true
      log.info("character_stressed", { stress: character.stress })
    }

    character.stress = Math.min(100, Math.max(0, character.stress))

    return result
  }

  static generateTurnSummary(context: EvolutionContext, stateUpdates: any, chaosEvent: ChaosEvent): string {
    const lines: string[] = []
    const timestamp = new Date().toISOString()

    lines.push(`# Turn ${context.chapterCount} Evolution Summary`)
    lines.push(`Generated: ${timestamp}`)
    lines.push("")

    lines.push("## 🎲 Chaos Event")
    lines.push(`- **Impact**: ${chaosEvent.impact.toUpperCase()}`)
    lines.push(`- **Magnitude**: ${chaosEvent.magnitude.toUpperCase()}`)
    lines.push(`- **Event**: ${chaosEvent.generatedEvent || chaosEvent.narrativeDirection}`)
    lines.push("")

    lines.push("## 📈 State Changes")

    if (stateUpdates.characters) {
      lines.push("")
      lines.push("### Characters Updated")
      for (const [charName, update] of Object.entries(stateUpdates.characters)) {
        const u = update as any
        lines.push(`**${charName}**:`)
        if (u.stress) lines.push(`  - Stress: ${u.stress > 0 ? "+" : ""}${u.stress}`)
        if (u.newSkill) lines.push(`  - ✨ New Skill: ${u.newSkill.name} (${u.newSkill.category})`)
        if (u.newTrauma) lines.push(`  - 💔 New Trauma: ${u.newTrauma.description} (severity: ${u.newTrauma.severity})`)
        if (u.status) lines.push(`  - Status: ${u.status}`)
      }
    }

    if (stateUpdates.relationships) {
      lines.push("")
      lines.push("### Relationships Updated")
      for (const [relKey, update] of Object.entries(stateUpdates.relationships)) {
        const u = update as any
        const changes: string[] = []
        if (u.trust) changes.push(`Trust: ${u.trust > 0 ? "+" : ""}${u.trust}`)
        if (u.hostility) changes.push(`Hostility: ${u.hostility > 0 ? "+" : ""}${u.hostility}`)
        if (changes.length > 0) {
          lines.push(`- **${relKey}**: ${changes.join(", ")}`)
        }
      }
    }

    if (stateUpdates.world?.events?.length) {
      lines.push("")
      lines.push("### World Events")
      stateUpdates.world.events.forEach((event: string) => lines.push(`- ${event}`))
    }

    if (stateUpdates.evolution_summary?.contradictions?.length) {
      lines.push("")
      lines.push("### ⚠️ Contradictions Detected")
      stateUpdates.evolution_summary.contradictions.forEach((c: string) => lines.push(`- ${c}`))
    }

    lines.push("")
    lines.push("---")
    lines.push(`*End of Turn ${context.chapterCount}*`)

    return lines.join("\n")
  }

  private static generateSkillNameFromCategory(category: string | undefined, reason: string): string {
    if (!category) return "Learned Ability"

    const parts = category.split(" ")
    const baseName = parts.pop() || "Ability"
    return `${baseName}`
  }

  private static normalizeSkillCategory(category: string | undefined): string {
    if (!category) return SKILL_CATEGORIES.ANALYSIS

    const normalized = category.toLowerCase().replace(/[^a-z]/g, "")
    const categoryMap: Record<string, string> = {
      combat: SKILL_CATEGORIES.COMBAT,
      physical: SKILL_CATEGORIES.COMBAT,
      fighting: SKILL_CATEGORIES.COMBAT,
      social: SKILL_CATEGORIES.PERSUASION,
      persuasion: SKILL_CATEGORIES.PERSUASION,
      deception: SKILL_CATEGORIES.DECEPTION,
      mental: SKILL_CATEGORIES.ANALYSIS,
      analysis: SKILL_CATEGORIES.ANALYSIS,
      deduction: SKILL_CATEGORIES.DEDUCTION,
      intuition: SKILL_CATEGORIES.INTUITION,
      technical: SKILL_CATEGORIES.HACKING,
      hacking: SKILL_CATEGORIES.HACKING,
      encryption: SKILL_CATEGORIES.ENCRYPTION,
      stealth: SKILL_CATEGORIES.STEALTH,
      escape: SKILL_CATEGORIES.ESCAPE,
      interrogation: SKILL_CATEGORIES.INTERROGATION,
      pain: SKILL_CATEGORIES.PAIN_TOLERANCE,
      fear: SKILL_CATEGORIES.FEAR_RESIST,
    }

    return categoryMap[normalized] || SKILL_CATEGORIES.ANALYSIS
  }

  private static calculateTraumaSeverityFromTags(tags: string[]): number {
    const severityMap: Record<string, number> = {
      [TRAUMA_TAGS.PHYSICAL_INJURY]: 7,
      [TRAUMA_TAGS.NEURAL]: 9,
      [TRAUMA_TAGS.PSYCHOLOGICAL_FEAR]: 5,
      [TRAUMA_TAGS.PSYCHOLOGICAL_BETRAYAL]: 6,
      [TRAUMA_TAGS.PSYCHOLOGICAL_GUILT]: 5,
      [TRAUMA_TAGS.PSYCHOLOGICAL_LOSS]: 7,
      [TRAUMA_TAGS.ISOLATION]: 4,
      [TRAUMA_TAGS.PERSECUTION]: 6,
      [TRAUMA_TAGS.VISUAL]: 4,
      [TRAUMA_TAGS.NIGHTMARE]: 5,
      [TRAUMA_TAGS.FLASHBACK]: 6,
    }

    if (tags.length === 0) return 3

    const maxSeverity = Math.max(...tags.map((tag) => severityMap[tag] || 3), 3)
    return maxSeverity
  }
}

export const evolutionRules = EvolutionRulesEngine
