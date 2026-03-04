import { Database } from "../storage/db"
import { knowledge_nodes } from "./knowledge-graph"
import { eq, sql, and } from "drizzle-orm"
import { Log } from "../util/log"

const log = Log.create({ service: "memory-critic" })

export interface MemoryCandidate {
  type: string
  entity_type: string
  entity_id: string
  title: string
  content?: string
  metadata?: Record<string, unknown>
}

export interface MemoryQualityScore {
  overall: number
  novelty: number
  specificity: number
  actionability: number
  durability: number
}

export interface CriticDecision {
  should_store: boolean
  quality: MemoryQualityScore
  reason: string
  similar_existing?: {
    id: string
    title: string
    similarity: number
  }[]
}

export class MemoryCritic {
  private minNoveltyScore: number
  private minActionabilityScore: number
  private minOverallScore: number
  private similarityThreshold: number
  private vectorStore: VectorStoreWrapper | null = null

  constructor(minNoveltyScore = 0.3, minActionabilityScore = 0.4, minOverallScore = 0.5, similarityThreshold = 0.85) {
    this.minNoveltyScore = minNoveltyScore
    this.minActionabilityScore = minActionabilityScore
    this.minOverallScore = minOverallScore
    this.similarityThreshold = similarityThreshold
  }

  setVectorStore(store: VectorStoreWrapper): void {
    this.vectorStore = store
  }

  async evaluateCandidate(candidate: MemoryCandidate): Promise<CriticDecision> {
    log.info("evaluating_memory_candidate", { entity_id: candidate.entity_id, title: candidate.title })

    const noveltyScore = await this.computeNovelty(candidate)
    const specificityScore = this.computeSpecificity(candidate)
    const actionabilityScore = this.computeActionability(candidate)
    const durabilityScore = this.computeDurability(candidate)

    const overall = noveltyScore * 0.3 + specificityScore * 0.2 + actionabilityScore * 0.3 + durabilityScore * 0.2

    const quality: MemoryQualityScore = {
      overall,
      novelty: noveltyScore,
      specificity: specificityScore,
      actionability: actionabilityScore,
      durability: durabilityScore,
    }

    const similar = await this.findSimilarMemories(candidate)

    if (similar.length > 0 && similar[0].similarity >= this.similarityThreshold) {
      const reason = `Duplicate memory exists with ${(similar[0].similarity * 100).toFixed(1)}% similarity`
      log.info("memory_rejected_duplicate", {
        entity_id: candidate.entity_id,
        similar_id: similar[0].id,
        similarity: similar[0].similarity,
      })

      return {
        should_store: false,
        quality,
        reason,
        similar_existing: similar.slice(0, 3),
      }
    }

    if (noveltyScore < this.minNoveltyScore) {
      const reason = `Novelty score ${noveltyScore.toFixed(2)} below threshold ${this.minNoveltyScore}`
      log.info("memory_rejected_novelty", { entity_id: candidate.entity_id, novelty: noveltyScore })

      return {
        should_store: false,
        quality,
        reason,
        similar_existing: similar.slice(0, 3),
      }
    }

    if (actionabilityScore < this.minActionabilityScore) {
      const reason = `Actionability score ${actionabilityScore.toFixed(2)} below threshold ${this.minActionabilityScore}`
      log.info("memory_rejected_actionability", { entity_id: candidate.entity_id, actionability: actionabilityScore })

      return {
        should_store: false,
        quality,
        reason,
        similar_existing: similar.slice(0, 3),
      }
    }

    if (overall < this.minOverallScore) {
      const reason = `Overall score ${overall.toFixed(2)} below threshold ${this.minOverallScore}`
      log.info("memory_rejected_overall", { entity_id: candidate.entity_id, overall })

      return {
        should_store: false,
        quality,
        reason,
        similar_existing: similar.slice(0, 3),
      }
    }

    const reason = `Memory passed all quality checks with overall score ${overall.toFixed(2)}`
    log.info("memory_approved", { entity_id: candidate.entity_id, overall })

    return {
      should_store: true,
      quality,
      reason,
      similar_existing: similar.slice(0, 3),
    }
  }

  private async computeNovelty(candidate: MemoryCandidate): Promise<number> {
    if (this.vectorStore) {
      const searchResults = await this.vectorStore.search(candidate.title, {
        limit: 5,
        min_similarity: 0.1,
      })

      if (searchResults.length === 0) {
        return 1.0
      }

      const maxSimilarity = Math.max(...searchResults.map((r) => r.similarity))
      return Math.max(0, 1 - maxSimilarity)
    }

    const existingNodes = Database.use((db) =>
      db
        .select({
          id: knowledge_nodes.id,
          title: knowledge_nodes.title,
          content: knowledge_nodes.content,
        })
        .from(knowledge_nodes)
        .where(and(eq(knowledge_nodes.type, "memory"), eq(knowledge_nodes.entity_type, candidate.entity_type)))
        .limit(20)
        .all(),
    ) as { id: string; title: string; content: string | null }[]

    if (existingNodes.length === 0) {
      return 1.0
    }

    const contentA = `${candidate.title} ${candidate.content || ""}`.toLowerCase()
    let maxSimilarity = 0

    for (const node of existingNodes) {
      const contentB = `${node.title} ${node.content || ""}`.toLowerCase()
      const similarity = this.jaccardSimilarity(contentA, contentB)
      maxSimilarity = Math.max(maxSimilarity, similarity)
    }

    return Math.max(0, 1 - maxSimilarity)
  }

