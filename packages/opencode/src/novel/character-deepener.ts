import { Log } from "../util/log"
import { callLLMJson } from "./llm-wrapper"
import type { CharacterLifecycle } from "./character-lifecycle"

const log = Log.create({ service: "character-deepener" })

export interface CharacterStateInput {
  name: string
  status: string
  stress: number
  traits: string[]
  skills: { name: string; category: string; level?: number; description?: string }[]
  trauma: { name: string; description?: string; tags?: string[]; severity?: number }[]
  secrets: string[]
  clues: string[]
  goals?: { type: string; description: string; status: string; progress?: number }[]
  notes: string
  relationships?: Record<string, { trust: number; hostility?: number; dynamic?: string }>
}

export interface DeepenedCharacterProfile {
  name: string
  // 基于现有数据的深化分析
  psychologicalProfile: {
    // 大五人格推断
    bigFiveTraits: {
      openness: number // 开放性: 好奇心、创造力
      conscientiousness: number // 尽责性: 自律、责任感
      extraversion: number // 外向性: 社交能量
      agreeableness: number // 宜人性: 合作信任
      neuroticism: number // 神经质: 情绪稳定性
    }
    // 依恋风格
    attachmentStyle: "secure" | "anxious" | "avoidant" | "disorganized"
    // 核心心理
    coreFear: string // 核心恐惧
    coreDesire: string // 核心欲望
    defenseMechanisms: string[] // 防御机制
    copingStrategies: string[] // 应对策略
  }
  // 角色弧光
  characterArc: {
    currentPhase: "denial" | "resistance" | "exploration" | "integration" | "mastery"
    arcDirection: "growth" | "decline" | "complex" | "stagnation"
    potentialBreakthrough: string // 潜在突破点
    potentialBreakdown: string // 潜在崩溃点
  }
  // 关系动态
  relationshipDynamics: {
    [otherCharacter: string]: {
      dynamicType: "ally" | "rival" | "mentor" | "protégé" | "love" | "enemy" | "unknown"
      powerBalance: "dominant" | "submissive" | "equal" | "shifting"
      tension: "cooperating" | "conflicting" | "neutral" | "betrayal_risk"
    }
  }
  // 叙事建议
  narrativeSuggestions: {
    internalConflict: string // 内心冲突
    externalConflict: string // 外部冲突
    growthOpportunities: string[] // 成长机会
    sceneTriggers: string[] // 触发特定反应的场景
  }
  // 深化后的属性（建议合并到角色）
  suggestedEnhancements: {
    newTraits: string[] // 建议添加的性格特质
    newGoals: string[] // 建议添加的目标
    backstoryFragments: string[] // 建议的背景碎片
    dialogueTraits: string[] // 建议的对话风格
  }
}

export interface CharacterDeepenerConfig {
  skillDefinitions?: Record<string, string>
  traumaDefinitions?: Record<string, string>
}

const DEFAULT_CONFIG: CharacterDeepenerConfig = {
  skillDefinitions: {},
  traumaDefinitions: {},
}

/**
 * Character Deepener - LLM-based Universal Character Deepening
 *
 * Analyzes character psychology using frameworks like Big Five, Attachment Theory, etc.
 * Uses dynamic world knowledge injection for genre-agnostic analysis.
 */
export class CharacterDeepener {
  private config: CharacterDeepenerConfig

