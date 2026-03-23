import { execSync, spawn } from "child_process"
import { readFile, writeFile, mkdir, rm, copyFile } from "fs/promises"
import { resolve, join, dirname } from "path"
import { Log } from "../util/log"
import { Archive } from "./archive"
import { Safety } from "./safety"
import type { ArchiveState } from "./archive"

const log = Log.create({ service: "rollback-manager" })

export interface RollbackCheckpoint {
  id: string
  timestamp: number
  description: string
  files: Record<string, string>
  gitCommit?: string
  archiveSnapshotId?: string
  benchmarkResults?: Record<string, number>
  autoEvolutionId?: string
}

export interface RollbackResult {
  success: boolean
  checkpointId: string
  restoredFiles: string[]
  error?: string
}

export interface VerificationResult {
  passed: boolean
  checks: Array<{
    name: string
    passed: boolean
    error?: string
  }>
}

export interface RollbackConfig {
  maxCheckpoints: number
  checkpointTTL: number
  autoRollbackOnBenchmarkFailure: boolean
  benchmarkThreshold: number
  requireHumanReview: boolean
}

const defaultRollbackConfig: RollbackConfig = {
  maxCheckpoints: 50,
  checkpointTTL: 7 * 24 * 60 * 60 * 1000,
  autoRollbackOnBenchmarkFailure: true,
  benchmarkThreshold: -5,
  requireHumanReview: false,
}

export interface AutoRollbackTrigger {
  type: "benchmark_failure" | "typecheck_failure" | "test_failure" | "manual"
  threshold?: number
  description: string
}

/**
 * Rollback Manager for self-evolution changes
 * Provides checkpoint creation, verification, and rollback capabilities
 *
 * [EVOLUTION]: Enhanced with archive integration, benchmark-based auto-rollback,
 * and automation level control
 */
export class RollbackManager {
  private projectDir: string
  private checkpointsDir: string
  private archive: Archive
  private safety: Safety
  private config: RollbackConfig

  constructor(projectDir: string, config?: Partial<RollbackConfig>) {
    this.projectDir = projectDir
    this.checkpointsDir = resolve(projectDir, ".opencode/evolution/checkpoints")
    this.archive = new Archive()
    this.safety = new Safety()
    this.config = { ...defaultRollbackConfig, ...config }
  }

  /**
   * Create a checkpoint before making changes
   * [EVOLUTION]: Now also creates archive snapshot and stores benchmark baseline
   */
  async createCheckpoint(
    description: string,
    files: string[],
    options?: {
      archiveState?: ArchiveState
      benchmarkResults?: Record<string, number>
      autoEvolutionId?: string
    },
  ): Promise<RollbackCheckpoint> {
    const checkpointId = `checkpoint-${Date.now()}`

    await mkdir(this.checkpointsDir, { recursive: true })

    const fileHashes: Record<string, string> = {}

    for (const file of files) {
      try {
        const filePath = resolve(this.projectDir, file)
        const content = await readFile(filePath, "utf-8")
        const hash = this.simpleHash(content)

        const checkpointFile = join(this.checkpointsDir, `${checkpointId}-${this.escapeFile(file)}.txt`)
        await mkdir(dirname(checkpointFile), { recursive: true })
        await writeFile(checkpointFile, content)

        fileHashes[file] = hash
      } catch (error) {
        log.warn("failed_to_checkpoint_file", { file, error: String(error) })
      }
    }

    let gitCommit: string | undefined
    try {
      execSync("git add -A", { cwd: this.projectDir, stdio: "ignore" })
      execSync(`git commit -m "Checkpoint: ${description}"`, { cwd: this.projectDir, stdio: "ignore" })
      gitCommit = execSync("git rev-parse HEAD", { cwd: this.projectDir, encoding: "utf-8" }).trim()
    } catch {
      log.warn("git_checkpoint_failed")
    }

    let archiveSnapshotId: string | undefined
    if (options?.archiveState) {
      try {
        archiveSnapshotId = await this.archive.createSnapshot(
          "pre_evolution",
          `Checkpoint: ${description}`,
          options.archiveState,
        )
        log.info("archive_snapshot_created", { archiveSnapshotId })
      } catch (error) {
        log.warn("archive_snapshot_failed", { error: String(error) })
      }
    }

    const checkpoint: RollbackCheckpoint = {
      id: checkpointId,
      timestamp: Date.now(),
      description,
      files: fileHashes,
      gitCommit,
      archiveSnapshotId,
      benchmarkResults: options?.benchmarkResults,
      autoEvolutionId: options?.autoEvolutionId,
    }

    await writeFile(join(this.checkpointsDir, `${checkpointId}.json`), JSON.stringify(checkpoint, null, 2))

    await this.cleanupOldCheckpoints()

    log.info("checkpoint_created", { checkpointId, files: files.length, archiveSnapshotId })
    return checkpoint
  }

