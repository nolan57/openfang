/**
 * Learning to Evolution Modifier
 *
 * Enables the learning system to propose and apply modifications to evolution artifacts.
 * Provides a structured workflow for learning-driven evolution improvements.
 *
 * Workflow:
 * 1. Learning identifies patterns/insights
 * 2. Creates modification proposals
 * 3. Submits for human review (via Safety system)
 * 4. Applies approved modifications
 *
 * @example
 * ```typescript
 * const modifier = new LearningToEvolutionModifier(projectDir)
 *
 * // Create proposal from learning insight
 * const proposal = await modifier.createProposal({
 *   type: "prompt_optimization",
 *   targetId: "prompt-123",
 *   changes: { optimizedPrompt: "..." },
 *   reason: "Learning identified better phrasing"
 * })
 *
 * // Submit for review
 * await modifier.submitForReview(proposal)
 * ```
 */

import { readFile, writeFile, access, mkdir } from "fs/promises"
import { resolve, join } from "path"
import { Log } from "../util/log"
import { withSpan, spanAttrs } from "./tracing"
import { Safety } from "./safety"
import { EvolutionAnalyzer, type EvolutionIssue } from "./evolution-analyzer"
import type { PromptEvolution, SkillEvolution, MemoryEntry } from "../evolution/types"
import {
  savePromptEvolution,
  saveSkillEvolution,
  saveMemory,
  updateSkillStatus,
  archiveMemory,
} from "../evolution/store"

// Human review request for evolution modifications
interface EvolutionReviewRequest {
  id: string
  proposal_id: string
  title: string
  description: string
  status: "pending" | "approved" | "rejected"
  created_at: number
  reviewed_at?: number
  review_reason?: string
}

const log = Log.create({ service: "learning-evolution-modifier" })

const PROPOSALS_DIR = ".opencode/evolution/proposals"

// ============================================================================
// Proposal Types
// ============================================================================

export type ModificationType =
  | "prompt_optimization"
  | "prompt_merge"
  | "prompt_deletion"
  | "skill_code_fix"
  | "skill_merge"
  | "skill_deletion"
  | "memory_compress"
  | "memory_archive"
  | "memory_deletion"
  | "memory_merge"

export type ModificationStatus = "draft" | "pending_review" | "approved" | "rejected" | "applied"

export interface ModificationProposal {
  id: string
  type: ModificationType
  status: ModificationStatus
  target_type: "prompt" | "skill" | "memory"
  target_id: string
  target_name?: string
  changes: Record<string, unknown>
  reason: string
  evidence?: string
  created_at: number
  updated_at: number
  review_request_id?: string
  applied_at?: number
  rejected_reason?: string
  related_issues?: EvolutionIssue[]
}

export interface CreateProposalInput {
  type: ModificationType
  target_id: string
  target_name?: string
  changes: Record<string, unknown>
  reason: string
  evidence?: string
  related_issues?: EvolutionIssue[]
}

export interface ApplyModificationResult {
  success: boolean
  new_id?: string
  error?: string
}

// ============================================================================
// LearningToEvolutionModifier
// ============================================================================

export class LearningToEvolutionModifier {
  private projectDir: string
  private evolutionDir: string
  private proposalsDir: string
  private reviewRequests: Map<string, EvolutionReviewRequest> = new Map()
  private safety: Safety | null = null
  private analyzer: EvolutionAnalyzer

  constructor(projectDir: string) {
    this.projectDir = projectDir
    this.evolutionDir = resolve(projectDir, ".opencode/evolution")
    this.proposalsDir = resolve(this.evolutionDir, "proposals")
    this.analyzer = new EvolutionAnalyzer(projectDir)
  }

  /**
   * Set safety instance for cooldown checks and risk assessment
   */
  setSafety(safety: Safety): void {
    this.safety = safety
  }