  constructor(config: CharacterDeepenerConfig = DEFAULT_CONFIG) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Update config dynamically (e.g., after loading new patterns)
   */
  updateConfig(newConfig: Partial<CharacterDeepenerConfig>): void {
    this.config = { ...this.config, ...newConfig }
  }
  async deepenCharacter(character: CharacterStateInput): Promise<DeepenedCharacterProfile> {
    log.info("deepening_character", { name: character.name })

    const characterSummary = this.buildCharacterSummary(character)
    const worldKnowledgeDict = this.buildWorldKnowledgeDictionary()

    const prompt = `You are a character psychology expert. Your task is to analyze the character based on their current state data using psychological frameworks.

=== Character Data ===
${characterSummary}

${worldKnowledgeDict}

=== Analysis Requirements ===
Use the following psychological frameworks for analysis:

1. **Big Five Personality** - Infer from traits, skills, behavior
2. **Attachment Theory** - Infer from relationships and trauma
3. **Trauma Psychology** - Infer psychological impact from trauma and stress
4. **Maslow's Hierarchy** - Infer core desires from goals
5. **Defense Mechanisms** - Infer common defense patterns from behavior

=== Output Format (strict JSON) ===
{
  "psychologicalProfile": {
    "bigFiveTraits": { "openness": 1-10, "conscientiousness": 1-10, "extraversion": 1-10, "agreeableness": 1-10, "neuroticism": 1-10 },
    "attachmentStyle": "secure|anxious|avoidant|disorganized",
    "coreFear": "One sentence",
    "coreDesire": "One sentence",
    "defenseMechanisms": ["mechanism1", "mechanism2"],
    "copingStrategies": ["strategy1", "strategy2"]
  },
  "characterArc": {
    "currentPhase": "denial|resistance|exploration|integration|mastery",
    "arcDirection": "growth|decline|complex|stagnation",
    "potentialBreakthrough": "potential breakthrough point",
    "potentialBreakdown": "potential breakdown point"
  },
  "relationshipDynamics": { "otherCharacter": { "dynamicType": "ally|rival|mentor|protégé|enemy|unknown", "powerBalance": "dominant|submissive|equal|shifting", "tension": "cooperating|conflicting|neutral|betrayal_risk" } },
  "narrativeSuggestions": { "internalConflict": "...", "externalConflict": "...", "growthOpportunities": ["..."], "sceneTriggers": ["..."] },
  "suggestedEnhancements": { "newTraits": ["..."], "newGoals": ["..."], "backstoryFragments": ["..."], "dialogueTraits": ["..."] }
}

Note: Output JSON only, no other text. All numbers must be 1-10.`

    try {
      const result = await callLLMJson<DeepenedCharacterProfile>({
        prompt,
        callType: "character_deepening",
        temperature: 0.5,
        useRetry: true,
      })

      const analysis = result.data
      log.info("character_deepened", {
        name: character.name,
        attachmentStyle: analysis.psychologicalProfile?.attachmentStyle,
        arcDirection: analysis.characterArc?.arcDirection,
      })

      return {
        name: character.name,
        psychologicalProfile: this.fillDefaults(analysis.psychologicalProfile),
        characterArc: this.fillArcDefaults(analysis.characterArc),
        relationshipDynamics: analysis.relationshipDynamics || {},
        narrativeSuggestions: this.fillNarrativeDefaults(analysis.narrativeSuggestions),
        suggestedEnhancements: this.fillEnhancementDefaults(analysis.suggestedEnhancements),
      }
    } catch (e) {
      log.error("character_deepening_failed", { name: character.name, error: String(e) })
    }

    return this.createDefaultProfile(character.name)
  }

  /**
   * 深化所有角色
   */
  async deepenAllCharacters(
    characters: Record<string, CharacterStateInput>,
  ): Promise<Record<string, DeepenedCharacterProfile>> {
    const deepened: Record<string, DeepenedCharacterProfile> = {}

    for (const [charName, charData] of Object.entries(characters)) {
      deepened[charName] = await this.deepenCharacter({
        ...charData,
        name: charName,
      } as CharacterStateInput)
    }

    // 跨角色分析 - 基于关系动态调整
    await this.crossCharacterAnalysis(deepened)

    return deepened
  }

  /**
   * Cross-character analysis - analyze relationship dynamics between characters
   */
  private async crossCharacterAnalysis(profiles: Record<string, DeepenedCharacterProfile>): Promise<void> {
    const profilesText = Object.entries(profiles)
      .map(([name, p]) => `${name}: ${p.psychologicalProfile.coreFear}, ${p.psychologicalProfile.coreDesire}`)
      .join("\n")

    const prompt = `Analyze the relationship dynamics and potential conflicts between these characters:

${profilesText}

Based on their core fears and desires, infer their interaction patterns.
Output JSON:
{
  "characterA-characterB": {
    "dynamicType": "ally|rival|mentor|protégé|love|enemy|unknown",
    "powerBalance": "dominant|submissive|equal|shifting",
    "tension": "cooperating|conflicting|neutral|betrayal_risk"
  }
}`

    try {
      const result = await callLLMJson<Record<string, { dynamicType: string; powerBalance: string; tension: string }>>({
        prompt,
        callType: "cross_character_analysis",
        temperature: 0.5,
        useRetry: true,
      })
      const dynamics = result.data

      for (const [key, value] of Object.entries(dynamics)) {
        const parts = key.split("-")
        const charA = parts[0]
        const charB = parts.slice(1).join("-")
        if (profiles[charA] && charB) {
          profiles[charA].relationshipDynamics[charB] = {
            dynamicType: (value.dynamicType || "unknown") as any,
            powerBalance: (value.powerBalance || "equal") as any,
            tension: (value.tension || "neutral") as any,
          }
        }
        if (profiles[charB] && charA) {
          profiles[charB].relationshipDynamics[charA] = {
            dynamicType: (value.dynamicType || "unknown") as any,
            powerBalance: (value.powerBalance || "equal") as any,
            tension: (value.tension || "neutral") as any,
          }
        }
      }
    } catch (e) {
      log.warn("cross_analysis_failed", { error: String(e) })
    }
  }