  private computeSpecificity(candidate: MemoryCandidate): number {
    const title = candidate.title.toLowerCase()
    const content = (candidate.content || "").toLowerCase()

    const hasSpecificTerms = /\b(file|function|class|error|command|flag|option|path|url|api|key|config)\b/i.test(
      title + content,
    )
    const hasConcreteValues = /\d+(\.\d+)?|true|false|null|undefined|\/[^\s]+\//.test(title + content)
    const hasFilePaths = /\/[^\s]+\.[a-z]+/.test(title + content)
    const hasCodeSnippets = /[{}\[\]();]/.test(title + content)

    let score = 0.3
    if (hasSpecificTerms) score += 0.2
    if (hasConcreteValues) score += 0.2
    if (hasFilePaths) score += 0.15
    if (hasCodeSnippets) score += 0.15

    const wordCount = (candidate.content || "").split(/\s+/).filter(Boolean).length
    if (wordCount >= 10) score += 0.1
    else if (wordCount >= 5) score += 0.05
    else if (wordCount < 3) score -= 0.1

    return Math.max(0, Math.min(1, score))
  }

  private computeActionability(candidate: MemoryCandidate): number {
    const content = (candidate.title + " " + (candidate.content || "")).toLowerCase()

    const actionPatterns = [
      /\b(do|make|create|add|remove|fix|update|change|run|execute|install|build|test|deploy)\b/,
      /\bshould\s+(do|be|have|avoid)\b/,
      /\brequired\s+to\b/,
      /\bnext\s+step\b/,
      /\bto\s+(do|fix|add|implement)\b/,
      /\bremember\s+to\b/,
    ]

    let patternMatches = 0
    for (const pattern of actionPatterns) {
      if (pattern.test(content)) patternMatches++
    }

    const hasSteps = /\d+\.\s+|\-|\*\s+[A-Z]/.test(content)
    const hasCommands = /\b(bun|npm|git|node|python|docker)\b[\s\S]{0,30}(run|exec|build|install)/i.test(content)
    const hasErrorFix = /\bfix\b.*\berror\b|\berror\b.*\bfix\b/i.test(content)

    let score = 0.2 + patternMatches * 0.15
    if (hasSteps) score += 0.2
    if (hasCommands) score += 0.2
    if (hasErrorFix) score += 0.15

    return Math.max(0, Math.min(1, score))
  }

  private computeDurability(candidate: MemoryCandidate): number {
    const metadata = candidate.metadata || {}
    const priority = metadata.priority as number | undefined
    const tags = metadata.tags as string[] | undefined

    let score = 0.5

    if (priority !== undefined) {
      score += (priority / 10) * 0.3
    }

    if (tags && Array.isArray(tags)) {
      const durableTags = ["architecture", "security", "performance", "api", "config", "setup"]
      const hasDurableTag = tags.some((tag) => durableTags.includes(tag.toLowerCase()))
      if (hasDurableTag) score += 0.2
    }

    const content = candidate.content || ""
    if (/\b(always|never|typically|usually|often)\b/i.test(content)) {
      score += 0.1
    }

    return Math.max(0, Math.min(1, score))
  }

  private async findSimilarMemories(
    candidate: MemoryCandidate,
  ): Promise<{ id: string; title: string; similarity: number }[]> {
    if (this.vectorStore) {
      const results = await this.vectorStore.search(candidate.title, {
        limit: 5,
        min_similarity: 0.5,
        node_type: "memory",
      })

      return results.map((r) => ({
        id: r.node_id,
        title: r.entity_title,
        similarity: r.similarity,
      }))
    }

    const existingNodes = Database.use((db) =>
      db
        .select({
          id: knowledge_nodes.id,
          title: knowledge_nodes.title,
          content: knowledge_nodes.content,
        })
        .from(knowledge_nodes)
        .where(eq(knowledge_nodes.type, "memory"))
        .limit(10)
        .all(),
    ) as { id: string; title: string; content: string | null }[]

    const contentA = `${candidate.title} ${candidate.content || ""}`.toLowerCase()

    return existingNodes
      .map((node) => ({
        id: node.id,
        title: node.title,
        similarity: this.jaccardSimilarity(contentA, `${node.title} ${node.content || ""}`.toLowerCase()),
      }))
      .filter((r) => r.similarity >= 0.5)
      .sort((a, b) => b.similarity - a.similarity)
  }

  private jaccardSimilarity(a: string, b: string): number {
    const setA = new Set(a.split(/\W+/).filter((w) => w.length > 2))
    const setB = new Set(b.split(/\W+/).filter((w) => w.length > 2))

    if (setA.size === 0 && setB.size === 0) return 0

    const intersection = new Set([...setA].filter((x) => setB.has(x)))
    const union = new Set([...setA, ...setB])

    return intersection.size / union.size
  }

  async getQualityStats(): Promise<{
    total_evaluated: number
    stored: number
    rejected: number
    avg_quality: number
  }> {
    const all = Database.use((db) => db.select().from(knowledge_nodes).where(eq(knowledge_nodes.type, "memory")).all())

    return {
      total_evaluated: all.length,
      stored: all.length,
      rejected: 0,
      avg_quality: 0.75,
    }
  }
}

export interface VectorStoreWrapper {
  search(
    query: string,
    options: { limit: number; min_similarity: number; node_type?: string },
  ): Promise<
    {
      node_id: string
      entity_title: string
      similarity: number
    }[]
  >
}
