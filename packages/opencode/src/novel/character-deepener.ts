import { Log } from "../util/log"
import { generateText } from "ai"
import { getNovelLanguageModel } from "./model"

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
      openness: number      // 开放性: 好奇心、创造力
      conscientiousness: number // 尽责性: 自律、责任感
      extraversion: number  // 外向性: 社交能量
      agreeableness: number // 宜人性: 合作信任
      neuroticism: number   // 神经质: 情绪稳定性
    }
    // 依恋风格
    attachmentStyle: "secure" | "anxious" | "avoidant" | "disorganized"
    // 核心心理
    coreFear: string       // 核心恐惧
    coreDesire: string     // 核心欲望
    defenseMechanisms: string[]  // 防御机制
    copingStrategies: string[]   // 应对策略
  }
  // 角色弧光
  characterArc: {
    currentPhase: "denial" | "resistance" | "exploration" | "integration" | "mastery"
    arcDirection: "growth" | "decline" | "complex" | "stagnation"
    potentialBreakthrough: string   // 潜在突破点
    potentialBreakdown: string     // 潜在崩溃点
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
    internalConflict: string     // 内心冲突
    externalConflict: string     // 外部冲突
    growthOpportunities: string[] // 成长机会
    sceneTriggers: string[]      // 触发特定反应的场景
  }
  // 深化后的属性（建议合并到角色）
  suggestedEnhancements: {
    newTraits: string[]           // 建议添加的性格特质
    newGoals: string[]           // 建议添加的目标
    backstoryFragments: string[] // 建议的背景碎片
    dialogueTraits: string[]     // 建议的对话风格
  }
}

/**
 * Character Deepener - 基于 LLM 的通用角色深化
 * 
 * 不硬编码任何角色类型，完全依靠 LLM 分析现有角色数据
 * 结合心理学理论（Big Five, 依恋理论, 创伤理论等）进行推理
 */
export class CharacterDeepener {
  
