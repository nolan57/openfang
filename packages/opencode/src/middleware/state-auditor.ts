import { Log } from "../util/log"
import type { CharacterState, StoryBible } from "../types/novel-state"

const log = Log.create({ service: "state-auditor" })

export interface TurnStatistics {
  turnNumber: number
  charactersAffected: number
  skillsAwarded: number
  traumasInflicted: number
  stressChanges: { character: string; before: number; after: number; delta: number }[]
  relationshipChanges: number
  specialEvents: string[]
}

export interface SpecialEvent {
  type: "BREAKDOWN" | "TRAUMA_FLASHBACK" | "RELATIONSHIP_RUPTURE" | "SKILL_MASTERED"
  character: string
  description: string
  severity: number
}

export class StateAuditor {
  private readonly BREAKDOWN_THRESHOLD = 90
  private readonly HIGH_STRESS_THRESHOLD = 70
  private readonly MAX_SKILLS_PER_TURN = 2
  private readonly MAX_TRAUMAS_PER_TURN = 1

  analyzeTurn(beforeState: StoryBible, afterState: StoryBible, turnNumber: number): TurnStatistics {
    const stats: TurnStatistics = {
      turnNumber,
      charactersAffected: 0,
      skillsAwarded: 0,
      traumasInflicted: 0,
      stressChanges: [],
      relationshipChanges: 0,
      specialEvents: [],
    }

    for (const [charName, afterChar] of Object.entries(afterState.characters || {})) {
      const beforeChar = beforeState.characters?.[charName]
      if (!beforeChar) {
        stats.charactersAffected++
        continue
      }

      // 统计 stress 变化
      if (beforeChar.stress !== afterChar.stress) {
        stats.stressChanges.push({
          character: charName,
          before: beforeChar.stress || 0,
          after: afterChar.stress || 0,
          delta: (afterChar.stress || 0) - (beforeChar.stress || 0),
        })
        stats.charactersAffected++
      }

      // 统计技能获取
      const newSkills = (afterChar.skills || []).filter(
        (s: any) => !beforeChar.skills?.some((bs: any) => bs.name === s.name),
      )
      stats.skillsAwarded += newSkills.length

      // 统计创伤
      const newTraumas = (afterChar.trauma || []).filter(
        (t: any) => !beforeChar.trauma?.some((bt: any) => bt.name === t.name),
      )
      stats.traumasInflicted += newTraumas.length
    }

    // 统计关系变化
    const relBefore = Object.keys(beforeState.relationships || {}).length
    const relAfter = Object.keys(afterState.relationships || {}).length
    stats.relationshipChanges = Math.max(0, relAfter - relBefore)

    return stats
  }

  detectSpecialEvents(state: StoryBible, stats: TurnStatistics): SpecialEvent[] {
    const events: SpecialEvent[] = []

    for (const [charName, char] of Object.entries(state.characters || {})) {
      const stress = char.stress || 0

      // 角色崩溃风险
      if (stress >= this.BREAKDOWN_THRESHOLD) {
        events.push({
          type: "BREAKDOWN",
          character: charName,
          description: `${charName} 心理压力达到 ${stress}，处于崩溃边缘`,
          severity: 10,
        })
      }

      // 高压力预警
      if (stress >= this.HIGH_STRESS_THRESHOLD && stress < this.BREAKDOWN_THRESHOLD) {
        events.push({
          type: "TRAUMA_FLASHBACK",
          character: charName,
          description: `${charName} 压力过高 (${stress})，可能触发创伤闪回`,
          severity: 6,
        })
      }

      // 技能过多检查
      const newSkillsThisTurn = (char.skills || []).filter((s: any) => s.acquiredTurn === state.turnCount)
      if (newSkillsThisTurn.length > this.MAX_SKILLS_PER_TURN) {
        log.warn("skill_inflation_risk", { character: charName, count: newSkillsThisTurn.length })
      }
    }

    // 关系破裂检测
    for (const [relKey, rel] of Object.entries(state.relationships || {})) {
      if ((rel as any).trust <= -80) {
        const [char1, char2] = relKey.split("-")
        events.push({
          type: "RELATIONSHIP_RUPTURE",
          character: `${char1} & ${char2}`,
          description: `${char1} 和 ${char2} 关系彻底破裂 (信任: ${(rel as any).trust})`,
          severity: 8,
        })
      }
    }

    return events
  }

  checkConsistency(state: StoryBible): string[] {
    const warnings: string[] = []

    for (const [charName, char] of Object.entries(state.characters || {})) {
      // 检查技能重复
      const skillNames = (char.skills || []).map((s: any) => s.name)
      const duplicates = skillNames.filter((name, idx) => skillNames.indexOf(name) !== idx)
      if (duplicates.length > 0) {
        warnings.push(`${charName}: 重复技能 ${duplicates.join(", ")}`)
      }

      // 检查 stress 范围
      if ((char.stress || 0) > 100 || (char.stress || 0) < 0) {
        warnings.push(`${charName}: stress 值异常 (${char.stress})`)
      }

      // 检查创伤严重度
      for (const trauma of char.trauma || []) {
        if ((trauma as any).severity > 10 || (trauma as any).severity < 1) {
          warnings.push(`${charName}: 创伤 ${trauma.name} 严重度异常`)
        }
      }
    }

    return warnings
  }

  // 兜底逻辑：当 LLM 没有返回任何更新时，提供默认值
  provideFallback(
    state: StoryBible,
    storyText: string,
    outcome: string,
    difficulty: number,
  ): Partial<StoryBible> {
    const fallback: Partial<StoryBible> = {}

    // 如果没有角色更新，添加默认 stress 变化
    if (!fallback.characters || Object.keys(fallback.characters).length === 0) {
      const stressMap: Record<string, number> = {
        SUCCESS: 5,
        COMPLICATION: 15,
        FAILURE: 25,
        NEUTRAL: 0,
      }
      const delta = stressMap[outcome] || 0

      if (delta !== 0) {
        for (const charName of Object.keys(state.characters || {})) {
          if (!fallback.characters) fallback.characters = {}
          fallback.characters[charName] = {
            stress: delta,
            status: "active",
            traits: [],
            trauma: [],
            skills: [],
            secrets: [],
            clues: [],
            goals: [],
          }
        }
        log.info("fallback_stress_applied", { outcome, delta })
      }
    }

    return fallback
  }

  generateReport(stats: TurnStatistics, events: SpecialEvent[]): string {
    const lines: string[] = []
    lines.push(`📊 Turn ${stats.turnNumber} Analysis`)
    lines.push(`- Characters affected: ${stats.charactersAffected}`)
    lines.push(`- Skills awarded: ${stats.skillsAwarded}`)
    lines.push(`- Traumas inflicted: ${stats.traumasInflicted}`)
    lines.push(`- Relationship changes: ${stats.relationshipChanges}`)

    if (stats.stressChanges.length > 0) {
      lines.push("\n🔴 Stress Changes:")
      for (const change of stats.stressChanges) {
        const sign = change.delta > 0 ? "+" : ""
        lines.push(`  ${change.character}: ${change.before} → ${change.after} (${sign}${change.delta})`)
      }
    }

    if (events.length > 0) {
      lines.push("\n⚠️  Special Events:")
      for (const event of events) {
        lines.push(`  [${event.type}] ${event.character}: ${event.description}`)
      }
    }

    return lines.join("\n")
  }
}

export const stateAuditor = new StateAuditor()