  /**
   * Rollback to a specific checkpoint
   * [EVOLUTION]: Also restores archive state if available
   */
  async rollback(checkpointId: string): Promise<RollbackResult> {
    const checkpointFile = join(this.checkpointsDir, `${checkpointId}.json`)

    let checkpoint: RollbackCheckpoint
    try {
      const content = await readFile(checkpointFile, "utf-8")
      checkpoint = JSON.parse(content)
    } catch (error) {
      return {
        success: false,
        checkpointId,
        restoredFiles: [],
        error: `Checkpoint not found: ${checkpointId}`,
      }
    }

    const restoredFiles: string[] = []

    for (const file of Object.keys(checkpoint.files)) {
      try {
        const checkpointContentFile = join(this.checkpointsDir, `${checkpointId}-${this.escapeFile(file)}.txt`)
        const content = await readFile(checkpointContentFile, "utf-8")
        const filePath = resolve(this.projectDir, file)

        await mkdir(dirname(filePath), { recursive: true })
        await writeFile(filePath, content)

        restoredFiles.push(file)
      } catch (error) {
        log.error("failed_to_restore_file", { file, error: String(error) })
      }
    }

    if (checkpoint.gitCommit) {
      try {
        execSync(`git reset --hard ${checkpoint.gitCommit}`, { cwd: this.projectDir, stdio: "ignore" })
      } catch {
        log.warn("git_rollback_failed")
      }
    }

    if (checkpoint.archiveSnapshotId) {
      try {
        const archiveState = await this.archive.rollback(checkpoint.archiveSnapshotId)
        if (archiveState) {
          log.info("archive_state_restored", { checkpointId })
        }
      } catch (error) {
        log.warn("archive_rollback_failed", { error: String(error) })
      }
    }

    log.info("rollback_complete", { checkpointId, restoredFiles: restoredFiles.length })

    return {
      success: true,
      checkpointId,
      restoredFiles,
    }
  }

  /**
   * Auto-rollback based on trigger conditions
   * [EVOLUTION]: Automated rollback with benchmark/test failure detection
   */
  async autoRollback(
    trigger: AutoRollbackTrigger,
    currentBenchmark?: Record<string, number>,
    baselineBenchmark?: Record<string, number>,
  ): Promise<{ triggered: boolean; checkpointId?: string; reason: string }> {
    if (!this.config.autoRollbackOnBenchmarkFailure) {
      return { triggered: false, reason: "Auto-rollback disabled" }
    }

    if (trigger.type === "benchmark_failure" && currentBenchmark && baselineBenchmark) {
      for (const [metric, currentValue] of Object.entries(currentBenchmark)) {
        const baseline = baselineBenchmark[metric]
        if (baseline === undefined) continue

        const changePercent = ((currentValue - baseline) / baseline) * 100
        if (changePercent < this.config.benchmarkThreshold) {
          log.warn("benchmark_regression_detected", {
            metric,
            baseline,
            current: currentValue,
            changePercent,
            threshold: this.config.benchmarkThreshold,
          })

          const checkpoints = await this.listCheckpoints()
          const latestWithBenchmark = checkpoints.find((c) => c.benchmarkResults !== undefined)

          if (latestWithBenchmark) {
            const result = await this.rollback(latestWithBenchmark.id)
            if (result.success) {
              return {
                triggered: true,
                checkpointId: latestWithBenchmark.id,
                reason: `Benchmark regression: ${metric} degraded by ${changePercent.toFixed(2)}%`,
              }
            }
          }
        }
      }
    }

    if (trigger.type === "typecheck_failure" || trigger.type === "test_failure") {
      const checkpoints = await this.listCheckpoints()
      const latest = checkpoints[0]

      if (latest) {
        const result = await this.rollback(latest.id)
        if (result.success) {
          return {
            triggered: true,
            checkpointId: latest.id,
            reason: `${trigger.type === "typecheck_failure" ? "Type check" : "Test"} failure triggered rollback`,
          }
        }
      }
    }

    return { triggered: false, reason: "No rollback conditions met" }
  }

