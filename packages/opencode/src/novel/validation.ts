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
