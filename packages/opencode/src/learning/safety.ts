import { Database } from "../storage/db"
import { learning_runs } from "./learning.sql"
import { eq, desc } from "drizzle-orm"
import { Archive, type ArchiveState } from "./archive"
import { Log } from "../util/log"

const log = Log.create({ service: "learning-safety" })

export interface SafetyConfig {
  cooldown_hours: number
  max_retries: number
  auto_merge_threshold: number
  require_human_review_lines: number
  require_human_review_risk: string[]
}

export const defaultSafetyConfig: SafetyConfig = {
  cooldown_hours: 24,
  max_retries: 3,
  auto_merge_threshold: 5,
  require_human_review_lines: 50,
  require_human_review_risk: ["high"],
}

export interface SafetyCheckResult {
  allowed: boolean
  reason: string
  cooldown_remaining_ms?: number
}

export interface HumanReviewRequest {
  id: string
  title: string
  description: string
  changes_summary: string
  files_affected: string[]
  risk: string
  status: "pending" | "approved" | "rejected"
}

export class Safety {
  private config: SafetyConfig
  private archive: Archive

  constructor(config: Partial<SafetyConfig> = {}) {
    this.config = { ...defaultSafetyConfig, ...config }
    this.archive = new Archive()
  }

  async checkCooldown(): Promise<SafetyCheckResult> {
    const lastRun = await this.getLastEvolutionRun()

    if (!lastRun) {
      return { allowed: true, reason: "No previous runs" }
    }

    const lastRunTime = lastRun.time_created
    const now = Date.now()
    const cooldownMs = this.config.cooldown_hours * 60 * 60 * 1000
    const elapsed = now - lastRunTime

    if (elapsed < cooldownMs) {
      const remaining = cooldownMs - elapsed
      log.info("cooldown_active", {
        remaining_ms: remaining,
        required_hours: this.config.cooldown_hours,
      })
      return {
        allowed: false,
        reason: "Cooldown period active",
        cooldown_remaining_ms: remaining,
      }
    }

    return { allowed: true, reason: "Cooldown passed" }
  }

  private async getLastEvolutionRun(): Promise<{ time_created: number } | undefined> {
    const result = Database.use((db) =>
      db
        .select({ time_created: learning_runs.time_created })
        .from(learning_runs)
        .orderBy(desc(learning_runs.time_created))
        .limit(1)
        .get(),
    )
    return result ?? undefined
  }

  async checkChangeRisk(files_affected: string[], risk: string): Promise<SafetyCheckResult> {
    const totalChanges = files_affected.length

    const needsHumanReview =
      totalChanges > this.config.require_human_review_lines || this.config.require_human_review_risk.includes(risk)

    if (needsHumanReview) {
      log.warn("change_requires_human_review", {
        files: totalChanges,
        risk,
        threshold: this.config.require_human_review_lines,
      })
      return {
        allowed: false,
        reason: `Change requires human review (${totalChanges} files, risk: ${risk})`,
      }
    }

    return { allowed: true, reason: "Change approved for auto-merge" }
  }

  async canAutoMerge(improvement_percent: number): Promise<boolean> {
    return improvement_percent >= this.config.auto_merge_threshold
  }

  async createGoldenSnapshot(state: ArchiveState): Promise<string> {
    const golden = await this.archive.getGoldenSnapshot()

    if (golden) {
      log.info("updating_existing_golden_snapshot", { existing_id: golden.id })
    }

    const id = await this.archive.createSnapshot("golden", `Golden snapshot - ${new Date().toISOString()}`, state)

    log.info("golden_snapshot_created", { id })
    return id
  }

  async rollbackToSafeState(): Promise<ArchiveState | null> {
    const golden = await this.archive.getGoldenSnapshot()

    if (!golden) {
      log.error("no_golden_snapshot_available")
      return null
    }

    const state = await this.archive.rollback(golden.id)

    if (state) {
      log.info("rolled_back_to_golden_snapshot", { snapshot_id: golden.id })
    }

    return state
  }

  formatCooldownTime(ms: number): string {
    const hours = Math.floor(ms / (1000 * 60 * 60))
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))

    if (hours > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${minutes}m`
  }

  async shouldCreatePR(files_affected: string[], risk: string): Promise<boolean> {
    return files_affected.length >= 10 || this.config.require_human_review_risk.includes(risk)
  }
}