  /**
   * Verify changes after modification
   */
  async verifyChanges(
    files: string[],
    verificationChecks: Array<{ name: string; check: () => Promise<boolean> }>,
  ): Promise<VerificationResult> {
    const checks: VerificationResult["checks"] = []

    for (const { name, check } of verificationChecks) {
      try {
        const passed = await check()
        checks.push({ name, passed })
      } catch (error) {
        checks.push({ name, passed: false, error: String(error) })
      }
    }

    try {
      execSync("bun run typecheck", { cwd: this.projectDir, stdio: "ignore" })
      checks.push({ name: "TypeScript compilation", passed: true })
    } catch {
      checks.push({ name: "TypeScript compilation", passed: false, error: "Type check failed" })
    }

    const passed = checks.every((c) => c.passed)

    return { passed, checks }
  }

  /**
   * Cleanup old checkpoints
   */
  async cleanupOldCheckpoints(maxAgeMs?: number): Promise<number> {
    const now = Date.now()
    const ttl = maxAgeMs ?? this.config.checkpointTTL
    let removed = 0

    try {
      const files = await import("fs/promises")
      const entries = await files.readdir(this.checkpointsDir)

      const checkpoints: Array<{ file: string; checkpoint: RollbackCheckpoint }> = []

      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue

        const filePath = join(this.checkpointsDir, entry)
        const content = await readFile(filePath, "utf-8")
        const checkpoint: RollbackCheckpoint = JSON.parse(content)
        checkpoints.push({ file: filePath, checkpoint })
      }

      checkpoints.sort((a, b) => b.checkpoint.timestamp - a.checkpoint.timestamp)

      for (let i = 0; i < checkpoints.length; i++) {
        const { file, checkpoint } = checkpoints[i]
        const isExpired = now - checkpoint.timestamp > ttl
        const isOverMax = i >= this.config.maxCheckpoints

        if (isExpired || isOverMax) {
          await rm(file)

          for (const fileKey of Object.keys(checkpoint.files)) {
            try {
              await rm(join(this.checkpointsDir, `${checkpoint.id}-${this.escapeFile(fileKey)}.txt`))
            } catch {
              // Ignore
            }
          }

          removed++
        }
      }
    } catch (error) {
      log.warn("cleanup_failed", { error: String(error) })
    }

    return removed
  }

  /**
   * List all checkpoints
   */
  async listCheckpoints(): Promise<RollbackCheckpoint[]> {
    try {
      const files = await import("fs/promises")
      const entries = await files.readdir(this.checkpointsDir)
      const checkpoints: RollbackCheckpoint[] = []

      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue

        const filePath = join(this.checkpointsDir, entry)
        const content = await readFile(filePath, "utf-8")
        checkpoints.push(JSON.parse(content))
      }

      return checkpoints.sort((a, b) => b.timestamp - a.timestamp)
    } catch {
      return []
    }
  }

  /**
   * Get the latest checkpoint
   */
  async getLatestCheckpoint(): Promise<RollbackCheckpoint | null> {
    const checkpoints = await this.listCheckpoints()
    return checkpoints.length > 0 ? checkpoints[0] : null
  }

  /**
   * Get checkpoint by auto-evolution ID
   */
  async getCheckpointByEvolutionId(evolutionId: string): Promise<RollbackCheckpoint | null> {
    const checkpoints = await this.listCheckpoints()
    return checkpoints.find((c) => c.autoEvolutionId === evolutionId) || null
  }

  private simpleHash(content: string): string {
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(36)
  }

  private escapeFile(file: string): string {
    return file.replace(/[^a-zA-Z0-9]/g, "_")
  }

  /**
   * Get rollback manager stats
   */
  async getStats(): Promise<{
    totalCheckpoints: number
    oldestCheckpoint: number | null
    newestCheckpoint: number | null
    totalSizeBytes: number
  }> {
    const checkpoints = await this.listCheckpoints()

    if (checkpoints.length === 0) {
      return {
        totalCheckpoints: 0,
        oldestCheckpoint: null,
        newestCheckpoint: null,
        totalSizeBytes: 0,
      }
    }

    let totalSizeBytes = 0
    try {
      const files = await import("fs/promises")
      const entries = await files.readdir(this.checkpointsDir)
      for (const entry of entries) {
        const stat = await files.stat(join(this.checkpointsDir, entry))
        totalSizeBytes += stat.size
      }
    } catch {
      // Ignore
    }

    return {
      totalCheckpoints: checkpoints.length,
      oldestCheckpoint: checkpoints[checkpoints.length - 1].timestamp,
      newestCheckpoint: checkpoints[0].timestamp,
      totalSizeBytes,
    }
  }
}

/**
 * Create rollback manager for project
 * [EVOLUTION]: Now accepts optional config
 */
export function createRollbackManager(projectDir: string, config?: Partial<RollbackConfig>): RollbackManager {
  return new RollbackManager(projectDir, config)
}
