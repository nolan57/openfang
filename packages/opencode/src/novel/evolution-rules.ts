import { Log } from "../util/log"
import { generateText } from "ai"
import { TRAUMA_TAGS, SKILL_CATEGORIES, CHARACTER_STATUS } from "./types"
import { getNovelLanguageModel } from "./model"

const log = Log.create({ service: "evolution-rules" })

const STATE_CHANGE_EVALUATION_PROMPT = `You are a strict game master (GM) responsible for extracting state changes from story text.

Character State Rules:
- Skill Award: A character can only receive a new skill when they successfully overcome a specific and challenging obstacle. Skills represent learned competence through adversity.
- Trauma Trigger: A character receives trauma when experiencing life-threatening events, extreme pressure (witnessing death, betrayal), or cumulative stress exceeds critical threshold.

Your task:
Analyze the story segment below. Identify ALL skill awards and trauma triggers following the rules above.

Output Format (strict JSON):
{
  "skill_awards": [
    {
      "character_name": "Character name from the story",
      "skill_name": "Descriptive name for the new skill (e.g., 'Quick Reflexes', 'Deceptive Charm')",
      "skill_category": "General category (e.g., Combat, Social, Mental, Technical, Physical, Survival)",
      "reason_in_story": "What happened in the story that warrants this skill"
    }
  ],
  "trauma_awards": [
    {
      "character_name": "Character name from the story",
      "trauma_name": "Descriptive name for the trauma (e.g., 'Fear of Fire', 'Trust Issues')",
      "trauma_tags": ["General tags: Physical, Psychological, Social, Loss, Betrayal, Fear, Pain"],
      "severity": 1-10,
      "reason_in_story": "What happened in the story that caused this trauma"
    }
  ]
}

Story Segment:
{{STORY_SEGMENT}}

Output only JSON, no other text.`

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

interface ChaosEvent {
  roll: number
  category: "catastrophic" | "complication" | "neutral" | "boon"
  description: string
  narrativePrompt: string
}

const CHAOS_TABLE: ChaosEvent[] = [
  {
    roll: 1,
    category: "catastrophic",
    description: "灾难性失败",
    narrativePrompt: "突发灾难：装备故障/盟友受伤/关键证据丢失/敌人增援抵达",
  },
  {
    roll: 2,
    category: "complication",
    description: "复杂情况",
    narrativePrompt: "新障碍：时间限制缩减/新敌人出现/环境恶化/资源耗尽",
  },
  {
    roll: 3,
    category: "complication",
    description: "意外阻碍",
    narrativePrompt: "意外阻碍：通讯中断/路径封锁/身份暴露/内部矛盾",
  },
  {
    roll: 4,
    category: "neutral",
    description: "标准流程",
    narrativePrompt: "按当前剧情自然推进，无外部干扰",
  },
  {
    roll: 5,
    category: "neutral",
    description: "平稳发展",
    narrativePrompt: "维持当前节奏，允许角色展现能力",
  },
  {
    roll: 6,
    category: "boon",
    description: "意外收获",
    narrativePrompt: "意外助力：发现隐藏物品/盟友及时赶到/关键线索揭示/敌人失误",
  },
]

export class EvolutionRulesEngine {
  private static readonly STRESS_THRESHOLD_CRITICAL = 90
  private static readonly STRESS_THRESHOLD_HIGH = 70
  private static readonly STRESS_DELTA_LARGE = 20
  private static readonly DIFFICULTY_THRESHOLD_HIGH = 7

  static rollChaos(): ChaosEvent {
    const roll = Math.floor(Math.random() * 6) + 1
    const event = CHAOS_TABLE[roll - 1]
    log.info("chaos_rolled", { roll, category: event.category, description: event.description })
    return { ...event, roll }
  }

  static async checkStateChanges(context: EvolutionContext): Promise<{ skills: SkillAward[]; traumas: TraumaAward[] }> {
    const storyText = context.storySegment

    if (storyText.length < 20) {
      return { skills: [], traumas: [] }
    }

    try {
      const languageModel = await getNovelLanguageModel()

      const prompt = STATE_CHANGE_EVALUATION_PROMPT.split("{{STORY_SEGMENT}}").join(storyText)

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

      for (const [charName, char] of Object.entries(context.characters)) {
        if (char.stress >= this.STRESS_THRESHOLD_CRITICAL) {
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

    if (character.stress >= this.STRESS_THRESHOLD_CRITICAL) {
      result.breakdown = true
      character.status = CHARACTER_STATUS.STRESSED
      log.warn("character_breakdown", { stress: character.stress })
    } else if (character.stress >= this.STRESS_THRESHOLD_HIGH) {
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
    lines.push(`- **Roll**: ${chaosEvent.roll}/6`)
    lines.push(`- **Category**: ${chaosEvent.category.toUpperCase()}`)
    lines.push(`- **Event**: ${chaosEvent.description}`)
    lines.push(`- **Narrative**: ${chaosEvent.narrativePrompt}`)
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
