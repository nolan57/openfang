import { Log } from "../util/log"

const log = Log.create({ service: "context-retriever" })

export interface RetrievalQuery {
  text: string
  filters?: Record<string, any>
  limit?: number
  minRelevance?: number
}

export interface RetrievedChunk {
  id: string
  content: string
  score: number
  source: string
}

export interface RetrievalResult {
  chunks: RetrievedChunk[]
  totalScanned: number
  queryTimeMs: number
}

export class Retriever {
  private chunks: Map<string, { content: string; source: string; embedding?: number[] }>

  constructor() {
    this.chunks = new Map()
  }

  indexChunk(id: string, content: string, source: string): void {
    this.chunks.set(id, { content, source })
    log.info("chunk_indexed", { id, source })
  }

  removeChunk(id: string): boolean {
    return this.chunks.delete(id)
  }

  retrieve(query: RetrievalQuery): RetrievalResult {
    const startTime = Date.now()
    const limit = query.limit ?? 5
    const minRelevance = query.minRelevance ?? 0.1

    const results: RetrievedChunk[] = []

    for (const [id, chunk] of this.chunks.entries()) {
      if (query.filters?.source && chunk.source !== query.filters.source) {
        continue
      }

      const score = this.calculateSimilarity(query.text, chunk.content)

      if (score >= minRelevance) {
        results.push({
          id,
          content: chunk.content,
          score,
          source: chunk.source,
        })
      }
    }

    results.sort((a, b) => b.score - a.score)
    const topResults = results.slice(0, limit)

    log.info("retrieval_completed", {
      query: query.text.slice(0, 50),
      results: topResults.length,
      totalScanned: this.chunks.size,
      timeMs: Date.now() - startTime,
    })

    return {
      chunks: topResults,
      totalScanned: this.chunks.size,
      queryTimeMs: Date.now() - startTime,
    }
  }

  retrieveHybrid(query: RetrievalQuery, vectorResults: RetrievedChunk[]): RetrievalResult {
    const keywordResults = this.retrieve({ ...query, limit: query.limit ?? 10 })
    const seen = new Set<string>()

    const merged: RetrievedChunk[] = []

    for (const chunk of [...vectorResults, ...keywordResults.chunks]) {
      if (!seen.has(chunk.id)) {
        seen.add(chunk.id)
        merged.push({
          ...chunk,
          score: (chunk.score + (vectorResults.find((v) => v.id === chunk.id)?.score ?? 0)) / 2,
        })
      }
    }

    merged.sort((a, b) => b.score - a.score)

    return {
      chunks: merged.slice(0, query.limit ?? 5),
      totalScanned: this.chunks.size,
      queryTimeMs: Date.now() - Date.now(),
    }
  }

  private calculateSimilarity(query: string, content: string): number {
    const queryTerms = this.tokenize(query)
    const contentTerms = this.tokenize(content)

    if (queryTerms.length === 0 || contentTerms.length === 0) {
      return 0
    }

    const querySet = new Set(queryTerms)
    const contentSet = new Set(contentTerms)

    let matches = 0
    for (const term of querySet) {
      if (contentSet.has(term)) {
        matches++
      }
    }

    const jaccard = matches / (querySet.size + contentSet.size - matches)

    const positionBonus = this.positionBonus(query, content)

    return jaccard * 0.7 + positionBonus * 0.3
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2)
  }

  private positionBonus(query: string, content: string): number {
    const queryLower = query.toLowerCase()
    const contentLower = content.toLowerCase()
    const firstMatch = contentLower.indexOf(queryLower)

    if (firstMatch === -1) {
      return 0
    }

    const position = firstMatch / content.length
    return 1 - position * 0.5
  }

  getIndexedCount(): number {
    return this.chunks.size
  }

  clear(): void {
    this.chunks.clear()
    log.info("retriever_cleared")
  }
}

export function createRetriever(): Retriever {
  return new Retriever()
}
