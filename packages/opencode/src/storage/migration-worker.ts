/**
 * MigrationWorker - Non-blocking background migration system
 *
 * Provides resumable, non-blocking database migration that allows the main
 * application to start immediately while migration continues in the background.
 *
 * Key features:
 * - State tracking with _migration_status table
 * - Batch processing with yield to event loop
 * - Resumable from last checkpoint on process restart
 * - Progress reporting via callback
 *
 * @example
 * ```ts
 * const worker = new MigrationWorker(sqlite)
 * 
 * // Start migration (non-blocking)
 * worker.start({
 *   onProgress: (progress) => console.log(progress),
 *   onComplete: (stats) => console.log('Done', stats),
 * })
 * 
 * // Check status
 * const status = worker.getStatus()
 * ```
 */

import { Log } from "../util/log"
import type { Database as BunDatabase } from "bun:sqlite"

const log = Log.create({ service: "migration-worker" })

// ============================================================================
// Types
// ============================================================================

export type MigrationStatus = "pending" | "running" | "completed" | "failed"

export interface MigrationProgress {
  phase: string
  current: number
  total: number
  percent: number
  eta?: number // Estimated time remaining in ms
}

export interface MigrationCheckpoint {
  phase: string
  current_file: string | null
  processed_count: number
  total_count: number
  started_at: number
  updated_at: number
}

export interface MigrationWorkerOptions {
  /** Batch size for each processing cycle */
  batchSize?: number
  /** Delay between batches in ms (default: 10) */
  batchDelay?: number
  /** Callback for progress updates */
  onProgress?: (progress: MigrationProgress) => void
  /** Callback when migration completes successfully */
  onComplete?: (stats: MigrationStats) => void
  /** Callback when migration fails */
  onError?: (error: Error) => void
}

export interface MigrationStats {
  projects: number
  sessions: number
  messages: number
  parts: number
  todos: number
  permissions: number
  shares: number
  skipped: {
    projects: number
    sessions: number
    messages: number
    parts: number
  }
  errors: string[]
  duration: number
}

// ============================================================================
// Migration State Table
// ============================================================================

const STATUS_TABLE = "_migration_status"
const CHECKPOINT_TABLE = "_migration_checkpoint"

const CREATE_STATUS_TABLE = `
  CREATE TABLE IF NOT EXISTS ${STATUS_TABLE} (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL DEFAULT 'pending',
    started_at INTEGER,
    completed_at INTEGER,
    error_message TEXT,
    version INTEGER NOT NULL DEFAULT 1
  )
`

const CREATE_CHECKPOINT_TABLE = `
  CREATE TABLE IF NOT EXISTS ${CHECKPOINT_TABLE} (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    phase TEXT NOT NULL,
    current_file TEXT,
    processed_count INTEGER NOT NULL DEFAULT 0,
    total_count INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`

// ============================================================================
// MigrationWorker Class
// ============================================================================

export class MigrationWorker {
  private sqlite: BunDatabase
  private batchSize: number
  private batchDelay: number
  private onProgress?: (progress: MigrationProgress) => void
  private onComplete?: (stats: MigrationStats) => void
  private onError?: (error: Error) => void
  private running: boolean = false
  private intervalId: Timer | null = null
  private stats: MigrationStats = this.createEmptyStats()
  private startTime: number = 0

  constructor(sqlite: BunDatabase, options: MigrationWorkerOptions = {}) {
    this.sqlite = sqlite
    this.batchSize = options.batchSize ?? 50
    this.batchDelay = options.batchDelay ?? 10
    this.onProgress = options.onProgress
    this.onComplete = options.onComplete
    this.onError = options.onError

    // Ensure tables exist
    this.ensureTables()
  }

  private createEmptyStats(): MigrationStats {
    return {
      projects: 0,
      sessions: 0,
      messages: 0,
      parts: 0,
      todos: 0,
      permissions: 0,
      shares: 0,
      skipped: {
        projects: 0,
        sessions: 0,
        messages: 0,
        parts: 0,
      },
      errors: [],
      duration: 0,
    }
  }

  private ensureTables(): void {
    this.sqlite.exec(CREATE_STATUS_TABLE)
    this.sqlite.exec(CREATE_CHECKPOINT_TABLE)
  }

  /**
   * Get current migration status
   */
  getStatus(): MigrationStatus {
    const result = this.sqlite
      .query<{ status: MigrationStatus }, []>(`SELECT status FROM ${STATUS_TABLE} WHERE id = 1`)
      .get()
    return result?.status ?? "pending"
  }

  /**
   * Get current checkpoint information
   */
  getCheckpoint(): MigrationCheckpoint | null {
    const result = this.sqlite
      .query<MigrationCheckpoint, []>(`SELECT * FROM ${CHECKPOINT_TABLE} WHERE id = 1`)
      .get()
    return result ?? null
  }

  /**
   * Check if migration is needed (pending or failed previously)
   */
  isMigrationNeeded(): boolean {
    const status = this.getStatus()
    return status === "pending" || status === "failed"
  }

