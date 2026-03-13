import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { GlobalBus } from "../bus/global"
import { Job } from "./job"
import { executeJob, shutdownAll, getActiveExecutionCount, getActiveExecutionIds, cancelExecution } from "./executor"
import { getNextRunTime, validateCronExpression, describeSchedule } from "./cron"

export { Job } from "./job"
export { executeJob, cancelExecution, getActiveExecutionCount, getActiveExecutionIds, shutdownAll } from "./executor"
export { getNextRunTime, validateCronExpression, describeSchedule } from "./cron"
export type { CronSchedule, CronPayload, JobOptions, ExecutionStatus, CronPayloadKind } from "./types"

const log = Log.create({ service: "scheduler" })

export namespace Scheduler {
  /**
   * Legacy interval-based task registration
   * For backward compatibility with existing code
   */
  export type Task = {
    id: string
    interval: number
    run: () => Promise<void>
    scope?: "instance" | "global"
  }

  type Timer = ReturnType<typeof setInterval>
  type Entry = {
    tasks: Map<string, Task>
    timers: Map<string, Timer>
  }

  const create = (): Entry => {
    const tasks = new Map<string, Task>()
    const timers = new Map<string, Timer>()
    return { tasks, timers }
  }

  const shared = create()

  const state = Instance.state(
    () => create(),
    async (entry) => {
      for (const timer of entry.timers.values()) {
        clearInterval(timer)
      }
      entry.tasks.clear()
      entry.timers.clear()
    },
  )

  /**
   * Register an interval-based task (legacy)
   */
  export function register(task: Task) {
    const scope = task.scope ?? "instance"
    const entry = scope === "global" ? shared : state()
    const current = entry.timers.get(task.id)
    if (current && scope === "global") return
    if (current) clearInterval(current)

    entry.tasks.set(task.id, task)
    void runLegacyTask(task)
    const timer = setInterval(() => {
      void runLegacyTask(task)
    }, task.interval)
    timer.unref()
    entry.timers.set(task.id, timer)
  }

  async function runLegacyTask(task: Task) {
    log.info("run", { id: task.id })

    // Emit started event
    GlobalBus.emit("event", {
      payload: {
        type: "tui.scheduler.job.started",
        properties: { id: task.id, name: task.id },
      },
    })

    try {
      await task.run()

      // Emit completed event
      GlobalBus.emit("event", {
        payload: {
          type: "tui.scheduler.job.completed",
          properties: { id: task.id, name: task.id },
        },
      })
    } catch (error) {
      // Emit failed event
      GlobalBus.emit("event", {
        payload: {
          type: "tui.scheduler.job.failed",
          properties: { id: task.id, name: task.id, error: String(error) },
        },
      })
      log.error("run failed", { id: task.id, error })
    }
  }

  // ========================================
  // Cron-based Job Management
  // ========================================

  /**
   * Start the cron scheduler loop
   */
  export function startCronScheduler() {
    const CHECK_INTERVAL_MS = 10_000 // Check every 10 seconds

    const timer = setInterval(async () => {
      try {
        await checkAndRunDueJobs()
      } catch (error) {
        log.error("cron scheduler check failed", { error })
      }
    }, CHECK_INTERVAL_MS)

    timer.unref()
    log.info("cron scheduler started")

    return () => {
      clearInterval(timer)
      log.info("cron scheduler stopped")
    }
  }

  /**
   * Check for due jobs and execute them
   */
  async function checkAndRunDueJobs() {
    const dueJobs = await Job.getDueJobs()

    for (const job of dueJobs) {
      log.info("executing due job", { id: job.id, name: job.name })

      // Run in background
      executeJob(job.id).catch((error) => {
        log.error("job execution failed", { id: job.id, error })
      })
    }
  }
}
