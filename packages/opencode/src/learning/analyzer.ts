import type { CollectedItem } from "./collector"
import { Log } from "../util/log"
import { NegativeMemory } from "./negative"
import { Config } from "../config/config"
import type { LearningConfig } from "./config"

const log = Log.create({ service: "learning-analyzer" })
const negativeMemory = new NegativeMemory()

let cachedConfig: LearningConfig | null = null

async function getLearningConfig(): Promise<LearningConfig> {
  if (cachedConfig) return cachedConfig

  const cfg = await Config.get()
  cachedConfig = {
    enabled: cfg.evolution?.enabled ?? true,
    schedule: { cron: undefined, idle_check: true, idle_threshold_minutes: 30 },
    sources: (cfg.evolution?.sources as any[]) ?? ["search", "arxiv", "github"],
    topics: cfg.evolution?.directions ?? [],
    max_items_per_run: cfg.evolution?.maxItemsPerRun ?? 10,
    note_output_dir: "docs/learning/notes",
    disableSkillGeneration: cfg.evolution?.disableSkillGeneration ?? true,
  }
  return cachedConfig
}

export interface AnalyzedItem extends CollectedItem {
  summary: string
  tags: string[]
  value_score: number
  action: "note_only" | "install_skill" | "code_suggestion"
}

export class Analyzer {
  async analyze(items: CollectedItem[]): Promise<AnalyzedItem[]> {
    const config = await getLearningConfig()
    const results: AnalyzedItem[] = []

    for (const item of items) {
      const isBlocked = await negativeMemory.isBlocked(item.url, item.title)
      if (isBlocked) {
        log.info("skipping_blocked_by_negative_memory", { url: item.url })
        continue
      }

      try {
        const analyzed = await this.analyzeItem(item, config)
        results.push(analyzed)
      } catch (e) {
        log.error("failed to analyze item", { url: item.url, error: String(e) })
      }
    }

    return results
  }

  private async analyzeItem(item: CollectedItem, config: LearningConfig): Promise<AnalyzedItem> {
    const summary = this.extractSummary(item.content)
    const tags = this.extractTags(item)
    const score = this.calculateValueScore(item, tags)
    const action = await this.determineAction(score, config)

    return {
      ...item,
      summary,
      tags,
      value_score: score,
      action,
    }
  }

  private extractSummary(content: string): string {
    return content.slice(0, 500) + (content.length > 500 ? "..." : "")
  }

  private extractTags(item: CollectedItem): string[] {
    const keywords = [
      "AI",
      "agent",
      "LLM",
      "GPT",
      "algorithm",
      "framework",
      "library",
      "tool",
      "machine learning",
      "neural",
      "transformer",
    ]
    const tags: string[] = []
    const lowerContent = (item.title + " " + item.content).toLowerCase()

    for (const kw of keywords) {
      if (lowerContent.includes(kw.toLowerCase())) {
        tags.push(kw)
      }
    }

    if (!tags.length) tags.push("general")
    return tags
  }

  private calculateValueScore(item: CollectedItem, tags: string[]): number {
    let score = 50

    if (item.source === "arxiv") score += 20
    else if (item.source === "github") score += 15

    score += tags.length * 5

    if (item.url.includes("github.com")) score += 10

    return Math.min(100, score)
  }

  private async determineAction(score: number, config: LearningConfig): Promise<AnalyzedItem["action"]> {
    // Check if skill generation is disabled
    if (config.disableSkillGeneration) {
      log.info("skill_generation_disabled", { score })
      return "note_only"
    }

    if (score >= 80) return "install_skill"
    if (score >= 60) return "code_suggestion"
    return "note_only"
  }
}