  /**
   * 深化单个角色 - 完全基于现有数据推理
   */
  async deepenCharacter(character: CharacterStateInput): Promise<DeepenedCharacterProfile> {
    log.info("deepening_character", { name: character.name })

    const languageModel = await getNovelLanguageModel()

    // 构建角色数据摘要
    const characterSummary = this.buildCharacterSummary(character)

    const prompt = `你是一位角色心理学专家。你的任务是基于角色的现有状态数据，
运用心理学理论进行深度分析，生成角色画像。

=== 角色现有数据 ===
${characterSummary}

=== 分析要求 ===
请运用以下心理学框架进行分析：

1. **大五人格 (Big Five)** - 从角色的 traits, skills, behavior 推断
2. **依恋理论** - 从 relationships 和 trauma 推断依恋风格
3. **创伤理论** - 从 trauma 和 stress 推断心理影响
4. **马斯洛需求** - 从 goals 推断核心欲望
5. **防御机制** - 从行为模式推断常用防御方式

=== 输出格式 (严格 JSON) ===
{
  "psychologicalProfile": {
    "bigFiveTraits": {
      "openness": 1-10,
      "conscientiousness": 1-10,
      "extraversion": 1-10,
      "agreeableness": 1-10,
      "neuroticism": 1-10
    },
    "attachmentStyle": "secure|anxious|avoidant|disorganized",
    "coreFear": "一句话描述角色最深的恐惧",
    "coreDesire": "一句话描述角色最核心的欲望",
    "defenseMechanisms": ["机制1", "机制2"],
    "copingStrategies": ["策略1", "策略2"]
  },
  "characterArc": {
    "currentPhase": "denial|resistance|exploration|integration|mastery",
    "arcDirection": "growth|decline|complex|stagnation",
    "potentialBreakthrough": "角色可能的突破点",
    "potentialBreakdown": "角色可能的崩溃点"
  },
  "relationshipDynamics": {
    "其他角色名": {
      "dynamicType": "ally|rival|mentor|protégé|love|enemy|unknown",
      "powerBalance": "dominant|submissive|equal|shifting",
      "tension": "cooperating|conflicting|neutral|betrayal_risk"
    }
  },
  "narrativeSuggestions": {
    "internalConflict": "角色内心的核心冲突",
    "externalConflict": "角色面临的外部冲突",
    "growthOpportunities": ["成长机会1", "成长机会2"],
    "sceneTriggers": ["能触发角色特定反应的场景1", "场景2"]
  },
  "suggestedEnhancements": {
    "newTraits": ["建议添加的特质1", "特质2"],
    "newGoals": ["建议添加的目标1"],
    "backstoryFragments": ["建议的背景碎片1"],
    "dialogueTraits": ["建议的对话风格1"]
  }
}

注意：
- 只输出 JSON，不要其他文字
- 所有数值必须是 1-10
- 如果数据不足某项推断，使用 "insufficient_data" 并给出合理默认值
- 推理必须基于现有数据，禁止凭空编造`

    try {
      const result = await generateText({
        model: languageModel,
        prompt,
      })

      const match = result.text.match(/\{[\s\S]*\}/)
      if (match) {
        const analysis = JSON.parse(match[0])
        
        log.info("character_deepened", { 
          name: character.name,
          attachmentStyle: analysis.psychologicalProfile?.attachmentStyle,
          arcDirection: analysis.characterArc?.arcDirection
        })

        return {
          name: character.name,
          psychologicalProfile: this.fillDefaults(analysis.psychologicalProfile),
          characterArc: this.fillArcDefaults(analysis.characterArc),
          relationshipDynamics: analysis.relationshipDynamics || {},
          narrativeSuggestions: this.fillNarrativeDefaults(analysis.narrativeSuggestions),
          suggestedEnhancements: this.fillEnhancementDefaults(analysis.suggestedEnhancements),
        }
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
    characters: Record<string, CharacterStateInput>
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
   * 跨角色分析 - 分析角色之间的关系动态
   */
  private async crossCharacterAnalysis(
    profiles: Record<string, DeepenedCharacterProfile>
  ): Promise<void> {
    const languageModel = await getNovelLanguageModel()

    const profilesText = Object.entries(profiles)
      .map(([name, p]) => `${name}: ${p.psychologicalProfile.coreFear}, ${p.psychologicalProfile.coreDesire}`)
      .join("\n")

    const prompt = `分析这些角色之间的关系动态和潜在冲突：

${profilesText}

基于他们的核心恐惧和欲望，推断他们之间的互动模式。
输出 JSON：
{
  "角色A-角色B": {
    "dynamicType": "ally|rival|mentor|protégé|love|enemy|unknown",
    "powerBalance": "dominant|submissive|equal|shifting",
    "tension": "cooperating|conflicting|neutral|betrayal_risk"
  }
}`

    try {
      const result = await generateText({
        model: languageModel,
        prompt,
      })

      const match = result.text.match(/\{[\s\S]*\}/)
      if (match) {
        const dynamics = JSON.parse(match[0]) as Record<string, any>

        // 更新每个角色的关系动态
        for (const [key, value] of Object.entries(dynamics)) {
          const [charA, charB] = key.split("-")
          if (profiles[charA] && charB) {
            profiles[charA].relationshipDynamics[charB] = {
              dynamicType: value.dynamicType || "unknown",
              powerBalance: value.powerBalance || "equal",
              tension: value.tension || "neutral"
            }
          }
          if (profiles[charB] && charA) {
            profiles[charB].relationshipDynamics[charA] = {
              dynamicType: value.dynamicType || "unknown",
              powerBalance: value.powerBalance || "equal",
              tension: value.tension || "neutral"
            }
          }
        }
      }
    } catch (e) {
      log.warn("cross_analysis_failed", { error: String(e) })
    }
  }

  /**
   * 构建角色数据摘要
   */
  private buildCharacterSummary(character: CharacterStateInput): string {
    const parts: string[] = []

    parts.push(`角色名: ${character.name}`)
    parts.push(`当前状态: ${character.status}`)
    parts.push(`压力值: ${character.stress}/100`)

    if (character.traits?.length) {
      parts.push(`性格特质: ${character.traits.join(", ")}`)
    }

    if (character.skills?.length) {
      const skillSummary = character.skills.map(s => `${s.name}(${s.category})`).join(", ")
      parts.push(`技能: ${skillSummary}`)
    }

    if (character.trauma?.length) {
      const traumaSummary = character.trauma.map(t => `${t.name}${t.tags ? `[${t.tags.join(",")}]` : ""}`).join(", ")
      parts.push(`创伤: ${traumaSummary}`)
    }

    if (character.secrets?.length) {
      parts.push(`秘密: ${character.secrets.join(", ")}`)
    }

    if (character.clues?.length) {
      parts.push(`线索: ${character.clues.join(", ")}`)
    }

    if (character.goals?.length) {
      const goalSummary = character.goals.map(g => `${g.type}:${g.description}(${g.status})`).join("; ")
      parts.push(`目标: ${goalSummary}`)
    }

    if (character.notes) {
      parts.push(`备注: ${character.notes}`)
    }

    if (character.relationships) {
      const relSummary = Object.entries(character.relationships)
        .map(([other, r]) => `${other}(信任:${r.trust}, 敌意:${r.hostility || 0})`)
        .join(", ")
      parts.push(`关系: ${relSummary}`)
    }

    return parts.join("\n")
  }

  private fillDefaults(profile: any): DeepenedCharacterProfile["psychologicalProfile"] {
    if (!profile) return this.defaultPsychologicalProfile()
    
    return {
      bigFiveTraits: profile.bigFiveTraits || { openness: 5, conscientiousness: 5, extraversion: 5, agreeableness: 5, neuroticism: 5 },
      attachmentStyle: profile.attachmentStyle || "secure",
      coreFear: profile.coreFear || "未知",
      coreDesire: profile.coreDesire || "生存",
      defenseMechanisms: profile.defenseMechanisms || [],
      copingStrategies: profile.copingStrategies || [],
    }
  }

  private fillArcDefaults(arc: any): DeepenedCharacterProfile["characterArc"] {
    if (!arc) return { currentPhase: "exploration", arcDirection: "complex", potentialBreakthrough: "", potentialBreakdown: "" }
    
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
      characterArc: { currentPhase: "exploration", arcDirection: "complex", potentialBreakthrough: "", potentialBreakdown: "" },
      relationshipDynamics: {},
      narrativeSuggestions: { internalConflict: "", externalConflict: "", growthOpportunities: [], sceneTriggers: [] },
      suggestedEnhancements: { newTraits: [], newGoals: [], backstoryFragments: [], dialogueTraits: [] },
    }
  }
}

export const characterDeepener = new CharacterDeepener()