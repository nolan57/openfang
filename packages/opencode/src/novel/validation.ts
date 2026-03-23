import { z } from "zod"
import { Log } from "../util/log"
import {
  TraumaEntrySchema,
  SkillEntrySchema,
  GoalSchema,
  RelationshipSchema,
  MindModelSchema,
  WorldStateSchema,
  EvolutionSummarySchema,
} from "../types/novel-state"

const log = Log.create({ service: "validation" })

export const RawCharacterUpdate = z.object({
  name: z.string(),
  stress_delta: z.number().optional(),
  status_change: z.string().optional(),
  emotions: z
    .object({
      valence_delta: z.number().optional(),
      arousal_delta: z.number().optional(),
      dominant: z.string().optional(),
    })
    .optional(),
  new_trait: z.string().optional(),
  new_trauma: z
    .object({
      name: z.string(),
      description: z.string(),
      tags: z.array(z.string()),
      severity: z.number().min(1).max(10),
      source_event: z.string(),
    })
    .optional(),
  new_skill: z
    .object({
      name: z.string(),
      category: z.string(),
      level: z.number().min(1).max(10).optional(),
      description: z.string().optional(),
      source_event: z.string(),
      difficulty: z.number().min(1).max(10).optional(),
    })
    .optional(),
  secrets: z.array(z.string()).optional(),
  clues: z.array(z.string()).optional(),
  goals: z
    .array(
      z.object({
        type: z.string(),
        description: z.string(),
        priority: z.number().min(1).max(10),
        status: z.enum(["active", "completed", "failed", "abandoned", "paused"]),
      }),
    )
    .optional(),
  notes: z.string().optional(),
  relationship_deltas: z.record(z.string(), z.number()).optional(),
  mindModel: z
    .object({
      publicSelf: z.string(),
      privateSelf: z.string(),
      blindSpot: z.string(),
    })
    .optional(),
})

export const RawRelationshipUpdate = z.object({
  trust: z.number().min(-100).max(100).optional(),
  hostility: z.number().min(0).max(100).optional(),
  dominance: z.number().min(-100).max(100).optional(),
  friendliness: z.number().min(-100).max(100).optional(),
  dynamic: z.string().optional(),
  attachmentStyle: z.enum(["secure", "anxious", "avoidant", "disorganized"]).optional(),
})

export const RawWorldUpdate = z.object({
  events_resolved: z.array(z.string()).optional(),
  new_threats: z.array(z.string()).optional(),
  new_opportunities: z.array(z.string()).optional(),
  clues_discovered: z.array(z.string()).optional(),
  location_change: z.string().optional(),
  timeProgression: z.string().optional(),
})

export const RawStateUpdate = z
  .object({
    character_updates: z.array(RawCharacterUpdate).optional(),
    relationships: z.record(z.string(), RawRelationshipUpdate).optional(),
    world_updates: RawWorldUpdate.optional(),
    evolution_summary: EvolutionSummarySchema.optional(),
  })
  .passthrough()

export interface ValidationResult<T> {
  success: boolean
  data?: T
  error?: string
}

function formatZodError(error: z.ZodError): string {
  return error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")
}

/**
 * Check if an inconsistency is critical (requires immediate attention)
 */
function isCriticalInconsistency(error: string): boolean {
  const criticalPatterns = [
    "dead character",
    "cannot gain skill",
    "cannot change status",
    "destroyed location",
    "non-existent character",
    "state conflict",
  ]
  return criticalPatterns.some((pattern) => error.toLowerCase().includes(pattern))
}

/**
 * Check fact consistency of parsed state update against current world state
 * Returns null if consistent, or an error message if inconsistent
 */
