import { z } from "zod"
import {
  TraumaEntrySchema,
  SkillEntrySchema,
  GoalSchema,
  RelationshipSchema,
  MindModelSchema,
  WorldStateSchema,
  EvolutionSummarySchema,
} from "../types/novel-state"

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
