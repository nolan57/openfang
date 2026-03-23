import { Database } from "../storage/db"
import { negative_memory } from "./learning.sql"
import { eq, and, gt, desc, like } from "drizzle-orm"
import { Log } from "../util/log"
import { readFile, writeFile, mkdir } from "fs/promises"
import { resolve, dirname } from "path"
import { Instance } from "../project/instance"

const log = Log.create({ service: "learning-negative" })

const NEGATIVE_FILE = ".opencode/evolution/negative.json"

export type FailureType =
  | "install_failed"
  | "skill_conflict"
  | "performance_regression"
  | "security_issue"
  | "runtime_error"
  | "dependency_missing"
  | "incompatible_version"
  | "anti_pattern"
  | "best_practice_violation"

export interface NegativeMemoryEntry {
  failure_type: FailureType
  description: string
  context: Record<string, unknown>
  severity?: number
  blocked_items?: string[]
  anti_pattern?: {
    pattern: string
    alternative: string
    examples: string[]
  }
}

/**
 * Enhanced Negative Memory with Anti-Pattern library
 * [EVOLUTION]: Stores both failures and anti-patterns for code generation checks
 */
export class NegativeMemory {
  private projectDir: string
  private antiPatterns: Map<string, AntiPattern> = new Map()

  constructor() {
    this.projectDir = this.getProjectDir()
    this.loadAntiPatterns()
  }

  private getProjectDir(): string {
    try {
      return Instance.directory
    } catch {
      return process.cwd()
    }
  }

  async recordFailure(entry: NegativeMemoryEntry): Promise<string> {
    const existing = await this.findSimilar(entry)

    if (existing) {
      await this.incrementEncountered(existing.id)
      log.info("negative_memory_incremented", {
        id: existing.id,
        times_encountered: existing.times_encountered + 1,
      })
      return existing.id
    }

    const id = crypto.randomUUID()
    Database.use((db) =>
      db.insert(negative_memory).values({
        id,
        failure_type: entry.failure_type,
        description: entry.description,
        context: JSON.stringify(entry.context),
        severity: entry.severity ?? 1,
        times_encountered: 1,
        blocked_items: JSON.stringify(entry.blocked_items ?? []),
      }),
    )

    if (entry.anti_pattern) {
      await this.addAntiPattern({
        id: `failure_${id}`,
        name: entry.description,
        pattern: entry.anti_pattern.pattern,
        alternative: entry.anti_pattern.alternative,
        examples: entry.anti_pattern.examples,
        severity: entry.severity ?? 1,
      })
    }

    log.info("negative_memory_created", { id, type: entry.failure_type })
    return id
  }

  private async findSimilar(entry: NegativeMemoryEntry) {
    const all = Database.use((db) =>
      db.select().from(negative_memory).where(eq(negative_memory.failure_type, entry.failure_type)).all(),
    )

    return all.find((m) => {
      const ctx = JSON.parse(m.context)
      return Object.keys(entry.context).some((k) => ctx[k] === entry.context[k])
    })
  }

  private async incrementEncountered(id: string) {
    const record = Database.use((db) => db.select().from(negative_memory).where(eq(negative_memory.id, id)).get())

    if (record) {
      Database.use((db) =>
        db
          .update(negative_memory)
          .set({ times_encountered: record.times_encountered + 1 })
          .where(eq(negative_memory.id, id)),
      )
    }
  }

  async isBlocked(url: string, name?: string): Promise<boolean> {
    const all = Database.use((db) => db.select().from(negative_memory).where(gt(negative_memory.severity, 2)).all())

    for (const m of all) {
      const blocked = JSON.parse(m.blocked_items) as string[]
      if (blocked.includes(url) || (name && blocked.includes(name))) {
        log.info("item_blocked_by_negative_memory", {
          url,
          name,
          memory_id: m.id,
        })
        return true
      }
    }

    return false
  }

  async getBlocklist(): Promise<{ url: string; name?: string }[]> {
    const all = Database.use((db) => db.select().from(negative_memory).where(gt(negative_memory.severity, 2)).all())

    return all.flatMap((m) => {
      const blocked = JSON.parse(m.blocked_items) as string[]
      return blocked.map((item) => ({ url: item }))
    })
  }

  async getRecentFailures(limit = 10) {
    return Database.use((db) =>
      db.select().from(negative_memory).orderBy(desc(negative_memory.time_created)).limit(limit).all(),
    )
  }

