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
  type TraumaEntry,
  type SkillEntry,
  type Goal,
  type Relationship,
  type MindModel,
  type WorldState,
  type EvolutionSummary,
} from "../types/novel-state"

const log = Log.create({ service: "validation" })

// ============================================================================
// SCHEMA DEFINITIONS (stricter than original: min(1), defaults, etc.)
// ============================================================================

export const RawCharacterUpdate = z.object({
  name: z.string().min(1, "Character name is required"),
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
      name: z.string().min(1),
      description: z.string().min(1),
      tags: z.array(z.string()).min(1, "Trauma must have at least one tag"),
      severity: z.number().min(1).max(10),
      source_event: z.string().min(1),
    })
    .optional(),
  new_skill: z
    .object({
      name: z.string().min(1),
      category: z.string().min(1),
      level: z.number().min(1).max(10).optional().default(1),
      description: z.string().optional(),
      source_event: z.string().min(1),
      difficulty: z.number().min(1).max(10).optional(),
    })
    .optional(),
  secrets: z.array(z.string()).optional(),
  clues: z.array(z.string()).optional(),
  goals: z
    .array(
      z.object({
        type: z.string().min(1),
        description: z.string().min(1),
        priority: z.number().min(1).max(10),
        status: z.enum(["active", "completed", "failed", "abandoned", "paused"]),
      }),
    )
    .optional(),
  notes: z.string().optional(),
  relationship_deltas: z.record(z.string(), z.number()).optional(),
  mindModel: z
    .object({
      publicSelf: z.string().min(1),
      privateSelf: z.string().min(1),
      blindSpot: z.string().min(1),
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

// ============================================================================
// VALIDATION RESULT TYPES
// ============================================================================

export interface ValidationResult<T> {
  success: boolean
  data?: T
  /** Single error string — kept for backward compatibility */
  error?: string
  /** Structured error list — prefer this when available */
  errors?: ValidationError[]
}

export interface ValidationError {
  path: string
  message: string
  severity: "warning" | "error"
  context?: Record<string, any>
}

// ============================================================================
// PERFORMANCE: LRU VALIDATION CACHE
// ============================================================================

class ValidationCache {
  private static readonly MAX_SIZE = 1000
  readonly cache = new Map<string, ValidationResult<any>>()

  set(key: string, result: ValidationResult<any>): void {
    if (this.cache.size >= ValidationCache.MAX_SIZE) {
      const first = this.cache.keys().next()
      if (!first.done) this.cache.delete(first.value)
    }
    this.cache.set(key, result)
  }

  get(key: string): ValidationResult<any> | undefined {
    return this.cache.get(key)
  }

  clear(): void {
    this.cache.clear()
  }
}

const validationCache = new ValidationCache()

// ============================================================================
// ERROR FORMATTING UTILITIES
// ============================================================================

function formatZodError(error: z.ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    severity: "error" as const,
    context: {
      code: issue.code,
      received: (issue as any).received,
      expected: (issue as any).expected,
    },
  }))
}

function createValidationError(path: string, message: string, context?: Record<string, any>): ValidationError {
  return { path, message, severity: "error", context }
}

// ============================================================================
// GENERIC VALIDATION WRAPPER (reduces boilerplate)
// ============================================================================

function wrapValidation<T>(schema: z.ZodType<T>, data: unknown, cachePrefix: string): ValidationResult<T> {
  const cacheKey = `${cachePrefix}_${JSON.stringify(data)}`
  const cached = validationCache.get(cacheKey)
  if (cached) return cached

  try {
    const result = schema.safeParse(data)
    if (result.success) {
      const vr: ValidationResult<T> = { success: true, data: result.data }
      validationCache.set(cacheKey, vr)
      return vr
    }
    const formatted = formatZodError(result.error)
    const vr: ValidationResult<T> = {
      success: false,
      errors: formatted,
      error: formatted.map((e) => e.message).join("; "),
    }
    validationCache.set(cacheKey, vr)
    return vr
  } catch (e) {
    const vr: ValidationResult<T> = { success: false, error: String(e) }
    validationCache.set(cacheKey, vr)
    return vr
  }
}

