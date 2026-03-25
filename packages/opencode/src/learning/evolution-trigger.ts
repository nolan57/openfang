import { Deployer, type DeploymentTask } from "./deployer"
import { KnowledgeGraph } from "./knowledge-graph"
import { ConsistencyChecker } from "./consistency-checker"
import { Safety } from "./safety"
import { Log } from "../util/log"
import * as fs from "fs"
import * as path from "path"

const log = Log.create({ service: "evolution-trigger" })

export interface EvolutionTriggerConfig {
  check_interval_ms: number
  auto_approve_small_changes: boolean
  small_change_threshold_lines: number
  require_human_review_for_skills: boolean
  cooldown_hours: number
  max_consecutive_evolution: number
  confidence_threshold: number
  max_retries_per_hour: number
  circuit_breaker_threshold: number
}

export const defaultTriggerConfig: EvolutionTriggerConfig = {
  check_interval_ms: 60000,
  auto_approve_small_changes: true,
  small_change_threshold_lines: 20,
  require_human_review_for_skills: true,
  cooldown_hours: 2,
  max_consecutive_evolution: 3,
  confidence_threshold: 0.7,
  max_retries_per_hour: 5,
  circuit_breaker_threshold: 3,
}

export interface TriggerResult {
  tasks_created: number
  tasks_pending: number
  errors: string[]
  cooldown_active: boolean
  circuit_breaker_active: boolean
}

export interface CircuitBreakerState {
  failures: number
  lastFailureTime: number
  state: "closed" | "open" | "half-open"
  lastStateChange: number
}

/**
 * Evolution Trigger with Anti-Infinite-Loop Mechanisms
 * [EVOLUTION]: Added cooldown, confidence threshold, circuit breaker to prevent
 * system from getting stuck in endless refactoring loops
 */
export class EvolutionTrigger {
  private deployer: Deployer
  private graph: KnowledgeGraph
  private consistency: ConsistencyChecker
  private safety: Safety
  private config: EvolutionTriggerConfig
  private lastCheck: number = 0
  private lastEvolutionTime: number = 0
  private consecutiveEvolutionCount: number = 0
  private retriesThisHour: number = 0
  private hourResetTime: number = Date.now()
  private circuitBreaker: CircuitBreakerState = {
    failures: 0,
    lastFailureTime: 0,
    state: "closed",
    lastStateChange: Date.now(),
  }
  private evolutionHistory: Array<{ timestamp: number; success: boolean; type: string }> = []

  constructor(config: Partial<EvolutionTriggerConfig> = {}) {
    this.deployer = new Deployer()
    this.graph = new KnowledgeGraph()
    this.consistency = new ConsistencyChecker()
    this.safety = new Safety()
    this.config = { ...defaultTriggerConfig, ...config }
  }

