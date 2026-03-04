import { Database } from "../storage/db"
import { negative_memory } from "./learning.sql"
import { eq, and, gt } from "drizzle-orm"
import { Log } from "../util/log"

const log = Log.create({ service: "learning-negative" })

export type FailureType =
  | "install_failed"
  | "skill_conflict"
  | "performance_regression"
  | "security_issue"
  | "runtime_error"
  | "dependency_missing"
  | "incompatible_version"

export interface NegativeMemoryEntry {
  failure_type: FailureType
  description: string
  context: Record<string, unknown>
  severity?: number
  blocked_items?: string[]
}

export class NegativeMemory {
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
      db.select().from(negative_memory).orderBy(negative_memory.time_created).limit(limit).all(),
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
}
