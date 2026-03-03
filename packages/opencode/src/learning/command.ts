import type { LearningConfig } from "./config"
import { defaultLearningConfig } from "./config"
import { LearningScheduler } from "./scheduler"
import { Collector } from "./collector"
import { Analyzer } from "./analyzer"
import { NoteGenerator } from "./notes"
import { KnowledgeStore } from "./store"
import { Installer } from "./installer"
import { CodeSuggester, type CodeSuggestion } from "./suggester"
import { Log } from "../util/log"

const log = Log.create({ service: "learning-command" })

export interface LearningResult {
  success: boolean
  collected: number
  notes: number
  installs: number
  suggestions: number
  error?: string
}

export async function runLearning(config?: Partial<LearningConfig>): Promise<LearningResult> {
  const finalConfig: LearningConfig = {
    ...defaultLearningConfig,
    ...config,
    schedule: {
      ...defaultLearningConfig.schedule,
      ...config?.schedule,
    },
  }

  log.info("starting learning run", { topics: finalConfig.topics })

  const scheduler = new LearningScheduler(finalConfig)
  await scheduler.setup()

  const collector = new Collector(finalConfig)
  const analyzer = new Analyzer()
  const noteGen = new NoteGenerator(finalConfig.note_output_dir)
  const store = new KnowledgeStore()
  const installer = new Installer()
  const suggester = new CodeSuggester()

  const runId = await store.createRun("manual", finalConfig.topics)

  try {
    const items = await collector.collect()
    log.info("collected items", { count: items.length })

    const analyzed = await analyzer.analyze(items)
    log.info("analyzed items", { count: analyzed.length })

    await store.saveKnowledge(
      analyzed.map((i) => ({
        run_id: runId,
        source: i.source,
        url: i.url,
        title: i.title,
        summary: i.summary,
        tags: i.tags,
        value_score: i.value_score,
        action: i.action,
      })),
    )

    const notes = await noteGen.generate(
      runId,
      analyzed.map((a) => ({
        source: a.source,
        url: a.url,
        title: a.title,
        content: a.content,
      })),
    )
    log.info("generated notes", { count: notes.length })

    const installResults = await installer.install(analyzed)
    log.info("install results", { results: installResults })

    const suggestions = await suggester.generateSuggestions(analyzed)
    log.info("code suggestions", { count: suggestions.length })

    if (suggestions.length > 0) {
      for (const s of suggestions) {
        log.info("code suggestion", {
          id: s.id,
          title: s.title,
          risk: s.risk,
          effort: s.effort,
          files: s.affected_files,
        })
      }
    }

    await store.completeRun(runId, items.length, notes.length)

    return {
      success: true,
      collected: items.length,
      notes: notes.length,
      installs: installResults.filter((r) => r.success).length,
      suggestions: suggestions.length,
    }
  } catch (e) {
    log.error("learning run failed", { error: String(e) })
    return {
      success: false,
      collected: 0,
      notes: 0,
      installs: 0,
      suggestions: 0,
      error: String(e),
    }
  }
}

export { CodeSuggester, type CodeSuggestion }