// ============================================================================
// CRITICAL INCONSISTENCY DETECTION
// ============================================================================

function isCriticalInconsistency(error: string): boolean {
  const criticalPatterns = [
    "dead character",
    "cannot gain skill",
    "cannot change status",
    "destroyed location",
    "non-existent character",
    "state conflict",
    "invalid relationship",
    "impossible action",
  ]
  return criticalPatterns.some((pattern) => error.toLowerCase().includes(pattern))
}

// ============================================================================
// FACT CONSISTENCY CHECKS (returns ValidationError[] instead of string | null)
// ============================================================================

interface WorldStateContext {
  characters?: Record<string, any>
  relationships?: Record<string, any>
  world?: any
  chapterCount?: number
  turnCount?: number
}

function checkFactConsistency(
  parsedData: z.infer<typeof RawStateUpdate>,
  worldState: WorldStateContext,
): ValidationError[] {
  const errors: ValidationError[] = []

  // Check character updates
  if (parsedData.character_updates) {
    for (const update of parsedData.character_updates) {
      const charName = update.name
      const currentChar = worldState?.characters?.[charName]

      if (currentChar) {
        const currentStatus = currentChar.status?.toLowerCase() || "active"

        if (currentStatus === "dead" || currentStatus === "deceased") {
          if (update.new_skill) {
            errors.push(createValidationError(
              `character_updates.${charName}.new_skill`,
              `Dead character '${charName}' cannot gain new skill '${update.new_skill.name}'`,
              { character: charName, skill: update.new_skill.name, status: currentStatus },
            ))
          }
          if (
            update.status_change &&
            !["dead", "deceased", "undead", "ghost"].includes(update.status_change.toLowerCase())
          ) {
            errors.push(createValidationError(
              `character_updates.${charName}.status_change`,
              `Dead character '${charName}' cannot change status to '${update.status_change}'`,
              { character: charName, newStatus: update.status_change, currentStatus },
            ))
          }
          if (update.new_trait) {
            errors.push(createValidationError(
              `character_updates.${charName}.new_trait`,
              `Dead character '${charName}' cannot gain new trait '${update.new_trait}'`,
              { character: charName, trait: update.new_trait, status: currentStatus },
            ))
          }
          if (update.stress_delta && update.stress_delta > 0) {
            errors.push({
              path: `character_updates.${charName}.stress_delta`,
              message: `Dead character '${charName}' cannot have positive stress change`,
              severity: "warning",
              context: { character: charName, stressDelta: update.stress_delta, status: currentStatus },
            })
          }
        }

        if (currentStatus === "inactive") {
          if (update.new_skill) {
            errors.push(createValidationError(
              `character_updates.${charName}.new_skill`,
              `Inactive character '${charName}' cannot gain skills`,
              { character: charName, status: currentStatus },
            ))
          }
          if (update.new_trait) {
            errors.push(createValidationError(
              `character_updates.${charName}.new_trait`,
              `Inactive character '${charName}' cannot gain traits`,
              { character: charName, status: currentStatus },
            ))
          }
        }
      }

      // Cannot establish relationships with non-existent characters
      if (update.relationship_deltas) {
        for (const [otherChar, delta] of Object.entries(update.relationship_deltas)) {
          if (!worldState?.characters?.[otherChar]) {
            errors.push(createValidationError(
              `character_updates.${charName}.relationship_deltas.${otherChar}`,
              `Cannot establish relationship with non-existent character '${otherChar}'`,
              { character: charName, otherCharacter: otherChar },
            ))
          }
        }
      }
    }
  }

  // Check world updates
  if (parsedData.world_updates) {
    const worldUpdate = parsedData.world_updates
    if (worldUpdate.location_change) {
      const destroyedLocations = worldState?.world?.destroyedLocations || []
      if (destroyedLocations.includes(worldUpdate.location_change)) {
        errors.push(createValidationError(
          "world_updates.location_change",
          `Cannot move to destroyed location '${worldUpdate.location_change}'`,
          { location: worldUpdate.location_change, destroyed: true },
        ))
      }
    }
  }

  // Check relationship updates
  if (parsedData.relationships) {
    for (const [relKey, relUpdate] of Object.entries(parsedData.relationships)) {
      const [charA, charB] = relKey.split("-")
      if (!worldState?.characters?.[charA]) {
        errors.push(createValidationError(
          `relationships.${relKey}.character_a`,
          `Cannot update relationship: character '${charA}' does not exist`,
          { relationship: relKey, character: charA },
        ))
      }
      if (!worldState?.characters?.[charB]) {
        errors.push(createValidationError(
          `relationships.${relKey}.character_b`,
          `Cannot update relationship: character '${charB}' does not exist`,
          { relationship: relKey, character: charB },
        ))
      }
      if (relUpdate.trust !== undefined && (relUpdate.trust < -100 || relUpdate.trust > 100)) {
        errors.push({
          path: `relationships.${relKey}.trust`,
          message: `Trust value out of range [-100, 100]: ${relUpdate.trust}`,
          severity: "warning",
          context: { relationship: relKey, trust: relUpdate.trust },
        })
      }
    }
  }

  return errors
}

