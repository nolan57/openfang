/**
 * Evolution Code Analyzer
 *
 * Analyzes evolution artifacts (prompts, skills, memories) to identify improvement opportunities.
 * Used by the learning system to propose modifications to evolution code.
 *
 * @example
 * ```typescript
 * const analyzer = new EvolutionAnalyzer(projectDir)
 * const issues = await analyzer.analyzePrompts()
 * const skillIssues = await analyzer.analyzeSkills()
 * ```
 */

import { readFile, access, readdir } from "fs/promises"
import { resolve, join } from "path"
import { Log } from "../util/log"
import { withSpan, spanAttrs } from "./tracing"
import type { PromptEvolution, SkillEvolution, MemoryEntry } from "../evolution/types"

const log = Log.create({ service: "evolution-analyzer" })

const EVOLUTION_DIR = ".opencode/evolution"
const SKILLS_DIR = ".opencode/skills"

// ============================================================================
// Issue Types
// ============================================================================

export type EvolutionIssueType =
  | "prompt_redundant"
  | "prompt_outdated"
  | "prompt_ineffective"
  | "skill_unused"
  | "skill_ineffective"
  | "skill_code_quality"
  | "memory_duplicate"
  | "memory_contradiction"
  | "memory_stale"

export interface EvolutionIssue {
  type: EvolutionIssueType
  severity: "low" | "medium" | "high"
  artifact_type: "prompt" | "skill" | "memory"
  artifact_id: string
  artifact_name?: string
  message: string
  evidence?: string
  suggestion?: string
  related_artifacts?: string[]
}

export interface PromptAnalysis {
  total_prompts: number
  issues: EvolutionIssue[]
  usage_stats: {
    high_usage: number
    low_usage: number
    zero_usage: number
  }
}

export interface SkillAnalysis {
  total_skills: number
  issues: EvolutionIssue[]
  status_breakdown: {
    draft: number
    approved: number
    rejected: number
  }
}

export interface MemoryAnalysis {
  total_memories: number
  issues: EvolutionIssue[]
  archive_stats: {
    active: number
    archived: number
  }
}

// ============================================================================
// EvolutionAnalyzer
// ============================================================================

export class EvolutionAnalyzer {
  private projectDir: string
  private evolutionDir: string
  private skillsDir: string

  constructor(projectDir: string) {
    this.projectDir = projectDir
    this.evolutionDir = resolve(projectDir, EVOLUTION_DIR)
    this.skillsDir = resolve(projectDir, SKILLS_DIR)
  }

  /**
   * Analyze all evolution artifacts and return issues
   */
  async analyzeAll(): Promise<{
    prompts: PromptAnalysis
    skills: SkillAnalysis
    memories: MemoryAnalysis
    total_issues: number
  }> {
    return withSpan(
      "learning.evolution_analyzer.analyze_all",
      async (span) => {
        const [prompts, skills, memories] = await Promise.all([
          this.analyzePrompts(),
          this.analyzeSkills(),
          this.analyzeMemories(),
        ])

        const totalIssues = prompts.issues.length + skills.issues.length + memories.issues.length

        span.setAttributes({
          ...spanAttrs.count(totalIssues),
          "prompts.total": prompts.total_prompts,
          "skills.total": skills.total_skills,
          "memories.total": memories.total_memories,
        })

        log.info("evolution_analysis_complete", {
          total_issues: totalIssues,
          prompts: prompts.issues.length,
          skills: skills.issues.length,
          memories: memories.issues.length,
        })

        return {
          prompts,
          skills,
          memories,
          total_issues: totalIssues,
        }
      },
    )
  }

