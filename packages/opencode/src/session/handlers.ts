/**
 * Loop Handlers - Modular processors for session main loop
 *
 * This module extracts complex logic from prompt.ts loop() into
 * independent, testable handlers following the Strategy pattern.
 *
 * [ENH] Target 4: Decouple main loop for maintainability
 */

import { MessageV2 } from "./message-v2"
import { Session } from "."
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { SessionCompaction } from "./compaction"
import { Identifier } from "@/id/id"
import { TaskTool } from "@/tool/task"
import { PermissionNext } from "@/permission/next"
import { Plugin } from "@/plugin"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { ulid } from "ulid"
import type { Tool } from "@/tool/tool"

const log = Log.create({ service: "session.handlers" })

// ============================================================================
// Types
// ============================================================================

/**
 * Context passed to all handlers
 */
export interface LoopContext {
  sessionID: string
  abort: AbortSignal
  step: number
  messages: MessageV2.WithParts[]
  lastUser: MessageV2.User
  lastAssistant?: MessageV2.Assistant
  lastFinished?: MessageV2.Assistant
  model: Provider.Model
  agent: Agent.Info
  session: Session.Info
}

/**
 * Result returned by handlers
 */
export interface HandlerResult {
  /** Whether the main loop should continue */
  shouldContinue: boolean
  /** Whether to break out of the loop entirely */
  shouldBreak: boolean
  /** Whether to create compaction */
  needsCompaction?: boolean
  /** Handler-specific metadata */
  metadata?: Record<string, unknown>
}

// ============================================================================
// Handler: Subtask Processing
// ============================================================================

/**
 * [ENH] Handle pending subtask execution
 * Extracts subtask processing logic from main loop
 */
export async function handleSubtask(ctx: LoopContext, task: MessageV2.SubtaskPart): Promise<HandlerResult> {
  log.info("handle_subtask", { agent: task.agent, description: task.description })

  const taskTool = await TaskTool.init()
  const taskModel = task.model ? await Provider.getModel(task.model.providerID, task.model.modelID) : ctx.model

  // Create assistant message for subtask
  const assistantMessage = (await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "assistant",
    parentID: ctx.lastUser.id,
    sessionID: ctx.sessionID,
    mode: task.agent,
    agent: task.agent,
    variant: ctx.lastUser.variant,
    path: {
      cwd: Instance.directory,
      root: Instance.worktree,
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: taskModel.id,
    providerID: taskModel.providerID,
    time: {
      created: Date.now(),
    },
  })) as MessageV2.Assistant

  // Create tool part
  let part = (await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: assistantMessage.id,
    sessionID: assistantMessage.sessionID,
    type: "tool",
    callID: ulid(),
    tool: TaskTool.id,
    state: {
      status: "running",
      input: {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      },
      time: {
        start: Date.now(),
      },
    },
  })) as MessageV2.ToolPart

  const taskArgs = {
    prompt: task.prompt,
    description: task.description,
    subagent_type: task.agent,
    command: task.command,
  }

  await Plugin.trigger(
    "tool.execute.before",
    { tool: "task", sessionID: ctx.sessionID, callID: part.id },
    { args: taskArgs },
  )

  // Build context for task execution
  const taskCtx: Tool.Context = {
    agent: task.agent,
    messageID: assistantMessage.id,
    sessionID: ctx.sessionID,
    abort: ctx.abort,
    callID: part.callID,
    extra: { bypassAgentCheck: true },
    messages: ctx.messages,
    async metadata(input) {
      await Session.updatePart({
        ...part,
        type: "tool",
        state: { ...part.state, ...input },
      } satisfies MessageV2.ToolPart)
    },
    async ask(req) {
      await PermissionNext.ask({
        ...req,
        sessionID: ctx.sessionID,
        ruleset: PermissionNext.merge(ctx.agent.permission, ctx.session.permission ?? []),
      })
    },
  }

  // Execute task
  let executionError: Error | undefined
  const result = await taskTool.execute(taskArgs, taskCtx).catch((error) => {
    executionError = error
    log.error("subtask_execution_failed", {
      error,
      agent: task.agent,
      description: task.description,
    })
    return undefined
  })

  const attachments = result?.attachments?.map((attachment) => ({
    ...attachment,
    id: Identifier.ascending("part"),
    sessionID: ctx.sessionID,
    messageID: assistantMessage.id,
  }))

  await Plugin.trigger(
    "tool.execute.after",
    { tool: "task", sessionID: ctx.sessionID, callID: part.id, args: taskArgs },
    result,
  )

  assistantMessage.finish = "tool-calls"
  assistantMessage.time.completed = Date.now()
  await Session.updateMessage(assistantMessage)

  // Update part with result
  if (result && part.state.status === "running") {
    await Session.updatePart({
      ...part,
      state: {
        status: "completed",
        input: part.state.input,
        title: result.title,
        metadata: result.metadata,
        output: result.output,
        attachments,
        time: {
          ...part.state.time,
          end: Date.now(),
        },
      },
    } satisfies MessageV2.ToolPart)
  }

  if (!result) {
    await Session.updatePart({
      ...part,
      state: {
        status: "error",
        error: executionError ? `Tool execution failed: ${executionError.message}` : "Tool execution failed",
        time: {
          start: part.state.status === "running" ? part.state.time.start : Date.now(),
          end: Date.now(),
        },
        metadata: part.metadata,
        input: part.state.input,
      },
    } satisfies MessageV2.ToolPart)
  }

  // Add synthetic user message for certain reasoning models
  if (task.command) {
    const summaryUserMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: ctx.sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: ctx.lastUser.agent,
      model: ctx.lastUser.model,
    }
    await Session.updateMessage(summaryUserMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: summaryUserMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: "Summarize the task tool output above and continue with your task.",
      synthetic: true,
    } satisfies MessageV2.TextPart)
  }

  return { shouldContinue: true, shouldBreak: false }
}