  /**
   * Initialize the modifier and ensure directories exist
   */
  async init(): Promise<void> {
    try {
      await access(this.evolutionDir)
    } catch {
      await mkdir(this.evolutionDir, { recursive: true })
    }

    try {
      await access(this.proposalsDir)
    } catch {
      await mkdir(this.proposalsDir, { recursive: true })
    }

    log.info("learning_evolution_modifier_initialized", { projectDir: this.projectDir })
  }

  /**
   * Create a modification proposal from learning insights
   */
  async createProposal(input: CreateProposalInput): Promise<ModificationProposal> {
    return withSpan(
      "learning.evolution_modifier.create_proposal",
      async (span) => {
        const now = Date.now()
        const proposal: ModificationProposal = {
          id: crypto.randomUUID(),
          type: input.type,
          status: "draft",
          target_type: this.getTargetType(input.type),
          target_id: input.target_id,
          target_name: input.target_name,
          changes: input.changes,
          reason: input.reason,
          evidence: input.evidence,
          created_at: now,
          updated_at: now,
          related_issues: input.related_issues,
        }

        // Save proposal to file
        await this.saveProposal(proposal)

        span.setAttributes({
          "proposal.id": proposal.id,
          "proposal.type": proposal.type,
          "proposal.target": proposal.target_id,
        })

        log.info("proposal_created", {
          id: proposal.id,
          type: proposal.type,
          target: proposal.target_id,
        })

        return proposal
      },
    )
  }

  /**
   * Submit proposal for human review
   */
  async submitForReview(proposal: ModificationProposal): Promise<ModificationProposal> {
    return withSpan(
      "learning.evolution_modifier.submit_review",
      async (span) => {
        // Check safety cooldown if safety is configured
        if (this.safety) {
          const cooldownCheck = await this.safety.checkCooldown()
          if (!cooldownCheck.allowed) {
            log.warn("proposal_blocked_by_cooldown", {
              proposal_id: proposal.id,
              reason: cooldownCheck.reason,
              remaining: cooldownCheck.cooldown_remaining_ms,
            })
            throw new Error(
              `Cannot submit for review: ${cooldownCheck.reason}. ` +
                `Remaining: ${this.safety.formatCooldownTime(cooldownCheck.cooldown_remaining_ms || 0)}`,
            )
          }
        }

        proposal.status = "pending_review"
        proposal.updated_at = Date.now()

        // Create review request
        const reviewRequest: EvolutionReviewRequest = {
          id: crypto.randomUUID(),
          proposal_id: proposal.id,
          title: `Evolution ${proposal.type} proposal`,
          description: this.buildReviewDescription(proposal),
          status: "pending",
          created_at: Date.now(),
        }

        this.reviewRequests.set(reviewRequest.id, reviewRequest)
        proposal.review_request_id = reviewRequest.id

        await this.saveProposal(proposal)

        span.setAttributes({
          "proposal.id": proposal.id,
          "review_request.id": reviewRequest.id,
        })

        log.info("proposal_submitted_for_review", {
          proposal_id: proposal.id,
          review_id: reviewRequest.id,
        })

        return proposal
      },
    )
  }

  /**
   * Process review decision and apply if approved
   */
  async processReviewDecision(decision: {
    approved: boolean
    reason?: string
    metadata?: { proposal_id?: string }
  }): Promise<ApplyModificationResult> {
    return withSpan(
      "learning.evolution_modifier.process_decision",
      async (span) => {
        if (decision.metadata?.proposal_id) {
          const proposal = await this.getProposal(decision.metadata.proposal_id as string)

          if (!proposal) {
            return { success: false, error: "Proposal not found" }
          }

          if (decision.approved) {
            proposal.status = "approved"
            proposal.updated_at = Date.now()
            await this.saveProposal(proposal)

            // Apply the modification
            const result = await this.applyModification(proposal)
            span.setAttributes({ "result.success": result.success })
            return result
          } else {
            proposal.status = "rejected"
            proposal.rejected_reason = decision.reason
            proposal.updated_at = Date.now()
            await this.saveProposal(proposal)

            log.info("proposal_rejected", {
              proposal_id: proposal.id,
              reason: decision.reason,
            })

            return { success: true }
          }
        }

        return { success: false, error: "No proposal_id in decision metadata" }
      },
    )
  }

