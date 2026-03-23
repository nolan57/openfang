import { eq, and, isNotNull, lte, desc } from "drizzle-orm"
import { ulid } from "ulid"
import { Log } from "../util/log"
import { Database } from "../storage/db"
import { scheduler_job, scheduler_execution, scheduler_log } from "./job.sql"
import { getNextRunTime, validateCronExpression } from "./cron"
import type { CronSchedule, CronPayload, JobOptions, ExecutionStatus } from "./types"
import { GlobalBus } from "../bus/global"
import { Instance } from "../project/instance"

const log = Log.create({ service: "scheduler.job" })

export namespace Job {
  export type Info = typeof scheduler_job.$inferSelect
  export type Insert = typeof scheduler_job.$inferInsert

  export type Execution = typeof scheduler_execution.$inferSelect
  export type ExecutionInsert = typeof scheduler_execution.$inferInsert

  export type LogEntry = typeof scheduler_log.$inferSelect

  /**
   * Create a new scheduled job
   */
  export async function create(input: {
    name: string
    description?: string
    schedule: CronSchedule
    payload: CronPayload
    options?: JobOptions
    enabled?: boolean
  }): Promise<Info> {
    const scheduleExpr = JSON.stringify(input.schedule)
    const nextRunAt = getNextRunTime(input.schedule)

    const job: Insert = {
      id: `job_${ulid()}`,
      name: input.name,
      description: input.description,
      schedule_type: input.schedule.kind,
      schedule_expr: scheduleExpr,
      payload_type: input.payload.kind,
      payload: input.payload as any,
      options: input.options as any,
      enabled: input.enabled ?? true,
      next_run_at: nextRunAt,
    }

    Database.use((db) => db.insert(scheduler_job).values(job).run())

    log.info("job created", { id: job.id, name: job.name, nextRunAt })

    // Emit event
    GlobalBus.emit("event", {
      payload: {
        type: "scheduler.job.created",
        properties: { id: job.id, name: job.name },
      },
    })

    return job as Info
  }

  /**
   * Get a job by ID
   */
  export async function get(id: string): Promise<Info | undefined> {
    return Database.use((db) =>
      db.select().from(scheduler_job).where(eq(scheduler_job.id, id)).get()
    )
  }

  /**
   * List all jobs
   */
  export async function list(options?: {
    enabled?: boolean
    limit?: number
  }): Promise<Info[]> {
    return Database.use((db) => {
      let query = db
        .select()
        .from(scheduler_job)
        .orderBy(desc(scheduler_job.time_created))

      if (options?.enabled !== undefined) {
        query = query.where(eq(scheduler_job.enabled, options.enabled)) as any
      }

      if (options?.limit) {
        query = query.limit(options.limit) as any
      }

      return query.all()
    })
  }

  /**
   * Get jobs that are due to run
   */
  export async function getDueJobs(): Promise<Info[]> {
    const now = Date.now()
    return Database.use((db) =>
      db
        .select()
        .from(scheduler_job)
        .where(
          and(
            eq(scheduler_job.enabled, true),
            isNotNull(scheduler_job.next_run_at),
            lte(scheduler_job.next_run_at, now)
          )
        )
        .all()
    )
  }

  /**
   * Update a job
   */
  export async function update(
    id: string,
    updates: Partial<{
      name: string
      description: string
      schedule: CronSchedule
      payload: CronPayload
      options: JobOptions
      enabled: boolean
    }>
  ): Promise<Info | undefined> {
    const job = await get(id)
    if (!job) return undefined

    const updateData: Partial<Insert> = {}

    if (updates.name !== undefined) updateData.name = updates.name
    if (updates.description !== undefined) updateData.description = updates.description
    if (updates.schedule !== undefined) {
      updateData.schedule_type = updates.schedule.kind
      updateData.schedule_expr = JSON.stringify(updates.schedule)
      updateData.next_run_at = getNextRunTime(updates.schedule)
    }
    if (updates.payload !== undefined) {
      updateData.payload_type = updates.payload.kind
      updateData.payload = updates.payload as any
    }
    if (updates.options !== undefined) updateData.options = updates.options as any
    if (updates.enabled !== undefined) updateData.enabled = updates.enabled

    Database.use((db) =>
      db.update(scheduler_job).set(updateData).where(eq(scheduler_job.id, id)).run()
    )

    return get(id)
  }

  /**
   * Delete a job
   */
  export async function remove(id: string): Promise<boolean> {
    Database.use((db) => db.delete(scheduler_job).where(eq(scheduler_job.id, id)).run())

    log.info("job deleted", { id })

    GlobalBus.emit("event", {
      payload: {
        type: "scheduler.job.deleted",
        properties: { id },
      },
    })

    return true
  }

