import { Database } from "../storage/db"
import { learning_runs, knowledge } from "./learning.sql"
import { eq } from "drizzle-orm"

export interface CodeSuggestionRecord {
  id: string
  run_id: string
  title: string
  description: string
  rationale: string
  affected_files: string
  risk: string
  effort: string
  suggested_changes: string
  source_url: string
  source_title: string
  source_tags: string
  status: string
  created_at: number
}

export class SuggestionStore {
  async saveSuggestions(suggestions: Omit<CodeSuggestionRecord, "created_at" | "status">[]) {
    for (const s of suggestions) {
      Database.use((db) =>
        db.insert(knowledge).values({
          id: s.id,
          run_id: s.run_id,
          source: "code_suggestion",
          url: s.source_url,
          title: s.title,
          summary: s.description,
          tags: s.source_tags,
          value_score: 60,
          action: "code_suggestion",
          processed: 0,
        }),
      )
    }
  }

  async getSuggestions(limit = 20) {
    return Database.use((db) =>
      db
        .select()
        .from(knowledge)
        .where(eq(knowledge.action, "code_suggestion"))
        .orderBy(knowledge.time_created)
        .limit(limit)
        .all(),
    )
  }

  async markProcessed(id: string) {
    Database.use((db) => db.update(knowledge).set({ processed: 1 }).where(eq(knowledge.id, id)))
  }
}