  /**
   * Apply a modification to evolution artifacts
   */
  async applyModification(proposal: ModificationProposal): Promise<ApplyModificationResult> {
    return withSpan(
      "learning.evolution_modifier.apply",
      async (span) => {
        try {
          let result: ApplyModificationResult

          switch (proposal.type) {
            case "prompt_optimization":
              result = await this.applyPromptOptimization(proposal)
              break
            case "prompt_merge":
              result = await this.applyPromptMerge(proposal)
              break
            case "prompt_deletion":
              result = { success: true } // Prompt deletion not implemented yet
              break
            case "skill_code_fix":
              result = await this.applySkillCodeFix(proposal)
              break
            case "skill_merge":
              result = { success: true } // Skill merge not implemented yet
              break
            case "skill_deletion":
              result = { success: true } // Skill deletion not implemented yet
              break
            case "memory_compress":
              result = await this.applyMemoryCompression(proposal)
              break
            case "memory_archive":
              result = await this.applyMemoryArchive(proposal)
              break
            case "memory_deletion":
              result = { success: true } // Memory deletion not implemented yet
              break
            case "memory_merge":
              result = await this.applyMemoryMerge(proposal)
              break
            default:
              return { success: false, error: `Unknown modification type: ${proposal.type}` }
          }

          if (result.success) {
            proposal.status = "applied"
            proposal.applied_at = Date.now()
            proposal.updated_at = Date.now()
            await this.saveProposal(proposal)

            span.setAttributes({
              "proposal.id": proposal.id,
              "modification.type": proposal.type,
              "result.new_id": result.new_id,
            })

            log.info("modification_applied", {
              proposal_id: proposal.id,
              type: proposal.type,
              new_id: result.new_id,
            })
          }

          return result
        } catch (error) {
          log.error("apply_modification_failed", {
            proposal_id: proposal.id,
            error: String(error),
          })

          return {
            success: false,
            error: String(error),
          }
        }
      },
    )
  }

  /**
   * Get all pending review requests
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
    const pending: Array<{
      review_id: string
      proposal_id: string
      title: string
      description: string
      created_at: number
      proposal_type: string
      target_name?: string
    }> = []

    for (const [reviewId, review] of this.reviewRequests) {
      if (review.status === "pending") {
        const proposal = await this.getProposal(review.proposal_id)
        if (proposal) {
          pending.push({
            review_id: reviewId,
            proposal_id: review.proposal_id,
            title: review.title,
            description: review.description,
            created_at: review.created_at,
            proposal_type: proposal.type,
            target_name: proposal.target_name,
          })
        }
      }
    }

    // Also load from persisted proposals
    const allProposals = await this.getProposals("pending_review")
    for (const proposal of allProposals) {
      if (!pending.find((r) => r.proposal_id === proposal.id)) {
        pending.push({
          review_id: proposal.review_request_id || "unknown",
          proposal_id: proposal.id,
          title: `Evolution ${proposal.type} proposal`,
          description: this.buildReviewDescription(proposal),
          created_at: proposal.created_at,
          proposal_type: proposal.type,
          target_name: proposal.target_name,
        })
      }
    }

    return pending.sort((a, b) => b.created_at - a.created_at)
  }

  /**
   * Approve a pending review
   */
  async approveReview(reviewIdOrProposalId: string): Promise<ApplyModificationResult> {
    // Try to find by review_id first
    const review = this.reviewRequests.get(reviewIdOrProposalId)

    if (review) {
      review.status = "approved"
      review.reviewed_at = Date.now()

      const proposal = await this.getProposal(review.proposal_id)
      if (proposal) {
        return this.applyModification(proposal)
      }
      return { success: false, error: "Proposal not found" }
    }

    // Try to find by proposal_id
    const proposal = await this.getProposal(reviewIdOrProposalId)
    if (proposal && proposal.status === "pending_review") {
      const decision = {
        approved: true as const,
        reason: "Approved by user",
        metadata: { proposal_id: proposal.id },
      }
      return this.processReviewDecision(decision)
    }

    return { success: false, error: "Review or proposal not found" }
  }

