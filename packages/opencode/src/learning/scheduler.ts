import type { LearningConfig } from "./config"
import { Log } from "../util/log"
import * as os from "os"

const log = Log.create({ service: "learning-scheduler" })

export interface ResourceStatus {
  cpuUsage: number
  memoryUsage: number
  memoryTotal: number
  memoryAvailable: number
  isIdle: boolean
  loadAverage: number[]
}

export interface SchedulerConfig {
  idleThresholdPercent: number
  maxCpuUsagePercent: number
  maxMemoryUsagePercent: number
  minIdleMinutes: number
  checkIntervalMs: number
  heavyTaskCpuThreshold: number
  heavyTaskMemoryThreshold: number
}

const defaultSchedulerConfig: SchedulerConfig = {
  idleThresholdPercent: 20,
  maxCpuUsagePercent: 80,
  maxMemoryUsagePercent: 85,
  minIdleMinutes: 5,
  checkIntervalMs: 30000,
  heavyTaskCpuThreshold: 30,
  heavyTaskMemoryThreshold: 50,
}

export type TaskPriority = "low" | "normal" | "high" | "critical"

export interface ScheduledTask {
  id: string
  name: string
  priority: TaskPriority
  resourceIntensity: "light" | "normal" | "heavy"
  estimatedDurationMs: number
  canInterrupt: boolean
  cooldownMs: number
  lastRunAt?: number
  nextAllowedAt?: number
  run: () => Promise<void>
}

export interface TaskResult {
  success: boolean
  durationMs: number
  error?: string
}

/**
 * Resource-Aware Scheduler
 * [EVOLUTION]: Monitors system resources and schedules tasks only when conditions are favorable
 */
export class LearningScheduler {
  private config: LearningConfig
  private schedulerConfig: SchedulerConfig
  private tasks: Map<string, ScheduledTask> = new Map()
  private isRunning: boolean = false
  private currentTaskId: string | null = null
  private lastActiveAt: number = Date.now()
  private idleTimer: NodeJS.Timeout | null = null
  private resourceCheckInterval: NodeJS.Timeout | null = null

  constructor(config: LearningConfig, schedulerConfig?: Partial<SchedulerConfig>) {
    this.config = config
    this.schedulerConfig = { ...defaultSchedulerConfig, ...schedulerConfig }
  }

  async setup(): Promise<void> {
    if (!this.config.enabled) {
      log.info("learning disabled")
      return
    }

    if (this.config.schedule.cron) {
      log.info("cron learning configured", {
        cron: this.config.schedule.cron,
        topics: this.config.topics,
        sources: this.config.sources,
      })
    }

    if (this.config.schedule.idle_check) {
      log.info("idle check enabled", {
        thresholdMinutes: this.config.schedule.idle_threshold_minutes,
      })
      this.startIdleMonitoring()
    }

    this.startResourceMonitoring()

    log.info("resource_aware_scheduler_started", {
      idleThreshold: this.schedulerConfig.idleThresholdPercent,
      maxCpu: this.schedulerConfig.maxCpuUsagePercent,
      maxMemory: this.schedulerConfig.maxMemoryUsagePercent,
    })
  }

  /**
   * Register a task for scheduling
   */
  registerTask(task: ScheduledTask): void {
    this.tasks.set(task.id, task)
    log.info("task_registered", { id: task.id, priority: task.priority, intensity: task.resourceIntensity })
  }

  /**
   * Unregister a task
   */
  unregisterTask(taskId: string): void {
    this.tasks.delete(taskId)
    log.info("task_unregistered", { taskId })
  }

  /**
   * Get current resource status
   */
  async getResourceStatus(): Promise<ResourceStatus> {
    const cpus = os.cpus()
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem

    const loadAvg = os.loadavg()

    const cpuUsage = this.calculateCpuUsage(loadAvg)
    const memoryUsage = (usedMem / totalMem) * 100

    const isIdle = cpuUsage < this.schedulerConfig.idleThresholdPercent && memoryUsage < 70

    return {
      cpuUsage,
      memoryUsage,
      memoryTotal: totalMem,
      memoryAvailable: freeMem,
      isIdle,
      loadAverage: loadAvg,
    }
  }

  /**
   * Check if a heavy task can run
   */
  async canRunHeavyTask(): Promise<{ allowed: boolean; reason: string }> {
    const status = await this.getResourceStatus()

    if (status.cpuUsage > this.schedulerConfig.heavyTaskCpuThreshold) {
      return { allowed: false, reason: `CPU usage too high: ${status.cpuUsage.toFixed(1)}%` }
    }

    if (status.memoryUsage > this.schedulerConfig.heavyTaskMemoryThreshold) {
      return { allowed: false, reason: `Memory usage too high: ${status.memoryUsage.toFixed(1)}%` }
    }

    if (!status.isIdle) {
      return { allowed: false, reason: "System is not idle" }
    }

    return { allowed: true, reason: "Resources available" }
  }

  /**
   * Check if any task can run
   */
  async canRunTask(priority: TaskPriority): Promise<{ allowed: boolean; reason: string }> {
    const status = await this.getResourceStatus()

    if (priority === "critical") {
      return { allowed: true, reason: "Critical task bypasses resource checks" }
    }

    if (status.cpuUsage > this.schedulerConfig.maxCpuUsagePercent) {
      return { allowed: false, reason: `CPU usage critical: ${status.cpuUsage.toFixed(1)}%` }
    }

    if (status.memoryUsage > this.schedulerConfig.maxMemoryUsagePercent) {
      return { allowed: false, reason: `Memory usage critical: ${status.memoryUsage.toFixed(1)}%` }
    }

    return { allowed: true, reason: "Resources available" }
  }

