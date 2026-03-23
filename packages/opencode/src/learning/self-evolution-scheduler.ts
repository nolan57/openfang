import { SelfRefactor } from "./self-refactor"
import type { CodeIssue, RefactorResult, GitHubConfig } from "./self-refactor"
import { Log } from "../util/log"
import { resolve } from "path"
import { IncrementalIndexer, incrementalIndexer } from "./incremental-indexer"

const log = Log.create({ service: "self-evolution-scheduler" })

export interface SelfEvolutionConfig {
  enabled: boolean
  scanIntervalMs: number
  autoFixPatterns: CodeIssue["type"][]
  requireHumanReview: boolean
  maxAutoFixPerRun: number
  enableIncrementalIndex?: boolean
  github?: GitHubConfig
}

export const defaultSelfEvolutionConfig: SelfEvolutionConfig = {
  enabled: false, // Disabled by default - requires explicit enable
  scanIntervalMs: 24 * 60 * 60 * 1000, // Once per day
  autoFixPatterns: ["console_log", "TODO"],
  requireHumanReview: true,
  maxAutoFixPerRun: 10,
  enableIncrementalIndex: true,
}

export interface SelfEvolutionResult {
  issues_scanned: number
  auto_fixed: number
  human_review_required: number
  pr_created: boolean
  pr_url?: string
  errors: string[]
}

export class SelfEvolutionScheduler {
  private config: SelfEvolutionConfig
  private srcDir: string
  private refactor: SelfRefactor
  private intervalId: ReturnType<typeof setInterval> | null = null
  private indexer: IncrementalIndexer

  constructor(projectDir: string, config?: Partial<SelfEvolutionConfig>) {
    this.srcDir = resolve(projectDir, "packages/opencode/src")
    this.config = { ...defaultSelfEvolutionConfig, ...config }
    this.refactor = new SelfRefactor(this.srcDir)
    this.indexer = incrementalIndexer
    this.indexer.configure(this.srcDir, "opencode")

    if (this.config.github) {
      this.refactor.setGitHubConfig(this.config.github)
    }
  }

  /**
   * Start the self-evolution scheduler
   */
  start(): void {
    if (!this.config.enabled) {
      log.info("self_evolution_disabled")
      return
    }

    if (this.intervalId) {
      log.warn("scheduler_already_running")
      return
    }

    // Start incremental indexer
    if (this.config.enableIncrementalIndex) {
      this.indexer.start()
      log.info("incremental_indexer_started")
    }

    // Run immediately on start
    this.runEvolutionCycle().catch((e) => log.error("initial_scan_failed", { error: String(e) }))

    // Schedule periodic runs
    this.intervalId = setInterval(() => {
      this.runEvolutionCycle().catch((e) => log.error("scheduled_scan_failed", { error: String(e) }))
    }, this.config.scanIntervalMs)

    log.info("self_evolution_started", {
      intervalMs: this.config.scanIntervalMs,
      autoFixPatterns: this.config.autoFixPatterns,
    })
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      log.info("self_evolution_stopped")
    }
  }

  /**
   * Run a single evolution cycle
   */
  async runEvolutionCycle(): Promise<SelfEvolutionResult> {
    const result: SelfEvolutionResult = {
      issues_scanned: 0,
      auto_fixed: 0,
      human_review_required: 0,
      pr_created: false,
      errors: [],
    }

    try {
      log.info("evolution_cycle_start")

      // Scan for issues
      const allIssues = await this.refactor.scanForIssues()
      result.issues_scanned = allIssues.length

      // Separate into auto-fixable and human-review required
      const autoFixable = allIssues.filter((i) => this.config.autoFixPatterns.includes(i.type))
      const humanReview = allIssues.filter((i) => !this.config.autoFixPatterns.includes(i.type))

      result.human_review_required = humanReview.length

      // Auto-fix limited number of issues
      const toFix = autoFixable.slice(0, this.config.maxAutoFixPerRun)

      if (toFix.length > 0) {
        if (this.config.requireHumanReview) {
          // Log what would be fixed for human review
          log.info("issues_for_review", {
            count: toFix.length,
            issues: toFix.map((i) => ({ file: i.file, line: i.line, type: i.type })),
          })

          // Store pending fixes for later approval
          await this.storePendingFixes(toFix)
        } else {
          // Auto-apply fixes
          const fixResult = await this.refactor.fixIssues(toFix, false)
          result.auto_fixed = fixResult.fixed

          // Create PR if GitHub is configured
          if (this.config.github && fixResult.fixed > 0) {
            const prResult = await this.refactor.createPullRequest(toFix)
            result.pr_created = prResult.pr_created
            result.pr_url = prResult.pr_url
          }
        }
      }

      log.info("evolution_cycle_complete", result)
    } catch (error) {
      const errorMsg = String(error)
      result.errors.push(errorMsg)
      log.error("evolution_cycle_failed", { error: errorMsg })
    }

    return result
  }

  /**
   * Manually trigger evolution (for CLI command)
   */
  async trigger(): Promise<SelfEvolutionResult> {
    return this.runEvolutionCycle()
  }

  /**
   * Get current stats
   */
  async getStats() {
    return this.refactor.getStats()
  }

  /**
   * Store pending fixes for human review
   */
  private async storePendingFixes(issues: CodeIssue[]): Promise<void> {
    // For now, just log - in full implementation would save to a pending fixes store
    log.info("pending_fixes_stored", { count: issues.length })
  }
}

/**
 * Create a self-evolution scheduler for the project
 */
export function createSelfEvolutionScheduler(
  projectDir: string,
  config?: Partial<SelfEvolutionConfig>,
): SelfEvolutionScheduler {
  return new SelfEvolutionScheduler(projectDir, config)
}
