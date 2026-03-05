import { execSync, spawn } from "child_process"
import { readFile, writeFile, mkdir, rm, copyFile } from "fs/promises"
import { resolve, join, dirname } from "path"
import { Log } from "../util/log"

const log = Log.create({ service: "rollback-manager" })

export interface RollbackCheckpoint {
  id: string
  timestamp: number
  description: string
  files: Record<string, string> // file path -> original content hash
  gitCommit?: string
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

/**
 * Rollback Manager for self-evolution changes
 * Provides checkpoint creation, verification, and rollback capabilities
 */
export class RollbackManager {
  private projectDir: string
  private checkpointsDir: string

  constructor(projectDir: string) {
    this.projectDir = projectDir
    this.checkpointsDir = resolve(projectDir, ".opencode/evolution/checkpoints")
  }

  /**
   * Create a checkpoint before making changes
   */
  async createCheckpoint(description: string, files: string[]): Promise<RollbackCheckpoint> {
    const checkpointId = `checkpoint-${Date.now()}`
    
    // Ensure checkpoints directory exists
    await mkdir(this.checkpointsDir, { recursive: true })

    const fileHashes: Record<string, string> = {}

    // Store current file contents
    for (const file of files) {
      try {
        const filePath = resolve(this.projectDir, file)
        const content = await readFile(filePath, "utf-8")
        const hash = this.simpleHash(content)
        
        // Store content in checkpoint file
        const checkpointFile = join(this.checkpointsDir, `${checkpointId}-${this.escapeFile(file)}.txt`)
        await mkdir(dirname(checkpointFile), { recursive: true })
        await writeFile(checkpointFile, content)
        
        fileHashes[file] = hash
      } catch (error) {
        log.warn("failed_to_checkpoint_file", { file, error: String(error) })
      }
    }

    // Create git commit for additional safety
    let gitCommit: string | undefined
    try {
      execSync("git add -A", { cwd: this.projectDir, stdio: "ignore" })
      execSync(`git commit -m "Checkpoint: ${description}"`, { cwd: this.projectDir, stdio: "ignore" })
      gitCommit = execSync("git rev-parse HEAD", { cwd: this.projectDir, encoding: "utf-8" }).trim()
    } catch {
      log.warn("git_checkpoint_failed")
    }

    const checkpoint: RollbackCheckpoint = {
      id: checkpointId,
      timestamp: Date.now(),
      description,
      files: fileHashes,
      gitCommit,
    }

    // Save checkpoint metadata
    await writeFile(
      join(this.checkpointsDir, `${checkpointId}.json`),
      JSON.stringify(checkpoint, null, 2),
    )

    log.info("checkpoint_created", { checkpointId, files: files.length })
    return checkpoint
  }

  /**
   * Rollback to a specific checkpoint
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

    // Restore files from checkpoint
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

    // Try to rollback git if commit exists
    if (checkpoint.gitCommit) {
      try {
        execSync(`git reset --hard ${checkpoint.gitCommit}`, { cwd: this.projectDir, stdio: "ignore" })
      } catch {
        log.warn("git_rollback_failed")
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
   * Verify changes after modification
   */
  async verifyChanges(
    files: string[],
    verificationChecks: Array<{ name: string; check: () => Promise<boolean> }>,
  ): Promise<VerificationResult> {
    const checks: VerificationResult["checks"] = []

    // Run custom verification checks
    for (const { name, check } of verificationChecks) {
      try {
        const passed = await check()
        checks.push({ name, passed })
      } catch (error) {
        checks.push({ name, passed: false, error: String(error) })
      }
    }

    // TypeScript check
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
  async cleanupOldCheckpoints(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const now = Date.now()
    let removed = 0

    try {
      const files = await import("fs/promises")
      const entries = await files.readdir(this.checkpointsDir)

      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue

        const filePath = join(this.checkpointsDir, entry)
        const content = await readFile(filePath, "utf-8")
        const checkpoint: RollbackCheckpoint = JSON.parse(content)

        if (now - checkpoint.timestamp > maxAgeMs) {
          // Remove checkpoint files
          await rm(filePath)
          
          // Remove associated content files
          for (const file of Object.keys(checkpoint.files)) {
            try {
              await rm(join(this.checkpointsDir, `${checkpoint.id}-${this.escapeFile(file)}.txt`))
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

  private simpleHash(content: string): string {
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(36)
  }

  private escapeFile(file: string): string {
    return file.replace(/[^a-zA-Z0-9]/g, "_")
  }
}

/**
 * Create rollback manager for project
 */
export function createRollbackManager(projectDir: string): RollbackManager {
  return new RollbackManager(projectDir)
}