/**
 * Learning Feedback Loop
 *
 * Connects learning insights to evolution modifications, creating a closed feedback loop.
 * This module orchestrates the flow from learning analysis to evolution code changes.
 *
 * Architecture:
 * ```
 * Learning Analysis → Pattern Detection → Issue Identification
 *        ↓
 * Proposal Generation → Human Review → Apply Modification
 *        ↓
 * Evolution Updated → Learning Re-analyzes → Continuous Improvement
 * ```
 *
 * @example
 * ```typescript
 * const feedbackLoop = new LearningFeedbackLoop(projectDir)
 * await feedbackLoop.initialize()
 *
 * // Run a feedback cycle
 * const result = await feedbackLoop.runCycle()
 *
 * // Or handle specific learning insights
 * await feedbackLoop.processLearningInsight(insight)
 * ```
 */

import { Log } from "../util/log"
import { withSpan, spanAttrs } from "./tracing"
import { EvolutionAnalyzer, type EvolutionIssue } from "./evolution-analyzer"
import {
  LearningToEvolutionModifier,
  type ModificationProposal,
  type CreateProposalInput,
} from "./evolution-modifier"
import { Safety, type SafetyConfig, defaultSafetyConfig } from "./safety"
import { KnowledgeGraph } from "./knowledge-graph"
import { getSharedVectorStore } from "./vector-store"

const log = Log.create({ service: "learning-feedback-loop" })

// ============================================================================
// Configuration
// ============================================================================

export interface FeedbackLoopConfig {
  /** Enable automatic proposal generation from learning insights */
  autoGenerateProposals: boolean
  /** Minimum severity for auto-generated proposals */
  minSeverity: "low" | "medium" | "high"
  /** Maximum proposals to generate per cycle */
  maxProposalsPerCycle: number
  /** Enable human review for all modifications */
  requireHumanReview: boolean
  /** Safety configuration */
  safety?: Partial<SafetyConfig>
}

export const DEFAULT_FEEDBACK_LOOP_CONFIG: FeedbackLoopConfig = {
  autoGenerateProposals: true,
  minSeverity: "medium",
  maxProposalsPerCycle: 10,
  requireHumanReview: true,
  safety: {},
}

export interface LearningInsight {
  type: "pattern" | "anomaly" | "improvement" | "regression"
  category: "prompt" | "skill" | "memory" | "code_quality"
  description: string
  evidence: string
  severity: "low" | "medium" | "high"
  suggested_action?: string
  metadata?: Record<string, unknown>
}

export interface FeedbackCycleResult {
  issues_analyzed: number
  proposals_created: number
  proposals_submitted: number
  proposals_applied: number
  errors: string[]
}

// ============================================================================
// LearningFeedbackLoop
// ============================================================================

export class LearningFeedbackLoop {
  private projectDir: string
  private analyzer: EvolutionAnalyzer
  private modifier: LearningToEvolutionModifier
  private safety: Safety
  private knowledgeGraph: KnowledgeGraph | null = null
  private config: FeedbackLoopConfig
  private initialized: boolean = false

  constructor(projectDir: string, config?: Partial<FeedbackLoopConfig>) {
    this.projectDir = projectDir
    this.config = { ...DEFAULT_FEEDBACK_LOOP_CONFIG, ...config }
    this.analyzer = new EvolutionAnalyzer(projectDir)
    this.modifier = new LearningToEvolutionModifier(projectDir)
    this.safety = new Safety(this.config.safety)
  }