// ============================================================================
// Handler: Compaction Processing
// ============================================================================

/**
 * [ENH] Handle pending compaction processing
 */
export async function handleCompaction(ctx: LoopContext, task: MessageV2.CompactionPart): Promise<HandlerResult> {
  log.info("handle_compaction", { auto: task.auto })

  const result = await SessionCompaction.process({
    messages: ctx.messages,
    parentID: ctx.lastUser.id,
    abort: ctx.abort,
    sessionID: ctx.sessionID,
    auto: task.auto,
  })

  return {
    shouldContinue: true,
    shouldBreak: result === "stop",
  }
}

// ============================================================================
// Handler: Context Overflow Check
// ============================================================================

/**
 * [ENH] Check for context overflow and trigger compaction if needed
 */
export async function handleContextOverflow(ctx: LoopContext): Promise<HandlerResult> {
  if (!ctx.lastFinished || ctx.lastFinished.summary === true) {
    return { shouldContinue: false, shouldBreak: false }
  }

  const isOverflow = await SessionCompaction.isOverflow({
    tokens: ctx.lastFinished.tokens,
    model: ctx.model,
  })

  if (isOverflow) {
    log.info("context_overflow_detected", { tokens: ctx.lastFinished.tokens })
    return {
      shouldContinue: true,
      shouldBreak: false,
      needsCompaction: true,
    }
  }

  return { shouldContinue: false, shouldBreak: false }
}

// ============================================================================
// Handler: Memory Injection
// ============================================================================

import { Memory } from "@/memory/service"

/**
 * [ENH] Inject relevant memories into system prompt
 * Supports context-aware filtering (Target 1)
 */
