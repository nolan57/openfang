import { Log } from "../util/log"
import type {
  ProposedChanges,
  ValidatedChanges,
  CharacterState,
  SkillEntry,
  TraumaEntry,
  TurnResult,
  OutcomeType,
} from "../types/novel-state"
import { validateSkillAward, validateTraumaSeverity } from "../types/novel-state"

const log = Log.create({ service: "state-auditor" })

export interface AuditResult {
  validated: ValidatedChanges
  correctionsApplied: number
  warnings: string[]
}

export class StateAuditor {
  private readonly MAX_STRESS = 100
  private readonly CRITICAL_STRESS_THRESHOLD = 90
  private readonly SKILL_COOLDOWN_TURNS = 3
  private readonly MAX_TRUST_DELTA_PER_TURN = 50

  async auditAndFix(proposed: ProposedChanges, currentState: any, turnResult: TurnResult): Promise<AuditResult> {
    const validated: ValidatedChanges = {
      ...proposed,
      auditFlags: [],
      corrections_applied: 0,
    }
    const warnings: string[] = []

    const { outcome_type, challenge_difficulty } = turnResult

    for (const [charName, charUpdate] of Object.entries(proposed.characters || {})) {
      const currentChar = currentState.characters?.[charName] || ({} as CharacterState)
      const update = charUpdate as Partial<CharacterState>

      this.auditSkill(
        validated,
        update,
        currentChar,
        charName,
        outcome_type,
        challenge_difficulty || 5,
        currentState.turnCount,
        warnings,
      )

      this.auditTrauma(validated, update, currentChar, charName, outcome_type, currentState.turnCount || 0, warnings)

      this.auditStress(validated, update, currentChar, charName, warnings)

      this.auditRelationships(validated, update, currentChar, charName, warnings)
    }

    for (const [relKey, relUpdate] of Object.entries(proposed.relationships || {})) {
      this.auditRelationshipDelta(validated, relKey, relUpdate as any, warnings)
    }

    log.info("audit_complete", {
      flags: validated.auditFlags.length,
      corrections: validated.corrections_applied,
      warnings: warnings.length,
      outcome: outcome_type,
    })

    return {
      validated,
      correctionsApplied: validated.corrections_applied,
      warnings,
    }
  }

  private auditSkill(
    validated: ValidatedChanges,
    update: Partial<CharacterState>,
    currentChar: CharacterState,
    charName: string,
    outcome: OutcomeType,
    difficulty: number,
    currentTurn: number,
    warnings: string[],
  ): void {
    if (!update.skills || update.skills.length === 0) return

    const newSkills: SkillEntry[] = []
    const rejectedSkills: SkillEntry[] = []

    for (const skill of update.skills) {
      const canAward = validateSkillAward(outcome, difficulty)

      if (!canAward) {
        validated.auditFlags.push({
          type: "SKILL_IN_FAILURE",
          description: `${charName} gained skill "${skill.name}" during ${outcome} (difficulty ${difficulty})`,
          corrected: true,
          correction: `Skill removed, converted to stress +15`,
        })
        rejectedSkills.push(skill)
        validated.corrections_applied++
      } else {
        const isDuplicate = this.checkSkillDuplicate(currentChar, skill)
        if (isDuplicate) {
          validated.auditFlags.push({
            type: "INFLATION",
            description: `${charName} skill "${skill.name}" is redundant with recent skills`,
            corrected: true,
            correction: "Skill merged into existing skill level",
          })
          validated.corrections_applied++
        } else {
          newSkills.push(skill)
        }
      }
    }

    if (rejectedSkills.length > 0) {
      update.stress = (update.stress || 0) + 15 * rejectedSkills.length
      warnings.push(`${charName}: Rejected ${rejectedSkills.length} skill(s), added stress`)
    }

    update.skills = newSkills
  }

  private checkSkillDuplicate(currentChar: CharacterState, newSkill: SkillEntry): boolean {
    if (!currentChar.skills || currentChar.skills.length === 0) return false

    const recentSkills = currentChar.skills.filter((s) => {
      if (!s.acquiredTurn) return false
      return currentChar.skills && s.acquiredTurn >= currentChar.skills.length - this.SKILL_COOLDOWN_TURNS
    })

    const sameCategory = recentSkills.filter((s) => s.category === newSkill.category)
    return sameCategory.length >= 2
  }

