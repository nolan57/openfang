/**
 * Knowledge Graph Index Manager
 * 
 * Unified manager for automatic knowledge graph indexing with:
 * - File watcher trigger (real-time)
 * - Scheduler trigger (periodic)
 * - Session end trigger (on session close)
 * 
 * Features:
 * - Debounce: Prevent rapid consecutive indexing
 * - Lock: Prevent concurrent indexing conflicts
 * - Queue: Batch file changes for efficient processing
 * - Status tracking: Monitor indexing state
 */

import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Memory } from "../memory"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { FileWatcher } from "../file/watcher"
import { Scheduler } from "../scheduler"
import * as path from "path"
import * as fs from "fs/promises"

const log = Log.create({ service: "knowledge-index-manager" })

export interface IndexManagerConfig {
  /** Debounce interval in ms (default: 5000 = 5 seconds) */
  debounceMs: number
  /** Max files to queue before forcing index (default: 50) */
  maxQueueSize: number
  /** Enable file watcher trigger (default: true) */
  enableFileWatcher: boolean
  /** Enable scheduler trigger (default: true) */
  enableScheduler: boolean
  /** Scheduler cron expression (default: every 30 minutes) */
  schedulerCron: string
  /** Enable session end trigger (default: true) */
  enableSessionEnd: boolean
  /** File extensions to index */
  extensions: string[]
  /** Directories to ignore */
  ignorePatterns: string[]
}

export const defaultIndexManagerConfig: IndexManagerConfig = {
  debounceMs: 5000,
  maxQueueSize: 50,
  enableFileWatcher: true,
  enableScheduler: true,
  schedulerCron: "*/30 * * * *", // Every 30 minutes
  enableSessionEnd: true,
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  ignorePatterns: ["node_modules", "dist", "build", ".git", "coverage"],
}

export interface IndexResult {
  filesProcessed: number
  entitiesAdded: number
  edgesAdded: number
  durationMs: number
  trigger: "file_watcher" | "scheduler" | "session_end" | "manual"
}

export interface IndexStatus {
  isIndexing: boolean
  lastIndexTime: number | null
  lastIndexResult: IndexResult | null
  pendingFiles: number
  queuedFiles: string[]
  errors: string[]
}

type IndexTrigger = IndexResult["trigger"]

/**
 * Knowledge Graph Index Manager
 * 
 * Singleton that manages automatic indexing with conflict prevention
 */
class KnowledgeIndexManagerImpl {
  private config: IndexManagerConfig
  private initialized: boolean = false
  
  // Debounce & Lock
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private indexLock: boolean = false
  private currentIndexPromise: Promise<IndexResult> | null = null
  
  // Queue
  private pendingFiles: Set<string> = new Set()
  private pendingDeletes: Set<string> = new Set()
  
  // Status
  private lastIndexTime: number | null = null
  private lastIndexResult: IndexResult | null = null
  private errors: string[] = []
  
  // Unsubscribe handlers
  private fileWatcherUnsubscribe: (() => void) | null = null
  
  constructor(config: Partial<IndexManagerConfig> = {}) {
    this.config = { ...defaultIndexManagerConfig, ...config }
  }
  
  /**
   * Initialize the index manager
   */
  async init(): Promise<void> {
    if (this.initialized) return
    
    log.info("initializing", { config: this.config })
    
    // Setup file watcher trigger
    if (this.config.enableFileWatcher) {
      this.setupFileWatcher()
    }
    
    // Setup scheduler trigger
    if (this.config.enableScheduler) {
      this.setupScheduler()
    }
    
    this.initialized = true
    log.info("initialized")
  }
  
