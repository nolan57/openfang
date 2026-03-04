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
}

export const defaultTriggerConfig: EvolutionTriggerConfig = {
  check_interval_ms: 60000,
  auto_approve_small_changes: true,
  small_change_threshold_lines: 20,
  require_human_review_for_skills: true,
}

export interface TriggerResult {
  tasks_created: number
  tasks_pending: number
  errors: string[]
}

export class EvolutionTrigger {
  private deployer: Deployer
  private graph: KnowledgeGraph
  private consistency: ConsistencyChecker
  private safety: Safety
  private config: EvolutionTriggerConfig
  private lastCheck: number = 0

  constructor(config: Partial<EvolutionTriggerConfig> = {}) {
    this.deployer = new Deployer()
    this.graph = new KnowledgeGraph()
    this.consistency = new ConsistencyChecker()
    this.safety = new Safety()
    this.config = { ...defaultTriggerConfig, ...config }
  }

  async checkAndTrigger(): Promise<TriggerResult> {
    const result: TriggerResult = {
      tasks_created: 0,
      tasks_pending: 0,
      errors: [],
    }

    try {
      const safetyCheck = await this.safety.checkCooldown()
      if (!safetyCheck.allowed) {
        log.info("cooldown_active", { remaining: safetyCheck.cooldown_remaining_ms })
        result.tasks_pending = -1
        return result
      }

      const pendingTasks = await this.deployer.getPendingTasks()
      result.tasks_pending = pendingTasks.length

      const codeChanges = await this.detectCodeChanges()
      for (const change of codeChanges) {
        const taskId = await this.deployer.createCodeChangeTask({
          files: change.files,
          diff_summary: change.summary,
          build_command: "bun run build",
          restart_command: "echo 'restart'",
        })
        result.tasks_created++
        log.info("code_change_task_created", { taskId, files: change.files.length })
      }

      const skillChanges = await this.detectNewSkills()
      for (const skill of skillChanges) {
        if (this.config.require_human_review_for_skills) {
          log.info("skill_change_requires_review", { skill: skill.name })
        } else {
          log.info("skill_change_detected", { skill: skill.name })
        }
      }

      const consistencyReport = await this.consistency.runFullCheck()
      if (consistencyReport.summary.conflicts > 0 || consistencyReport.summary.outdated > 5) {
        log.warn("consistency_issues_detected", {
          conflicts: consistencyReport.summary.conflicts,
          outdated: consistencyReport.summary.outdated,
        })
      }

      this.lastCheck = Date.now()
    } catch (error) {
      result.errors.push(String(error))
      log.error("trigger_check_failed", { error: String(error) })
    }

    return result
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
  }> {
    const pending = await this.deployer.getPendingTasks()

    return {
      last_check: this.lastCheck,
      config: this.config,
      pending_tasks: pending.length,
    }
  }
}