export async function handleMemoryInjection(
  ctx: LoopContext,
  systemPrompt: string[],
  options: {
    enabled?: boolean
    filters?: {
      session_id?: string
      project_dir?: string
      memory_types?: Array<"session" | "evolution" | "project">
    }
  } = {},
): Promise<string[]> {
  const enabled = options.enabled ?? true
  if (!enabled || ctx.step !== 1) {
    return systemPrompt
  }

  // Extract task text from user messages
  const taskText = ctx.messages
    .filter((m) => m.info.role === "user")
    .flatMap((m) => m.parts)
    .filter((p) => p.type === "text")
    .map((p) => ("text" in p ? p.text : ""))
    .join(" ")

  if (!taskText) {
    return systemPrompt
  }

  // [ENH] Target 1: Context-aware filtering
  const memories = await Memory.getRelevantMemories(taskText, {
    projectDir: options.filters?.project_dir ?? Instance.directory,
    types: options.filters?.memory_types,
    limit: 5,
  })

  if (memories.length === 0) {
    return systemPrompt
  }

  const memoryContext = memories.map((m) => `• ${m.key}: ${m.value}`).join("\n")

  log.info("memory_injected", { count: memories.length, step: ctx.step })

  return [
    ...systemPrompt,
    `\n<system-reminder>\nPast session learnings relevant to this task:\n${memoryContext}\n</system-reminder>`,
  ]
}

// ============================================================================
// Handler: In-Session Review (Evolution Proposals)
// ============================================================================

import {
  handleInSessionReview,
  processUserReviewDecision,
  isReviewCommand,
  getReviewNotification,
} from "./in-session-review"

/**
 * Check for pending evolution reviews and present to user
 * Should be called at session start to notify user of pending reviews
 */
export async function handleReviewNotification(): Promise<string | null> {
  try {
    return await getReviewNotification(3)
  } catch (error) {
    log.error("review_notification_failed", { error: String(error) })
    return null
  }
}

/**
 * Process user message for review commands
 * Should be called before normal message processing
 */
export async function handleReviewCommand(
  userInput: string,
): Promise<{
  isReview: boolean
  response?: string
  action?: "approved" | "rejected"
}> {
  // Check if this is a review-related command
  if (!isReviewCommand(userInput)) {
    return { isReview: false }
  }

  // Process the review decision
  const result = await processUserReviewDecision(userInput)

  if (!result.success && result.error === "Not a review command") {
    // It's a review command but not approve/reject (e.g., "list reviews")
    if (userInput.match(/list\s+(pending\s+)?(proposals|reviews)/i)) {
      const reviews = await import("./in-session-review")
      const formatted = await reviews.getPendingReviewsFormatted(10)
      return {
        isReview: true,
        response: formatted.formatted || "No pending reviews",
      }
    }
    return { isReview: true, response: "Unknown review command. Use: approve <id> | reject <id> <reason> | list reviews" }
  }

  return {
    isReview: true,
    response: result.message,
    action: result.action,
  }
}

/**
 * Present pending review to user
 * Returns true if a review was presented
 */
export async function handleReviewPresentation(
  ctx?: LoopContext,
): Promise<boolean> {
  try {
    const result = await handleInSessionReview(ctx, {
      maxReviews: 3,
      showDetails: true,
      autoPresent: true,
    })

    return result.presented
  } catch (error) {
    log.error("review_presentation_failed", { error: String(error) })
    return false
  }
}

// Re-export for convenience
export { isReviewCommand } from "./in-session-review"

// ============================================================================
// Handler: Dynamic Memory Refresh (Target 2)
// ============================================================================

import { EmbeddingService } from "@/learning/embedding-service"

/**
 * [ENH] Target 2: Dynamic memory refresh for long conversations
 * Detects topic drift and refreshes relevant memories
 */
export const MEMORY_REFRESH_CONFIG = {
  enabled: false, // Default disabled, requires explicit enable
  threshold: 0.45, // Higher threshold to reduce false positives
  minTurnsBetweenRefresh: 3,
  maxRefreshesPerSession: 2,
}

