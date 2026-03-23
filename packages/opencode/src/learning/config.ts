import { z } from "zod"

export const LearningSource = z.enum(["search", "arxiv", "github", "blogs", "pypi"])
export type LearningSource = z.infer<typeof LearningSource>

export const LearningSchedule = z.object({
  cron: z.string().optional(),
  idle_check: z.boolean(),
  idle_threshold_minutes: z.number(),
})
export type LearningSchedule = z.infer<typeof LearningSchedule>

/**
 * Automation Level Control
 * [EVOLUTION]: Three-tier automation system for human-AI collaboration
 * - L1 (Suggest): AI only suggests changes, human must review and apply
 * - L2 (Test): AI can auto-test changes, human approves deployment
 * - L3 (Deploy): AI can auto-deploy low-risk changes, high-risk requires review
 */
export const AutomationLevel = z.enum(["L1", "L2", "L3"])
export type AutomationLevel = z.infer<typeof AutomationLevel>

export const AutomationConfig = z.object({
  level: AutomationLevel,
  enabled: z.boolean().default(true),
  requireHumanReviewFor: z.array(z.string()).default(["skill_install", "config_change", "dependency_change"]),
  autoApprovePatterns: z.array(z.string()).default(["documentation", "comment_fix", "formatting"]),
  maxLinesPerAutoChange: z.number().default(50),
  maxFilesPerAutoChange: z.number().default(5),
  riskThreshold: z.object({
    low: z.number().default(0.3),
    medium: z.number().default(0.6),
    high: z.number().default(0.8),
  }),
  cooldown: z.object({
    betweenChanges: z.number().default(5 * 60 * 1000),
    afterFailure: z.number().default(60 * 60 * 1000),
  }),
})
export type AutomationConfig = z.infer<typeof AutomationConfig>

export const defaultAutomationConfig: AutomationConfig = {
  level: "L2",
  enabled: true,
  requireHumanReviewFor: ["skill_install", "config_change", "dependency_change"],
  autoApprovePatterns: ["documentation", "comment_fix", "formatting"],
  maxLinesPerAutoChange: 50,
  maxFilesPerAutoChange: 5,
  riskThreshold: {
    low: 0.3,
    medium: 0.6,
    high: 0.8,
  },
  cooldown: {
    betweenChanges: 5 * 60 * 1000,
    afterFailure: 60 * 60 * 1000,
  },
}

export const LearningConfig = z.object({
  enabled: z.boolean(),
  schedule: LearningSchedule,
  sources: z.array(LearningSource),
  topics: z.array(z.string()),
  max_items_per_run: z.number(),
  note_output_dir: z.string(),
  spec_file: z.string().optional(),
  automation: AutomationConfig.optional(),
})
export type LearningConfig = z.infer<typeof LearningConfig>

export const defaultLearningConfig: LearningConfig = {
  enabled: true,
  schedule: {
    cron: undefined,
    idle_check: true,
    idle_threshold_minutes: 30,
  },
  sources: ["search", "arxiv", "github"],
  topics: ["AI", "code generation", "agent systems"],
  max_items_per_run: 10,
  note_output_dir: "docs/learning/notes",
  automation: defaultAutomationConfig,
}

/**
 * Helper to check if an action requires human review based on automation level
 */
export function requiresHumanReview(
  actionType: string,
  riskLevel: "low" | "medium" | "high",
  config: AutomationConfig,
): boolean {
  if (!config.enabled) {
    return true
  }

  if (config.requireHumanReviewFor.includes(actionType)) {
    return true
  }

  if (config.level === "L1") {
    return true
  }

  if (config.level === "L2" && riskLevel === "high") {
    return true
  }

  if (config.level === "L3" && (riskLevel === "high" || riskLevel === "medium")) {
    return riskLevel === "high"
  }

  return false
}

/**
 * Helper to determine if an auto-change is allowed
 */
export function canAutoChange(
  linesChanged: number,
  filesChanged: number,
  config: AutomationConfig,
): { allowed: boolean; reason: string } {
  if (!config.enabled) {
    return { allowed: false, reason: "Automation disabled" }
  }

  if (linesChanged > config.maxLinesPerAutoChange) {
    return {
      allowed: false,
      reason: `Lines changed (${linesChanged}) exceeds limit (${config.maxLinesPerAutoChange})`,
    }
  }

  if (filesChanged > config.maxFilesPerAutoChange) {
    return {
      allowed: false,
      reason: `Files changed (${filesChanged}) exceeds limit (${config.maxFilesPerAutoChange})`,
    }
  }

  return { allowed: true, reason: "Change within auto-approval limits" }
}

/**
 * Helper to calculate risk level based on change characteristics
 */
export function calculateRiskLevel(changes: {
  linesChanged: number
  filesChanged: number
  isCoreFile: boolean
  isConfigFile: boolean
  isDependencyChange: boolean
}): "low" | "medium" | "high" {
  let riskScore = 0

  if (changes.linesChanged > 100) riskScore += 0.3
  if (changes.linesChanged > 500) riskScore += 0.3

  if (changes.filesChanged > 5) riskScore += 0.2
  if (changes.filesChanged > 20) riskScore += 0.3

  if (changes.isCoreFile) riskScore += 0.3
  if (changes.isConfigFile) riskScore += 0.3
  if (changes.isDependencyChange) riskScore += 0.4

  if (riskScore >= 0.8) return "high"
  if (riskScore >= 0.5) return "medium"
  return "low"
}
