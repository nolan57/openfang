import z from "zod"

export type AgentType = "build" | "review" | "test" | "explore" | "general" | "custom"
export type AgentRole = "coordinator" | "worker" | "specialist"
export type AgentState = "idle" | "running" | "busy" | "terminated"
export type DispatchStrategy = "round_robin" | "capability_based" | "load_balanced"
export type MessageType = "task" | "result" | "broadcast" | "memory_share" | "query"
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled"
export type Priority = "low" | "normal" | "high"
export type MemoryType = "session" | "evolution" | "project"

export const AgentInfo = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.enum(["build", "review", "test", "explore", "general", "custom"]),
    role: z.enum(["coordinator", "worker", "specialist"]),
    state: z.enum(["idle", "running", "busy", "terminated"]),
    capabilities: z.array(z.string()),
    config: z.object({
      model: z.object({
        providerID: z.string(),
        modelID: z.string(),
      }),
      tools: z.array(z.string()),
      permission: z.record(z.string(), z.any()),
      maxSteps: z.number().int().positive().optional(),
      timeout: z.number().optional(),
    }),
    createdAt: z.string(),
    lastActiveAt: z.string(),
  })
  .meta({ ref: "CollabAgent" })
export type AgentInfo = z.infer<typeof AgentInfo>

export const TaskMessage = z
  .object({
    id: z.string(),
    type: z.literal("task"),
    from: z.string(),
    to: z.string(),
    timestamp: z.string(),
    task: z.object({
      id: z.string(),
      action: z.string(),
      payload: z.any(),
      priority: z.enum(["low", "normal", "high"]).optional(),
    }),
  })
  .meta({ ref: "TaskMessage" })
export type TaskMessage = z.infer<typeof TaskMessage>

export const ResultMessage = z
  .object({
    id: z.string(),
    type: z.literal("result"),
    from: z.string(),
    to: z.string(),
    timestamp: z.string(),
    taskId: z.string(),
    success: z.boolean(),
    payload: z.any(),
    error: z.string().optional(),
  })
  .meta({ ref: "ResultMessage" })
export type ResultMessage = z.infer<typeof ResultMessage>

export const BroadcastMessage = z
  .object({
    id: z.string(),
    type: z.literal("broadcast"),
    from: z.string(),
    timestamp: z.string(),
    content: z.string(),
    scope: z.union([
      z.literal("all"),
      z.string().startsWith("role:"),
      z.string().startsWith("type:"),
      z.array(z.string()),
    ]),
  })
  .meta({ ref: "BroadcastMessage" })
export type BroadcastMessage = z.infer<typeof BroadcastMessage>

export const MemoryShareMessage = z
  .object({
    id: z.string(),
    type: z.literal("memory_share"),
    from: z.string(),
    timestamp: z.string(),
    memories: z.array(
      z.object({
        id: z.string(),
        type: z.enum(["session", "evolution", "project"]),
        content: z.string(),
      }),
    ),
  })
  .meta({ ref: "MemoryShareMessage" })
export type MemoryShareMessage = z.infer<typeof MemoryShareMessage>

export const QueryMessage = z
  .object({
    id: z.string(),
    type: z.literal("query"),
    from: z.string(),
    timestamp: z.string(),
    query: z.string(),
    sources: z.array(z.enum(["session", "evolution", "project"])),
    responseTo: z.string().optional(),
  })
  .meta({ ref: "QueryMessage" })
export type QueryMessage = z.infer<typeof QueryMessage>

export const AgentMessage = z.discriminatedUnion("type", [
  TaskMessage,
  ResultMessage,
  BroadcastMessage,
  MemoryShareMessage,
  QueryMessage,
])
export type AgentMessage = z.infer<typeof AgentMessage>

export const Task = z
  .object({
    id: z.string(),
    action: z.string(),
    payload: z.any(),
    requirements: z.array(z.string()),
    priority: z.enum(["low", "normal", "high"]),
    timeout: z.number().optional(),
    dependencies: z.array(z.string()).optional(),
  })
  .meta({ ref: "Task" })
export type Task = z.infer<typeof Task>

export const TaskResult = z
  .object({
    taskId: z.string(),
    agentId: z.string(),
    success: z.boolean(),
    payload: z.any(),
    duration: z.number(),
    error: z.string().optional(),
  })
  .meta({ ref: "TaskResult" })
