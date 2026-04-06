import { Log } from "../util/log"
import { callLLMJson } from "./llm-wrapper"
import { getTraumaTags, getSkillCategories, getCharacterStatus } from "./types"
import { createPromptBuilder, type StoryTone } from "./dynamic-prompt"
import { novelConfigManager } from "./novel-config"
import type { DeepenedCharacterProfile } from "./character-deepener"

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
  rollImpact: number
  rollMagnitude: number
  impact: "positive" | "negative" | "neutral"
  magnitude: "static" | "minor" | "major"
  narrativeDirection: string
  generatedEvent?: string
  structuredEvent?: {
    type: string
    targets: string[]
  } | null
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
  private static impactBias: Record<string, number> = { positive: 1 / 3, negative: 1 / 3, neutral: 1 / 3 }

  static setImpactBias(bias: Record<string, number>): void {
    const total = Object.values(bias).reduce((sum, val) => sum + val, 0)
    if (total > 0) {
      this.impactBias = {}
      for (const [key, value] of Object.entries(bias)) {
        this.impactBias[key] = value / total
      }
    }
    log.info("impact_bias_set", { bias: this.impactBias })
  }

  /**
   * 掷双骰子决定混乱事件
   * @returns 包含影响方向和变化幅度的混乱事件
   */
  static rollChaos(): ChaosEvent {
    const rollImpact = Math.floor(Math.random() * 6) + 1
    const rollMagnitude = Math.floor(Math.random() * 6) + 1

    let impact: ChaosEvent["impact"]
    const rand = Math.random()
    let cumulative = 0
    impact = "neutral"

    for (const [key, value] of Object.entries(this.impactBias)) {
      cumulative += value
      if (rand <= cumulative && ["positive", "negative", "neutral"].includes(key)) {
        impact = key as ChaosEvent["impact"]
        break
      }
    }

    const magnitude = MAGNITUDE_LABELS[rollMagnitude]

    log.info("chaos_rolled", { rollImpact, rollMagnitude, impact, magnitude, biasApplied: true })

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
      plotHook?: string
      relationshipInstability?: string
      activeMotifs?: string
      activeArchetypes?: string
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

      const plotHookSection = storyContext.plotHook
        ? `\nPLOT HOOK TO INCORPORATE:\n${storyContext.plotHook}\n\nIMPORTANT: This plot hook represents a pending narrative thread. The chaos event should naturally weave in or address this hook. This is a strong narrative direction — prioritize it over generic events.`
        : ""

      const relationshipInstabilitySection = storyContext.relationshipInstability
        ? `\n${storyContext.relationshipInstability}\n\nNARRATIVE IMPERATIVE: The chaos event MUST amplify or address these unstable relationships. This is not optional — the story tension demands it.`
        : ""

      const activeMotifsSection = storyContext.activeMotifs
        ? `\n${storyContext.activeMotifs}\n\nThe chaos event should AMPLIFY or SUBVERT these motifs. If amplifying, make them more prominent. If subverting, create irony by inverting their meaning.`
        : ""

      const activeArchetypesSection = storyContext.activeArchetypes
        ? `\n${storyContext.activeArchetypes}\n\nThe chaos event should TEST these character archetypes. Force the hero to face their deepest fear, the mentor to doubt their wisdom, the shadow to reveal their humanity.`
        : ""

      const prompt = promptBuilder
        .withVariables({
          IMPACT: impactLabel,
          MAGNITUDE: magnitudeLabel,
          STORY_CONTEXT: storyContext.currentStory.substring(0, 1500),
          CHARACTERS: storyContext.characters.join(", "),
          RECENT_EVENTS: storyContext.recentEvents.join("\n") || "None",
          PLOT_HOOK: plotHookSection,
          RELATIONSHIP_INSTABILITY: relationshipInstabilitySection,
          ACTIVE_MOTIFS: activeMotifsSection,
          ACTIVE_ARCHETYPES: activeArchetypesSection,
        })
        .build()

      const result = await callLLMJson<{ event: string }>({
        prompt,
        callType: "chaos_event_generation",
        temperature: 0.9,
        useRetry: true,
      })

      chaosEvent.narrativeDirection =
        chaosEvent.impact === "positive"
          ? `Positive Impact (${chaosEvent.magnitude})`
          : chaosEvent.impact === "negative"
            ? `Negative Impact (${chaosEvent.magnitude})`
            : `Neutral Impact (${chaosEvent.magnitude})`

      chaosEvent.generatedEvent = result.data.event || result.text.trim()

      chaosEvent.structuredEvent = await this.extractStructuredEvent(chaosEvent.generatedEvent, storyContext.characters)

      log.info("chaos_event_generated", {
        rollImpact: chaosEvent.rollImpact,
        rollMagnitude: chaosEvent.rollMagnitude,
        impact: chaosEvent.impact,
        magnitude: chaosEvent.magnitude,
        hasGeneratedEvent: !!chaosEvent.generatedEvent,
        structuredEventType: chaosEvent.structuredEvent?.type,
      })
    } catch (error) {
      log.warn("chaos_event_generation_failed", { error: String(error) })
      chaosEvent.generatedEvent = `${chaosEvent.impact} impact, ${chaosEvent.magnitude} change (LLM failed)`
      chaosEvent.structuredEvent = null
    }

    return chaosEvent
  }

  private static async extractStructuredEvent(
    eventText: string,
    characters: string[],
  ): Promise<{ type: string; targets: string[] } | null> {
    try {
      const result = await callLLMJson<{ type: string; targets: string[] }>({
        prompt: `Analyze this story event and extract structured information.

Event: ${eventText.substring(0, 500)}

Available Characters: ${characters.join(", ")}

Extract:
1. Event type (one word, e.g., "betrayal", "alliance", "discovery", "confrontation", "escape", "revelation")
2. Target characters (list of character names from the available characters that are directly affected)

Output JSON only:
{
  "type": "event type",
  "targets": ["character1", "character2"]
}`,
        callType: "structured_event_extraction",
        temperature: 0.2,
        useRetry: false, // Lightweight extraction, no need for retry
      })

      return {
        type: result.data.type || "unknown",
        targets: Array.isArray(result.data.targets) ? result.data.targets : [],
      }
    } catch (error) {
      log.warn("structured_event_extraction_failed", { error: String(error) })
    }

    return null
  }

  static async checkStateChanges(
    context: EvolutionContext,
    storyTone?: StoryTone,
    characterProfiles?: Record<string, DeepenedCharacterProfile>,
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

      let prompt = promptBuilder.withVariables({ STORY_SEGMENT: storyText }).build()

      if (characterProfiles && Object.keys(characterProfiles).length > 0) {
        const characterContext = Object.entries(characterProfiles)
          .map(
            ([name, profile]) =>
              `**${name}**: Core Fear: "${profile.psychologicalProfile.coreFear}", Core Desire: "${profile.psychologicalProfile.coreDesire}"`,
          )
          .join("\n")

        prompt += `\n\n=== Character Psychological Profiles ===\n${characterContext}\n\nWhen evaluating skill awards and trauma triggers, consider each character's core fear and desire. A character is more likely to gain skills related to their core desire and receive trauma related to their core fear.`
      }

      const result = await callLLMJson<{
        skill_awards?: Array<{ character_name: string; skill_name: string; skill_category: string; reason_in_story: string }>
        trauma_awards?: Array<{ character_name: string; trauma_name: string; trauma_tags: string[]; severity: number; reason_in_story: string }>
      }>({
        prompt,
        callType: "state_evaluation",
        temperature: 0.3,
        useRetry: true,
      })

      const evaluation = result.data

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

      const difficulty = novelConfigManager.getDifficultyPreset()
      const STRESS_THRESHOLD_CRITICAL = difficulty.stressThresholds.critical
      const STRESS_THRESHOLD_HIGH = difficulty.stressThresholds.high

      for (const [charName, char] of Object.entries(context.characters)) {
        if (char.stress >= STRESS_THRESHOLD_CRITICAL) {
          traumaAwards.push({
            characterName: charName,
            trauma: {
              description: `Cumulative stress exceeded critical threshold (${char.stress}/100), psychological breakdown`,
              tags: [getTraumaTags().PSYCHOLOGICAL_FEAR, getTraumaTags().PSYCHOLOGICAL_GUILT],
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
          hasCharacterProfiles: !!characterProfiles,
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
      character.status = getCharacterStatus().STRESSED
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
    const skillCategories = getSkillCategories()
    if (!category) return skillCategories.ANALYSIS

    const normalized = category.toLowerCase().replace(/[^a-z]/g, "")
    const categoryMap: Record<string, string> = {
      combat: skillCategories.COMBAT,
      physical: skillCategories.COMBAT,
      fighting: skillCategories.COMBAT,
      social: skillCategories.PERSUASION,
      persuasion: skillCategories.PERSUASION,
      deception: skillCategories.DECEPTION,
      mental: skillCategories.ANALYSIS,
      analysis: skillCategories.ANALYSIS,
      deduction: skillCategories.DEDUCTION,
      intuition: skillCategories.INTUITION,
      technical: skillCategories.HACKING,
      hacking: skillCategories.HACKING,
      encryption: skillCategories.ENCRYPTION,
      stealth: skillCategories.STEALTH,
      escape: skillCategories.ESCAPE,
      interrogation: skillCategories.INTERROGATION,
      pain: skillCategories.PAIN_TOLERANCE,
      fear: skillCategories.FEAR_RESIST,
    }

    return categoryMap[normalized] || skillCategories.ANALYSIS
  }

  private static calculateTraumaSeverityFromTags(tags: string[]): number {
    const traumaTags = getTraumaTags()
    const severityMap: Record<string, number> = {
      [traumaTags.PHYSICAL_INJURY]: 7,
      [traumaTags.NEURAL]: 9,
      [traumaTags.PSYCHOLOGICAL_FEAR]: 5,
      [traumaTags.PSYCHOLOGICAL_BETRAYAL]: 6,
      [traumaTags.PSYCHOLOGICAL_GUILT]: 5,
      [traumaTags.PSYCHOLOGICAL_LOSS]: 7,
      [traumaTags.ISOLATION]: 4,
      [traumaTags.PERSECUTION]: 6,
      [traumaTags.VISUAL]: 4,
      [traumaTags.NIGHTMARE]: 5,
      [traumaTags.FLASHBACK]: 6,
    }

    if (tags.length === 0) return 3

    const maxSeverity = Math.max(...tags.map((tag) => severityMap[tag] || 3), 3)
    return maxSeverity
  }
}

export const evolutionRules = EvolutionRulesEngine
