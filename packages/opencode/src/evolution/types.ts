import { z } from "zod"

export const PromptEvolution = z.object({
  id: z.string(),
  originalPrompt: z.string(),
  optimizedPrompt: z.string(),
  reason: z.string(),
  sessionID: z.string(),
  createdAt: z.number(),
  usageCount: z.number().default(0),
})

export const SkillEvolution = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  content: z.string(),
  triggerPatterns: z.array(z.string()),
  sessionID: z.string(),
  createdAt: z.number(),
  status: z.enum(["draft", "approved", "rejected"]),
})

// [ENH] Target 4a: Sensitive memory support
export const MemoryEntry = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  context: z.string(),
  sessionIDs: z.array(z.string()),
  createdAt: z.number(),
  lastUsedAt: z.number(),
  usageCount: z.number().default(0),
  // [ENH] Sensitive content flags
  sensitive: z.boolean().default(false),
  encrypted: z.boolean().default(false),
  // [ENH] Target 4b: Memory compression
  archived: z.boolean().default(false),
  archivedAt: z.number().optional(),
  archivedReason: z.string().optional(), // "compressed", "expired", etc.
  summaryFor: z.array(z.string()).optional(), // IDs of memories this summarizes
})

// [ENH] Target 4b: Memory compression - input type for saveMemory
export type SaveMemoryInput = {
  key: string
  value: string
  context: string
  sessionIDs: string[]
}

export type PromptEvolution = z.infer<typeof PromptEvolution>
export type SkillEvolution = z.infer<typeof SkillEvolution>
export type MemoryEntry = z.infer<typeof MemoryEntry>

// [ENH] Options for saveMemory
export interface SaveMemoryOptions {
  /** Mark as sensitive - will be encrypted before storage */
  sensitive?: boolean
  /** Compress after N similar memories (future feature) */
  compressAfter?: number
}
