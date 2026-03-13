/**
 * Scheduler Executor - Executes scheduled tasks in-process
 *
 * Handles:
 * - Agent Turn execution (via Session API)
 * - System Event execution (shell commands)
 * - Timeout and heartbeat management
 */

import { Log } from "../util/log"
import { GlobalBus } from "../bus/global"
import { Job } from "./job"
import { getNextRunTime } from "./cron"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { PermissionNext } from "../permission/next"
import type { CronPayload, JobOptions } from "./types"

const log = Log.create({ service: "scheduler.executor" })

/** Default timeout (1 hour) */
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000

/** Heartbeat interval (30 seconds) */
const HEARTBEAT_INTERVAL_MS = 30_000

/** Active executions */
const activeExecutions = new Map<
  string,
  {
    heartbeatTimer: ReturnType<typeof setInterval> | null
    timeoutTimer: ReturnType<typeof setTimeout> | null
    abortController: AbortController
  }
>()

/**
 * Execute a job
 */
export async function executeJob(
  jobId: string,
  options?: { executionId?: string; manual?: boolean }
): Promise<{
  status: "success" | "failed"
  output?: string
  error?: string
  durationMs: number
}> {
  const startTime = Date.now()

  // Get job
  const job = await Job.get(jobId)
  if (!job) {
    return {
      status: "failed",
      error: `Job not found: ${jobId}`,
      durationMs: Date.now() - startTime,
    }
  }

  // Check if job is enabled (skip for manual trigger)
  if (!options?.manual && !job.enabled) {
    return {
      status: "failed",
      error: "Job is disabled",
      durationMs: Date.now() - startTime,
    }
  }

  // Create execution record
  const execution = await Job.createExecution(jobId)
  const executionId = execution.id

  log.info("starting execution", { executionId, jobId, jobName: job.name })

  // Update execution status
  await Job.updateExecution(executionId, {
    status: "running",
    started_at: startTime,
  })

  // Get options
  const jobOptions = job.options as JobOptions | null
  const timeoutMs = jobOptions?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // Create abort controller
  const abortController = new AbortController()
  const executionContext = {
    heartbeatTimer: null as ReturnType<typeof setInterval> | null,
    timeoutTimer: null as ReturnType<typeof setTimeout> | null,
    abortController,
  }
  activeExecutions.set(executionId, executionContext)

  // Start heartbeat
  executionContext.heartbeatTimer = setInterval(async () => {
    await Job.updateExecution(executionId, { heartbeat_at: Date.now() })
  }, HEARTBEAT_INTERVAL_MS)

  // Set timeout
  executionContext.timeoutTimer = setTimeout(() => {
    log.warn("execution timeout", { executionId, timeoutMs })
    abortController.abort(`Timeout after ${timeoutMs}ms`)
  }, timeoutMs)

  // Emit started event
  GlobalBus.emit("event", {
    payload: {
      type: "scheduler.execution.started",
      properties: { id: executionId, jobId, jobName: job.name },
    },
  })

  try {
    // Parse payload
    const payload = job.payload as CronPayload
    let result: { status: "success" | "failed"; output?: string; error?: string }

    // Execute based on payload type
    if (payload.kind === "agentTurn") {
      result = await executeAgentTurn(executionId, payload, abortController.signal)
    } else if (payload.kind === "systemEvent") {
      result = await executeSystemEvent(executionId, payload, abortController.signal)
    } else {
      result = {
        status: "failed",
        error: `Unknown payload kind: ${(payload as any).kind}`,
      }
    }

    const durationMs = Date.now() - startTime

    // Update execution
    await Job.updateExecution(executionId, {
      status: result.status,
      finished_at: Date.now(),
      output: result.output,
      error: result.error,
      duration_ms: durationMs,
    })

    // Update job state
    await Job.updateAfterRun(jobId, {
      status: result.status,
      error: result.error,
      durationMs,
    })

    // Append log
    await Job.appendLog(executionId, "info", `Execution completed with status: ${result.status}`)

    // Emit completed event
    GlobalBus.emit("event", {
      payload: {
        type: "scheduler.execution.completed",
        properties: { id: executionId, jobId, status: result.status, durationMs },
      },
    })

    return {
      status: result.status,
      output: result.output,
      error: result.error,
      durationMs,
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    const durationMs = Date.now() - startTime

    log.error("execution failed", { executionId, error: errorMsg })

    // Update execution
    await Job.updateExecution(executionId, {
      status: "failed",
      finished_at: Date.now(),
      error: errorMsg,
      duration_ms: durationMs,
    })

    // Update job state
    await Job.updateAfterRun(jobId, {
      status: "failed",
      error: errorMsg,
      durationMs,
    })

    // Append log
    await Job.appendLog(executionId, "error", `Execution failed: ${errorMsg}`)

    // Emit failed event
    GlobalBus.emit("event", {
      payload: {
        type: "scheduler.execution.failed",
        properties: { id: executionId, jobId, error: errorMsg },
      },
    })

    return {
      status: "failed",
      error: errorMsg,
      durationMs,
    }
  } finally {
    // Cleanup
    if (executionContext.heartbeatTimer) {
      clearInterval(executionContext.heartbeatTimer)
    }
    if (executionContext.timeoutTimer) {
      clearTimeout(executionContext.timeoutTimer)
    }
    activeExecutions.delete(executionId)
  }
}

/**
 * Execute an agent turn (in-process)
 */
async function executeAgentTurn(
  executionId: string,
  payload: CronPayload,
  signal: AbortSignal
): Promise<{ status: "success" | "failed"; output?: string; error?: string }> {
  log.info("executing agent turn", { executionId, message: payload.message.substring(0, 100) })
  await Job.appendLog(executionId, "info", `Starting agent turn: ${payload.message.substring(0, 100)}...`)

  try {
    // Create session with deny permissions for interactive prompts
    const rules: PermissionNext.Ruleset = [
      { permission: "question", action: "deny", pattern: "*" },
      { permission: "plan_enter", action: "deny", pattern: "*" },
      { permission: "plan_exit", action: "deny", pattern: "*" },
    ]

    const session = await Session.create({
      title: `Cron: ${payload.message.substring(0, 50)}`,
      permission: rules,
    })

    await Job.appendLog(executionId, "info", `Created session: ${session.id}`)

    // Execute prompt (non-blocking - we need to wait for completion)
    const result = await SessionPrompt.prompt({
      sessionID: session.id,
      parts: [{ type: "text", text: payload.message }],
    })

    // Get the response text
    const textParts = result.parts.filter((p) => p.type === "text")
    const output = textParts.map((p) => (p as any).text || "").join("\n")

    await Job.appendLog(executionId, "stream", output)

    if (signal.aborted) {
      return { status: "failed", error: "Aborted" }
    }

    return { status: "success", output }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    await Job.appendLog(executionId, "error", `Agent turn failed: ${errorMsg}`)
    return { status: "failed", error: errorMsg }
  }
}

/**
 * Execute a system event (shell command)
 */
async function executeSystemEvent(
  executionId: string,
  payload: CronPayload,
  signal: AbortSignal
): Promise<{ status: "success" | "failed"; output?: string; error?: string }> {
  const command = payload.message

  log.info("executing system event", { executionId, command })
  await Job.appendLog(executionId, "info", `Executing command: ${command}`)

  try {
    // Use Bun's shell
    const result = await Bun.$`${{ raw: command }}`.quiet()

    const output = result.stdout.toString() + result.stderr.toString()

    await Job.appendLog(executionId, "stream", output)

    if (signal.aborted) {
      return { status: "failed", error: "Aborted" }
    }

    if (result.exitCode !== 0) {
      return {
        status: "failed",
        output,
        error: `Command exited with code ${result.exitCode}`,
      }
    }

    return { status: "success", output: output || "Command executed successfully" }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    await Job.appendLog(executionId, "error", `Command failed: ${errorMsg}`)
    return { status: "failed", error: errorMsg }
  }
}

/**
 * Cancel an execution
 */
export async function cancelExecution(executionId: string, reason?: string): Promise<boolean> {
  const ctx = activeExecutions.get(executionId)
  if (!ctx) return false

  log.info("cancelling execution", { executionId, reason })

  ctx.abortController.abort(reason ?? "Cancelled by user")

  await Job.updateExecution(executionId, {
    status: "cancelled",
    finished_at: Date.now(),
    error: reason ?? "Cancelled",
  })

  await Job.appendLog(executionId, "warn", `Execution cancelled: ${reason ?? "No reason provided"}`)

  return true
}

/**
 * Execute a task directly without creating a job record
 * Used by external schedulers like mcp-cron
 */
export async function executeDirect(
  payload: CronPayload,
  options?: JobOptions
): Promise<{
  status: "success" | "failed"
  output?: string
  error?: string
  durationMs: number
}> {
  const startTime = Date.now()
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // Create abort controller
  const abortController = new AbortController()
  const executionId = `direct_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`

  activeExecutions.set(executionId, {
    heartbeatTimer: null,
    timeoutTimer: null,
    abortController,
  })

  // Set timeout
  const timeoutTimer = setTimeout(() => {
    log.warn("direct execution timeout", { executionId, timeoutMs })
    abortController.abort(`Timeout after ${timeoutMs}ms`)
  }, timeoutMs)

  log.info("starting direct execution", { executionId, kind: payload.kind })

  try {
    let result: { status: "success" | "failed"; output?: string; error?: string }

    if (payload.kind === "agentTurn") {
      result = await executeAgentTurnDirect(payload, abortController.signal)
    } else if (payload.kind === "systemEvent") {
      result = await executeSystemEventDirect(payload, abortController.signal)
    } else {
      result = {
        status: "failed",
        error: `Unknown payload kind: ${(payload as any).kind}`,
      }
    }

    const durationMs = Date.now() - startTime

    log.info("direct execution completed", { executionId, status: result.status, durationMs })

    return {
      status: result.status,
      output: result.output,
      error: result.error,
      durationMs,
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    const durationMs = Date.now() - startTime

    log.error("direct execution failed", { executionId, error: errorMsg })

    return {
      status: "failed",
      error: errorMsg,
      durationMs,
    }
  } finally {
    clearTimeout(timeoutTimer)
    activeExecutions.delete(executionId)
  }
}

/**
 * Execute an agent turn directly (no job record)
 */
async function executeAgentTurnDirect(
  payload: CronPayload,
  signal: AbortSignal
): Promise<{ status: "success" | "failed"; output?: string; error?: string }> {
  log.info("executing agent turn", { message: payload.message.substring(0, 100) })

  try {
    // Create session with deny permissions for interactive prompts
    const rules: PermissionNext.Ruleset = [
      { permission: "question", action: "deny", pattern: "*" },
      { permission: "plan_enter", action: "deny", pattern: "*" },
      { permission: "plan_exit", action: "deny", pattern: "*" },
    ]

    const session = await Session.create({
      title: `Cron: ${payload.message.substring(0, 50)}`,
      permission: rules,
    })

    // Execute prompt
    const result = await SessionPrompt.prompt({
      sessionID: session.id,
      parts: [{ type: "text", text: payload.message }],
    })

    // Get the response text
    const textParts = result.parts.filter((p) => p.type === "text")
    const output = textParts.map((p) => (p as any).text || "").join("\n")

    if (signal.aborted) {
      return { status: "failed", error: "Aborted" }
    }

    return { status: "success", output }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    return { status: "failed", error: errorMsg }
  }
}

/**
 * Execute a system event directly (no job record)
 */
async function executeSystemEventDirect(
  payload: CronPayload,
  signal: AbortSignal
): Promise<{ status: "success" | "failed"; output?: string; error?: string }> {
  const command = payload.message

  log.info("executing system event", { command })

  try {
    // Use Bun's shell
    const result = await Bun.$`${{ raw: command }}`.quiet()

    const output = result.stdout.toString() + result.stderr.toString()

    if (signal.aborted) {
      return { status: "failed", error: "Aborted" }
    }

    if (result.exitCode !== 0) {
      return {
        status: "failed",
        output,
        error: `Command exited with code ${result.exitCode}`,
      }
    }

    return { status: "success", output: output || "Command executed successfully" }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    return { status: "failed", error: errorMsg }
  }
}

/**
 * Get active execution count
 */
export function getActiveExecutionCount(): number {
  return activeExecutions.size
}

/**
 * Get active execution IDs
 */
export function getActiveExecutionIds(): string[] {
  return Array.from(activeExecutions.keys())
}

/**
 * Shutdown all executions
 */
export async function shutdownAll(): Promise<void> {
  log.info("shutting down all executions")

  for (const [id, ctx] of activeExecutions) {
    ctx.abortController.abort("Server shutdown")
    if (ctx.heartbeatTimer) clearInterval(ctx.heartbeatTimer)
    if (ctx.timeoutTimer) clearTimeout(ctx.timeoutTimer)
  }

  activeExecutions.clear()
}