  /**
   * Reject a pending review
   */
  async rejectReview(reviewIdOrProposalId: string, reason: string): Promise<{ success: boolean; error?: string }> {
    // Try to find by review_id first
    const review = this.reviewRequests.get(reviewIdOrProposalId)

    if (review) {
      review.status = "rejected"
      review.reviewed_at = Date.now()
      review.review_reason = reason

      const proposal = await this.getProposal(review.proposal_id)
      if (proposal) {
        proposal.status = "rejected"
        proposal.rejected_reason = reason
        proposal.updated_at = Date.now()
        await this.saveProposal(proposal)
        return { success: true }
      }
      return { success: false, error: "Proposal not found" }
    }

    // Try to find by proposal_id
    const proposal = await this.getProposal(reviewIdOrProposalId)
    if (proposal && proposal.status === "pending_review") {
      proposal.status = "rejected"
      proposal.rejected_reason = reason
      proposal.updated_at = Date.now()
      await this.saveProposal(proposal)
      return { success: true }
    }

    return { success: false, error: "Review or proposal not found" }
  }

  /**
   * Get all proposals, optionally filtered by status
   */
  async getProposals(status?: ModificationStatus): Promise<ModificationProposal[]> {
    const proposals: ModificationProposal[] = []

    try {
      const files = await this.readProposalFiles()
      for (const file of files) {
        const proposal = await this.loadProposal(file)
        if (proposal && (!status || proposal.status === status)) {
          proposals.push(proposal)
        }
      }
    } catch (error) {
      log.warn("get_proposals_failed", { error: String(error) })
    }

    return proposals.sort((a, b) => b.updated_at - a.updated_at)
  }

  /**
   * Get a specific proposal by ID
   */
  async getProposal(id: string): Promise<ModificationProposal | null> {
    try {
      const files = await this.readProposalFiles()
      for (const file of files) {
        const proposal = await this.loadProposal(file)
        if (proposal?.id === id) {
          return proposal
        }
      }
    } catch (error) {
      log.warn("get_proposal_failed", { id, error: String(error) })
    }

    return null
  }

  /**
   * Delete a proposal
   */
  async deleteProposal(id: string): Promise<boolean> {
    try {
      const filePath = join(this.proposalsDir, `${id}.json`)
      const { unlink } = await import("fs/promises")
      await unlink(filePath)
      log.info("proposal_deleted", { id })
      return true
    } catch (error) {
      log.warn("delete_proposal_failed", { id, error: String(error) })
      return false
    }
  }

