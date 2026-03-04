import type { CollectedItem } from "./collector"
import { Log } from "../util/log"
import { NegativeMemory } from "./negative"

const log = Log.create({ service: "learning-analyzer" })
const negativeMemory = new NegativeMemory()

export interface AnalyzedItem extends CollectedItem {
  summary: string
  tags: string[]
  value_score: number
  action: "note_only" | "install_skill" | "code_suggestion"
}

export class Analyzer {
  async analyze(items: CollectedItem[]): Promise<AnalyzedItem[]> {
    const results: AnalyzedItem[] = []

    for (const item of items) {
      const isBlocked = await negativeMemory.isBlocked(item.url, item.title)
      if (isBlocked) {
        log.info("skipping_blocked_by_negative_memory", { url: item.url })
        continue
      }

      try {
        const analyzed = this.analyzeItem(item)
        results.push(analyzed)
      } catch (e) {
        log.error("failed to analyze item", { url: item.url, error: String(e) })
      }
    }

    return results
  }

  private analyzeItem(item: CollectedItem): AnalyzedItem {
    const summary = this.extractSummary(item.content)
    const tags = this.extractTags(item)
    const score = this.calculateValueScore(item, tags)
    const action = this.determineAction(score)

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

  private determineAction(score: number): AnalyzedItem["action"] {
    if (score >= 80) return "install_skill"
    if (score >= 60) return "code_suggestion"
    return "note_only"
  }
}