  /**
   * Build character data summary
   */
  private buildCharacterSummary(character: CharacterStateInput): string {
    const parts: string[] = []

    parts.push(`Character: ${character.name}`)
    parts.push(`Status: ${character.status}`)
    parts.push(`Stress: ${character.stress}/100`)

    if (character.traits?.length) {
      parts.push(`Traits: ${character.traits.join(", ")}`)
    }

    if (character.skills?.length) {
      const skillSummary = character.skills.map((s) => `${s.name}(${s.category})`).join(", ")
      parts.push(`Skills: ${skillSummary}`)
    }

    if (character.trauma?.length) {
      const traumaSummary = character.trauma.map((t) => `${t.name}${t.tags ? `[${t.tags.join(",")}]` : ""}`).join(", ")
      parts.push(`Trauma: ${traumaSummary}`)
    }

    if (character.secrets?.length) {
      parts.push(`Secrets: ${character.secrets.join(", ")}`)
    }

    if (character.clues?.length) {
      parts.push(`Clues: ${character.clues.join(", ")}`)
    }

    if (character.goals?.length) {
      const goalSummary = character.goals.map((g) => `${g.type}:${g.description}(${g.status})`).join("; ")
      parts.push(`Goals: ${goalSummary}`)
    }

    if (character.notes) {
      parts.push(`Notes: ${character.notes}`)
    }

    if (character.relationships) {
      const relSummary = Object.entries(character.relationships)
        .map(([other, r]) => `${other}(trust:${r.trust}, hostility:${r.hostility || 0})`)
        .join(", ")
      parts.push(`Relationships: ${relSummary}`)
    }

    return parts.join("\n")
  }

  /**
   * Build world knowledge dictionary from config for LLM context
   */
  private buildWorldKnowledgeDictionary(): string {
    const lines: string[] = []

    if (Object.keys(this.config.skillDefinitions || {}).length > 0) {
      lines.push("=== Skill Dictionary ===")
      for (const [skillName, definition] of Object.entries(this.config.skillDefinitions!)) {
        lines.push(`- ${skillName}: ${definition}`)
      }
    }

    if (Object.keys(this.config.traumaDefinitions || {}).length > 0) {
      lines.push("=== Trauma Dictionary ===")
      for (const [traumaName, definition] of Object.entries(this.config.traumaDefinitions!)) {
        lines.push(`- ${traumaName}: ${definition}`)
      }
    }

    if (lines.length === 0) {
      return "=== World Knowledge ===\n(No specific definitions loaded - use general interpretation)"
    }

    return lines.join("\n")
  }

  private fillDefaults(profile: any): DeepenedCharacterProfile["psychologicalProfile"] {
    if (!profile) return this.defaultPsychologicalProfile()

    return {
      bigFiveTraits: profile.bigFiveTraits || {
        openness: 5,
        conscientiousness: 5,
        extraversion: 5,
        agreeableness: 5,
        neuroticism: 5,
      },
      attachmentStyle: profile.attachmentStyle || "secure",
      coreFear: profile.coreFear || "未知",
      coreDesire: profile.coreDesire || "生存",
      defenseMechanisms: profile.defenseMechanisms || [],
      copingStrategies: profile.copingStrategies || [],
    }
  }

  private fillArcDefaults(arc: any): DeepenedCharacterProfile["characterArc"] {
    if (!arc)
      return { currentPhase: "exploration", arcDirection: "complex", potentialBreakthrough: "", potentialBreakdown: "" }

    return {
      currentPhase: arc.currentPhase || "exploration",
      arcDirection: arc.arcDirection || "complex",
      potentialBreakthrough: arc.potentialBreakthrough || "",
      potentialBreakdown: arc.potentialBreakdown || "",
    }
  }

  private fillNarrativeDefaults(suggestions: any): DeepenedCharacterProfile["narrativeSuggestions"] {
    if (!suggestions) return { internalConflict: "", externalConflict: "", growthOpportunities: [], sceneTriggers: [] }

    return {
      internalConflict: suggestions.internalConflict || "",
      externalConflict: suggestions.externalConflict || "",
      growthOpportunities: suggestions.growthOpportunities || [],
      sceneTriggers: suggestions.sceneTriggers || [],
    }
  }