  async checkAndTrigger(verbose: boolean = false): Promise<TriggerResult & { steps?: string[] }> {
    const result: TriggerResult & { steps?: string[] } = {
      tasks_created: 0,
      tasks_pending: 0,
      errors: [],
      cooldown_active: false,
      circuit_breaker_active: false,
      steps: verbose ? [] : undefined,
    }

    const addStep = (step: string) => {
      if (verbose && result.steps) {
        result.steps.push(step)
      }
    }

    try {
      addStep("🔍 Checking circuit breaker status...")
      
      if (this.circuitBreaker.state === "open") {
        const shouldTryHalfOpen = Date.now() - this.circuitBreaker.lastStateChange > 5 * 60 * 1000
        if (!shouldTryHalfOpen) {
          log.warn("circuit_breaker_open", {
            failures: this.circuitBreaker.failures,
            since: new Date(this.circuitBreaker.lastStateChange).toISOString(),
          })
          result.circuit_breaker_active = true
          addStep("⚠️ Circuit breaker is OPEN - waiting for recovery")
          return result
        }
        this.circuitBreaker.state = "half-open"
        this.circuitBreaker.lastStateChange = Date.now()
        log.info("circuit_breaker_half_open")
        addStep("🔄 Circuit breaker is HALF-OPEN - attempting recovery")
      }

      addStep("🛡️ Checking safety cooldown...")
      const cooldownCheck = await this.safety.checkCooldown()
      const customCooldownCheck = this.checkCustomCooldown()

      if (!cooldownCheck.allowed || !customCooldownCheck.allowed) {
        log.info("cooldown_active", {
          safety_cooldown: !cooldownCheck.allowed,
          custom_cooldown: !customCooldownCheck.allowed,
          remaining: customCooldownCheck.remaining_ms,
        })
        result.cooldown_active = true
        addStep("⏸️ Cooldown is active - evolution postponed")
        return result
      }
      addStep("✅ Safety checks passed")

      addStep("📊 Checking confidence level...")
      const confidenceCheck = await this.checkConfidence()
      if (!confidenceCheck.allowed) {
        log.warn("low_confidence_preventing_evolution", {
          confidence: confidenceCheck.confidence,
          threshold: this.config.confidence_threshold,
        })
        result.errors.push("Low confidence - evolution prevented")
        addStep(`⚠️ Low confidence (${confidenceCheck.confidence.toFixed(2)}) - evolution prevented`)
        return result
      }
      addStep(`✅ Confidence level: ${confidenceCheck.confidence.toFixed(2)}`)

      addStep("📋 Checking pending tasks...")
      const pendingTasks = await this.deployer.getPendingTasks()
      result.tasks_pending = pendingTasks.length
      addStep(`📊 Found ${pendingTasks.length} pending task(s)`)

      addStep("🔍 Detecting code changes...")
      const codeChanges = await this.detectCodeChanges()
      for (const change of codeChanges) {
        const taskId = await this.deployer.createCodeChangeTask({
          files: change.files,
          diff_summary: change.summary,
          build_command: "bun run build",
          restart_command: "echo 'restart'",
        })
        result.tasks_created++
        addStep(`📝 Created code change task: ${taskId}`)
        log.info("code_change_task_created", { taskId, files: change.files.length })
      }

      addStep("🎯 Checking for new skills...")
      const skillChanges = await this.detectNewSkills()
      for (const skill of skillChanges) {
        if (this.config.require_human_review_for_skills) {
          log.info("skill_change_requires_review", { skill: skill.name })
          addStep(`🔒 Skill '${skill.name}' requires human review`)
        } else {
          log.info("skill_change_detected", { skill: skill.name })
          addStep(`✨ New skill detected: ${skill.name}`)
        }
      }

      addStep("🔍 Running consistency check...")
      const consistencyReport = await this.consistency.runFullCheck()
      if (consistencyReport.summary.conflicts > 0 || consistencyReport.summary.outdated > 5) {
        log.warn("consistency_issues_detected", {
          conflicts: consistencyReport.summary.conflicts,
          outdated: consistencyReport.summary.outdated,
        })
        addStep(`⚠️ Consistency issues: ${consistencyReport.summary.conflicts} conflicts, ${consistencyReport.summary.outdated} outdated`)
      } else {
        addStep("✅ Consistency check passed")
      }

      this.recordEvolution(true, "successful_check")
      this.updateCircuitBreaker(true)
      this.lastCheck = Date.now()
      addStep("✅ Evolution check completed successfully")
    } catch (error) {
      result.errors.push(String(error))
      log.error("trigger_check_failed", { error: String(error) })
      this.recordEvolution(false, String(error))
      this.updateCircuitBreaker(false)
      addStep(`❌ Error: ${String(error)}`)
    }

    return result
  }

  private checkCustomCooldown(): { allowed: boolean; remaining_ms: number } {
    const now = Date.now()

    if (now - this.lastEvolutionTime < this.config.cooldown_hours * 60 * 60 * 1000) {
      const remaining = this.config.cooldown_hours * 60 * 60 * 1000 - (now - this.lastEvolutionTime)
      return { allowed: false, remaining_ms: remaining }
    }

    if (this.consecutiveEvolutionCount >= this.config.max_consecutive_evolution) {
      log.warn("max_consecutive_evolution_reached", {
        count: this.consecutiveEvolutionCount,
        max: this.config.max_consecutive_evolution,
      })
      return { allowed: false, remaining_ms: 60 * 60 * 1000 }
    }

    if (now - this.hourResetTime > 60 * 60 * 1000) {
      this.retriesThisHour = 0
      this.hourResetTime = now
    }

    if (this.retriesThisHour >= this.config.max_retries_per_hour) {
      log.warn("max_retries_per_hour_reached", {
        retries: this.retriesThisHour,
        max: this.config.max_retries_per_hour,
      })
      return { allowed: false, remaining_ms: 60 * 60 * 1000 }
    }

    return { allowed: true, remaining_ms: 0 }
  }

