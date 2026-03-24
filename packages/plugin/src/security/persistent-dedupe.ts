/**
 * Persistent deduplication utility for plugins.
 *
 * Prevents duplicate processing of messages, events, or tasks by maintaining
 * a persistent store of seen identifiers with automatic expiration.
 *
 * @example
 * ```typescript
 * // Create deduplicator with 24-hour retention
 * const dedupe = new PersistentDedupe({
 *   filePath: "./data/seen-messages.json",
 *   maxAgeMs: 24 * 60 * 60 * 1000
 * })
 *
 * // Load existing data
 * await dedupe.load()
 *
 * // Check and mark as seen atomically
 * const messageId = "telegram:12345"
 * if (await dedupe.checkAndMark(messageId)) {
 *   console.log("Duplicate message, skipping")
 *   return
 * }
 *
 * // Process the message
 * await handleMessage(messageId)
 * ```
 */

import { writeFile, readFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"

/**
 * Entry structure for persistent storage.
 */
type DedupeEntry = {
  id: string
  timestamp: number
}

/**
 * Options for PersistentDedupe constructor.
 */
export interface PersistentDedupeOptions {
  /**
   * Path to the JSON file for persistent storage.
   */
  filePath: string

  /**
   * Maximum age of entries in milliseconds.
   * Entries older than this will be automatically removed.
   * @default 24 hours (86400000 ms)
   */
  maxAgeMs?: number

  /**
   * Maximum number of entries to keep.
   * When exceeded, oldest entries are removed.
   * @default 10000
   */
  maxEntries?: number
}

/**
 * Statistics about the deduplication store.
 */
export interface DedupeStats {
  /**
   * Current number of entries in the store.
   */
  count: number

  /**
   * Number of entries expired and removed in the last cleanup.
   */
  expiredCount: number

  /**
   * Number of entries pruned due to maxEntries limit.
   */
  prunedCount: number

  /**
   * Timestamp of the oldest entry.
   */
  oldestTimestamp: number | null

  /**
   * Timestamp of the newest entry.
   */
  newestTimestamp: number | null
}

/**
 * Persistent deduplication manager.
 *
 * Maintains a set of seen identifiers with timestamps, persisted to disk.
 * Automatically expires old entries and enforces size limits.
 */
export class PersistentDedupe {
  private seen = new Map<string, number>()
  private filePath: string
  private maxAgeMs: number
  private maxEntries: number
  private lastCleanup: number = 0

  constructor(options: PersistentDedupeOptions) {
    this.filePath = options.filePath
    this.maxAgeMs = options.maxAgeMs ?? 24 * 60 * 60 * 1000 // 24 hours
    this.maxEntries = options.maxEntries ?? 10000
  }

  /**
   * Loads existing entries from the persistent storage file.
   * Automatically cleans up expired entries during load.
   *
   * If the file doesn't exist or is corrupted, starts with an empty store.
   */
  async load(): Promise<void> {
    try {
      const content = await readFile(this.filePath, "utf8")
      const entries = JSON.parse(content) as DedupeEntry[]

      if (!Array.isArray(entries)) {
        this.seen = new Map()
        return
      }

      const now = Date.now()
      const cutoff = now - this.maxAgeMs

      // Load only non-expired entries
      this.seen = new Map(
        entries
          .filter(entry => entry.timestamp > cutoff)
          .map(entry => [entry.id, entry.timestamp]),
      )

      // Enforce max entries limit
      this.enforceMaxEntries()
    } catch (err) {
      // File doesn't exist, is corrupted, or unreadable - start fresh
      this.seen = new Map()
    }
  }

  /**
   * Saves current entries to the persistent storage file.
   *
   * Creates parent directories if they don't exist.
   */
  async save(): Promise<void> {
    const dir = dirname(this.filePath)
    await mkdir(dir, { recursive: true })

    const entries: DedupeEntry[] = Array.from(this.seen.entries()).map(([id, timestamp]) => ({
      id,
      timestamp,
    }))

    // Sort by timestamp for efficient cleanup on next load
    entries.sort((a, b) => b.timestamp - a.timestamp)

    await writeFile(this.filePath, JSON.stringify(entries, null, 2), "utf8")
  }

  /**
   * Checks if an ID has been seen before.
   *
   * @param id - The identifier to check
   * @returns true if the ID was previously seen, false otherwise
   */
  isDuplicate(id: string): boolean {
    return this.seen.has(id)
  }

  /**
   * Marks an ID as seen with the current timestamp.
   *
   * @param id - The identifier to mark
   */
  async markAsSeen(id: string): Promise<void> {
    this.seen.set(id, Date.now())
    await this.save()
  }

  /**
   * Checks if an ID has been seen, and if not, marks it as seen.
   *
   * This is an atomic operation that combines check and mark.
   *
   * @param id - The identifier to check and mark
   * @returns true if the ID was already seen (duplicate), false if newly seen
   *
   * @example
   * ```typescript
   * if (await dedupe.checkAndMark(messageId)) {
   *   // Duplicate - skip processing
   *   return
   * }
   * // New message - process it
   * await processMessage(messageId)
   * ```
   */
  async checkAndMark(id: string): Promise<boolean> {
    if (this.seen.has(id)) {
      return true
    }
    await this.markAsSeen(id)
    return false
  }

  /**
   * Removes an ID from the seen set.
   *
   * @param id - The identifier to remove
   */
  async remove(id: string): Promise<void> {
    this.seen.delete(id)
    await this.save()
  }

  /**
   * Clears all seen IDs.
   */
  async clear(): Promise<void> {
    this.seen.clear()
    await this.save()
  }

  /**
   * Runs cleanup to remove expired entries.
   *
   * Automatically called during load(), but can be called manually
   * for periodic cleanup in long-running processes.
   *
   * @returns Statistics about the cleanup operation
   */
  async cleanup(): Promise<DedupeStats> {
    const now = Date.now()
    const cutoff = now - this.maxAgeMs
    const previousCount = this.seen.size

    // Remove expired entries
    for (const [id, timestamp] of this.seen.entries()) {
      if (timestamp <= cutoff) {
        this.seen.delete(id)
      }
    }

    const afterExpiryCount = this.seen.size
    const expiredCount = previousCount - afterExpiryCount

    // Enforce max entries limit
    const prunedCount = this.enforceMaxEntries()

    // Save after cleanup
    await this.save()

    this.lastCleanup = now

    return {
      count: this.seen.size,
      expiredCount,
      prunedCount,
      oldestTimestamp: this.getOldestTimestamp(),
      newestTimestamp: this.getNewestTimestamp(),
    }
  }

  /**
   * Gets statistics about the deduplication store.
   */
  getStats(): DedupeStats {
    return {
      count: this.seen.size,
      expiredCount: 0,
      prunedCount: 0,
      oldestTimestamp: this.getOldestTimestamp(),
      newestTimestamp: this.getNewestTimestamp(),
    }
  }

  /**
   * Gets the number of entries currently in the store.
   */
  get size(): number {
    return this.seen.size
  }

  /**
   * Enforces the maxEntries limit by removing oldest entries.
   *
   * @returns Number of entries pruned
   */
  private enforceMaxEntries(): number {
    if (this.seen.size <= this.maxEntries) {
      return 0
    }

    // Sort entries by timestamp
    const sorted = Array.from(this.seen.entries()).sort((a, b) => b[1] - a[1])

    // Keep only the newest entries
    const toKeep = sorted.slice(0, this.maxEntries)
    const toRemove = sorted.slice(this.maxEntries)

    this.seen = new Map(toKeep)

    return toRemove.length
  }

  /**
   * Gets the timestamp of the oldest entry.
   */
  private getOldestTimestamp(): number | null {
    if (this.seen.size === 0) {
      return null
    }
    let oldest = Infinity
    for (const timestamp of this.seen.values()) {
      if (timestamp < oldest) {
        oldest = timestamp
      }
    }
    return oldest === Infinity ? null : oldest
  }

  /**
   * Gets the timestamp of the newest entry.
   */
  private getNewestTimestamp(): number | null {
    if (this.seen.size === 0) {
      return null
    }
    let newest = -Infinity
    for (const timestamp of this.seen.values()) {
      if (timestamp > newest) {
        newest = timestamp
      }
    }
    return newest === -Infinity ? null : newest
  }
}

/**
 * In-memory deduplication for short-term use cases.
 *
 * Simpler alternative to PersistentDedupe when persistence isn't needed.
 */
export class InMemoryDedupe {
  private seen = new Set<string>()
  private maxEntries: number

  constructor(maxEntries: number = 1000) {
    this.maxEntries = maxEntries
  }

  /**
   * Checks and marks an ID atomically.
   *
   * @returns true if duplicate, false if newly seen
   */
  checkAndMark(id: string): boolean {
    if (this.seen.has(id)) {
      return true
    }

    // Enforce max entries by clearing oldest 10% when full
    if (this.seen.size >= this.maxEntries) {
      const toRemove = Math.ceil(this.maxEntries * 0.1)
      const iterator = this.seen.values()
      for (let i = 0; i < toRemove; i++) {
        const result = iterator.next()
        if (result.done) break
        this.seen.delete(result.value)
      }
    }

    this.seen.add(id)
    return false
  }

  /**
   * Checks if an ID has been seen.
   */
  isDuplicate(id: string): boolean {
    return this.seen.has(id)
  }

  /**
   * Marks an ID as seen.
   */
  mark(id: string): void {
    this.seen.add(id)
  }

  /**
   * Clears all seen IDs.
   */
  clear(): void {
    this.seen.clear()
  }

  /**
   * Gets the current count of seen IDs.
   */
  get size(): number {
    return this.seen.size
  }
}
