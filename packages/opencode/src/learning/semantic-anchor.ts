import { KnowledgeGraph, type KnowledgeNode, type NodeType } from "./knowledge-graph"
import { Log } from "../util/log"

const log = Log.create({ service: "semantic-anchor" })

export interface SimilarityResult {
  node: KnowledgeNode
  score: number
}

export class SemanticAnchor {
  private graph: KnowledgeGraph
  private similarityThreshold: number

  constructor(similarityThreshold = 0.3) {
    this.graph = new KnowledgeGraph()
    this.similarityThreshold = similarityThreshold
  }

  async findSimilar(content: string, types?: NodeType[], limit = 5): Promise<SimilarityResult[]> {
    const queryHash = this.simpleHash(content)
    const queryFeatures = this.extractFeatures(content)

    let nodes: KnowledgeNode[]
    if (types && types.length > 0) {
      nodes = []
      for (const type of types) {
        const found = await this.graph.findNodesByType(type)
        nodes.push(...found)
      }
    } else {
      nodes = await this.graph.findNodesByType("memory")
      const files = await this.graph.findNodesByType("file")
      nodes.push(...files)
    }

    const results: SimilarityResult[] = []

    for (const node of nodes) {
      const nodeFeatures = this.extractFeatures(node.content || node.title)
      const score = this.calculateSimilarity(queryFeatures, nodeFeatures)

      if (score >= this.similarityThreshold) {
        results.push({ node, score })
      }
    }

    results.sort((a, b) => b.score - a.score)

    log.info("semantic_search_completed", {
      query_length: content.length,
      nodes_scanned: nodes.length,
      results_found: results.length,
    })

    return results.slice(0, limit)
  }

  async findRelatedByContext(context: string): Promise<KnowledgeNode[]> {
    const keywords = this.extractKeywords(context)

    const allNodes = [
      ...(await this.graph.findNodesByType("memory")),
      ...(await this.graph.findNodesByType("constraint")),
      ...(await this.graph.findNodesByType("agenda")),
    ]

    const scored = allNodes.map((node) => {
      const nodeText = `${node.title} ${node.content || ""}`.toLowerCase()
      let matches = 0
      for (const kw of keywords) {
        if (nodeText.includes(kw.toLowerCase())) {
          matches++
        }
      }
      return { node, score: matches / keywords.length }
    })

    const relevant = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((s) => s.node)

    return relevant
  }

  async findConflicting(currentContent: string): Promise<KnowledgeNode[]> {
    const currentFeatures = this.extractFeatures(currentContent)

    const allMemories = await this.graph.findNodesByType("memory")

    const conflicts: KnowledgeNode[] = []

    for (const memory of allMemories) {
      const memoryFeatures = this.extractFeatures(memory.content || "")
      const similarity = this.calculateSimilarity(currentFeatures, memoryFeatures)

      if (similarity > 0.7) {
        const relatedToCurrent = await this.graph.getRelatedNodes(memory.id, "conflicts_with")
        if (relatedToCurrent.length > 0) {
          conflicts.push(memory)
        }
      }
    }

    return conflicts
  }

  async suggestConnections(newNode: KnowledgeNode): Promise<{ target: KnowledgeNode; reason: string }[]> {
    const suggestions: { target: KnowledgeNode; reason: string }[] = []

    const content = newNode.content || newNode.title
    const features = this.extractFeatures(content)

    const allNodes = [
      ...(await this.graph.findNodesByType("memory")),
      ...(await this.graph.findNodesByType("constraint")),
    ]

    for (const node of allNodes) {
      if (node.id === newNode.id) continue

      const nodeFeatures = this.extractFeatures(node.content || node.title)
      const similarity = this.calculateSimilarity(features, nodeFeatures)

      if (similarity > 0.5 && similarity < 0.9) {
        suggestions.push({
          target: node,
          reason: `High similarity (${Math.round(similarity * 100)}%) in topics`,
        })
      }
    }

    return suggestions.sort((a, b) => b.reason.localeCompare(a.reason)).slice(0, 5)
  }

  private extractFeatures(text: string): string[] {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)

    const stopWords = new Set([
      "this",
      "that",
      "with",
      "from",
      "have",
      "been",
      "were",
      "they",
      "their",
      "which",
      "will",
      "would",
      "could",
      "should",
      "about",
      "after",
      "before",
      "there",
      "where",
      "when",
      "what",
      "why",
      "how",
      "some",
      "them",
      "than",
      "then",
      "now",
      "just",
      "only",
      "also",
      "into",
      "over",
      "such",
      "into",
      "more",
      "most",
    ])

    return [...new Set(words.filter((w) => !stopWords.has(w)))]
  }

  private extractKeywords(text: string): string[] {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)

    const freq: Record<string, number> = {}
    for (const word of words) {
      freq[word] = (freq[word] || 0) + 1
    }

    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([w]) => w)
  }

  private calculateSimilarity(features1: string[], features2: string[]): number {
    if (features1.length === 0 || features2.length === 0) return 0

    const set1 = new Set(features1)
    const set2 = new Set(features2)

    const intersection = new Set([...set1].filter((x) => set2.has(x)))
    const union = new Set([...set1, ...set2])

    return intersection.size / union.size
  }

  private simpleHash(text: string): number {
    let hash = 0
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash
    }
    return hash
  }

  setThreshold(threshold: number): void {
    this.similarityThreshold = threshold
  }
}