  /**
   * Setup file watcher trigger
   */
  private setupFileWatcher(): void {
    const handler = async (evt: { type: "file.watcher.updated"; properties: { file: string; event: "add" | "change" | "unlink" } }) => {
      // Check if file should be indexed
      const ext = path.extname(evt.properties.file)
      if (!this.config.extensions.includes(ext)) return
      
      // Check ignore patterns
      const relativePath = path.relative(Instance.directory, evt.properties.file)
      if (this.shouldIgnore(relativePath)) return
      
      log.debug("file_changed", { file: relativePath, event: evt.properties.event })
      
      if (evt.properties.event === "unlink") {
        this.pendingDeletes.add(relativePath)
        this.pendingFiles.delete(relativePath)
      } else {
        this.pendingFiles.add(relativePath)
      }
      
      // Trigger debounced index
      this.scheduleDebouncedIndex("file_watcher")
    }
    
    // Subscribe to file watcher events
    const unsubscribe = Bus.subscribe(FileWatcher.Event.Updated, handler)
    this.fileWatcherUnsubscribe = unsubscribe
  }
  
  /**
   * Setup scheduler trigger
   */
  private setupScheduler(): void {
    Scheduler.register({
      id: "knowledge-graph-index",
      interval: 30 * 60 * 1000, // 30 minutes (legacy fallback)
      scope: "instance",
      run: async () => {
        log.info("scheduled_index_triggered")
        await this.triggerIndex("scheduler")
      },
    })
  }
  
  /**
   * Check if path should be ignored
   */
  private shouldIgnore(relativePath: string): boolean {
    for (const pattern of this.config.ignorePatterns) {
      if (relativePath.includes(pattern)) return true
    }
    return false
  }
  
  /**
   * Schedule a debounced index operation
   */
  private scheduleDebouncedIndex(trigger: IndexTrigger): void {
    // Clear existing timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    
    // Force immediate index if queue is full
    if (this.pendingFiles.size >= this.config.maxQueueSize) {
      log.info("queue_full_forcing_index", { size: this.pendingFiles.size })
      void this.triggerIndex(trigger)
      return
    }
    
    // Schedule debounced index
    this.debounceTimer = setTimeout(() => {
      void this.triggerIndex(trigger)
    }, this.config.debounceMs)
  }
  
  /**
   * Trigger an index operation
   * This is the main entry point for all triggers
   */
  async triggerIndex(trigger: IndexTrigger): Promise<IndexResult> {
    // If already indexing, wait for it to complete
    if (this.indexLock && this.currentIndexPromise) {
      log.info("waiting_for_existing_index", { trigger })
      return this.currentIndexPromise
    }
    
    // Check if there's anything to index
    if (this.pendingFiles.size === 0 && this.pendingDeletes.size === 0) {
      log.debug("nothing_to_index", { trigger })
      return {
        filesProcessed: 0,
        entitiesAdded: 0,
        edgesAdded: 0,
        durationMs: 0,
        trigger,
      }
    }
    
    // Acquire lock
    this.indexLock = true
    this.currentIndexPromise = this.doIndex(trigger)
    
    try {
      const result = await this.currentIndexPromise
      return result
    } finally {
      this.indexLock = false
      this.currentIndexPromise = null
    }
  }
  
  /**
   * Perform the actual indexing
   */
  private async doIndex(trigger: IndexTrigger): Promise<IndexResult> {
    const startTime = Date.now()
    const filesToIndex = [...this.pendingFiles]
    const filesToDelete = [...this.pendingDeletes]
    
    // Clear queues
    this.pendingFiles.clear()
    this.pendingDeletes.clear()
    
    log.info("starting_index", {
      trigger,
      filesToIndex: filesToIndex.length,
      filesToDelete: filesToDelete.length,
    })
    
    let entitiesAdded = 0
    let edgesAdded = 0
    
    try {
      await Memory.init()
      
      // Process deletions (remove from knowledge graph)
      if (filesToDelete.length > 0) {
        await this.processDeletions(filesToDelete)
      }
      
      // Process additions/changes
      if (filesToIndex.length > 0) {
        const files = await this.readFiles(filesToIndex)
        
        if (files.length > 0) {
          const result = await Memory.indexProject({
            files,
            clearExisting: false,
          })
          entitiesAdded = result.entitiesAdded
          edgesAdded = result.relationsAdded
        }
      }
      
      const durationMs = Date.now() - startTime
      
      const result: IndexResult = {
        filesProcessed: filesToIndex.length,
        entitiesAdded,
        edgesAdded,
        durationMs,
        trigger,
      }
      
      this.lastIndexTime = Date.now()
      this.lastIndexResult = result
      
      log.info("index_complete", {
        ...result,
        totalPending: this.pendingFiles.size,
      })
      
      return result
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      this.errors.push(errorMsg)
      log.error("index_failed", { error: errorMsg, trigger })
      
      // Re-queue failed files
      for (const file of filesToIndex) {
        this.pendingFiles.add(file)
      }
      
      return {
        filesProcessed: 0,
        entitiesAdded: 0,
        edgesAdded: 0,
        durationMs: Date.now() - startTime,
        trigger,
      }
    }
  }
  