  /**
   * Initialize the feedback loop
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    await this.modifier.init()
    this.modifier.setSafety(this.safety)

    // Initialize knowledge graph if enabled
    if (this.config.autoGenerateProposals) {
      try {
        this.knowledgeGraph = new KnowledgeGraph()
        const vectorStore = await getSharedVectorStore()
        log.info("feedback_loop_knowledge_components_initialized")
      } catch (error) {
        log.warn("feedback_loop_knowledge_init_failed", { error: String(error) })
      }
    }

    this.initialized = true
    log.info("learning_feedback_loop_initialized", {
      projectDir: this.projectDir,
      autoGenerate: this.config.autoGenerateProposals,
      requireReview: this.config.requireHumanReview,
    })
  }

  /**
   * Run a complete feedback cycle
   */
  async runCycle(): Promise<FeedbackCycleResult> {
    return withSpan(
      "learning.feedback_loop.run_cycle",
      async (span) => {
        const result: FeedbackCycleResult = {
          issues_analyzed: 0,
          proposals_created: 0,
          proposals_submitted: 0,
          proposals_applied: 0,
          errors: [],
        }

        try {
          // Step 1: Analyze evolution artifacts
          const analysis = await this.analyzer.analyzeAll()
          result.issues_analyzed = analysis.total_issues

          span.setAttributes({
            "analysis.prompts": analysis.prompts.issues.length,
            "analysis.skills": analysis.skills.issues.length,
            "analysis.memories": analysis.memories.issues.length,
          })

          // Step 2: Auto-generate proposals for high-priority issues
          if (this.config.autoGenerateProposals) {
            const proposals = await this.modifier.autoGenerateProposals({
              minSeverity: this.config.minSeverity,
            })
            result.proposals_created = proposals.length

            // Step 3: Submit for review if required
            if (this.config.requireHumanReview) {
              for (const proposal of proposals.slice(0, this.config.maxProposalsPerCycle)) {
                try {
                  await this.modifier.submitForReview(proposal)
                  result.proposals_submitted++
                } catch (error) {
                  result.errors.push(`Failed to submit proposal ${proposal.id}: ${String(error)}`)
                }
              }
            }
          }

          // Step 4: Process pending approved proposals
          const pendingProposals = await this.modifier.getProposals("approved")
          for (const proposal of pendingProposals) {
            try {
              const applyResult = await this.modifier.applyModification(proposal)
              if (applyResult.success) {
                result.proposals_applied++
              } else {
                result.errors.push(`Failed to apply proposal ${proposal.id}: ${applyResult.error}`)
              }
            } catch (error) {
              result.errors.push(`Failed to apply proposal ${proposal.id}: ${String(error)}`)
            }
          }

          span.setAttributes({
            "result.proposals_created": result.proposals_created,
            "result.proposals_submitted": result.proposals_submitted,
            "result.proposals_applied": result.proposals_applied,
            "result.errors_count": result.errors.length,
          })

          log.info("feedback_cycle_complete", {
            issues_analyzed: result.issues_analyzed,
            proposals_created: result.proposals_created,
            proposals_submitted: result.proposals_submitted,
            proposals_applied: result.proposals_applied,
            errors: result.errors.length,
          })
        } catch (error) {
          log.error("feedback_cycle_failed", { error: String(error) })
          result.errors.push(`Cycle failed: ${String(error)}`)
        }

        return result
      },
    )
  }

  /**
   * Process a learning insight and create modification proposal
   */
  async processLearningInsight(insight: LearningInsight): Promise<ModificationProposal | null> {
    return withSpan(
      "learning.feedback_loop.process_insight",
      async (span) => {
        span.setAttributes({
          "insight.type": insight.type,
          "insight.category": insight.category,
          "insight.severity": insight.severity,
        })

        // Convert insight to proposal input
        const proposalInput = this.insightToProposalInput(insight)
        if (!proposalInput) {
          log.warn("insight_not_convertible", { type: insight.type, category: insight.category })
          return null
        }

        // Create proposal
        const proposal = await this.modifier.createProposal(proposalInput)

        // Submit for review if required
        if (this.config.requireHumanReview) {
          await this.modifier.submitForReview(proposal)
        }

        log.info("learning_insight_processed", {
          insight_type: insight.type,
          proposal_id: proposal.id,
          submitted_for_review: this.config.requireHumanReview,
        })

        return proposal
      },
    )
  }

  /**
   * Get pending reviews awaiting user action
   * Returns detailed review information for UI display
   */
  async getPendingReviews(): Promise<Array<{
    review_id: string
    proposal_id: string
    title: string
    description: string
    created_at: number
    proposal_type: string
    target_name?: string
  }>> {
    return this.modifier.getPendingReviews()
  }

  /**
   * Get proposal by ID
   */
  async getProposal(id: string): Promise<ModificationProposal | null> {
    return this.modifier.getProposal(id)
  }