  /**
   * Enable a job
   */
  export async function enable(id: string): Promise<Info | undefined> {
    const job = await get(id)
    if (!job) return undefined

    const schedule: CronSchedule = JSON.parse(job.schedule_expr)
    const nextRunAt = getNextRunTime(schedule)

    Database.use((db) =>
      db
        .update(scheduler_job)
        .set({ enabled: true, next_run_at: nextRunAt })
        .where(eq(scheduler_job.id, id))
        .run()
    )

    log.info("job enabled", { id, nextRunAt })
    return get(id)
  }

  /**
   * Disable a job
   */
  export async function disable(id: string): Promise<Info | undefined> {
    Database.use((db) =>
      db
        .update(scheduler_job)
        .set({ enabled: false, next_run_at: null })
        .where(eq(scheduler_job.id, id))
        .run()
    )

    log.info("job disabled", { id })
    return get(id)
  }

  /**
   * Update job state after execution
   */
  export async function updateAfterRun(
    id: string,
    result: {
      status: "success" | "failed"
      error?: string
      durationMs?: number
    }
  ): Promise<void> {
    const job = await get(id)
    if (!job) return

    const schedule: CronSchedule = JSON.parse(job.schedule_expr)
    const now = Date.now()

    const updates: Partial<Insert> = {
      last_run_at: now,
      last_status: result.status,
      last_error: result.error ?? null,
    }

    if (result.status === "failed") {
      updates.consecutive_errors = (job.consecutive_errors ?? 0) + 1
    } else {
      updates.consecutive_errors = 0
    }

    // Calculate next run time
    const options = job.options as JobOptions | null
    const shouldDelete = options?.deleteAfterRun && result.status === "success"

    if (shouldDelete) {
      await remove(id)
      return
    }

    if (schedule.kind === "once") {
      // One-time job - disable after run
      updates.enabled = false
      updates.next_run_at = null
    } else if (job.enabled) {
      updates.next_run_at = getNextRunTime(schedule, now)
    }

    Database.use((db) =>
      db.update(scheduler_job).set(updates).where(eq(scheduler_job.id, id)).run()
    )
  }

  // ========================================
  // Execution Management
  // ========================================

  /**
   * Create an execution record
   */
  export async function createExecution(jobId: string): Promise<Execution> {
    const execution: ExecutionInsert = {
      id: `exec_${ulid()}`,
      job_id: jobId,
      status: "pending",
    }

    Database.use((db) => db.insert(scheduler_execution).values(execution).run())
    return execution as Execution
  }

  /**
   * Get an execution by ID
   */
  export async function getExecution(id: string): Promise<Execution | undefined> {
    return Database.use((db) =>
      db.select().from(scheduler_execution).where(eq(scheduler_execution.id, id)).get()
    )
  }

  /**
   * Update execution status
   */
  export async function updateExecution(
    id: string,
    updates: Partial<{
      status: ExecutionStatus
      started_at: number
      finished_at: number
      output: string
      error: string
      duration_ms: number
      heartbeat_at: number
    }>
  ): Promise<void> {
    Database.use((db) =>
      db.update(scheduler_execution).set(updates).where(eq(scheduler_execution.id, id)).run()
    )
  }

  /**
   * Get executions for a job
   */
  export async function getExecutions(jobId: string, limit = 50): Promise<Execution[]> {
    return Database.use((db) =>
      db
        .select()
        .from(scheduler_execution)
        .where(eq(scheduler_execution.job_id, jobId))
        .orderBy(desc(scheduler_execution.time_created))
        .limit(limit)
        .all()
    )
  }

  /**
   * Get stale executions (no heartbeat for a while)
   */
  export async function getStaleExecutions(timeoutMs: number): Promise<Execution[]> {
    const threshold = Date.now() - timeoutMs
    return Database.use((db) =>
      db
        .select()
        .from(scheduler_execution)
        .where(
          and(
            eq(scheduler_execution.status, "running"),
            lte(scheduler_execution.heartbeat_at, threshold)
          )
        )
        .all()
    )
  }

  // ========================================
  // Logging
  // ========================================

  /**
   * Append a log entry to an execution
   */
  export async function appendLog(
    executionId: string,
    level: "info" | "error" | "warn" | "debug" | "stream",
    message: string
  ): Promise<void> {
    Database.use((db) =>
      db.insert(scheduler_log).values({
        id: `log_${ulid()}`,
        execution_id: executionId,
        level,
        message,
        timestamp: Date.now(),
      }).run()
    )
  }

  /**
   * Get logs for an execution
   */
  export async function getLogs(
    executionId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<LogEntry[]> {
    return Database.use((db) => {
      let query = db
        .select()
        .from(scheduler_log)
        .where(eq(scheduler_log.execution_id, executionId))
        .orderBy(scheduler_log.timestamp)

      if (options?.limit) {
        query = query.limit(options.limit) as any
      }
      if (options?.offset) {
        query = query.offset(options.offset) as any
      }

      return query.all()
    })
  }
}