  /**
   * Check if service can start in degraded mode
   * Returns true if migration is running or completed
   */
  canStartService(): boolean {
    const status = this.getStatus()
    return status === "running" || status === "completed"
  }

  /**
   * Update status in database
   */
  private updateStatus(status: MigrationStatus, errorMessage?: string): void {
    const now = Date.now()
    this.sqlite.exec(
      `INSERT INTO ${STATUS_TABLE} (id, status, started_at, completed_at, error_message, version)
       VALUES (1, ?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END,
         error_message = excluded.error_message`,
      [status, this.startTime || now, status === "completed" ? now : null, errorMessage ?? null, status, status === "completed" ? now : null],
    )
  }

  /**
   * Update checkpoint in database
   */
  private updateCheckpoint(
    phase: string,
    currentFile: string | null,
    processedCount: number,
    totalCount: number,
  ): void {
    const now = Date.now()
    this.sqlite.exec(
      `INSERT INTO ${CHECKPOINT_TABLE} (id, phase, current_file, processed_count, total_count, started_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         phase = excluded.phase,
         current_file = excluded.current_file,
         processed_count = excluded.processed_count,
         total_count = excluded.total_count,
         updated_at = excluded.updated_at`,
      [phase, currentFile, processedCount, totalCount, this.startTime, now],
    )
  }

  /**
   * Report progress
   */
  private reportProgress(phase: string, current: number, total: number): void {
    if (this.onProgress) {
      const percent = total > 0 ? Math.round((current / total) * 100) : 0
      const elapsed = Date.now() - this.startTime
      const eta = current > 0 ? Math.round((elapsed / current) * (total - current)) : undefined

      this.onProgress({
        phase,
        current,
        total,
        percent,
        eta,
      })
    }
  }

  /**
   * Yield to event loop - allows other operations to proceed
   */
  private async yield(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, this.batchDelay)
    })
  }

  /**
   * Start migration in background
   * Returns immediately, migration continues asynchronously
   */
  async start(migrationFn: () => Promise<MigrationStats>): Promise<void> {
    // Check if already running or completed
    const status = this.getStatus()
    if (status === "running") {
      log.info("migration_already_running")
      return
    }
    if (status === "completed") {
      log.info("migration_already_completed")
      return
    }

    this.running = true
    this.startTime = Date.now()
    this.stats = this.createEmptyStats()

    // Update status to running
    this.updateStatus("running")

    try {
      log.info("migration_started", { batchSize: this.batchSize, batchDelay: this.batchDelay })

      // Run the actual migration function
      this.stats = await migrationFn()

      // Mark as completed
      this.updateStatus("completed")
      this.running = false

      const duration = Date.now() - this.startTime
      this.stats.duration = duration

      log.info("migration_completed", { ...this.stats, duration })

      if (this.onComplete) {
        this.onComplete(this.stats)
      }
    } catch (error) {
      this.running = false
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Update status to failed
      this.updateStatus("failed", errorMessage)

      log.error("migration_failed", { error: errorMessage })

      if (this.onError) {
        this.onError(error instanceof Error ? error : new Error(errorMessage))
      }
    }
  }

  /**
   * Start migration with batch processor
   * This is a convenience method for common migration patterns
   */
  async startBatched<T>(
    items: T[],
    processor: (batch: T[], offset: number) => Promise<number>,
    options: { phase: string; getItemId?: (item: T) => string },
  ): Promise<MigrationStats> {
    const { phase, getItemId } = options
    const total = items.length
    let processed = 0

    // Check for existing checkpoint
    const checkpoint = this.getCheckpoint()
    if (checkpoint && checkpoint.phase === phase) {
      processed = checkpoint.processed_count
      log.info("resuming_from_checkpoint", { phase, processed, total })
    } else {
      // New migration phase
      this.updateCheckpoint(phase, null, 0, total)
    }

    // Process in batches
    for (let i = processed; i < total; i += this.batchSize) {
      if (!this.running) break

      const batch = items.slice(i, Math.min(i + this.batchSize, total))
      const currentFile = getItemId ? getItemId(batch[0]) : null

      // Update checkpoint before processing
      this.updateCheckpoint(phase, currentFile, i, total)

      // Process batch
      const count = await processor(batch, i)
      processed += count

      // Report progress
      this.reportProgress(phase, processed, total)

      // Yield to event loop
      await this.yield()
    }

    return this.stats
  }

  /**
   * Stop migration (can be resumed later)
   */
  stop(): void {
    this.running = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    log.info("migration_stopped")
  }

  /**
   * Reset migration state (for testing or re-run)
   */
  reset(): void {
    this.sqlite.exec(`DELETE FROM ${STATUS_TABLE}`)
    this.sqlite.exec(`DELETE FROM ${CHECKPOINT_TABLE}`)
    this.stats = this.createEmptyStats()
    this.running = false
    log.info("migration_state_reset")
  }
}

/**
 * Helper function to create a migration worker
 */
export function createMigrationWorker(
  sqlite: BunDatabase,
  options?: MigrationWorkerOptions,
): MigrationWorker {
  return new MigrationWorker(sqlite, options)
}
