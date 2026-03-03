import { Database } from "../storage/db"
import { learning_runs, knowledge } from "./learning.sql"
import { eq } from "drizzle-orm"

export class KnowledgeStore {
  async createRun(trigger: string, topics: string[]): Promise<string> {
    const id = crypto.randomUUID()
    Database.use((db) =>
      db.insert(learning_runs).values({
        id,
        trigger,
        status: "running",
        topics: JSON.stringify(topics),
        items_collected: 0,
        notes_created: 0,
      }),
    )
    return id
  }

  async completeRun(id: string, itemsCollected: number, notesCreated: number) {
    Database.use((db) =>
      db
        .update(learning_runs)
        .set({
          status: "completed",
          items_collected: itemsCollected,
          notes_created: notesCreated,
        })
        .where(eq(learning_runs.id, id)),
    )
  }

  async saveKnowledge(
    items: {
      run_id: string
      source: string
      url: string
      title: string
      summary: string
      tags: string[]
      value_score: number
      action: string
    }[],
  ) {
    for (const item of items) {
      Database.use((db) =>
        db.insert(knowledge).values({
          id: crypto.randomUUID(),
          run_id: item.run_id,
          source: item.source,
          url: item.url,
          title: item.title,
          summary: item.summary,
          tags: JSON.stringify(item.tags),
          value_score: item.value_score,
          action: item.action,
          processed: 0,
        }),
      )
    }
  }

  async getRecentKnowledge(limit = 50) {
    return Database.use((db) => db.select().from(knowledge).orderBy(knowledge.time_created).limit(limit).all())
  }
}