  /**
   * Execute a task with resource monitoring
   */
  async executeTask(taskId: string): Promise<TaskResult> {
    const task = this.tasks.get(taskId)
    if (!task) {
      return { success: false, durationMs: 0, error: `Task not found: ${taskId}` }
    }

    const canRun = await this.canRunTask(task.priority)
    if (!canRun.allowed && task.priority !== "critical") {
      return { success: false, durationMs: 0, error: canRun.reason }
    }

    if (task.resourceIntensity === "heavy") {
      const heavyCheck = await this.canRunHeavyTask()
      if (!heavyCheck.allowed) {
        return { success: false, durationMs: 0, error: `Heavy task blocked: ${heavyCheck.reason}` }
      }
    }

    const now = Date.now()
    if (task.nextAllowedAt && now < task.nextAllowedAt) {
      const waitTime = task.nextAllowedAt - now
      log.info("task_cooldown_active", { taskId, waitMs: waitTime })
      return { success: false, durationMs: 0, error: `Task in cooldown, retry in ${Math.round(waitTime / 1000)}s` }
    }

    this.currentTaskId = taskId
    this.isRunning = true
    const startTime = Date.now()

    log.info("task_started", { taskId, priority: task.priority, intensity: task.resourceIntensity })

    try {
      await task.run()

      const duration = Date.now() - startTime
      task.lastRunAt = now
      task.nextAllowedAt = now + task.cooldownMs

      log.info("task_completed", { taskId, durationMs: duration })

      return { success: true, durationMs: duration }
    } catch (error) {
      const duration = Date.now() - startTime
      log.error("task_failed", { taskId, error: String(error), durationMs: duration })
      return { success: false, durationMs: duration, error: String(error) }
    } finally {
      this.isRunning = false
      this.currentTaskId = null
    }
  }

  /**
   * Get the next suitable task to run
   */
  async getNextTask(): Promise<ScheduledTask | null> {
    const now = Date.now()
    const eligibleTasks: ScheduledTask[] = []

    for (const task of this.tasks.values()) {
      if (task.nextAllowedAt && now < task.nextAllowedAt) {
        continue
      }

      eligibleTasks.push(task)
    }

    if (eligibleTasks.length === 0) {
      return null
    }

    eligibleTasks.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 }
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    })

    return eligibleTasks[0]
  }

  /**
   * Run the next available task
   */
  async runNextTask(): Promise<TaskResult | null> {
    const task = await this.getNextTask()
    if (!task) {
      return null
    }
    return this.executeTask(task.id)
  }

  /**
   * Start idle monitoring
   */
  private startIdleMonitoring(): void {
    const checkIdle = () => {
      this.lastActiveAt = Date.now()
    }

    process.on("keypress", checkIdle)
    process.on("input", checkIdle)

    this.idleTimer = setInterval(() => {
      const idleMinutes = (Date.now() - this.lastActiveAt) / 1000 / 60
      if (idleMinutes >= this.config.schedule.idle_threshold_minutes) {
        log.info("system_idle_detected", { idleMinutes })
        this.runNextTask().catch((e) => log.error("idle_task_run_failed", { error: String(e) }))
      }
    }, this.schedulerConfig.checkIntervalMs)

    log.info("idle_monitoring_started", { thresholdMinutes: this.config.schedule.idle_threshold_minutes })
  }

  /**
   * Start resource monitoring
   */
  private startResourceMonitoring(): void {
    this.resourceCheckInterval = setInterval(() => {
      this.getResourceStatus()
        .then((status) => {
          log.debug("resource_status", {
            cpu: status.cpuUsage.toFixed(1),
            memory: status.memoryUsage.toFixed(1),
            idle: status.isIdle,
          })
        })
        .catch((e) => log.error("resource_check_failed", { error: String(e) }))
    }, this.schedulerConfig.checkIntervalMs)

    log.info("resource_monitoring_started", { intervalMs: this.schedulerConfig.checkIntervalMs })
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }

    if (this.resourceCheckInterval) {
      clearInterval(this.resourceCheckInterval)
      this.resourceCheckInterval = null
    }

    process.removeAllListeners("keypress")
    process.removeAllListeners("input")

    log.info("scheduler_stopped")
  }

  /**
   * Get scheduler stats
   */
  getStats(): {
    totalTasks: number
    isRunning: boolean
    currentTask: string | null
    lastActivity: Date
  } {
    return {
      totalTasks: this.tasks.size,
      isRunning: this.isRunning,
      currentTask: this.currentTaskId,
      lastActivity: new Date(this.lastActiveAt),
    }
  }

  private calculateCpuUsage(loadAvg: number[]): number {
    const numCpus = os.cpus().length
    const oneMinuteLoad = loadAvg[0]
    return Math.min(100, (oneMinuteLoad / numCpus) * 100)
  }

  getNextScheduledTime(): Date | null {
    if (!this.config.schedule.cron) return null

    try {
      const [minute, hour, dayOfMonth, month, dayOfWeek] = this.config.schedule.cron.split(" ")
      const now = new Date()
      const next = new Date(now)

      if (dayOfWeek !== "*") {
        const daysUntil = (parseInt(dayOfWeek) - now.getDay() + 7) % 7 || 7
        next.setDate(now.getDate() + daysUntil)
      }
      next.setHours(parseInt(hour) || 0, parseInt(minute) || 0, 0, 0)

      if (next <= now) {
        next.setDate(next.getDate() + 7)
      }

      return next
    } catch {
      return null
    }
  }
}