  /**
   * Process file deletions
   */
  private async processDeletions(files: string[]): Promise<void> {
    // Note: This would ideally remove nodes/edges from knowledge graph
    // For now, we just log - actual deletion would require additional implementation
    log.info("processing_deletions", { files: files.length })
    
    // TODO: Implement node/edge deletion from knowledge graph
    // This would involve:
    // 1. Finding nodes by file path
    // 2. Removing edges connected to those nodes
    // 3. Removing the nodes themselves
  }
  
  /**
   * Read file contents for indexing
   */
  private async readFiles(filePaths: string[]): Promise<Array<{ path: string; content: string; type: string }>> {
    const files: Array<{ path: string; content: string; type: string }> = []
    
    await Promise.all(
      filePaths.map(async (filePath) => {
        try {
          const absolutePath = path.join(Instance.directory, filePath)
          const content = await fs.readFile(absolutePath, "utf-8")
          const ext = path.extname(filePath)
          
          let type = "file"
          if (ext === ".ts" || ext === ".tsx") type = "typescript"
          else if (ext === ".js" || ext === ".jsx") type = "javascript"
          
          files.push({ path: filePath, content, type })
        } catch (error) {
          log.warn("failed_to_read_file", { filePath, error: String(error) })
        }
      }),
    )
    
    return files
  }
  
  /**
   * Trigger index on session end
   */
  async onSessionEnd(): Promise<void> {
    if (!this.config.enableSessionEnd) return
    
    log.info("session_end_trigger")
    await this.triggerIndex("session_end")
  }
  
  /**
   * Get current status
   */
  getStatus(): IndexStatus {
    return {
      isIndexing: this.indexLock,
      lastIndexTime: this.lastIndexTime,
      lastIndexResult: this.lastIndexResult,
      pendingFiles: this.pendingFiles.size,
      queuedFiles: [...this.pendingFiles],
      errors: this.errors.slice(-10), // Last 10 errors
    }
  }
  
  /**
   * Add files manually to the queue
   */
  queueFiles(files: string[]): void {
    for (const file of files) {
      const ext = path.extname(file)
      if (this.config.extensions.includes(ext) && !this.shouldIgnore(file)) {
        this.pendingFiles.add(file)
      }
    }
  }
  
  /**
   * Clear error history
   */
  clearErrors(): void {
    this.errors = []
  }
  
  /**
   * Shutdown the manager
   */
  async shutdown(): Promise<void> {
    // Clear debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    
    // Unsubscribe from file watcher
    if (this.fileWatcherUnsubscribe) {
      this.fileWatcherUnsubscribe()
      this.fileWatcherUnsubscribe = null
    }
    
    // Wait for current index to complete
    if (this.currentIndexPromise) {
      await this.currentIndexPromise
    }
    
    this.initialized = false
    log.info("shutdown")
  }
}

// Singleton instance
let instance: KnowledgeIndexManagerImpl | null = null

/**
 * Get the Knowledge Index Manager instance
 */
export function getKnowledgeIndexManager(config?: Partial<IndexManagerConfig>): KnowledgeIndexManagerImpl {
  if (!instance) {
    instance = new KnowledgeIndexManagerImpl(config)
  }
  return instance
}

/**
 * Initialize the Knowledge Index Manager
 */
export async function initKnowledgeIndexManager(config?: Partial<IndexManagerConfig>): Promise<void> {
  const manager = getKnowledgeIndexManager(config)
  await manager.init()
}

/**
 * Trigger session end indexing
 */
export async function triggerSessionEndIndex(): Promise<void> {
  const manager = getKnowledgeIndexManager()
  await manager.onSessionEnd()
}