  private async checkConfidence(): Promise<{ allowed: boolean; confidence: number }> {
    const recentHistory = this.evolutionHistory.slice(-10)
    if (recentHistory.length < 3) {
      return { allowed: true, confidence: 1.0 }
    }

    const successes = recentHistory.filter((h) => h.success).length
    const confidence = successes / recentHistory.length

    if (confidence < this.config.confidence_threshold) {
      return { allowed: false, confidence }
    }

    return { allowed: true, confidence }
  }

  private recordEvolution(success: boolean, type: string): void {
    const now = Date.now()
    this.evolutionHistory.push({ timestamp: now, success, type })

    if (this.evolutionHistory.length > 100) {
      this.evolutionHistory.shift()
    }

    if (success) {
      this.lastEvolutionTime = now
      this.consecutiveEvolutionCount++
      this.retriesThisHour++
    } else {
      this.consecutiveEvolutionCount = 0
    }

    log.info("evolution_recorded", { success, type, consecutive: this.consecutiveEvolutionCount })
  }

  private updateCircuitBreaker(success: boolean): void {
    if (success) {
      if (this.circuitBreaker.state === "half-open") {
        this.circuitBreaker.state = "closed"
        this.circuitBreaker.failures = 0
        this.circuitBreaker.lastStateChange = Date.now()
        log.info("circuit_breaker_closed")
      }
    } else {
      this.circuitBreaker.failures++
      this.circuitBreaker.lastFailureTime = Date.now()

      if (this.circuitBreaker.failures >= this.config.circuit_breaker_threshold) {
        this.circuitBreaker.state = "open"
        this.circuitBreaker.lastStateChange = Date.now()
        log.warn("circuit_breaker_opened", { failures: this.circuitBreaker.failures })
      }
    }
  }

  private async detectCodeChanges(): Promise<{ files: string[]; summary: string }[]> {
    const changes: { files: string[]; summary: string }[] = []

    const recentNodes = await this.graph.findNodesByType("file")
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000

    const recentChanges = recentNodes.filter((n) => {
      const lastChanged = n.metadata?.last_changed as number | undefined
      return lastChanged && lastChanged > thirtyMinutesAgo
    })

    if (recentChanges.length > 0) {
      changes.push({
        files: recentChanges.map((n) => n.entity_id),
        summary: `Auto-detected ${recentChanges.length} recently modified files`,
      })
    }

    return changes
  }

  private async detectNewSkills(): Promise<{ name: string; source: string }[]> {
    const skills: { name: string; source: string }[] = []

    const skillNodes = await this.graph.findNodesByType("skill")
    const oneHourAgo = Date.now() - 60 * 60 * 1000

    const newSkills = skillNodes.filter((n) => {
      const created = n.metadata?.loaded_at as number | undefined
      return created && created > oneHourAgo
    })

    for (const skill of newSkills) {
      skills.push({
        name: skill.title,
        source: skill.entity_id,
      })
    }

    return skills
  }

  startMonitoring(intervalMs?: number): NodeJS.Timer {
    const interval = intervalMs || this.config.check_interval_ms

    log.info("trigger_monitoring_started", { interval_ms: interval })

    return setInterval(() => {
      this.checkAndTrigger().catch((err) => {
        log.error("monitoring_error", { error: String(err) })
      })
    }, interval)
  }

  stopMonitoring(timer: NodeJS.Timer): void {
    clearInterval(timer)
    log.info("trigger_monitoring_stopped")
  }

  async getStatus(): Promise<{
    last_check: number
    config: EvolutionTriggerConfig
    pending_tasks: number
    consecutive_evolution: number
    circuit_breaker: CircuitBreakerState
    confidence: number
  }> {
    const pending = await this.deployer.getPendingTasks()
    const recentHistory = this.evolutionHistory.slice(-10)
    const successes = recentHistory.filter((h) => h.success).length
    const confidence = recentHistory.length > 0 ? successes / recentHistory.length : 1.0

    return {
      last_check: this.lastCheck,
      config: this.config,
      pending_tasks: pending.length,
      consecutive_evolution: this.consecutiveEvolutionCount,
      circuit_breaker: this.circuitBreaker,
      confidence,
    }
  }

  /**
   * Manual reset for circuit breaker (for emergency recovery)
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker = {
      failures: 0,
      lastFailureTime: 0,
      state: "closed",
      lastStateChange: Date.now(),
    }
    this.consecutiveEvolutionCount = 0
    log.info("circuit_breaker_manually_reset")
  }

  /**
   * Get evolution history for analysis
   */
  getEvolutionHistory(limit: number = 50): typeof this.evolutionHistory {
    return this.evolutionHistory.slice(-limit)
  }
}
