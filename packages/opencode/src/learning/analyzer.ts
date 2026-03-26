import type { CollectedItem } from "./collector"
import { Log } from "../util/log"
import { NegativeMemory } from "./negative"
import { Config } from "../config/config"
import type { LearningConfig } from "./config"
import { generateText } from "ai"
import { Provider } from "../provider/provider"

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

interface ScoringFactors {
  sourceWeight: number
  contentQuality: number
  recency: number
  relevance: number
  engagement: number
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
    const score = await this.calculateValueScore(item, tags)
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

  private getSourceAuthority(source: string, url: string): number {
    const sourceScores = {
      arxiv: 0.95,
      github: 0.85,
      search: 0.7,
      pypi: 0.8,
      blogs: 0.75,
    }

    const baseScore = sourceScores[source as keyof typeof sourceScores] ?? 0.6

    const domainBoosts: Record<string, number> = {
      "github.com": 0.1,
      "arxiv.org": 0.05,
      "openai.com": 0.1,
      "anthropic.com": 0.1,
      "google.com": 0.08,
      "microsoft.com": 0.08,
      "meta.com": 0.08,
    }

    for (const [domain, boost] of Object.entries(domainBoosts)) {
      if (url.includes(domain)) {
        return Math.min(1.0, baseScore + boost)
      }
    }

    return baseScore
  }

  private async analyzeContentQuality(content: string): Promise<number> {
    if (!content || content.length < 100) return 0.3
    if (content.length > 10000) return 0.7

    const hasCode = /```[\s\S]*?```/.test(content)
    const hasExamples = /example|usage|demo/i.test(content)
    const hasStructure = content.includes("##") || content.includes("###") || content.includes("- ")
    const hasLinks = /https?:\/\//.test(content)

    let quality = 0.5
    if (hasCode) quality += 0.15
    if (hasExamples) quality += 0.15
    if (hasStructure) quality += 0.1
    if (hasLinks) quality += 0.1

    return Math.min(1.0, quality)
  }

  private calculateRecencyScore(publishedAt?: string): number {
    if (!publishedAt) return 0.7

    try {
      const pubDate = new Date(publishedAt)
      const now = new Date()
      const daysDiff = (now.getTime() - pubDate.getTime()) / (1000 * 60 * 60 * 24)

      if (daysDiff < 30) return 1.0
      if (daysDiff < 90) return 0.9
      if (daysDiff < 180) return 0.7
      if (daysDiff < 365) return 0.5
      return 0.3
    } catch {
      return 0.7
    }
  }

  private async computeSemanticRelevance(item: CollectedItem, config: LearningConfig): Promise<number> {
    if (!config.topics || config.topics.length === 0) return 0.7

    const topicKeywords = config.topics.join(" ")
    const combinedText = `${item.title} ${item.content.slice(0, 500)}`.toLowerCase()
    const topicWords = topicKeywords.toLowerCase().split(/\s+/)

    let matchCount = 0
    for (const word of topicWords) {
      if (combinedText.includes(word.toLowerCase())) {
        matchCount++
      }
    }

    return Math.min(1.0, matchCount / topicWords.length)
  }

  private async getEngagementMetrics(url: string): Promise<number> {
    if (url.includes("github.com")) {
      try {
        const githubUrl = url.match(/github\.com\/[^/]+\/[^/]+/)
        if (githubUrl) {
          return 0.8
        }
      } catch {
        return 0.5
      }
    }

    return 0.5
  }

  private async calculateValueScore(item: CollectedItem, tags: string[]): Promise<number> {
    const factors: ScoringFactors = {
      sourceWeight: this.getSourceAuthority(item.source, item.url),
      contentQuality: await this.analyzeContentQuality(item.content),
      recency: this.calculateRecencyScore(),
      relevance: await this.computeSemanticRelevance(item, await getLearningConfig()),
      engagement: await this.getEngagementMetrics(item.url),
    }

    const weights = {
      sourceWeight: 0.25,
      contentQuality: 0.3,
      recency: 0.15,
      relevance: 0.2,
      engagement: 0.1,
    }

    const score =
      factors.sourceWeight * weights.sourceWeight +
      factors.contentQuality * weights.contentQuality +
      factors.recency * weights.recency +
      factors.relevance * weights.relevance +
      factors.engagement * weights.engagement

    return Math.round(score * 100)
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
