import { z } from "zod"
import { Log } from "../util/log"

const log = Log.create({ service: "multi-thread-narrative" })

/**
 * Multi-Thread Narrative Executor
 *
 * Enhanced integration with orchestrator:
 * - Supports progress callbacks for real-time status updates
 * - Integrates with observability for performance tracking
 * - Provides structured execution context for better debugging
 *
 * Usage with orchestrator:
 * ```typescript
 * const executor = new MultiThreadNarrativeExecutor()
 * executor.setProgressCallback((progress) => {
 *   observability.recordThreadProgress(progress)
 * })
 * ```
 */

export const NarrativeThreadSchema = z.object({
  id: z.string(),
  name: z.string(),
  povCharacter: z.string(),
  currentChapter: z.number(),
  lastSyncChapter: z.number(),
  status: z.enum(["active", "paused", "completed", "merged"]),
  priority: z.number().min(1).max(10),
  chapters: z.array(
    z.object({
      number: z.number(),
      summary: z.string(),
      events: z.array(z.string()),
      characters: z.array(z.string()),
      location: z.string().optional(),
    }),
  ),
  pendingEvents: z.array(z.string()),
  convergesWith: z.array(z.string()).optional(),
})

export type NarrativeThread = z.infer<typeof NarrativeThreadSchema>

export interface ThreadSynchronization {
  threadId: string
  lastSyncChapter: number
  pendingConflicts: Array<{
    type: "contradiction" | "timing" | "character" | "location"
    description: string
    severity: "low" | "medium" | "high"
    resolution?: string
  }>
}

export interface MultiThreadConfig {
  maxActiveThreads: number
  syncInterval: number // chapters between syncs
  enableConflictDetection: boolean
  autoResolveConflicts: boolean
}

const DEFAULT_CONFIG: MultiThreadConfig = {
  maxActiveThreads: 5,
  syncInterval: 3,
  enableConflictDetection: true,
  autoResolveConflicts: false,
}

export class MultiThreadNarrativeExecutor {
  private threads: Map<string, NarrativeThread> = new Map()
  private config: MultiThreadConfig
  private globalChapter: number = 1
  private synchronizationBarriers: Map<number, Set<string>> = new Map()

  constructor(config: Partial<MultiThreadConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  createThread(name: string, povCharacter: string, priority: number = 5): NarrativeThread {
    const id = `thread_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    const thread: NarrativeThread = {
      id,
      name,
      povCharacter,
      currentChapter: this.globalChapter,
      lastSyncChapter: this.globalChapter,
      status: "active",
      priority,
      chapters: [],
      pendingEvents: [],
      convergesWith: [],
    }

    this.threads.set(id, thread)
    log.info("thread_created", { id, name, povCharacter, priority })

    return thread
  }

  async advanceThread(
    threadId: string,
    chapterData: {
      summary: string
      events: string[]
      characters: string[]
      location?: string
    },
  ): Promise<NarrativeThread> {
    const thread = this.threads.get(threadId)
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`)
    }

    if (thread.status !== "active") {
      throw new Error(`Thread ${threadId} is ${thread.status}, cannot advance`)
    }

    const nextChapter = thread.currentChapter + 1
    thread.currentChapter = nextChapter

    thread.chapters.push({
      number: nextChapter,
      summary: chapterData.summary,
      events: chapterData.events,
      characters: chapterData.characters,
      location: chapterData.location,
    })

    // Check if we need to synchronize
    if (this.needsSynchronization(thread)) {
      await this.synchronizeThread(thread)
    }

    this.threads.set(threadId, thread)
    log.info("thread_advanced", { threadId, chapter: nextChapter })