function checkFactConsistency(parsedData: z.infer<typeof RawStateUpdate>, worldState: any): string | null {
  // Check character updates
  if (parsedData.character_updates) {
    for (const update of parsedData.character_updates) {
      const charName = update.name
      const currentChar = worldState?.characters?.[charName]

      // Rule 1: Dead/inactive characters cannot have positive state changes
      if (currentChar) {
        const currentStatus = currentChar.status?.toLowerCase() || "active"

        if (currentStatus === "dead" || currentStatus === "deceased") {
          if (update.new_skill) {
            return `Dead character '${charName}' cannot gain new skill '${update.new_skill.name}'`
          }
          if (
            update.status_change &&
            !["dead", "deceased", "undead", "ghost"].includes(update.status_change.toLowerCase())
          ) {
            return `Dead character '${charName}' cannot change status to '${update.status_change}'`
          }
          if (update.new_trait) {
            return `Dead character '${charName}' cannot gain new trait '${update.new_trait}'`
          }
        }

        if (currentStatus === "inactive") {
          if (update.new_skill || update.new_trait) {
            return `Inactive character '${charName}' cannot gain skills or traits`
          }
        }
      }

      // Rule 2: Cannot establish relationships with non-existent characters
      if (update.relationship_deltas) {
        for (const [otherChar] of Object.entries(update.relationship_deltas)) {
          if (!worldState?.characters?.[otherChar]) {
            return `Cannot establish relationship with non-existent character '${otherChar}'`
          }
        }
      }
    }
  }

  // Check world updates
  if (parsedData.world_updates) {
    const worldUpdate = parsedData.world_updates

    // Rule 3: Cannot have events at destroyed locations
    if (worldUpdate.location_change) {
      const currentLocation = worldState?.world?.location
      if (currentLocation) {
        const destroyedLocations = worldState?.world?.destroyedLocations || []
        if (destroyedLocations.includes(worldUpdate.location_change)) {
          return `Cannot move to destroyed location '${worldUpdate.location_change}'`
        }
      }
    }
  }

  // Check relationship updates
  if (parsedData.relationships) {
    for (const [relKey] of Object.entries(parsedData.relationships)) {
      const [charA, charB] = relKey.split("-")
      if (!worldState?.characters?.[charA]) {
        return `Cannot update relationship: character '${charA}' does not exist`
      }
      if (!worldState?.characters?.[charB]) {
        return `Cannot update relationship: character '${charB}' does not exist`
      }
    }
  }

  return null
}

/**
 * Validate raw state update with world context for fact consistency
 * Performs both schema validation and fact consistency checks
 */
export function validateRawStateUpdateWithWorldContext(
  data: unknown,
  worldState: any,
): ValidationResult<z.infer<typeof RawStateUpdate>> {
  // First, perform basic schema validation
  const schemaResult = validateRawStateUpdate(data)
  if (!schemaResult.success) {
    return schemaResult
  }

  // Then, perform fact consistency checks
  const parsedData = schemaResult.data!
  const factError = checkFactConsistency(parsedData, worldState)

  if (factError) {
    // Log critical inconsistencies as structured events
    if (isCriticalInconsistency(factError)) {
      log.error("critical_fact_inconsistency_detected", {
        error: factError,
        updateData: data,
        worldState: {
          characters: Object.keys(worldState?.characters || {}),
          location: worldState?.world?.location,
        },
      })
    } else {
      log.warn("fact_inconsistency_detected", {
        error: factError,
        updateData: data,
      })
    }

    return {
      success: false,
      error: `Fact consistency check failed: ${factError}`,
    }
  }

  return { success: true, data: parsedData }
}

/**
 * Validate raw state update (schema validation only, no world context)
 * Kept for backward compatibility
 */
