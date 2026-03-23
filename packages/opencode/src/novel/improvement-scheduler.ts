import { Log } from "../util/log"
import { readdir, stat, readFile } from "fs/promises"
import { join, basename } from "path"
import { NovelLearningBridgeManager, type ImprovementSuggestion } from "./novel-learning-bridge"

const log = Log.create({ service: "novel-improvement-scheduler" })

export interface ImprovementSchedulerConfig {
  enabled: boolean
  intervalHours: number
  minConfidence: number
  autoApplyHighConfidence: boolean
  highConfidenceThreshold: number
  modules: string[]
  excludePatterns: string[]
}

export const DEFAULT_SCHEDULER_CONFIG: ImprovementSchedulerConfig = {
  enabled: false,
  intervalHours: 24,
  minConfidence: 0.5,
  autoApplyHighConfidence: false,
  highConfidenceThreshold: 0.8,
  modules: ["orchestrator.ts", "state-extractor.ts", "character-deepener.ts"],
  excludePatterns: [".test.ts", ".spec.ts", "node_modules"],
}

export class NovelImprovementScheduler {
  private config: ImprovementSchedulerConfig
  private bridgeManager: NovelLearningBridgeManager
  private timer: Timer | null = null
  private lastRun: Date | null = null
  private initialized: boolean = false

  constructor(config: Partial<ImprovementSchedulerConfig> = {}) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config }
    this.bridgeManager = new NovelLearningBridgeManager()
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      await this.bridgeManager.initialize()
      this.initialized = true
      log.info("improvement_scheduler_initialized", {
        enabled: this.config.enabled,
        intervalHours: this.config.intervalHours,
        modules: this.config.modules,
      })
    } catch (error) {
      log.error("scheduler_init_failed", { error: String(error) })
      throw error
    }
  }

  async start(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }

    if (this.timer) {
      log.warn("scheduler_already_running")
      return
    }

    if (!this.config.enabled) {
      log.info("scheduler_disabled")
      return
    }

    const intervalMs = this.config.intervalHours * 60 * 60 * 1000
    log.info("starting_improvement_scheduler", {
      intervalMs,
      intervalHours: this.config.intervalHours,
    })

    this.timer = setInterval(() => {
      this.runScheduledAnalysis().catch((error) => {
        log.error("scheduled_analysis_failed", { error: String(error) })
      })
    }, intervalMs)

    log.info("improvement_scheduler_started")
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      log.info("improvement_scheduler_stopped")
    }
  }

  async runScheduledAnalysis(): Promise<ImprovementResult[]> {
    const startTime = Date.now()
    log.info("scheduled_analysis_started")

    const results: ImprovementResult[] = []

    try {
      for (const moduleName of this.config.modules) {
        const modulePath = join(process.cwd(), "src", "novel", moduleName)

        const exists = await stat(modulePath).catch(() => null)
        if (!exists) {
          log.warn("module_not_found", { moduleName, path: modulePath })
          continue
        }

        log.info("analyzing_module", { moduleName })

        const code = await readFile(modulePath, "utf-8")
        const suggestions = await this.bridgeManager.getImprovementApi().analyzeAndSuggest(modulePath)

        const filtered = suggestions.filter((s) => s.confidence >= this.config.minConfidence)
        const highConfidence = filtered.filter((s) => s.confidence >= this.config.highConfidenceThreshold)

        results.push({
          moduleName,
          modulePath,
          suggestions: filtered,
          highConfidenceSuggestions: highConfidence,
          applied: [],
          durationMs: Date.now() - startTime,
        })

        if (this.config.autoApplyHighConfidence && highConfidence.length > 0) {
          log.info("auto_applying_high_confidence", {
            moduleName,
            count: highConfidence.length,
          })

          for (const suggestion of highConfidence) {
            const applied = await this.bridgeManager.getImprovementApi().applySuggestion(suggestion, false)
            if (applied) {
              results[results.length - 1].applied.push(suggestion)
            }
          }
        }
      }

      this.lastRun = new Date()
      log.info("scheduled_analysis_completed", {
        modulesAnalyzed: results.length,
        totalSuggestions: results.reduce((sum, r) => sum + r.suggestions.length, 0),
        highConfidence: results.reduce((sum, r) => sum + r.highConfidenceSuggestions.length, 0),
        applied: results.reduce((sum, r) => sum + r.applied.length, 0),
        durationMs: Date.now() - startTime,
      })

      return results
    } catch (error) {
      log.error("scheduled_analysis_error", { error: String(error) })
      throw error
    }
  }

  async getLastRunStatus(): Promise<{
    lastRun: Date | null
    suggestions: number
    applied: number
  } | null> {
    if (!this.lastRun) return null

    return {
      lastRun: this.lastRun,
      suggestions: 0,
      applied: 0,
    }
  }

  updateConfig(config: Partial<ImprovementSchedulerConfig>): void {
    const wasEnabled = this.config.enabled
    this.config = { ...this.config, ...config }

    if (wasEnabled && !this.config.enabled) {
      this.stop()
    } else if (!wasEnabled && this.config.enabled) {
      this.start()
    }
  }
}

export interface ImprovementResult {
  moduleName: string
  modulePath: string
  suggestions: ImprovementSuggestion[]
  highConfidenceSuggestions: ImprovementSuggestion[]
  applied: ImprovementSuggestion[]
  durationMs: number
}

let schedulerInstance: NovelImprovementScheduler | null = null

export async function getScheduler(): Promise<NovelImprovementScheduler> {
  if (!schedulerInstance) {
    schedulerInstance = new NovelImprovementScheduler()
    await schedulerInstance.initialize()
  }
  return schedulerInstance
}

export async function startScheduler(config?: Partial<ImprovementSchedulerConfig>): Promise<void> {
  const scheduler = await getScheduler()
  if (config) {
    scheduler.updateConfig(config)
  }
  await scheduler.start()
}

export async function stopScheduler(): Promise<void> {
  if (schedulerInstance) {
    await schedulerInstance.stop()
  }
}