  async shouldBlock(failureType: FailureType, context: Record<string, unknown>): Promise<boolean> {
    const record = Database.use((db) =>
      db
        .select()
        .from(negative_memory)
        .where(and(eq(negative_memory.failure_type, failureType), gt(negative_memory.severity, 3)))
        .all(),
    )

    return record.some((m) => {
      const ctx = JSON.parse(m.context)
      return Object.keys(context).every((k) => ctx[k] === context[k])
    })
  }

  // Anti-Pattern Library Functions

  private async loadAntiPatterns(): Promise<void> {
    try {
      const negativePath = resolve(this.projectDir, NEGATIVE_FILE)
      const content = await readFile(negativePath, "utf-8")
      const data = JSON.parse(content)

      if (data.antiPatterns && Array.isArray(data.antiPatterns)) {
        for (const pattern of data.antiPatterns) {
          this.antiPatterns.set(pattern.id, pattern)
        }
      }

      log.info("anti_patterns_loaded", { count: this.antiPatterns.size })
    } catch {
      // File doesn't exist, start empty
      log.info("no_existing_anti_patterns_file")
    }
  }

  private async saveAntiPatterns(): Promise<void> {
    try {
      const negativePath = resolve(this.projectDir, NEGATIVE_FILE)
      await mkdir(dirname(negativePath), { recursive: true })

      const data = {
        antiPatterns: Array.from(this.antiPatterns.values()),
        lastUpdated: Date.now(),
      }

      await writeFile(negativePath, JSON.stringify(data, null, 2))
      log.info("anti_patterns_saved", { count: this.antiPatterns.size })
    } catch (error) {
      log.warn("failed_to_save_anti_patterns", { error: String(error) })
    }
  }

  async addAntiPattern(pattern: AntiPattern): Promise<void> {
    this.antiPatterns.set(pattern.id, pattern)
    await this.saveAntiPatterns()
    log.info("anti_pattern_added", { id: pattern.id, name: pattern.name })
  }

  async removeAntiPattern(id: string): Promise<boolean> {
    const removed = this.antiPatterns.delete(id)
    if (removed) {
      await this.saveAntiPatterns()
      log.info("anti_pattern_removed", { id })
    }
    return removed
  }

  /**
   * Check code against anti-patterns during generation
   * [EVOLUTION]: Force check against negative rules
   */
  async checkCodeAgainstPatterns(code: string): Promise<{
    passed: boolean
    violations: Array<{ pattern: AntiPattern; match: string }>
  }> {
    const violations: Array<{ pattern: AntiPattern; match: string }> = []

    for (const pattern of this.antiPatterns.values()) {
      try {
        const regex = new RegExp(pattern.pattern, "gi")
        const matches = code.match(regex)

        if (matches && matches.length > 0) {
          violations.push({
            pattern,
            match: matches[0],
          })
        }
      } catch {
        // Invalid regex, skip
      }
    }

    return {
      passed: violations.length === 0,
      violations,
    }
  }

  /**
   * Get anti-pattern suggestions for code improvement
   */
  async getImprovementSuggestions(code: string): Promise<
    Array<{
      pattern: AntiPattern
      suggestion: string
    }>
  > {
    const { violations } = await this.checkCodeAgainstPatterns(code)

    return violations.map((v) => ({
      pattern: v.pattern,
      suggestion: `Replace "${v.match}" with: ${v.pattern.alternative}`,
    }))
  }

  async getAntiPatterns(): Promise<AntiPattern[]> {
    return Array.from(this.antiPatterns.values())
  }

  async getAntiPatternsBySeverity(minSeverity: number): Promise<AntiPattern[]> {
    return Array.from(this.antiPatterns.values()).filter((p) => p.severity >= minSeverity)
  }

  async getStats(): Promise<{
    total_failures: number
    total_anti_patterns: number
    high_severity_count: number
    most_common_type: string | null
  }> {
    const all = Database.use((db) => db.select().from(negative_memory).all())

    const typeCounts = new Map<string, number>()
    let highSeverityCount = 0

    for (const m of all) {
      typeCounts.set(m.failure_type, (typeCounts.get(m.failure_type) || 0) + 1)
      if (m.severity >= 4) highSeverityCount++
    }

    const mostCommonType = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null

    return {
      total_failures: all.length,
      total_anti_patterns: this.antiPatterns.size,
      high_severity_count: highSeverityCount,
      most_common_type: mostCommonType,
    }
  }
}

export interface AntiPattern {
  id: string
  name: string
  pattern: string // Regex pattern to detect
  alternative: string // What to use instead
  examples: string[] // Code examples
  severity: number // 1-5
  category?: string
  created_at?: number
}