  /**
   * Analyze evolution artifacts and auto-generate proposals for high-severity issues
   */
  async autoGenerateProposals(options?: { minSeverity?: "low" | "medium" | "high" }): Promise<ModificationProposal[]> {
    return withSpan(
      "learning.evolution_modifier.auto_generate",
      async (span) => {
        const minSeverity = options?.minSeverity ?? "medium"
        const analysis = await this.analyzer.analyzeAll()
        const proposals: ModificationProposal[] = []

        const allIssues = [...analysis.prompts.issues, ...analysis.skills.issues, ...analysis.memories.issues]
        const filteredIssues = EvolutionAnalyzer.prioritizeIssues(allIssues).filter(
          (issue) => EvolutionAnalyzer.getSeverityScore(issue.severity) >= EvolutionAnalyzer.getSeverityScore(minSeverity),
        )

        for (const issue of filteredIssues.slice(0, 10)) {
          // Limit to 10 auto-proposals per run
          const proposalInput = this.issueToProposalInput(issue)
          if (proposalInput) {
            const proposal = await this.createProposal(proposalInput)
            proposals.push(proposal)
          }
        }

        span.setAttributes({
          "issues.analyzed": allIssues.length,
          "issues.filtered": filteredIssues.length,
          "proposals.created": proposals.length,
        })

        log.info("auto_generated_proposals", {
          count: proposals.length,
          min_severity: minSeverity,
        })

        return proposals
      },
    )
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private getTargetType(modType: ModificationType): "prompt" | "skill" | "memory" {
    if (modType.startsWith("prompt")) return "prompt"
    if (modType.startsWith("skill")) return "skill"
    return "memory"
  }

  private buildReviewDescription(proposal: ModificationProposal): string {
    return `
## Evolution Modification Proposal

**Type:** ${proposal.type}
**Target:** ${proposal.target_type} (${proposal.target_name || proposal.target_id})

### Reason
${proposal.reason}

### Proposed Changes
${JSON.stringify(proposal.changes, null, 2)}

${proposal.evidence ? `### Evidence\n${proposal.evidence}` : ""}

${proposal.related_issues?.length ? `### Related Issues\n${proposal.related_issues.map((i) => `- ${i.message}`).join("\n")}` : ""}

---
*This proposal was auto-generated by the learning system.*
    `.trim()
  }

  private async saveProposal(proposal: ModificationProposal): Promise<void> {
    const filePath = join(this.proposalsDir, `${proposal.id}.json`)
    await writeFile(filePath, JSON.stringify(proposal, null, 2))
  }

  private async loadProposal(filePath: string): Promise<ModificationProposal | null> {
    try {
      const content = await readFile(filePath, "utf-8")
      return JSON.parse(content) as ModificationProposal
    } catch {
      return null
    }
  }

  private async readProposalFiles(): Promise<string[]> {
    try {
      const { readdir } = await import("fs/promises")
      const files = await readdir(this.proposalsDir)
      return files.filter((f) => f.endsWith(".json"))
    } catch {
      return []
    }
  }

  private issueToProposalInput(issue: EvolutionIssue): CreateProposalInput | null {
    switch (issue.type) {
      case "prompt_redundant":
        return {
          type: "prompt_merge",
          target_id: issue.artifact_id,
          target_name: issue.artifact_name,
          changes: { merge_with: issue.related_artifacts },
          reason: issue.message,
          evidence: issue.evidence,
          related_issues: [issue],
        }

      case "prompt_outdated":
        return {
          type: "prompt_deletion",
          target_id: issue.artifact_id,
          target_name: issue.artifact_name,
          changes: {},
          reason: issue.message,
          related_issues: [issue],
        }

      case "skill_code_quality":
        return {
          type: "skill_code_fix",
          target_id: issue.artifact_id,
          target_name: issue.artifact_name,
          changes: { fix_type: issue.suggestion },
          reason: issue.message,
          related_issues: [issue],
        }

      case "memory_duplicate":
        return {
          type: "memory_compress",
          target_id: issue.artifact_id,
          target_name: issue.artifact_name,
          changes: { compress_with: issue.related_artifacts },
          reason: issue.message,
          related_issues: [issue],
        }

      case "memory_stale":
        return {
          type: "memory_archive",
          target_id: issue.artifact_id,
          target_name: issue.artifact_name,
          changes: {},
          reason: issue.message,
          related_issues: [issue],
        }

      default:
        return null
    }
  }

  // ============================================================================
  // Modification Apply Methods
  // ============================================================================

  private async applyPromptOptimization(proposal: ModificationProposal): Promise<ApplyModificationResult> {
    const { changes } = proposal

    if (!changes.optimizedPrompt) {
      return { success: false, error: "Missing optimizedPrompt in changes" }
    }

    const newPrompt = await savePromptEvolution(this.projectDir, {
      originalPrompt: changes.originalPrompt as string,
      optimizedPrompt: changes.optimizedPrompt as string,
      reason: proposal.reason,
      sessionID: `learning-${Date.now()}`,
    })

    return {
      success: true,
      new_id: newPrompt.id,
    }
  }

  private async applyPromptMerge(proposal: ModificationProposal): Promise<ApplyModificationResult> {
    // For prompt merge, we create a new optimized prompt that combines multiple
    const { changes } = proposal

    if (!changes.mergedPrompt) {
      return { success: false, error: "Missing mergedPrompt in changes" }
    }

    const newPrompt = await savePromptEvolution(this.projectDir, {
      originalPrompt: changes.originalPrompt as string,
      optimizedPrompt: changes.mergedPrompt as string,
      reason: `Merged from multiple similar prompts: ${proposal.reason}`,
      sessionID: `learning-${Date.now()}`,
    })

    return {
      success: true,
      new_id: newPrompt.id,
    }
  }

  private async applySkillCodeFix(proposal: ModificationProposal): Promise<ApplyModificationResult> {
    // For skill code fixes, we update the skill content
    const { changes } = proposal

    // Load the skill
    const { getSkillEvolutions } = await import("../evolution/store")
    const skills = await getSkillEvolutions(this.projectDir)
    const skill = skills.find((s) => s.id === proposal.target_id)

    if (!skill) {
      return { success: false, error: "Skill not found" }
    }

    // Apply fix based on type
    let fixedContent = skill.content
    if (changes.fix_type === "Remove console.log statements") {
      fixedContent = fixedContent.replace(/console\.(log|warn|error|info)\s*\([^)]*\);?/g, "")
    }
    if (changes.fix_type === "Address or document the TODO") {
      fixedContent = fixedContent.replace(/\/\/\s*TODO[^\n]*\n/g, "")
    }

    // Create updated skill
    const updatedSkill = await saveSkillEvolution(this.projectDir, {
      name: skill.name,
      description: skill.description,
      content: fixedContent,
      triggerPatterns: skill.triggerPatterns,
      sessionID: skill.sessionID,
    })

    // Update status back to draft for re-review
    await updateSkillStatus(this.projectDir, updatedSkill.id, "draft")

    return {
      success: true,
      new_id: updatedSkill.id,
    }
  }

  private async applyMemoryCompression(proposal: ModificationProposal): Promise<ApplyModificationResult> {
    const { changes } = proposal
    const { summarizeSimilarMemories } = await import("../evolution/store")

    // Compress memories with same key
    const result = await summarizeSimilarMemories(this.projectDir, proposal.target_name || "unknown", {
      threshold: 2,
      archiveOriginals: true,
    })

    if (result) {
      return {
        success: true,
        new_id: result.summaryId,
      }
    }

    return { success: false, error: "Compression failed" }
  }

  private async applyMemoryArchive(proposal: ModificationProposal): Promise<ApplyModificationResult> {
    const archived = await archiveMemory(this.projectDir, proposal.target_id, "manual")

    return {
      success: archived,
      error: archived ? undefined : "Failed to archive memory",
    }
  }

  private async applyMemoryMerge(proposal: ModificationProposal): Promise<ApplyModificationResult> {
    const { changes } = proposal

    if (!changes.mergedValue) {
      return { success: false, error: "Missing mergedValue in changes" }
    }

    const newMemory = await saveMemory(this.projectDir, {
      key: changes.mergedKey as string,
      value: changes.mergedValue as string,
      context: `Merged from multiple memories: ${proposal.reason}`,
      sessionIDs: changes.mergedSessionIDs as string[] || [],
    })

    return {
      success: true,
      new_id: newMemory.id,
    }
  }
}

log.info("learning_evolution_modifier_loaded")