// ============================================================================
// CONTEXT-AWARE VALIDATION FUNCTIONS
// ============================================================================

export function validateGoalWithContext(
  data: unknown,
  characterState: any,
): ValidationResult<z.infer<typeof GoalSchema>> {
  try {
    const result = GoalSchema.safeParse(data)
    if (!result.success) {
      return { success: false, errors: formatZodError(result.error) }
    }

    const goal = result.data as Goal
    const errors: ValidationError[] = []

    if (characterState?.goals) {
      const existingGoal = characterState.goals.find((g: Goal) => g.type === goal.type)
      if (existingGoal && existingGoal.status === "completed" && goal.status === "active") {
        log.warn("completed_goal_reactivated", { goalType: goal.type, character: characterState.name })
        errors.push({
          path: "status",
          message: "Goal was previously completed but is being reactivated",
          severity: "warning",
          context: { existingStatus: existingGoal.status, newStatus: goal.status },
        })
      }
    }

    return {
      success: errors.every((e) => e.severity !== "error"),
      data: goal,
      errors: errors.length > 0 ? errors : undefined,
    }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

export function validateTraumaWithContext(
  data: unknown,
  characterState: any,
  eventContext?: string,
): ValidationResult<z.infer<typeof TraumaEntrySchema>> {
  try {
    const result = TraumaEntrySchema.safeParse(data)
    if (!result.success) {
      return { success: false, errors: formatZodError(result.error) }
    }

    const trauma = result.data as TraumaEntry
    const currentStress = characterState?.stress || 0
    const errors: ValidationError[] = []

    if (trauma.severity > 7 && currentStress < 50) {
      log.warn("high_severity_trauma_low_stress", {
        character: characterState?.name,
        traumaSeverity: trauma.severity,
        currentStress,
        traumaName: trauma.name,
      })
      errors.push({
        path: "severity",
        message: `High severity trauma (${trauma.severity}) with low current stress (${currentStress})`,
        severity: "warning",
        context: { traumaSeverity: trauma.severity, currentStress },
      })
    }

    if (trauma.severity >= 5 && currentStress < 30 && !eventContext) {
      log.warn("trauma_without_stress_context", {
        character: characterState?.name,
        traumaSeverity: trauma.severity,
        currentStress,
      })
      errors.push({
        path: "source_event",
        message: `Trauma severity ${trauma.severity} added without significant stress event`,
        severity: "warning",
        context: { traumaSeverity: trauma.severity, currentStress },
      })
    }

    return {
      success: errors.every((e) => e.severity !== "error"),
      data: trauma,
      errors: errors.length > 0 ? errors : undefined,
    }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

export function validateSkillWithContext(
  data: unknown,
  characterState: any,
  outcomeType?: string,
  difficulty?: number,
): ValidationResult<z.infer<typeof SkillEntrySchema>> {
  try {
    const result = SkillEntrySchema.safeParse(data)
    if (!result.success) {
      return { success: false, errors: formatZodError(result.error) }
    }

    const skill = result.data as SkillEntry
    const errors: ValidationError[] = []

    // Skill inflation detection
    const recentSkills = characterState?.skills?.filter((s: SkillEntry) => {
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
      errors.push({
        path: "name",
        message: `Character has gained ${recentSkills.length} skills recently, adding more may be skill inflation`,
        severity: "warning",
        context: { recentSkillsCount: recentSkills.length },
      })
    }

    if (outcomeType === "FAILURE" && difficulty && difficulty < 7) {
      log.warn("skill_awarded_on_failure", {
        character: characterState?.name,
        skill: skill.name,
        outcomeType,
        difficulty,
      })
      errors.push({
        path: "category",
        message: "Skill awarded during failure outcome without high difficulty justification",
        severity: "warning",
        context: { outcomeType, difficulty },
      })
    }

    return {
      success: errors.every((e) => e.severity !== "error"),
      data: skill,
      errors: errors.length > 0 ? errors : undefined,
    }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

export function validateCharacterUpdateWithContext(
  data: unknown,
  worldState: WorldStateContext,
): ValidationResult<z.infer<typeof RawCharacterUpdate>> {
  try {
    const result = RawCharacterUpdate.safeParse(data)
    if (!result.success) {
      return { success: false, errors: formatZodError(result.error) }
    }

    const update = result.data
    const currentChar = worldState?.characters?.[update.name]
    const errors: ValidationError[] = []

    if (currentChar) {
      const currentStatus = currentChar.status?.toLowerCase() || "active"
      if (currentStatus === "dead" || currentStatus === "deceased") {
        if (update.new_skill) {
          errors.push(createValidationError(
            "new_skill",
            `Dead character '${update.name}' cannot gain skill`,
            { character: update.name, status: currentStatus },
          ))
        }
        if (update.stress_delta && update.stress_delta > 0) {
          log.warn("dead_character_stress_increase", {
            character: update.name,
            stressDelta: update.stress_delta,
          })
          errors.push({
            path: "stress_delta",
            message: "Dead character cannot have positive stress increase",
            severity: "warning",
            context: { character: update.name, stressDelta: update.stress_delta },
          })
        }
      }
    }

    return {
      success: errors.every((e) => e.severity !== "error"),
      data: update,
      errors: errors.length > 0 ? errors : undefined,
    }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

export function validateRelationshipUpdateWithContext(
  relKey: string,
  data: unknown,
  worldState: WorldStateContext,
): ValidationResult<z.infer<typeof RawRelationshipUpdate>> {
  try {
    const result = RawRelationshipUpdate.safeParse(data)
    if (!result.success) {
      return { success: false, errors: formatZodError(result.error) }
    }

    const update = result.data
    const [charA, charB] = relKey.split("-")
    const errors: ValidationError[] = []

    if (!worldState?.characters?.[charA]) {
      errors.push(createValidationError(
        "character_a",
        `Relationship update failed: character '${charA}' does not exist`,
        { relationship: relKey, character: charA },
      ))
    }
    if (!worldState?.characters?.[charB]) {
      errors.push(createValidationError(
        "character_b",
        `Relationship update failed: character '${charB}' does not exist`,
        { relationship: relKey, character: charB },
      ))
    }

    const currentRel = worldState?.relationships?.[relKey]
    if (currentRel && update.trust !== undefined) {
      const absChange = Math.abs(update.trust)
      if (absChange > 50) {
        log.warn("extreme_trust_change", {
          relationship: relKey,
          trustChange: update.trust,
          currentTrust: currentRel.trust,
        })
        errors.push({
          path: "trust",
          message: `Extreme trust change (${update.trust}) without dramatic catalyst`,
          severity: "warning",
          context: { currentTrust: currentRel.trust, trustChange: update.trust },
        })
      }
    }

    return {
      success: errors.every((e) => e.severity !== "error"),
      data: update,
      errors: errors.length > 0 ? errors : undefined,
    }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

// ============================================================================
// MAIN VALIDATION FUNCTIONS
// ============================================================================

export function validateRawStateUpdateWithWorldContext(
  data: unknown,
  worldState: WorldStateContext,
): ValidationResult<z.infer<typeof RawStateUpdate>> {
  const cacheKey = `raw_state_ctx_${JSON.stringify(data)}_${JSON.stringify(worldState)}`
  const cached = validationCache.get(cacheKey)
  if (cached) return cached

  const schemaResult = validateRawStateUpdate(data)
  if (!schemaResult.success) {
    validationCache.set(cacheKey, schemaResult)
    return schemaResult
  }

  const parsedData = schemaResult.data!
  const factErrors = checkFactConsistency(parsedData, worldState)

  if (factErrors.length > 0) {
    const criticalErrors = factErrors.filter((e) => isCriticalInconsistency(e.message))
    if (criticalErrors.length > 0) {
      log.error("critical_fact_inconsistency_detected", {
        errors: criticalErrors.map((e) => e.message),
        updateData: data,
        worldState: {
          characters: Object.keys(worldState?.characters || {}),
          location: worldState?.world?.location,
        },
      })
    } else {
      log.warn("fact_inconsistency_detected", {
        errors: factErrors.map((e) => e.message),
        updateData: data,
      })
    }

    const result: ValidationResult<z.infer<typeof RawStateUpdate>> = {
      success: false,
      errors: factErrors,
      error: `Fact consistency check failed: ${factErrors.map((e) => e.message).join("; ")}`,
    }
    validationCache.set(cacheKey, result)
    return result
  }

  const result: ValidationResult<z.infer<typeof RawStateUpdate>> = { success: true, data: parsedData }
  validationCache.set(cacheKey, result)
  return result
}

/** Backward-compatible: schema validation only */
export function validateRawStateUpdate(data: unknown): ValidationResult<z.infer<typeof RawStateUpdate>> {
  return wrapValidation(RawStateUpdate, data, "raw_state_schema")
}

// ============================================================================
// GENERIC VALIDATION FUNCTIONS (with cache, backward-compatible)
// ============================================================================

export function validateTrauma(data: unknown): ValidationResult<z.infer<typeof TraumaEntrySchema>> {
  return wrapValidation(TraumaEntrySchema, data, "trauma")
}

export function validateSkill(data: unknown): ValidationResult<z.infer<typeof SkillEntrySchema>> {
  return wrapValidation(SkillEntrySchema, data, "skill")
}

export function validateGoal(data: unknown): ValidationResult<z.infer<typeof GoalSchema>> {
  return wrapValidation(GoalSchema, data, "goal")
}

export function validateRelationship(data: unknown): ValidationResult<z.infer<typeof RelationshipSchema>> {
  return wrapValidation(RelationshipSchema, data, "relationship")
}

export function validateMindModel(data: unknown): ValidationResult<z.infer<typeof MindModelSchema>> {
  return wrapValidation(MindModelSchema, data, "mindmodel")
}

export function validateWorldState(data: unknown): ValidationResult<z.infer<typeof WorldStateSchema>> {
  return wrapValidation(WorldStateSchema, data, "worldstate")
}

// ============================================================================
// RETRY CONFIGURATION (improved: jitter + configurable backoff)
// ============================================================================

export class RetryConfig {
  maxRetries: number = 3
  baseDelayMs: number = 1000
  maxDelayMs: number = 10000
  backoffMultiplier: number = 2
  jitter: boolean = true

  constructor(partial?: Partial<RetryConfig>) {
    Object.assign(this, partial)
  }

  getDelay(attempt: number): number {
    let delay = this.baseDelayMs * Math.pow(this.backoffMultiplier, attempt)
    if (this.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5)
    }
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

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function clearValidationCache(): void {
  validationCache.clear()
}

export function getValidationCacheSize(): number {
  return validationCache.cache.size
}

log.info("validation_module_loaded", {
  schemas: ["RawCharacterUpdate", "RawRelationshipUpdate", "RawWorldUpdate", "RawStateUpdate"].length,
  functions: 18,
})
