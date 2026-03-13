/**
 * Scheduler type definitions
 */

/**
 * Schedule configuration types
 */
export type CronSchedule =
  | { kind: "cron"; expr: string; tz?: string }
  | { kind: "interval"; everyMs: number; anchorMs?: number }
  | { kind: "once"; atMs: number }

/**
 * Job payload types
 */
export type CronPayloadKind = "agentTurn" | "systemEvent"

export type CronPayload = {
  kind: CronPayloadKind
  message: string
  /** Whether to deliver results to notification channel */
  deliver?: boolean
  /** Notification channel */
  channel?: string
  /** Recipient */
  to?: string
  /** Model to use for agent */
  model?: string
}

/**
 * Job execution options
 */
export type JobOptions = {
  /** Delete after successful run */
  deleteAfterRun?: boolean
  /** Enable retries */
  retry?: boolean
  /** Max retry count */
  maxRetries?: number
  /** Timeout in milliseconds */
  timeoutMs?: number
  /** Requires approval */
  requiresApproval?: boolean
}

/**
 * Execution status
 */
export type ExecutionStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "paused"
  | "cancelled"

/**
 * Job status
 */
export type JobStatus = "enabled" | "disabled"