  /**
   * Analyze prompt evolutions for issues
   */
  async analyzePrompts(): Promise<PromptAnalysis> {
    return withSpan(
      "learning.evolution_analyzer.analyze_prompts",
      async (span) => {
        const promptsPath = resolve(this.evolutionDir, "prompts.json")
        const issues: EvolutionIssue[] = []

        try {
          const content = await readFile(promptsPath, "utf-8")
          const prompts = JSON.parse(content) as PromptEvolution[]

          // Group by similarity to find redundancies
          const grouped = this.groupSimilarPrompts(prompts)

          for (const [group, similar] of grouped) {
            if (similar.length > 1) {
              // Found redundant prompts
              const lowUsage = similar.filter((p) => p.usageCount === 0)
              for (const prompt of lowUsage) {
                issues.push({
                  type: "prompt_redundant",
                  severity: "low",
                  artifact_type: "prompt",
                  artifact_id: prompt.id,
                  artifact_name: prompt.originalPrompt.slice(0, 30),
                  message: `Prompt is similar to ${similar.find((p) => p.id !== prompt.id)?.originalPrompt.slice(0, 30)}`,
                  evidence: `Similarity group: ${group}`,
                  suggestion: "Consider merging with similar prompt or removing if unused",
                  related_artifacts: similar.filter((p) => p.id !== prompt.id).map((p) => p.id),
                })
              }
            }
          }

          // Check for zero-usage prompts
          const zeroUsage = prompts.filter((p) => p.usageCount === 0 && p.createdAt < Date.now() - 7 * 24 * 60 * 60 * 1000)
          for (const prompt of zeroUsage) {
            issues.push({
              type: "prompt_outdated",
              severity: "low",
              artifact_type: "prompt",
              artifact_id: prompt.id,
              artifact_name: prompt.originalPrompt.slice(0, 30),
              message: "Prompt has zero usage after 7 days",
              suggestion: "Review if prompt is still relevant or remove",
            })
          }

          const highUsage = prompts.filter((p) => p.usageCount >= 5).length
          const lowUsage = prompts.filter((p) => p.usageCount > 0 && p.usageCount < 5).length
          const zeroUsageCount = prompts.filter((p) => p.usageCount === 0).length

          span.setAttributes({
            "prompts.total": prompts.length,
            "prompts.issues": issues.length,
            "prompts.high_usage": highUsage,
            "prompts.low_usage": lowUsage,
            "prompts.zero_usage": zeroUsageCount,
          })

          return {
            total_prompts: prompts.length,
            issues,
            usage_stats: {
              high_usage: highUsage,
              low_usage: lowUsage,
              zero_usage: zeroUsageCount,
            },
          }
        } catch (error) {
          log.warn("analyze_prompts_failed", { error: String(error) })
          return {
            total_prompts: 0,
            issues: [],
            usage_stats: {
              high_usage: 0,
              low_usage: 0,
              zero_usage: 0,
            },
          }
        }
      },
    )
  }

  /**
   * Analyze skill evolutions for issues
   */
  async analyzeSkills(): Promise<SkillAnalysis> {
    return withSpan(
      "learning.evolution_analyzer.analyze_skills",
      async (span) => {
        const skillsPath = resolve(this.evolutionDir, "skills.json")
        const issues: EvolutionIssue[] = []

        try {
          const content = await readFile(skillsPath, "utf-8")
          const skills = JSON.parse(content) as SkillEvolution[]

          // Check for unused draft skills
          const oldDrafts = skills.filter(
            (s) => s.status === "draft" && s.createdAt < Date.now() - 14 * 24 * 60 * 60 * 1000,
          )
          for (const skill of oldDrafts) {
            issues.push({
              type: "skill_unused",
              severity: "medium",
              artifact_type: "skill",
              artifact_id: skill.id,
              artifact_name: skill.name,
              message: "Draft skill pending review for 14+ days",
              suggestion: "Review and approve/reject or extend review period",
            })
          }

          // Check for rejected skills that might be worth revisiting
          const rejected = skills.filter(
            (s) => s.status === "rejected" && s.createdAt > Date.now() - 30 * 24 * 60 * 60 * 1000,
          )
          for (const skill of rejected) {
            issues.push({
              type: "skill_ineffective",
              severity: "low",
              artifact_type: "skill",
              artifact_id: skill.id,
              artifact_name: skill.name,
              message: "Skill was rejected - consider if requirements have changed",
              suggestion: "Review rejection reason and current needs",
            })
          }

          // Analyze approved skill code quality
          const approved = skills.filter((s) => s.status === "approved")
          for (const skill of approved) {
            const codeIssues = this.analyzeSkillCode(skill.content)
            for (const codeIssue of codeIssues) {
              issues.push({
                ...codeIssue,
                artifact_id: skill.id,
                artifact_name: skill.name,
                related_artifacts: [skill.id],
              })
            }
          }

          const draftCount = skills.filter((s) => s.status === "draft").length
          const approvedCount = skills.filter((s) => s.status === "approved").length
          const rejectedCount = skills.filter((s) => s.status === "rejected").length

          span.setAttributes({
            "skills.total": skills.length,
            "skills.issues": issues.length,
            "skills.draft": draftCount,
            "skills.approved": approvedCount,
            "skills.rejected": rejectedCount,
          })

          return {
            total_skills: skills.length,
            issues,
            status_breakdown: {
              draft: draftCount,
              approved: approvedCount,
              rejected: rejectedCount,
            },
          }
        } catch (error) {
          log.warn("analyze_skills_failed", { error: String(error) })
          return {
            total_skills: 0,
            issues: [],
            status_breakdown: {
              draft: 0,
              approved: 0,
              rejected: 0,
            },
          }
        }
      },
    )
  }