  private auditTrauma(
    validated: ValidatedChanges,
    update: Partial<CharacterState>,
    currentChar: CharacterState,
    charName: string,
    outcome: OutcomeType,
    currentTurn: number,
    warnings: string[],
  ): void {
    const currentStress = currentChar.stress || 0
    const stressDelta = update.stress || 0
    const newStress = currentStress + stressDelta

    const hasHighStressEvent = stressDelta > 20 || newStress > this.CRITICAL_STRESS_THRESHOLD

    if (validateTraumaSeverity(newStress, hasHighStressEvent) && (!update.trauma || update.trauma.length === 0)) {
      validated.auditFlags.push({
        type: "MISSING_TRAUMA",
        description: `${charName} stress ${newStress} exceeds trauma threshold without trauma entry`,
        corrected: true,
        correction: "Auto-generated trauma entry",
      })

      if (!update.trauma) update.trauma = []

      update.trauma.push({
        id: this.generateId(),
        name: this.generateTraumaName(charName, "stress_overload"),
        description: `Psychological wound from cumulative stress and ${outcome.toLowerCase()}`,
        tags: this.inferTraumaTags(outcome),
        severity: Math.min(10, Math.floor(newStress / 10) + 1),
        source_event: `Turn ${currentChar.skills?.[0]?.acquiredTurn || "?"} - ${outcome}`,
        acquiredChapter: currentChar.skills?.[0]?.acquiredChapter || 1,
        acquiredTurn: currentTurn,
        triggers: [],
      } as TraumaEntry)

      validated.corrections_applied++
      warnings.push(`${charName}: Auto-added trauma due to stress ${newStress}`)
    }
  }

  private auditStress(
    validated: ValidatedChanges,
    update: Partial<CharacterState>,
    currentChar: CharacterState,
    charName: string,
    warnings: string[],
  ): void {
    const currentStress = currentChar.stress || 0
    const stressDelta = update.stress || 0
    const newStress = currentStress + stressDelta

    if (newStress > this.MAX_STRESS) {
      validated.auditFlags.push({
        type: "STRESS_OVERFLOW",
        description: `${charName} stress would exceed ${this.MAX_STRESS} (calculated: ${newStress})`,
        corrected: true,
        correction: `Stress clamped to ${this.MAX_STRESS}`,
      })
      update.stress = this.MAX_STRESS - currentStress
      validated.corrections_applied++
      warnings.push(`${charName}: Stress clamped from ${newStress} to ${this.MAX_STRESS}`)
    }

    if (newStress > this.CRITICAL_STRESS_THRESHOLD) {
      warnings.push(`⚠️ ${charName} approaching critical stress: ${newStress}/${this.MAX_STRESS}`)
    }
  }

  private auditRelationships(
    validated: ValidatedChanges,
    update: Partial<CharacterState>,
    currentChar: CharacterState,
    charName: string,
    warnings: string[],
  ): void {
    if (!update.relationships) return

    for (const [otherChar, relData] of Object.entries(update.relationships)) {
      const delta = typeof relData === "number" ? relData : (relData as any).trust || 0
      if (Math.abs(delta) > this.MAX_TRUST_DELTA_PER_TURN) {
        warnings.push(`${charName} -> ${otherChar}: Large trust delta (${delta}) should have dramatic justification`)
      }
    }
  }

  private auditRelationshipDelta(
    validated: ValidatedChanges,
    relKey: string,
    relUpdate: any,
    warnings: string[],
  ): void {
    const trustDelta = relUpdate.trust || 0

    if (Math.abs(trustDelta) > this.MAX_TRUST_DELTA_PER_TURN) {
      validated.auditFlags.push({
        type: "IMPOSSIBLE_CHANGE",
        description: `Trust shift ${trustDelta} in ${relKey} exceeds maximum per-turn delta`,
        corrected: true,
        correction: `Delta clamped to ${Math.sign(trustDelta) * this.MAX_TRUST_DELTA_PER_TURN}`,
      })
      relUpdate.trust = Math.sign(trustDelta) * this.MAX_TRUST_DELTA_PER_TURN
      validated.corrections_applied++
      warnings.push(`${relKey}: Trust delta clamped to ±${this.MAX_TRUST_DELTA_PER_TURN}`)
    }
  }

  private generateId(): string {
    return `_${Math.random().toString(36).substr(2, 9)}`
  }

  private generateTraumaName(character: string, cause: string): string {
    const keywords = cause.split("_").map((k) => k.charAt(0).toUpperCase() + k.slice(1).toLowerCase())
    const suffix = ["Shock", "Wound", "Scar", "Phobia", "PTSD"][Math.floor(Math.random() * 5)]
    return `${character}_${keywords.join("")}_${suffix}`
  }

  private inferTraumaTags(outcome: OutcomeType): string[] {
    switch (outcome) {
      case "FAILURE":
        return ["Psychological_Fear", "Social_Humiliation"]
      case "COMPLICATION":
        return ["Psychological_Guilt", "Social_Isolation"]
      case "SUCCESS":
        return []
      case "NEUTRAL":
        return ["Psychological_Fear"]
      default:
        return ["Psychological_Fear"]
    }
  }

  get currentTurn(): number {
    return 0
  }
}

export const stateAuditor = new StateAuditor()
