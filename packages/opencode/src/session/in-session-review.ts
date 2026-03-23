/**
 * In-Session Review Handler
 *
 * Handles evolution modification proposals within the chat session.
 * Presents pending reviews to the user and processes their decisions.
 *
 * @example
 * ```typescript
 * // In session loop, after tool execution
 * const reviewResult = await handleInSessionReview(ctx)
 * if (reviewResult.presented) {
 *   // User is reviewing proposals, pause normal flow
 *   return
 * }
 * ```
 */

import { Log } from "../util/log"
import { LearningFeedbackLoop } from "../learning/feedback-loop"
import { Instance } from "../project/instance"
import type { LoopContext } from "../session/handlers"

const log = Log.create({ service: "in-session-review" })

export interface ReviewHandlerResult {
  /** Whether a review was presented to the user */
  presented: boolean
  /** Number of pending reviews */
  pending_count: number
  /** Review response if user made a decision */
  response?: {
    action: "approved" | "rejected" | "deferred"
    proposal_id: string
    message?: string
  }
}

export interface ReviewDisplayOptions {
  /** Maximum reviews to show at once */
  maxReviews?: number
  /** Show review details */
  showDetails?: boolean
  /** Auto-present if only one pending */
  autoPresent?: boolean
}

const DEFAULT_REVIEW_OPTIONS: Required<ReviewDisplayOptions> = {
  maxReviews: 3,
  showDetails: true,
  autoPresent: true,
}

/**
 * Check for pending reviews and present to user in session
 */
export async function handleInSessionReview(
  ctx?: LoopContext,
  options?: ReviewDisplayOptions,
): Promise<ReviewHandlerResult> {
  const opts = { ...DEFAULT_REVIEW_OPTIONS, ...options }

  try {
    const feedbackLoop = new LearningFeedbackLoop(Instance.directory)
    await feedbackLoop.initialize()

    // Get pending reviews
    const pending = await feedbackLoop.getPendingReviews()

    if (pending.length === 0) {
      return { presented: false, pending_count: 0 }
    }

    // Auto-present if enabled and within limit
    if (opts.autoPresent && pending.length <= opts.maxReviews) {
      const reviewToPresent = pending[0]

      // Build review message
      const reviewMessage = buildReviewMessage(reviewToPresent, opts.showDetails)

      log.info("presenting_review", {
        proposal_id: reviewToPresent.proposal_id,
        type: reviewToPresent.proposal_type,
        pending_count: pending.length,
      })

      return {
        presented: true,
        pending_count: pending.length,
        response: {
          action: "deferred", // Will be updated when user responds
          proposal_id: reviewToPresent.proposal_id,
          message: reviewMessage,
        },
      }
    }

    return {
      presented: false,
      pending_count: pending.length,
    }
  } catch (error) {
    log.error("in_session_review_failed", { error: String(error) })
    return {
      presented: false,
      pending_count: 0,
    }
  }
}

/**
 * Process user's review decision from session message
 */
export async function processUserReviewDecision(
  userInput: string,
): Promise<{
  success: boolean
  action?: "approved" | "rejected"
  proposal_id?: string
  error?: string
  message?: string
}> {
  try {
    // Check if input matches review command patterns
    const approveMatch = userInput.match(/^(?:approve|yes|ok|approved)\s*(?:proposal\s*)?([a-f0-9-]+)?/i)
    const rejectMatch = userInput.match(/^(?:reject|no|decline|rejected)\s*(?:proposal\s*)?([a-f0-9-]+)?\s*(?:because\s*|:?\s*)?(.*)?/i)

    if (approveMatch) {
      const proposalId = approveMatch[1]
      if (!proposalId) {
        return {
          success: false,
          error: "Please specify proposal ID",
          message: "Usage: approve <proposal-id>",
        }
      }

      const feedbackLoop = new LearningFeedbackLoop(Instance.directory)
      await feedbackLoop.initialize()

      const result = await feedbackLoop.approveProposal(proposalId)

      if (result.success) {
        log.info("proposal_approved_in_session", { proposal_id: proposalId })
        return {
          success: true,
          action: "approved",
          proposal_id: proposalId,
          message: "✓ Proposal approved and applied successfully",
        }
      } else {
        return {
          success: false,
          error: result.error,
          message: `Failed to approve: ${result.error}`,
        }
      }
    }

    if (rejectMatch) {
      const proposalId = rejectMatch[1]
      const reason = rejectMatch[2] || "No reason provided"

      if (!proposalId) {
        return {
          success: false,
          error: "Please specify proposal ID",
          message: "Usage: reject <proposal-id> [reason]",
        }
      }

      const feedbackLoop = new LearningFeedbackLoop(Instance.directory)
      await feedbackLoop.initialize()

      const result = await feedbackLoop.rejectProposal(proposalId, reason)

      if (result.success) {
        log.info("proposal_rejected_in_session", { proposal_id: proposalId, reason })
        return {
          success: true,
          action: "rejected",
          proposal_id: proposalId,
          message: `✗ Proposal rejected: ${reason}`,
        }
      } else {
        return {
          success: false,
          error: result.error,
          message: `Failed to reject: ${result.error}`,
        }
      }
    }

    // Not a review command
    return {
      success: false,
      error: "Not a review command",
    }
  } catch (error) {
    log.error("process_review_decision_failed", { error: String(error) })
    return {
      success: false,
      error: String(error),
    }
  }
}