  /**
   * Analyze memory entries for issues
   */
  async analyzeMemories(): Promise<MemoryAnalysis> {
    return withSpan(
      "learning.evolution_analyzer.analyze_memories",
      async (span) => {
        const issues: EvolutionIssue[] = []

        try {
          // Find memory files
          const files = await readdir(this.evolutionDir)
          const memoryFiles = files.filter((f) => f.startsWith("memories-") && f.endsWith(".json"))

          const allMemories: MemoryEntry[] = []
          for (const file of memoryFiles) {
            const content = await readFile(resolve(this.evolutionDir, file), "utf-8")
            const memories = JSON.parse(content) as MemoryEntry[]
            allMemories.push(...memories)
          }

          // Check for duplicate keys
          const keyGroups = new Map<string, MemoryEntry[]>()
          for (const memory of allMemories) {
            const group = keyGroups.get(memory.key) || []
            group.push(memory)
            keyGroups.set(memory.key, group)
          }

          for (const [key, memories] of keyGroups) {
            if (memories.length > 3) {
              // Found potential duplicates
              const older = memories.sort((a, b) => a.createdAt - b.createdAt).slice(0, -1)
              for (const memory of older) {
                issues.push({
                  type: "memory_duplicate",
                  severity: "low",
                  artifact_type: "memory",
                  artifact_id: memory.id,
                  artifact_name: memory.key,
                  message: `Memory key '${key}' has ${memories.length} entries`,
                  suggestion: "Consider compressing similar memories",
                  related_artifacts: memories.filter((m) => m.id !== memory.id).map((m) => m.id),
                })
              }
            }
          }

          // Check for stale memories (unused for 90+ days)
          const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000
          const staleMemories = allMemories.filter(
            (m) => m.lastUsedAt < ninetyDaysAgo && !m.archived && m.usageCount < 3,
          )
          for (const memory of staleMemories) {
            issues.push({
              type: "memory_stale",
              severity: "low",
              artifact_type: "memory",
              artifact_id: memory.id,
              artifact_name: memory.key,
              message: "Memory unused for 90+ days",
              suggestion: "Consider archiving or deleting",
            })
          }

          const activeCount = allMemories.filter((m) => !m.archived).length
          const archivedCount = allMemories.filter((m) => m.archived).length

          span.setAttributes({
            "memories.total": allMemories.length,
            "memories.issues": issues.length,
            "memories.active": activeCount,
            "memories.archived": archivedCount,
          })

          return {
            total_memories: allMemories.length,
            issues,
            archive_stats: {
              active: activeCount,
              archived: archivedCount,
            },
          }
        } catch (error) {
          log.warn("analyze_memories_failed", { error: String(error) })
          return {
            total_memories: 0,
            issues: [],
            archive_stats: {
              active: 0,
              archived: 0,
            },
          }
        }
      },
    )
  }

  /**
   * Group similar prompts by first line similarity
   */
  private groupSimilarPrompts(prompts: PromptEvolution[]): Map<string, PromptEvolution[]> {
    const groups = new Map<string, PromptEvolution[]>()

    for (const prompt of prompts) {
      const firstLine = prompt.originalPrompt.split("\n")[0].toLowerCase().trim()
      const key = firstLine.slice(0, 50)
      const group = groups.get(key) || []
      group.push(prompt)
      groups.set(key, group)
    }

    return groups
  }

  /**
   * Analyze skill code for quality issues
   */
  private analyzeSkillCode(code: string): EvolutionIssue[] {
    const issues: EvolutionIssue[] = []

    // Check for console.log
    if (code.includes("console.log")) {
      issues.push({
        type: "skill_code_quality",
        severity: "medium",
        artifact_type: "skill",
        artifact_id: "",
        message: "Skill code contains console.log statements",
        suggestion: "Use proper logging (Log from util/log)",
      })
    }

    // Check for TODO comments
    if (code.includes("// TODO") || code.includes("// FIXME")) {
      issues.push({
        type: "skill_code_quality",
        severity: "low",
        artifact_type: "skill",
        artifact_id: "",
        message: "Skill code contains TODO/FIXME comments",
        suggestion: "Address or document the TODO items",
      })
    }

    // Check for :any types
    if (code.includes(": any") || code.includes(":any")) {
      issues.push({
        type: "skill_code_quality",
        severity: "medium",
        artifact_type: "skill",
        artifact_id: "",
        message: "Skill code uses 'any' type",
        suggestion: "Use specific types or 'unknown'",
      })
    }

    return issues
  }

  /**
   * Get issue severity score for prioritization
   */
  static getSeverityScore(severity: EvolutionIssue["severity"]): number {
    switch (severity) {
      case "high":
        return 3
      case "medium":
        return 2
      case "low":
        return 1
    }
  }

  /**
   * Prioritize issues by severity and type
   */
  static prioritizeIssues(issues: EvolutionIssue[]): EvolutionIssue[] {
    return issues.sort((a, b) => {
      const severityDiff = EvolutionAnalyzer.getSeverityScore(b.severity) - EvolutionAnalyzer.getSeverityScore(a.severity)
      if (severityDiff !== 0) return severityDiff

      // Within same severity, prioritize certain types
      const typePriority: Record<EvolutionIssueType, number> = {
        memory_contradiction: 5,
        skill_code_quality: 4,
        prompt_ineffective: 4,
        skill_ineffective: 4,
        memory_duplicate: 3,
        prompt_redundant: 2,
        skill_unused: 2,
        memory_stale: 1,
        prompt_outdated: 1,
      }

      return (typePriority[b.type] || 0) - (typePriority[a.type] || 0)
    })
  }
}

log.info("evolution_analyzer_loaded")
