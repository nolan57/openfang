import { KnowledgeGraph, type KnowledgeNode } from "./knowledge-graph"
import { SemanticAnchor } from "./semantic-anchor"
import { ConstraintLoader } from "./constraint-loader"
import { Log } from "../util/log"

const log = Log.create({ service: "consistency-checker" })
const sevenDays = 7 * 24 * 60 * 60 * 1000

export interface ConsistencyIssue {
  id: string
  type: "conflict" | "outdated" | "orphan" | "redundant" | "constraint_violation"
  severity: "low" | "medium" | "high"
  description: string
  affected_nodes: string[]
  suggested_fix?: string
}

export interface ConsistencyReport {
  checked_at: number
  total_nodes: number
  total_edges: number
  issues: ConsistencyIssue[]
  summary: {
    conflicts: number
    outdated: number
    orphans: number
    redundant: number
    constraint_violations: number
  }
}

export class ConsistencyChecker {
  private graph: KnowledgeGraph
  private semantic: SemanticAnchor
  private constraints: ConstraintLoader

  constructor() {
    this.graph = new KnowledgeGraph()
    this.semantic = new SemanticAnchor()
    this.constraints = new ConstraintLoader()
  }

  async runFullCheck(): Promise<ConsistencyReport> {
    log.info("consistency_check_started")

    const stats = await this.graph.getStats()
    const issues: ConsistencyIssue[] = []

    const conflictIssues = await this.checkForConflicts()
    issues.push(...conflictIssues)

    const outdatedIssues = await this.checkForOutdated()
    issues.push(...outdatedIssues)

    const orphanIssues = await this.checkForOrphans()
    issues.push(...orphanIssues)

    const redundantIssues = await this.checkForRedundant()
    issues.push(...redundantIssues)

    const summary = {
      conflicts: issues.filter((i) => i.type === "conflict").length,
      outdated: issues.filter((i) => i.type === "outdated").length,
      orphans: issues.filter((i) => i.type === "orphan").length,
      redundant: issues.filter((i) => i.type === "redundant").length,
      constraint_violations: issues.filter((i) => i.type === "constraint_violation").length,
    }

    const report: ConsistencyReport = {
      checked_at: Date.now(),
      total_nodes: stats.nodes,
      total_edges: stats.edges,
      issues,
      summary,
    }

    log.info("consistency_check_completed", summary)

    return report
  }

  private async checkForConflicts(): Promise<ConsistencyIssue[]> {
    const issues: ConsistencyIssue[] = []

    const memories = await this.graph.findNodesByType("memory")

    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const a = memories[i]
        const b = memories[j]

        const conflicts = await this.semantic.findConflicting(a.content || "")

        if (conflicts.some((c) => c.id === b.id)) {
          issues.push({
            id: crypto.randomUUID(),
            type: "conflict",
            severity: "medium",
            description: `Potential conflict between "${a.title}" and "${b.title}"`,
            affected_nodes: [a.id, b.id],
            suggested_fix: "Review both memories for contradictory information",
          })
        }
      }
    }

    return issues
  }

  private async checkForOutdated(): Promise<ConsistencyIssue[]> {
    const issues: ConsistencyIssue[] = []

    const allNodes = [...(await this.graph.findNodesByType("memory")), ...(await this.graph.findNodesByType("agenda"))]

    const now = Date.now()
    const thirtyDays = 30 * 24 * 60 * 60 * 1000

    for (const node of allNodes) {
      const lastUpdated = Number(node.metadata?.last_changed || node.metadata?.loaded_at || 0)

      if (now - lastUpdated > thirtyDays) {
        issues.push({
          id: crypto.randomUUID(),
          type: "outdated",
          severity: "low",
          description: `"${node.title}" has not been updated in over 30 days`,
          affected_nodes: [node.id],
          suggested_fix: "Review and update or archive this entry",
        })
      }

      if (node.metadata?.outdated) {
        const outdatedDuration = now - Number(node.metadata.outdated_since || 0)
        if (outdatedDuration > sevenDays) {
          issues.push({
            id: crypto.randomUUID(),
            type: "outdated",
            severity: "high",
            description: `"${node.title}" marked as outdated for over 7 days`,
            affected_nodes: [node.id],
            suggested_fix: "Either update or remove the outdated marker",
          })
        }
      }
    }

    return issues
  }

  private async checkForOrphans(): Promise<ConsistencyIssue[]> {
    const issues: ConsistencyIssue[] = []

    const memories = await this.graph.findNodesByType("memory")

    for (const memory of memories) {
      const related = await this.graph.getRelatedNodes(memory.id)

      if (related.length === 0) {
        issues.push({
          id: crypto.randomUUID(),
          type: "orphan",
          severity: "low",
          description: `"${memory.title}" has no connections to other nodes`,
          affected_nodes: [memory.id],
          suggested_fix: "Consider connecting to related memories or removing",
        })
      }
    }

    return issues
  }

  private async checkForRedundant(): Promise<ConsistencyIssue[]> {
    const issues: ConsistencyIssue[] = []

    const memories = await this.graph.findNodesByType("memory")

    const checked = new Set<string>()

    for (const memory of memories) {
      if (checked.has(memory.id)) continue

      const similar = await this.semantic.findSimilar(memory.content || memory.title, ["memory"], 3)

      for (const s of similar) {
        if (s.node.id === memory.id) continue
        if (checked.has(s.node.id)) continue

        if (s.score > 0.85) {
          issues.push({
            id: crypto.randomUUID(),
            type: "redundant",
            severity: "medium",
            description: `"${memory.title}" and "${s.node.title}" are ${Math.round(s.score * 100)}% similar`,
            affected_nodes: [memory.id, s.node.id],
            suggested_fix: "Consider merging or consolidating these entries",
          })

          checked.add(s.node.id)
        }
      }

      checked.add(memory.id)
    }

    return issues
  }

  async checkConstraints(): Promise<ConsistencyIssue[]> {
    const issues: ConsistencyIssue[] = []

    const files = await this.graph.findNodesByType("file")

    for (const file of files) {
      const validation = await this.constraints.validateAgainstConstraints(file.content || "", file.entity_id)

      if (!validation.valid) {
        for (const violation of validation.violations) {
          issues.push({
            id: crypto.randomUUID(),
            type: "constraint_violation",
            severity: "high",
            description: `Constraint violation in ${file.title}: ${violation}`,
            affected_nodes: [file.id],
            suggested_fix: "Fix the constraint violation",
          })
        }
      }
    }

    return issues
  }

  async autoFix(issue: ConsistencyIssue): Promise<boolean> {
    log.info("attempting_auto_fix", { issue_type: issue.type, id: issue.id })

    switch (issue.type) {
      case "outdated":
        if (issue.affected_nodes.length === 1) {
          await this.graph.updateNode(issue.affected_nodes[0], {
            metadata: {
              ...(await this.graph.getNode(issue.affected_nodes[0]))?.metadata,
              outdated: false,
              outdated_since: null,
            },
          })
          return true
        }
        return false

      case "redundant":
        if (issue.affected_nodes.length === 2) {
          await this.graph.addEdge({
            source_id: issue.affected_nodes[0],
            target_id: issue.affected_nodes[1],
            relation: "related_to",
            weight: 2,
          })
          return true
        }
        return false

      default:
        return false
    }
  }
}
