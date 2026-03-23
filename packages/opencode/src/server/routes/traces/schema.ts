import { z } from "zod"

export const TracesQuerySchema = z.object({
  service: z.string().optional(),
  operation: z.string().optional(),
  start: z.coerce.number().optional(),
  end: z.coerce.number().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(["ok", "error", "all"]).optional(),
})

export const TraceParamsSchema = z.object({
  traceId: z.string(),
})

export const StatsQuerySchema = z.object({
  service: z.string(),
  start: z.coerce.number().optional(),
  end: z.coerce.number().optional(),
})

export const StreamQuerySchema = z.object({
  service: z.string().default("opencode-agent"),
  interval: z.coerce.number().min(1000).max(30000).default(2000),
})

export const ServicesQuerySchema = z.object({
  lookback: z.string().optional().default("1h"),
})