export function validateRawStateUpdate(data: unknown): ValidationResult<z.infer<typeof RawStateUpdate>> {
  try {
    const result = RawStateUpdate.safeParse(data)
    if (result.success) {
      return { success: true, data: result.data }
    }
    return { success: false, error: formatZodError(result.error) }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

export function validateTrauma(data: unknown): ValidationResult<z.infer<typeof TraumaEntrySchema>> {
  try {
    const result = TraumaEntrySchema.safeParse(data)
    if (result.success) {
      return { success: true, data: result.data }
    }
    return { success: false, error: formatZodError(result.error) }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

export function validateSkill(data: unknown): ValidationResult<z.infer<typeof SkillEntrySchema>> {
  try {
    const result = SkillEntrySchema.safeParse(data)
    if (result.success) {
      return { success: true, data: result.data }
    }
    return { success: false, error: formatZodError(result.error) }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

export function validateGoal(data: unknown): ValidationResult<z.infer<typeof GoalSchema>> {
  try {
    const result = GoalSchema.safeParse(data)
    if (result.success) {
      return { success: true, data: result.data }
    }
    return { success: false, error: formatZodError(result.error) }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

/**
 * Validate goal with character context
 * Ensures goal is appropriate for character's current state
 */
export function validateGoalWithContext(
  data: unknown,
  characterState: any,
): ValidationResult<z.infer<typeof GoalSchema>> {
  const goalResult = GoalSchema.safeParse(data)
  if (!goalResult.success) {
    return { success: false, error: formatZodError(goalResult.error) }
  }

  const goal = goalResult.data

  // Check if goal status change is valid
  if (characterState?.goals) {
    const existingGoal = characterState.goals.find((g: any) => g.type === goal.type)
    if (existingGoal && existingGoal.status === "completed" && goal.status === "active") {
      log.warn("completed_goal_reactivated", {
        goalType: goal.type,
        character: characterState.name,
      })
    }
  }

  return { success: true, data: goal }
}

/**
 * Validate trauma with character context
 * Ensures trauma severity matches stress level and event context
 */
export function validateTraumaWithContext(
  data: unknown,
  characterState: any,
  eventContext?: string,
): ValidationResult<z.infer<typeof TraumaEntrySchema>> {
  const traumaResult = TraumaEntrySchema.safeParse(data)
  if (!traumaResult.success) {
    return { success: false, error: formatZodError(traumaResult.error) }
  }

  const trauma = traumaResult.data
  const currentStress = characterState?.stress || 0

  // Warn if trauma severity doesn't match stress level
  if (trauma.severity > 7 && currentStress < 50) {
    log.warn("high_severity_trauma_low_stress", {
      character: characterState?.name,
      traumaSeverity: trauma.severity,
      currentStress,
      traumaName: trauma.name,
    })
  }

  // Warn if trauma is added without significant stress event
  if (trauma.severity >= 5 && currentStress < 30 && !eventContext) {
    log.warn("trauma_without_stress_context", {
      character: characterState?.name,
      traumaSeverity: trauma.severity,
      currentStress,
    })
  }

  return { success: true, data: trauma }
}

/**
 * Validate skill with character context
 * Ensures skill award is justified by achievement and outcome
 */
export function validateSkillWithContext(
  data: unknown,
  characterState: any,
  outcomeType?: string,
  difficulty?: number,
): ValidationResult<z.infer<typeof SkillEntrySchema>> {
  const skillResult = SkillEntrySchema.safeParse(data)
  if (!skillResult.success) {
    return { success: false, error: formatZodError(skillResult.error) }
  }

  const skill = skillResult.data

  // Check for skill inflation (too many skills in short time)
  const recentSkills =
    characterState?.skills?.filter((s: any) => {
      const acquiredTurn = s.acquiredTurn || 0
      const currentTurn = characterState?.currentTurn || 0
      return currentTurn - acquiredTurn < 3
    }) || []

  if (recentSkills.length >= 2) {
    log.warn("skill_inflation_detected", {
      character: characterState?.name,
      recentSkillsCount: recentSkills.length,
      newSkill: skill.name,
    })
  }

  // Warn if skill awarded during failure without clear justification
  if (outcomeType === "FAILURE" && difficulty && difficulty < 7) {
    log.warn("skill_awarded_on_failure", {
      character: characterState?.name,
      skill: skill.name,
      outcomeType,
      difficulty,
    })
  }

  return { success: true, data: skill }
}

export function validateRelationship(data: unknown): ValidationResult<z.infer<typeof RelationshipSchema>> {
  try {
    const result = RelationshipSchema.safeParse(data)
    if (result.success) {
      return { success: true, data: result.data }
    }
    return { success: false, error: formatZodError(result.error) }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

export function validateMindModel(data: unknown): ValidationResult<z.infer<typeof MindModelSchema>> {
  try {
    const result = MindModelSchema.safeParse(data)
    if (result.success) {
      return { success: true, data: result.data }
    }
    return { success: false, error: formatZodError(result.error) }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

export function validateWorldState(data: unknown): ValidationResult<z.infer<typeof WorldStateSchema>> {
  try {
    const result = WorldStateSchema.safeParse(data)
    if (result.success) {
      return { success: true, data: result.data }
    }
    return { success: false, error: formatZodError(result.error) }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

/**
 * Validate character update with world context
 * Checks for state conflicts and impossible changes
 */
export function validateCharacterUpdateWithContext(
  data: unknown,
  worldState: any,
): ValidationResult<z.infer<typeof RawCharacterUpdate>> {
  const charResult = RawCharacterUpdate.safeParse(data)
  if (!charResult.success) {
    return { success: false, error: formatZodError(charResult.error) }
  }

  const update = charResult.data
  const currentChar = worldState?.characters?.[update.name]

  // Check for impossible changes
  if (currentChar) {
    const currentStatus = currentChar.status?.toLowerCase() || "active"

    if (currentStatus === "dead" || currentStatus === "deceased") {
      if (update.new_skill) {
        return {
          success: false,
          error: `Dead character '${update.name}' cannot gain skill`,
        }
      }
      if (update.stress_delta && update.stress_delta > 0) {
        log.warn("dead_character_stress_increase", {
          character: update.name,
          stressDelta: update.stress_delta,
        })
      }
    }
  }

  return { success: true, data: update }
}

/**
 * Validate relationship update with world context
 * Ensures both characters exist and relationship change is valid
 */
export function validateRelationshipUpdateWithContext(
  relKey: string,
  data: unknown,
  worldState: any,
): ValidationResult<z.infer<typeof RawRelationshipUpdate>> {
  const relResult = RawRelationshipUpdate.safeParse(data)
  if (!relResult.success) {
    return { success: false, error: formatZodError(relResult.error) }
  }

  const [charA, charB] = relKey.split("-")

  // Check both characters exist
  if (!worldState?.characters?.[charA]) {
    return {
      success: false,
      error: `Relationship update failed: character '${charA}' does not exist`,
    }
  }
  if (!worldState?.characters?.[charB]) {
    return {
      success: false,
      error: `Relationship update failed: character '${charB}' does not exist`,
    }
  }

  // Check for impossible trust changes
  const update = relResult.data
  const currentRel = worldState?.relationships?.[relKey]

  if (currentRel && update.trust) {
    const trustChange = update.trust
    const absChange = Math.abs(trustChange)

    // Flag extreme trust changes without dramatic events
    if (absChange > 50) {
      log.warn("extreme_trust_change", {
        relationship: relKey,
        trustChange,
        currentTrust: currentRel.trust,
      })
    }
  }

  return { success: true, data: update }
}

export class RetryConfig {
  maxRetries: number = 3
  baseDelayMs: number = 1000
  maxDelayMs: number = 10000

  constructor(partial?: Partial<RetryConfig>) {
    Object.assign(this, partial)
  }

  getDelay(attempt: number): number {
    const delay = this.baseDelayMs * Math.pow(2, attempt)
    return Math.min(delay, this.maxDelayMs)
  }
}

export async function withRetry<T>(fn: () => Promise<T>, config: RetryConfig = new RetryConfig()): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))

      if (attempt < config.maxRetries) {
        const delay = config.getDelay(attempt)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError ?? new Error("Retry failed")
}

export interface CorrelationContext {
  correlationId: string
  timestamp: number
  operation: string
}

let correlationCounter = 0

export function createCorrelationId(): string {
  correlationCounter++
  return `${Date.now()}-${correlationCounter}`
}

export function createCorrelationContext(operation: string): CorrelationContext {
  return {
    correlationId: createCorrelationId(),
    timestamp: Date.now(),
    operation,
  }
}
