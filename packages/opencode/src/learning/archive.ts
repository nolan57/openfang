import { Database } from "../storage/db"
import { archive_snapshot } from "./learning.sql"
import { eq, desc } from "drizzle-orm"
import { Log } from "../util/log"
import * as crypto from "crypto"

const log = Log.create({ service: "learning-archive" })

export type SnapshotType = "pre_evolution" | "pre_skill_install" | "pre_code_change" | "golden"

export interface ArchiveState {
  skills: string[]
  config: Record<string, unknown>
  memories: string[]
}

export class Archive {
  private async computeChecksum(state: ArchiveState): Promise<string> {
    return crypto.createHash("sha256").update(JSON.stringify(state)).digest("hex")
  }

  async createSnapshot(
    type: SnapshotType,
    description: string,
    state: ArchiveState,
    parentId?: string,
  ): Promise<string> {
    const id = crypto.randomUUID()
    const checksum = await this.computeChecksum(state)

    if (type === "golden") {
      Database.use((db) =>
        db
          .update(archive_snapshot)
          .set({ is_golden: 0 })
          .where(eq(archive_snapshot.is_golden, 1) as any),
      )
    }

    Database.use((db) =>
      db.insert(archive_snapshot).values({
        id,
        snapshot_type: type,
        description,
        state: JSON.stringify(state),
        checksum,
        parent_id: parentId ?? null,
        is_golden: type === "golden" ? 1 : 0,
      }),
    )

    log.info("snapshot_created", { id, type, description })
    return id
  }

  async getSnapshot(id: string) {
    return Database.use((db) => db.select().from(archive_snapshot).where(eq(archive_snapshot.id, id)).get())
  }

  async getLatestSnapshot(type?: SnapshotType) {
    const query = Database.use((db) =>
      type
        ? db
            .select()
            .from(archive_snapshot)
            .where(eq(archive_snapshot.snapshot_type, type))
            .orderBy(desc(archive_snapshot.time_created))
            .limit(1)
            .get()
        : db.select().from(archive_snapshot).orderBy(desc(archive_snapshot.time_created)).limit(1).get(),
    )
    return query
  }

  async getGoldenSnapshot() {
    return Database.use((db) =>
      db
        .select()
        .from(archive_snapshot)
        .where(eq(archive_snapshot.is_golden, 1))
        .orderBy(desc(archive_snapshot.time_created))
        .limit(1)
        .get(),
    )
  }

  async rollback(targetId: string): Promise<ArchiveState | null> {
    const snapshot = await this.getSnapshot(targetId)
    if (!snapshot) {
      log.error("rollback_failed_snapshot_not_found", { targetId })
      return null
    }

    const currentChecksum = await this.computeChecksum(JSON.parse(snapshot.state))
    if (currentChecksum !== snapshot.checksum) {
      log.error("rollback_failed_checksum_mismatch", {
        targetId,
        expected: snapshot.checksum,
        actual: currentChecksum,
      })
      return null
    }

    const state = JSON.parse(snapshot.state) as ArchiveState

    log.info("rollback_success", {
      targetId,
      snapshotType: snapshot.snapshot_type,
      description: snapshot.description,
    })

    return state
  }

  async verifyIntegrity(): Promise<{ valid: boolean; issues: string[] }> {
    const all = Database.use((db) => db.select().from(archive_snapshot).all())
    const issues: string[] = []

    for (const s of all) {
      const computed = await this.computeChecksum(JSON.parse(s.state))
      if (computed !== s.checksum) {
        issues.push(`Snapshot ${s.id}: checksum mismatch`)
      }
    }

    return { valid: issues.length === 0, issues }
  }

  async getLineage(snapshotId: string): Promise<string[]> {
    const lineage: string[] = []
    let current = await this.getSnapshot(snapshotId)

    while (current) {
      lineage.push(current.id)
      if (current.parent_id) {
        current = await this.getSnapshot(current.parent_id)
      } else {
        break
      }
    }

    return lineage
  }

  async pruneOldSnapshots(keepCount = 10) {
    const all = Database.use((db) =>
      db
        .select()
        .from(archive_snapshot)
        .where(eq(archive_snapshot.is_golden, 0))
        .orderBy(desc(archive_snapshot.time_created))
        .all(),
    )

    if (all.length <= keepCount) return

    const toDelete = all.slice(keepCount)
    for (const s of toDelete) {
      Database.use((db) => db.delete(archive_snapshot).where(eq(archive_snapshot.id, s.id)))
    }

    log.info("pruned_old_snapshots", { deleted: toDelete.length })
  }
}