/**
 * Check if user message is a review-related command
 */
export function isReviewCommand(userInput: string): boolean {
  const patterns = [
    /^approve\s/i,
    /^reject\s/i,
    /^yes\s*$/i,
    /^no\s*$/i,
    /^ok\s*$/i,
    /^decline\s/i,
    /^show\s+(pending\s+)?reviews?/i,
    /^list\s+(pending\s+)?(proposals|reviews)/i,
  ]

  return patterns.some((pattern) => pattern.test(userInput))
}

/**
 * Get pending reviews formatted for display
 */
export async function getPendingReviewsFormatted(
  maxReviews: number = 3,
): Promise<{
  hasPending: boolean
  count: number
  formatted: string
}> {
  try {
    const feedbackLoop = new LearningFeedbackLoop(Instance.directory)
    await feedbackLoop.initialize()

    const pending = await feedbackLoop.getPendingReviews()

    if (pending.length === 0) {
      return {
        hasPending: false,
        count: 0,
        formatted: "",
      }
    }

    const showCount = Math.min(pending.length, maxReviews)
    const lines = [
      `📋 **Pending Reviews** (${pending.length} total):`,
      "",
    ]

    for (let i = 0; i < showCount; i++) {
      const review = pending[i]
      lines.push(
        `**${i + 1}. ${review.title}**`,
        `   Type: ${review.proposal_type}`,
        `   ID: \`${review.proposal_id}\``,
        `   Created: ${new Date(review.created_at).toLocaleString()}`,
        `   Description: ${review.description.slice(0, 150)}${review.description.length > 150 ? "..." : ""}`,
        "",
        `   Commands: \`approve ${review.proposal_id}\` | \`reject ${review.proposal_id} <reason>\``,
        "",
      )
    }

    if (pending.length > showCount) {
      lines.push(`_...and ${pending.length - showCount} more. Use \`list reviews\` to see all._`)
    }

    return {
      hasPending: true,
      count: pending.length,
      formatted: lines.join("\n"),
    }
  } catch (error) {
    log.error("get_pending_reviews_failed", { error: String(error) })
    return {
      hasPending: false,
      count: 0,
      formatted: "",
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function buildReviewMessage(review: Awaited<ReturnType<typeof LearningFeedbackLoop.prototype.getPendingReviews>>[0], showDetails: boolean): string {
  const lines = [
    `🔍 **Evolution Modification Proposal**`,
    "",
    `**Type:** ${review.proposal_type}`,
    `**Target:** ${review.target_name || review.proposal_id}`,
    `**ID:** \`${review.proposal_id}\``,
    "",
  ]

  if (showDetails) {
    lines.push(
      `**Description:**`,
      review.description,
      "",
      `**Created:** ${new Date(review.created_at).toLocaleString()}`,
      "",
    )
  }

  lines.push(
    `**Actions:**`,
    `- \`approve ${review.proposal_id}\` - Apply this modification`,
    `- \`reject ${review.proposal_id} <reason>\` - Reject with reason`,
    `- \`list reviews\` - Show all pending reviews`,
    "",
    `> Reply with your decision or continue the conversation to defer.`,
  )

  return lines.join("\n")
}

/**
 * Review notification for session start
 */
export async function getReviewNotification(
  maxReviews: number = 3,
): Promise<string | null> {
  const result = await getPendingReviewsFormatted(maxReviews)

  if (!result.hasPending) {
    return null
  }

  return [
    `📬 You have **${result.count}** pending evolution review${result.count > 1 ? "s" : ""}.`,
    "",
    result.formatted,
  ].join("\n")
}

log.info("in_session_review_handler_loaded")
