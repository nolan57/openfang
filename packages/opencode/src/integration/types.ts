import z from "zod"

export const OpenFangAgentInfo = z.object({
  id: z.string(),
  name: z.string(),
  module: z.string(),
  state: z.enum(["idle", "running", "busy", "terminated"]),
  capabilities: z.object({
    tools: z.array(z.string()),
    network: z.array(z.string()),
    memory_read: z.array(z.string()),
    memory_write: z.array(z.string()),
    shell: z.array(z.string()),
  }),
  model: z.object({
    provider: z.string(),
    model: z.string(),
    max_tokens: z.number(),
  }),
  resources: z.object({
    max_llm_tokens_per_hour: z.number(),
    max_concurrent_tools: z.number(),
  }),
  created_at: z.string(),
  last_active_at: z.string(),
})
export type OpenFangAgentInfo = z.infer<typeof OpenFangAgentInfo>

export const OpenFangAgentManifest = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  module: z.string(),
  model: z.object({
    provider: z.string(),
    model: z.string(),
    max_tokens: z.number(),
    temperature: z.number().optional(),
  }),
  capabilities: z.object({
    tools: z.array(z.string()),
    network: z.array(z.string()),
    memory_read: z.array(z.string()),
    memory_write: z.array(z.string()),
    shell: z.array(z.string()),
  }),
  resources: z.object({
    max_llm_tokens_per_hour: z.number(),
    max_concurrent_tools: z.number(),
  }),
})
export type OpenFangAgentManifest = z.infer<typeof OpenFangAgentManifest>

export const HandStatus = z.object({
  id: z.string(),
  hand_id: z.string(),
  agent_id: z.string(),
  state: z.enum(["active", "paused", "error"]),
  created_at: z.string(),
  last_active_at: z.string().optional(),
})
export type HandStatus = z.infer<typeof HandStatus>

export const WorkflowDefinition = z.object({
  name: z.string(),
  description: z.string(),
  steps: z.array(
    z.object({
      name: z.string(),
      agent_name: z.string().optional(),
      agent_id: z.string().optional(),
      prompt: z.string(),
      mode: z.enum(["sequential", "fan_out", "collect", "conditional", "loop"]).optional(),
      timeout_secs: z.number().optional(),
      error_mode: z.enum(["fail", "skip", "retry"]).optional(),
      max_retries: z.number().optional(),
      output_var: z.string().optional(),
      condition: z.string().optional(),
      max_iterations: z.number().optional(),
      until: z.string().optional(),
    }),
  ),
})
export type WorkflowDefinition = z.infer<typeof WorkflowDefinition>

export const WorkflowResult = z.object({
  run_id: z.string(),
  output: z.string(),
  status: z.enum(["completed", "failed", "running"]),
  duration_ms: z.number().optional(),
})
export type WorkflowResult = z.infer<typeof WorkflowResult>

export const TriggerDefinition = z.object({
  agent_id: z.string(),
  pattern: z.union([
    z.literal("all"),
    z.literal("lifecycle"),
    z.literal("agent_terminated"),
    z.literal("system"),
    z.literal("memory_update"),
    z.object({ agent_spawned: z.object({ name_pattern: z.string() }) }),
    z.object({ system_keyword: z.object({ keyword: z.string() }) }),
    z.object({ memory_key_pattern: z.object({ key_pattern: z.string() }) }),
    z.object({ content_match: z.object({ substring: z.string() }) }),
  ]),
  prompt_template: z.string(),
  max_fires: z.number().optional(),
})
export type TriggerDefinition = z.infer<typeof TriggerDefinition>

export const TriggerInfo = z.object({
  id: z.string(),
  agent_id: z.string(),
  pattern: z.string(),
  prompt_template: z.string(),
  enabled: z.boolean(),
  fire_count: z.number(),
  max_fires: z.number(),
  created_at: z.string(),
})
export type TriggerInfo = z.infer<typeof TriggerInfo>

export const MemoryItem = z.object({
  id: z.string(),
  type: z.enum(["session", "evolution", "project"]),
  content: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
  tags: z.array(z.string()).optional(),
  entityRefs: z.array(z.string()).optional(),
})
export type MemoryItem = z.infer<typeof MemoryItem>

export const OpenFangChannel = z.enum([
  "telegram",
  "discord",
  "slack",
  "whatsapp",
  "signal",
  "matrix",
  "email",
  "teams",
  "mattermost",
  "irc",
])
export type OpenFangChannel = z.infer<typeof OpenFangChannel>

export const ChannelConfig = z.object({
  enabled: z.boolean(),
  bot_token: z.string().optional(),
  webhook_url: z.string().optional(),
  rate_limit: z.number().optional(),
  dm_policy: z.enum(["allow", "deny"]).optional(),
  group_policy: z.enum(["allow", "deny"]).optional(),
})
export type ChannelConfig = z.infer<typeof ChannelConfig>

export const OpenFangConfig = z.object({
  enabled: z.boolean().default(false),
  base_url: z.string().default("http://localhost:4200"),
  api_key: z.string().optional(),
  wasm_enabled: z.boolean().default(false),
  wasm_module_path: z.string().optional(),
  hands: z
    .record(
      z.string(),
      z.object({
        enabled: z.boolean().default(false),
        schedule: z.string().optional(),
      }),
    )
    .optional(),
})
export type OpenFangConfig = z.infer<typeof OpenFangConfig>
