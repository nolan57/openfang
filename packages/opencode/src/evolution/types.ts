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

export const MemoryEntry = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  context: z.string(),
  sessionIDs: z.array(z.string()),
  createdAt: z.number(),
  lastUsedAt: z.number(),
  usageCount: z.number().default(0),
})

export type PromptEvolution = z.infer<typeof PromptEvolution>
export type SkillEvolution = z.infer<typeof SkillEvolution>
export type MemoryEntry = z.infer<typeof MemoryEntry>