  /**
   * Approve and apply a proposal
   */
  async approveProposal(id: string): Promise<{ success: boolean; error?: string; result?: any }> {
    const result = await this.modifier.approveReview(id)
    return {
      success: result.success,
      error: result.error,
    }
  }

  /**
   * Reject a proposal with reason
   */
  async rejectProposal(id: string, reason: string): Promise<{ success: boolean; error?: string }> {
    return this.modifier.rejectReview(id, reason)
  }

  /**
   * Get review statistics
   */
  async getReviewStats(): Promise<{
    pending_count: number
    approved_count: number
    rejected_count: number
    total_applied: number
  }> {
    const pending = await this.getPendingReviews()
    const allProposals = await this.modifier.getProposals()

    return {
      pending_count: pending.length,
      approved_count: allProposals.filter((p) => p.status === "approved").length,
      rejected_count: allProposals.filter((p) => p.status === "rejected").length,
      total_applied: allProposals.filter((p) => p.status === "applied").length,
    }
  }

  /**
   * Get feedback loop statistics
   */
  async getStats(): Promise<{
    total_proposals: number
    by_status: Record<string, number>
    pending_reviews: number
    applied_count: number
  }> {
    const allProposals = await this.modifier.getProposals()

    const byStatus: Record<string, number> = {}
    let appliedCount = 0

    for (const proposal of allProposals) {
      byStatus[proposal.status] = (byStatus[proposal.status] || 0) + 1
      if (proposal.status === "applied") {
        appliedCount++
      }
    }

    return {
      total_proposals: allProposals.length,
      by_status: byStatus,
      pending_reviews: byStatus["pending_review"] || 0,
      applied_count: appliedCount,
    }
  }

  /**
   * Link learning insight to evolution artifact in knowledge graph
   */
  async linkInsightToArtifact(
    insightId: string,
    artifactId: string,
    relation: "identifies_issue" | "suggests_improvement" | "validates_change",
  ): Promise<string | null> {
    if (!this.knowledgeGraph) {
      log.warn("knowledge_graph_not_initialized")
      return null
    }

    try {
      // Create insight node
      const insightNodeId = await this.knowledgeGraph.addNode({
        type: "memory",
        entity_type: "learning_insight",
        entity_id: insightId,
        title: `Insight: ${insightId}`,
        content: `Learning insight linked to artifact ${artifactId}`,
        memory_type: "project",
        metadata: {
          insight_id: insightId,
          artifact_id: artifactId,
          relation,
          created_at: Date.now(),
        },
      })

      // Link to artifact node
      const edgeId = await this.knowledgeGraph.linkMemories(insightNodeId, artifactId, "references")

      log.info("insight_linked_to_artifact", { insightId, artifactId, edgeId })
      return edgeId
    } catch (error) {
      log.error("link_insight_failed", { error: String(error) })
      return null
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private insightToProposalInput(insight: LearningInsight): CreateProposalInput | null {
    switch (insight.category) {
      case "prompt":
        if (insight.type === "improvement") {
          return {
            type: "prompt_optimization",
            target_id: (insight.metadata?.prompt_id as string) || "",
            target_name: insight.description.slice(0, 30),
            changes: {
              optimizedPrompt: insight.suggested_action,
              originalPrompt: insight.metadata?.original_prompt as string,
            },
            reason: insight.description,
            evidence: insight.evidence,
          }
        }
        break

      case "skill":
        if (insight.type === "anomaly" || insight.type === "regression") {
          return {
            type: "skill_code_fix",
            target_id: (insight.metadata?.skill_id as string) || "",
            target_name: insight.description.slice(0, 30),
            changes: {
              fix_type: insight.suggested_action,
            },
            reason: insight.description,
            evidence: insight.evidence,
          }
        }
        break

      case "memory":
        if (insight.type === "pattern") {
          return {
            type: "memory_compress",
            target_id: (insight.metadata?.memory_key as string) || "",
            target_name: insight.description.slice(0, 30),
            changes: {
              compress_with: insight.metadata?.related_memories as string[],
            },
            reason: insight.description,
            evidence: insight.evidence,
          }
        }
        break
    }

    return null
  }
}

log.info("learning_feedback_loop_loaded")