export type TaskResult = z.infer<typeof TaskResult>

export const TaskDispatch = z
  .object({
    task: Task,
    strategy: z.enum(["round_robin", "capability_based", "load_balanced"]),
  })
  .meta({ ref: "TaskDispatch" })
export type TaskDispatch = z.infer<typeof TaskDispatch>

export const AddMemoryParams = z
  .object({
    memoryType: z.enum(["session", "evolution", "project"]),
    content: z.string(),
    metadata: z.record(z.string(), z.any()).optional(),
    tags: z.array(z.string()).optional(),
    entityRefs: z.array(z.string()).optional(),
  })
  .meta({ ref: "AddMemoryParams" })
export type AddMemoryParams = z.infer<typeof AddMemoryParams>

export const SearchParams = z
  .object({
    query: z.string(),
    memoryType: z.enum(["session", "evolution", "project"]).optional(),
    limit: z.number().optional(),
    minSimilarity: z.number().optional(),
    filters: z.record(z.string(), z.any()).optional(),
  })
  .meta({ ref: "SearchParams" })
export type SearchParams = z.infer<typeof SearchParams>

export const MemoryRef = z
  .object({
    id: z.string(),
    type: z.enum(["session", "evolution", "project"]),
    content: z.string(),
  })
  .meta({ ref: "MemoryRef" })
export type MemoryRef = z.infer<typeof MemoryRef>

export const SessionMessage = z
  .object({
    id: z.string(),
    role: z.enum(["user", "assistant", "agent", "system"]),
    content: z.string(),
    agentId: z.string().optional(),
    timestamp: z.string(),
  })
  .meta({ ref: "SessionMessage" })
export type SessionMessage = z.infer<typeof SessionMessage>

export const Skill = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    prompt: z.string(),
    trigger: z.array(z.string()),
    version: z.number(),
    source: z.enum(["learned", "manual", "imported"]),
    createdAt: z.string(),
    updatedAt: z.string(),
    approved: z.boolean(),
  })
  .meta({ ref: "Skill" })
export type Skill = z.infer<typeof Skill>

export const Constraint = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    rule: z.string(),
    severity: z.enum(["error", "warning", "info"]),
    scope: z.array(z.string()),
    enabled: z.boolean(),
    source: z.enum(["learned", "manual"]),
    createdAt: z.string(),
  })
  .meta({ ref: "Constraint" })
export type Constraint = z.infer<typeof Constraint>

export const EntityType = z.enum([
  "file",
  "directory",
  "function",
  "class",
  "method",
  "constructor",
  "interface",
  "type",
  "enum",
  "variable",
  "constant",
  "property",
  "import",
  "export",
  "api",
  "endpoint",
  "test",
  "config",
])
export type EntityType = z.infer<typeof EntityType>

export const RelationType = z.enum([
  "imports",
  "exports",
  "extends",
  "implements",
  "calls",
  "called_by",
  "uses",
  "used_by",
  "contains",
  "contained_in",
  "tests",
  "tested_by",
  "configures",
  "configured_by",
  "api_endpoint",
  "api_caller",
])
export type RelationType = z.infer<typeof RelationType>

export const CodeEntity = z
  .object({
    id: z.string(),
    type: EntityType,
    name: z.string(),
    file: z.string(),
    line: z.number().optional(),
    column: z.number().optional(),
    signature: z.string().optional(),
    docstring: z.string().optional(),
    relations: z.array(
      z.object({
        targetId: z.string(),
        type: RelationType,
        metadata: z.record(z.string(), z.any()).optional(),
      }),
    ),
    metadata: z.record(z.string(), z.any()),
  })
  .meta({ ref: "CodeEntity" })
export type CodeEntity = z.infer<typeof CodeEntity>

export const ChangeRecord = z
  .object({
    id: z.string(),
    type: z.enum(["add", "modify", "delete"]),
    file: z.string(),
    entities: z.array(z.string()),
    timestamp: z.string(),
    commitHash: z.string().optional(),
    diff: z.string().optional(),
  })
  .meta({ ref: "ChangeRecord" })
export type ChangeRecord = z.infer<typeof ChangeRecord>