  private fillEnhancementDefaults(enhancements: any): DeepenedCharacterProfile["suggestedEnhancements"] {
    if (!enhancements) return { newTraits: [], newGoals: [], backstoryFragments: [], dialogueTraits: [] }

    return {
      newTraits: enhancements.newTraits || [],
      newGoals: enhancements.newGoals || [],
      backstoryFragments: enhancements.backstoryFragments || [],
      dialogueTraits: enhancements.dialogueTraits || [],
    }
  }

  private defaultPsychologicalProfile() {
    return {
      bigFiveTraits: { openness: 5, conscientiousness: 5, extraversion: 5, agreeableness: 5, neuroticism: 5 },
      attachmentStyle: "secure" as const,
      coreFear: "未知",
      coreDesire: "生存",
      defenseMechanisms: [],
      copingStrategies: [],
    }
  }

  private createDefaultProfile(name: string): DeepenedCharacterProfile {
    return {
      name,
      psychologicalProfile: this.defaultPsychologicalProfile(),
      characterArc: {
        currentPhase: "exploration",
        arcDirection: "complex",
        potentialBreakthrough: "",
        potentialBreakdown: "",
      },
      relationshipDynamics: {},
      narrativeSuggestions: { internalConflict: "", externalConflict: "", growthOpportunities: [], sceneTriggers: [] },
      suggestedEnhancements: { newTraits: [], newGoals: [], backstoryFragments: [], dialogueTraits: [] },
    }
  }

  private static adaptFromLifecycle(lifecycle: CharacterLifecycle): CharacterStateInput {
    const trauma: CharacterStateInput["trauma"] = []
    const skills: CharacterStateInput["skills"] = []
    const secrets: string[] = []
    const goals: CharacterStateInput["goals"] = []

    for (const event of lifecycle.lifeEvents) {
      if (event.impact?.trauma) {
        trauma.push({
          name: event.impact.trauma.name,
          severity: event.impact.trauma.severity,
          tags: event.impact.trauma.tags,
          description: event.description,
        })
      }

      if (event.impact?.skillGained) {
        skills.push({
          name: event.impact.skillGained.name,
          category: event.impact.skillGained.category,
          level: event.impact.skillGained.level,
        })
      }

      if (event.type === "trauma" && !event.impact?.trauma) {
        trauma.push({
          name: `Trauma_${event.id}`,
          description: event.description,
          tags: [event.type],
        })
      }

      if (["career_change", "coming_of_age", "transformation"].includes(event.type)) {
        goals.push({
          type: event.type,
          description: event.description,
          status: "active",
          progress: 0,
        })
      }

      if (["marriage", "parenthood"].includes(event.type)) {
        secrets.push(`Character experienced ${event.type}: ${event.description}`)
      }
    }

    const statusMap: Record<string, string> = {
      active: "active",
      inactive: "inactive",
      missing: "missing",
      imprisoned: "imprisoned",
      transformed: "transformed",
      dead: "deceased",
      ascended: "ascended",
      reincarnated: "reincarnated",
    }

    return {
      name: lifecycle.characterId,
      status: statusMap[lifecycle.status] || lifecycle.status,
      stress: 0,
      traits: [],
      skills,
      trauma,
      secrets,
      clues: [],
      goals,
      notes: `Life Stage: ${lifecycle.lifeStage}, Age: ${lifecycle.currentAge.toFixed(0)}, Events: ${lifecycle.lifeEvents.length}`,
      relationships: {},
    }
  }

  async deepenCharacterFromLifecycle(lifecycle: CharacterLifecycle): Promise<DeepenedCharacterProfile> {
    log.info("deepening_character_from_lifecycle", {
      characterId: lifecycle.characterId,
      lifeStage: lifecycle.lifeStage,
      eventsCount: lifecycle.lifeEvents.length,
    })

    const characterInput = CharacterDeepener.adaptFromLifecycle(lifecycle)

    const profile = await this.deepenCharacter(characterInput)

    log.info("character_deepened_from_lifecycle", {
      characterId: lifecycle.characterId,
      attachmentStyle: profile.psychologicalProfile.attachmentStyle,
      arcDirection: profile.characterArc.arcDirection,
    })

    return profile
  }
}

export interface PersistablePsychologicalProfile {
  coreFear: string
  coreDesire: string
  attachmentStyle: "secure" | "anxious" | "avoidant" | "disorganized"
  bigFiveTraits: {
    openness: number
    conscientiousness: number
    extraversion: number
    agreeableness: number
    neuroticism: number
  }
  defenseMechanisms: string[]
  copingStrategies: string[]
}

export const characterDeepener = new CharacterDeepener()