export async function handleDynamicMemoryRefresh(
  ctx: LoopContext,
  options: {
    enabled?: boolean
    threshold?: number
    initialTaskEmbedding?: Float32Array
    refreshCount?: number
  } = {},
): Promise<{
  shouldRefresh: boolean
  newEmbedding?: Float32Array
  refreshedMemories?: Awaited<ReturnType<typeof Memory.getRelevantMemories>>
}> {
  const config = {
    ...MEMORY_REFRESH_CONFIG,
    ...options,
  }

  // Check if enabled and within limits
  if (!config.enabled) {
    return { shouldRefresh: false }
  }

  if ((config.refreshCount ?? 0) >= MEMORY_REFRESH_CONFIG.maxRefreshesPerSession) {
    return { shouldRefresh: false }
  }

  // Need initial embedding to compare
  if (!config.initialTaskEmbedding) {
    return { shouldRefresh: false }
  }

  // Extract current user message text
  const currentText = ctx.messages
    .filter((m) => m.info.role === "user")
    .slice(-1)
    .flatMap((m) => m.parts)
    .filter((p) => p.type === "text")
    .map((p) => ("text" in p ? p.text : ""))
    .join(" ")

  if (!currentText) {
    return { shouldRefresh: false }
  }

  try {
    // Calculate similarity using EmbeddingService
    const currentEmbedding = await EmbeddingService.createGenerator({
      modelId: "dashscope/text-embedding-v4",
      dimensions: 1536,
    }).then((gen) => gen(currentText, "content"))

    // Cosine similarity
    const similarity = cosineSimilarity(config.initialTaskEmbedding, currentEmbedding)

    log.debug("dynamic_memory_similarity", { similarity, threshold: config.threshold })

    if (similarity < config.threshold) {
      log.info("dynamic_memory_refresh_triggered", { similarity, step: ctx.step })

      const refreshedMemories = await Memory.getRelevantMemories(currentText, {
        projectDir: Instance.directory,
        limit: 5,
      })

      return {
        shouldRefresh: true,
        newEmbedding: currentEmbedding,
        refreshedMemories,
      }
    }

    return { shouldRefresh: false }
  } catch (error) {
    log.warn("dynamic_memory_refresh_failed", { error: String(error) })
    return { shouldRefresh: false }
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dotProduct / denominator
}

// ============================================================================
// Handler: Memory Usage Feedback (Target 3)
// ============================================================================

import { incrementMemoryUsage } from "@/evolution/store"
import { getMemories } from "@/evolution/store"

/**
 * [ENH] Target 3: Record memory usage feedback
 * Detects when memories are referenced in responses
 */
export async function handleMemoryUsageFeedback(
  ctx: LoopContext,
  usedMemoryIds: string[],
  response: string,
): Promise<void> {
  if (usedMemoryIds.length === 0) return

  const allMemories = await getMemories(Instance.directory)
  const referencedIds: string[] = []

  for (const memoryId of usedMemoryIds) {
    const memory = allMemories.find((m) => m.id === memoryId)
    if (!memory) continue

    // Simple keyword detection (first 20 chars of value)
    const snippet = memory.value.slice(0, 20).toLowerCase()
    if (response.toLowerCase().includes(snippet)) {
      referencedIds.push(memoryId)
    }
  }

  // Batch update usage stats
  for (const id of referencedIds) {
    await incrementMemoryUsage(Instance.directory, id).catch((e) =>
      log.warn("failed_to_record_memory_usage", { id, error: String(e) }),
    )
  }

  if (referencedIds.length > 0) {
    log.info("memory_usage_feedback_recorded", { count: referencedIds.length })
  }
}

// ============================================================================
// Handler Registry
// ============================================================================

/**
 * Handler interface for the registry pattern
 */
export interface LoopHandler {
  name: string
  condition: (ctx: LoopContext) => boolean | Promise<boolean>
  execute: (ctx: LoopContext) => Promise<HandlerResult>
}

/**
 * Default handlers in execution order
 */
export const defaultHandlers: LoopHandler[] = [
  // Note: Subtask and Compaction handlers are condition-based
  // They need to be called explicitly with the task parameter
  // These are here for future extension
]

/**
 * Create a handler registry for custom handler injection
 */
export function createHandlerRegistry(customHandlers: LoopHandler[] = []): LoopHandler[] {
  return [...defaultHandlers, ...customHandlers]
}