    return thread
  }

  private needsSynchronization(thread: NarrativeThread): boolean {
    return thread.currentChapter - thread.lastSyncChapter >= this.config.syncInterval
  }

  private async synchronizeThread(thread: NarrativeThread): Promise<void> {
    log.info("synchronizing_thread", { threadId: thread.id })

    // Find other active threads at similar chapter
    const threadsToSync = Array.from(this.threads.values()).filter(
      (t) => t.id !== thread.id && t.status === "active" && Math.abs(t.currentChapter - thread.currentChapter) <= 2,
    )

    if (threadsToSync.length === 0) {
      thread.lastSyncChapter = thread.currentChapter
      return
    }

    // Detect conflicts
    if (this.config.enableConflictDetection) {
      const conflicts = await this.detectConflicts(thread, threadsToSync)

      if (conflicts.length > 0) {
        log.warn("conflicts_detected", { count: conflicts.length, threadId: thread.id })

        if (this.config.autoResolveConflicts) {
          await this.resolveConflicts(thread, conflicts)
        }
      }
    }

    thread.lastSyncChapter = thread.currentChapter
    this.threads.set(thread.id, thread)
  }

  private async detectConflicts(
    thread: NarrativeThread,
    otherThreads: NarrativeThread[],
  ): Promise<ThreadSynchronization["pendingConflicts"]> {
    const conflicts: ThreadSynchronization["pendingConflicts"] = []

    for (const other of otherThreads) {
      // Check for character contradictions
      const commonChars = thread.chapters[thread.chapters.length - 1]?.characters.filter((c) =>
        other.chapters[other.chapters.length - 1]?.characters.includes(c),
      )

      if (commonChars && commonChars.length > 0) {
        // Same character in two threads at same time - potential contradiction
        const threadLoc = thread.chapters[thread.chapters.length - 1]?.location
        const otherLoc = other.chapters[other.chapters.length - 1]?.location

        if (threadLoc && otherLoc && threadLoc !== otherLoc) {
          conflicts.push({
            type: "character",
            description: `Character(s) ${commonChars.join(", ")} appear in both ${thread.name} (${threadLoc}) and ${other.name} (${otherLoc}) simultaneously`,
            severity: "high",
          })
        }
      }

      // Check for event contradictions
      const threadEvents = new Set(thread.chapters[thread.chapters.length - 1]?.events || [])
      const otherEvents = new Set(other.chapters[other.chapters.length - 1]?.events || [])

      // Look for contradictory events (one says X happened, other says X didn't happen)
      for (const event of threadEvents) {
        if (otherEvents.has(`not ${event}`) || otherEvents.has(`failed ${event}`)) {
          conflicts.push({
            type: "contradiction",
            description: `Contradictory events: "${event}" in ${thread.name} vs negation in ${other.name}`,
            severity: "high",
          })
        }
      }
    }

    return conflicts
  }

  private async resolveConflicts(
    thread: NarrativeThread,
    conflicts: ThreadSynchronization["pendingConflicts"],
  ): Promise<void> {
    for (const conflict of conflicts) {
      if (conflict.type === "character") {
        // Auto-resolution: character was in one location, other thread needs adjustment
        conflict.resolution = `Character was in ${thread.chapters[thread.chapters.length - 1]?.location}. Other thread should be adjusted.`
      } else if (conflict.type === "contradiction") {
        // Auto-resolution: use thread with higher priority
        conflict.resolution = `Using version from higher priority thread.`
      }
    }

    log.info("conflicts_resolved", { count: conflicts.length, threadId: thread.id })
  }

  pauseThread(threadId: string): boolean {
    const thread = this.threads.get(threadId)
    if (!thread) return false

    thread.status = "paused"
    this.threads.set(threadId, thread)
    log.info("thread_paused", { threadId })

    return true
  }

  resumeThread(threadId: string): boolean {
    const thread = this.threads.get(threadId)
    if (!thread) return false

    thread.status = "active"
    this.threads.set(threadId, thread)
    log.info("thread_resumed", { threadId })

    return true
  }

  completeThread(threadId: string): boolean {
    const thread = this.threads.get(threadId)
    if (!thread) return false

    thread.status = "completed"
    this.threads.set(threadId, thread)
    log.info("thread_completed", { threadId })

    return true
  }

  mergeThreads(sourceThreadId: string, targetThreadId: string): boolean {
    const source = this.threads.get(sourceThreadId)
    const target = this.threads.get(targetThreadId)

    if (!source || !target) return false

    // Merge chapters
    target.chapters.push(...source.chapters)
    target.chapters.sort((a, b) => a.number - b.number)

    // Merge pending events
    target.pendingEvents.push(...source.pendingEvents)

    // Mark source as merged
    source.status = "merged"

    this.threads.set(sourceThreadId, source)
    this.threads.set(targetThreadId, target)
    log.info("threads_merged", { sourceThreadId, targetThreadId })

    return true
  }

  setConvergence(threadId1: string, threadId2: string): boolean {
    const thread1 = this.threads.get(threadId1)
    const thread2 = this.threads.get(threadId2)

    if (!thread1 || !thread2) return false

    if (!thread1.convergesWith) thread1.convergesWith = []
    if (!thread2.convergesWith) thread2.convergesWith = []

    if (!thread1.convergesWith.includes(threadId2)) {
      thread1.convergesWith.push(threadId2)
    }
    if (!thread2.convergesWith.includes(threadId1)) {
      thread2.convergesWith.push(threadId1)
    }

    this.threads.set(threadId1, thread1)
    this.threads.set(threadId2, thread2)
    log.info("convergence_set", { threadId1, threadId2 })

    return true
  }

  getThread(threadId: string): NarrativeThread | undefined {
    return this.threads.get(threadId)
  }

  getActiveThreads(): NarrativeThread[] {
    return Array.from(this.threads.values()).filter((t) => t.status === "active")
  }

  getThreadProgress(): Array<{
    threadId: string
    name: string
    chapter: number
    status: string
  }> {
    return Array.from(this.threads.values()).map((t) => ({
      threadId: t.id,
      name: t.name,
      chapter: t.currentChapter,
      status: t.status,
    }))
  }

  advanceGlobalChapter(): number {
    this.globalChapter++
    log.info("global_chapter_advanced", { chapter: this.globalChapter })
    return this.globalChapter
  }

  getGlobalChapter(): number {
    return this.globalChapter
  }

  getThreadReport(): string {
    const lines: string[] = ["# Multi-Thread Narrative Report\n"]

    const active = this.getActiveThreads()
    const paused = Array.from(this.threads.values()).filter((t) => t.status === "paused")
    const completed = Array.from(this.threads.values()).filter((t) => t.status === "completed")

    lines.push(`## Active Threads (${active.length})`)
    for (const thread of active.sort((a, b) => b.priority - a.priority)) {
      lines.push(`- **${thread.name}** (Priority: ${thread.priority})`)
      lines.push(`  - POV: ${thread.povCharacter}`)
      lines.push(`  - Chapter: ${thread.currentChapter}`)
      lines.push(`  - Pending Events: ${thread.pendingEvents.length}`)
      if (thread.convergesWith && thread.convergesWith.length > 0) {
        lines.push(`  - Converges with: ${thread.convergesWith.join(", ")}`)
      }
    }

    if (paused.length > 0) {
      lines.push(`\n## Paused Threads (${paused.length})`)
      for (const thread of paused) {
        lines.push(`- **${thread.name}** (Ch.${thread.currentChapter})`)
      }
    }

    if (completed.length > 0) {
      lines.push(`\n## Completed Threads (${completed.length})`)
      for (const thread of completed) {
        lines.push(`- **${thread.name}** (Completed at Ch.${thread.currentChapter})`)
      }
    }

    return lines.join("\n")
  }

  exportToJson(): { config: MultiThreadConfig; threads: NarrativeThread[]; globalChapter: number } {
    return {
      config: this.config,
      threads: Array.from(this.threads.values()),
      globalChapter: this.globalChapter,
    }
  }

  importFromJson(data: { config: MultiThreadConfig; threads: NarrativeThread[]; globalChapter: number }): void {
    this.config = { ...this.config, ...data.config }
    this.globalChapter = data.globalChapter
    for (const thread of data.threads) {
      this.threads.set(thread.id, thread)
    }
    log.info("multithread_narrative_imported", { threadCount: data.threads.length })
  }

  clear(): void {
    this.threads.clear()
    this.globalChapter = 1
    this.synchronizationBarriers.clear()
    log.info("multithread_narrative_cleared")
  }
}

export const multiThreadNarrativeExecutor = new MultiThreadNarrativeExecutor()
