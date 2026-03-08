import { Log } from "../util/log"
import { TRAUMA_TAGS, SKILL_CATEGORIES, CHARACTER_STATUS, SALIENCE_LEVELS } from "./types"

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

  static checkSkillUnlocks(context: EvolutionContext): SkillAward[] {
    const awards: SkillAward[] = []
    const storyText = context.storySegment.toLowerCase()

    for (const [charName, char] of Object.entries(context.characters)) {
      if (char.status === "deceased" || char.status === "consciousness_lost") {
        continue
      }

      const skillAwards = this.evaluateSkillConditions(charName, char, storyText, context)
      awards.push(...skillAwards)
    }

    if (awards.length > 0) {
      log.info("skills_unlocked", { count: awards.length, characters: awards.map((a) => a.characterName) })
    }

    return awards
  }

  private static evaluateSkillConditions(
    charName: string,
    char: CharacterState,
    storyText: string,
    context: EvolutionContext,
  ): SkillAward[] {
    const awards: SkillAward[] = []

    if (this.detectTechnicalBreakthrough(charName, storyText)) {
      awards.push({
        characterName: charName,
        skill: {
          name: this.generateSkillName("technical", storyText),
          category: SKILL_CATEGORIES.HACKING,
          level: 1,
          description: `在第${context.chapterCount}章中展现的技术突破`,
        },
        reason: "技术突破",
      })
    }

    if (this.detectSocialManipulation(charName, storyText)) {
      awards.push({
        characterName: charName,
        skill: {
          name: this.generateSkillName("social", storyText),
          category: SKILL_CATEGORIES.PERSUASION,
          level: 1,
          description: `在第${context.chapterCount}章中展现的社交操控能力`,
        },
        reason: "社交操控成功",
      })
    }

    if (this.detectInvestigativeInsight(charName, storyText)) {
      awards.push({
        characterName: charName,
        skill: {
          name: this.generateSkillName("analysis", storyText),
          category: SKILL_CATEGORIES.ANALYSIS,
          level: 1,
          description: `在第${context.chapterCount}章中展现的分析洞察力`,
        },
        reason: "关键洞察",
      })
    }

    if (this.detectStressResistance(charName, char, storyText)) {
      awards.push({
        characterName: charName,
        skill: {
          name: "心理韧性",
          category: SKILL_CATEGORIES.INTERROGATION_RESIST,
          level: 1,
          description: `在第${context.chapterCount}章高压环境下保持功能`,
        },
        reason: "高压抵抗",
      })
    }

    return awards
  }

  static checkTraumaTriggers(context: EvolutionContext): TraumaAward[] {
    const awards: TraumaAward[] = []
    const storyText = context.storySegment

    for (const [charName, char] of Object.entries(context.characters)) {
      if (char.status === "deceased" || char.status === "consciousness_lost") {
        continue
      }

      if (char.stress >= this.STRESS_THRESHOLD_CRITICAL) {
        awards.push({
          characterName: charName,
          trauma: {
            description: `累积压力突破临界值 (${char.stress}/100)，心理防线崩溃`,
            tags: [TRAUMA_TAGS.PSYCHOLOGICAL_FEAR, TRAUMA_TAGS.PSYCHOLOGICAL_GUILT],
            severity: 8,
          },
          reason: `压力值达到 ${char.stress}`,
        })
      }

      if (this.detectLifeThreateningEvent(charName, storyText)) {
        awards.push({
          characterName: charName,
          trauma: {
            description: this.extractTraumaDescription(charName, storyText),
            tags: [TRAUMA_TAGS.FLASHBACK, TRAUMA_TAGS.PSYCHOLOGICAL_FEAR],
            severity: this.calculateTraumaSeverity(storyText),
          },
          reason: "生命威胁事件",
        })
      }
    }

    if (awards.length > 0) {
      log.info("trauma_triggered", { count: awards.length, characters: awards.map((a) => a.characterName) })
    }

    return awards
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

  private static detectTechnicalBreakthrough(charName: string, storyText: string): boolean {
    const technicalKeywords = [
      "破解",
      "入侵",
      "解码",
      "接入",
      "加密",
      "系统",
      "突破",
      "解码",
      "关闭",
      "启动",
      "修复",
      "构建",
      "发明",
    ]
    const successKeywords = ["成功", "突破", "完成", "解锁", "获取", "揭示"]
    const hasTechnical = technicalKeywords.some((k) => storyText.includes(k))
    const hasSuccess = successKeywords.some((k) => storyText.includes(k))
    return hasTechnical && hasSuccess
  }

  private static detectSocialManipulation(charName: string, storyText: string): boolean {
    const socialKeywords = ["说服", "欺骗", "谈判", "审问", "误导", "操控", "威胁", "诱导", "蛊惑", "安抚"]
    const successKeywords = ["相信", "接受", "同意", "动摇", "妥协"]
    const hasSocial = socialKeywords.some((k) => storyText.includes(k))
    const hasSuccess = successKeywords.some((k) => storyText.includes(k))
    return hasSocial && hasSuccess
  }

  private static detectInvestigativeInsight(charName: string, storyText: string): boolean {
    const insightKeywords = ["发现", "意识到", "推断", "分析", "线索", "真相", "揭示", "看穿", "识破", "领悟"]
    return insightKeywords.some((k) => storyText.includes(k))
  }

  private static detectStressResistance(charName: string, char: CharacterState, storyText: string): boolean {
    const highStressKeywords = ["威胁", "危险", "压力", "紧张", "恐惧", "痛苦", "逼迫"]
    const resilienceKeywords = ["坚持", "冷静", "镇定", "抵抗", "承受", "保持"]
    const hasHighStress = highStressKeywords.some((k) => storyText.includes(k))
    const hasResilience = resilienceKeywords.some((k) => storyText.includes(k))
    return hasHighStress && hasResilience && char.stress >= 50
  }

  private static detectLifeThreateningEvent(charName: string, storyText: string): boolean {
    const dangerKeywords = ["死亡", "致命", "袭击", "受伤", "追杀", "爆炸", "枪击", "格式化", "抹除"]
    return dangerKeywords.some((k) => storyText.includes(charName) && storyText.includes(k))
  }

  private static extractTraumaDescription(charName: string, storyText: string): string {
    const relevantSentences = storyText.split(/[.!?]/).filter((s) => s.includes(charName))
    if (relevantSentences.length > 0) {
      return relevantSentences[0].trim().substring(0, 100)
    }
    return `在第 ${Math.floor(Math.random() * 10) + 1} 章经历的创伤事件`
  }

  private static calculateTraumaSeverity(storyText: string): number {
    const intensityKeywords = ["极度", "剧烈", "严重", "致命", "崩溃", "毁灭"]
    const count = intensityKeywords.filter((k) => storyText.includes(k)).length
    if (count >= 3) return 9
    if (count >= 2) return 7
    if (count >= 1) return 5
    return 3
  }

  private static generateSkillName(type: string, storyText: string): string {
    const skillPrefixes: Record<string, string[]> = {
      technical: ["神经", "数据", "系统", "网络", "量子"],
      social: ["心理", "言语", "情感", "社交", "谈判"],
      analysis: ["洞察", "推理", "分析", "直觉", "逻辑"],
    }

    const prefixes = skillPrefixes[type] || skillPrefixes.analysis
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)]
    const suffixes = ["突破", "掌控", "专精", "技巧", "能力"]
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)]

    return `${prefix}${suffix}`
  }
}

export const evolutionRules = EvolutionRulesEngine
