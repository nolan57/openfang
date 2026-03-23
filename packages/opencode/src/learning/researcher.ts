import type { CollectedItem } from "./collector"
import { Log } from "../util/log"

const log = Log.create({ service: "learning-researcher" })

export interface ResearchProposal {
  id: string
  title: string
  url: string
  summary: string
  source: string
  relevance_score: number
  evidence: string
  integration_points: string[]
  risk: "low" | "medium" | "high"
}

export class Researcher {
  async research(topics: string[], items: CollectedItem[]): Promise<ResearchProposal[]> {
    const proposals: ResearchProposal[] = []

    for (const item of items) {
      const proposal = this.createProposal(item, topics)
      if (proposal.relevance_score > 0.3) {
        proposals.push(proposal)
      }
    }

    proposals.sort((a, b) => b.relevance_score - a.relevance_score)

    log.info("research_completed", {
      items_processed: items.length,
      proposals_generated: proposals.length,
    })

    return proposals
  }

  private createProposal(item: CollectedItem, topics: string[]): ResearchProposal {
    const relevance_score = this.calculateRelevance(item, topics)
    const integration_points = this.findIntegrationPoints(item)
    const risk = this.assessRisk(item)

    return {
      id: crypto.randomUUID(),
      title: item.title,
      url: item.url,
      summary: item.content.slice(0, 300),
      source: item.source,
      relevance_score,
      evidence: this.extractEvidence(item),
      integration_points,
      risk,
    }
  }

  private calculateRelevance(item: CollectedItem, topics: string[]): number {
    let score = 0.5
    const content = (item.title + " " + item.content).toLowerCase()

    for (const topic of topics) {
      if (content.includes(topic.toLowerCase())) {
        score += 0.15
      }
    }

    if (item.source === "arxiv") score += 0.1
    if (item.source === "github") score += 0.05

    if (item.url.includes("github.com")) score += 0.1

    return Math.min(1, score)
  }

  private findIntegrationPoints(item: CollectedItem): string[] {
    const points: string[] = []
    const content = (item.title + " " + item.content).toLowerCase()

    if (content.includes("skill")) points.push("skill_installer")
    if (content.includes("agent") || content.includes("llm")) points.push("agent_enhancement")
    if (content.includes("memory") || content.includes("store")) points.push("knowledge_store")
    if (content.includes("api") || content.includes("tool")) points.push("tool_integration")
    if (content.includes("benchmark") || content.includes("performance")) points.push("optimization")

    return points.length > 0 ? points : ["general"]
  }

  private assessRisk(item: CollectedItem): "low" | "medium" | "high" {
    const content = (item.title + " " + item.content).toLowerCase()

    if (content.includes("experimental") || content.includes("beta")) return "high"
    if (content.includes("deprecated") || content.includes("legacy")) return "medium"

    if (item.url.includes("github.com") && content.includes("test")) return "low"
    if (item.url.includes("arxiv.org")) return "low"

    return "medium"
  }

  private extractEvidence(item: CollectedItem): string {
    const lines = item.content.split("\n").filter((l) => l.trim().length > 20)
    return lines.slice(0, 3).join(" | ")
  }
}
