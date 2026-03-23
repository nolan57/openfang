import type { ResearchProposal } from "./researcher"
import { NegativeMemory } from "./negative"
import { Log } from "../util/log"

const log = Log.create({ service: "learning-architect" })

export interface RefactoringPlan {
  proposal_id: string
  action: "approve" | "reject" | "human_review"
  reason: string
  files_to_modify: string[]
  tests_to_update: string[]
  rollback_strategy: string
  confidence: number
}

export class Architect {
  private negativeMemory: NegativeMemory

  constructor() {
    this.negativeMemory = new NegativeMemory()
  }

  async plan(proposals: ResearchProposal[]): Promise<RefactoringPlan[]> {
    const plans: RefactoringPlan[] = []

    for (const proposal of proposals) {
      const plan = await this.createPlan(proposal)
      plans.push(plan)

      if (plan.action === "human_review") {
        log.info("proposal_requires_human_review", {
          proposal_id: proposal.id,
          reason: plan.reason,
        })
      }
    }

    log.info("planning_completed", {
      proposals_processed: proposals.length,
      approved: plans.filter((p) => p.action === "approve").length,
      rejected: plans.filter((p) => p.action === "reject").length,
      human_review: plans.filter((p) => p.action === "human_review").length,
    })

    return plans
  }

  private async createPlan(proposal: ResearchProposal): Promise<RefactoringPlan> {
    const rejection = await this.checkConstraints(proposal)
    if (rejection) {
      return {
        proposal_id: proposal.id,
        action: "reject",
        reason: rejection,
        files_to_modify: [],
        tests_to_update: [],
        rollback_strategy: "none",
        confidence: 1.0,
      }
    }

    const needsHumanReview = this.needsHumanReview(proposal)
    if (needsHumanReview) {
      return {
        proposal_id: proposal.id,
        action: "human_review",
        reason: "High-risk or major architectural change requires human approval",
        files_to_modify: this.suggestFiles(proposal),
        tests_to_update: this.suggestTests(proposal),
        rollback_strategy: this.suggestRollback(proposal),
        confidence: 0.6,
      }
    }

    return {
      proposal_id: proposal.id,
      action: "approve",
      reason: "Low-risk improvement approved",
      files_to_modify: this.suggestFiles(proposal),
      tests_to_update: this.suggestTests(proposal),
      rollback_strategy: this.suggestRollback(proposal),
      confidence: 0.9,
    }
  }

  private async checkConstraints(proposal: ResearchProposal): Promise<string | null> {
    const blocked = await this.negativeMemory.isBlocked(proposal.url, proposal.title)
    if (blocked) {
      return `URL blocked by negative memory: ${proposal.url}`
    }

    const shouldBlock = await this.negativeMemory.shouldBlock("install_failed", { url: proposal.url })
    if (shouldBlock) {
      return `Similar failure recorded in negative memory`
    }

    return null
  }

  private needsHumanReview(proposal: ResearchProposal): boolean {
    if (proposal.risk === "high") return true

    if (proposal.integration_points.includes("agent_enhancement")) return true

    if (proposal.relevance_score < 0.5) return true

    return false
  }

  private suggestFiles(proposal: ResearchProposal): string[] {
    const files: string[] = []

    for (const point of proposal.integration_points) {
      switch (point) {
        case "skill_installer":
          files.push("src/learning/installer.ts")
          break
        case "agent_enhancement":
          files.push("src/agent/agent.ts")
          break
        case "knowledge_store":
          files.push("src/learning/store.ts")
          break
        case "tool_integration":
          files.push("src/tool/")
          break
        case "optimization":
          files.push("src/learning/suggester.ts")
          break
        default:
          files.push("src/learning/")
      }
    }

    return [...new Set(files)]
  }

  private suggestTests(proposal: ResearchProposal): string[] {
    const tests: string[] = []

    for (const point of proposal.integration_points) {
      tests.push(`test/learning/${point}.test.ts`)
    }

    return tests.length > 0 ? tests : ["test/learning/learning.test.ts"]
  }

  private suggestRollback(proposal: ResearchProposal): string {
    return `If changes fail: 1) Rollback to pre-evolution snapshot 2) Record failure in negative memory 3) Notify user`
  }
}
