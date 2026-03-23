/**
 * Tests for Learning → Evolution modification workflow
 *
 * Tests the integration between learning system and evolution code modification:
 * - EvolutionAnalyzer: Analyzes evolution artifacts for issues
 * - LearningToEvolutionModifier: Creates and applies modification proposals
 * - LearningFeedbackLoop: Orchestrates the feedback cycle
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdir, writeFile, rm, access } from "fs/promises"
import { resolve, join } from "path"
import { EvolutionAnalyzer } from "../src/learning/evolution-analyzer"
import { LearningToEvolutionModifier } from "../src/learning/evolution-modifier"
import { LearningFeedbackLoop } from "../src/learning/feedback-loop"
import type { PromptEvolution, SkillEvolution, MemoryEntry } from "../src/evolution/types"

const TEST_DIR = resolve(process.cwd(), "test-fixtures", "learning-evolution")

// Helper to create test evolution files
async function setupEvolutionFiles(
  projectDir: string,
  options?: {
    prompts?: PromptEvolution[]
    skills?: SkillEvolution[]
    memories?: MemoryEntry[]
  },
) {
  const evolutionDir = join(projectDir, ".opencode", "evolution")
  await mkdir(evolutionDir, { recursive: true })

  if (options?.prompts) {
    await writeFile(join(evolutionDir, "prompts.json"), JSON.stringify(options.prompts))
  }

  if (options?.skills) {
    await writeFile(join(evolutionDir, "skills.json"), JSON.stringify(options.skills))
  }

  if (options?.memories) {
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    await writeFile(join(evolutionDir, `memories-${month}.json`), JSON.stringify(options.memories))
  }
}

describe("EvolutionAnalyzer", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  describe("analyzePrompts", () => {
    it("should detect redundant prompts with similar first lines", async () => {
      const prompts: PromptEvolution[] = [
        {
          id: "prompt-1",
          originalPrompt: "You are a helpful assistant\nHelp me with code",
          optimizedPrompt: "You are an expert coder\nHelp me with code",
          reason: "Better specificity",
          sessionID: "session-1",
          usageCount: 5,
          createdAt: Date.now(),
        },
        {
          id: "prompt-2",
          originalPrompt: "You are a helpful assistant\nHelp me write tests",
          optimizedPrompt: "You are a testing expert\nHelp me write tests",
          reason: "Better specificity",
          sessionID: "session-2",
          usageCount: 0,
          createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days ago
        },
      ]

      await setupEvolutionFiles(TEST_DIR, { prompts })

      const analyzer = new EvolutionAnalyzer(TEST_DIR)
      const result = await analyzer.analyzePrompts()

      expect(result.total_prompts).toBe(2)
      expect(result.issues.length).toBeGreaterThan(0)
      expect(result.issues.some((i: any) => i.type === "prompt_redundant")).toBe(true)
    })

    it("should detect outdated prompts with zero usage", async () => {
      const prompts: PromptEvolution[] = [
        {
          id: "prompt-old",
          originalPrompt: "Old prompt",
          optimizedPrompt: "Optimized old",
          reason: "Test",
          sessionID: "session-old",
          usageCount: 0,
          createdAt: Date.now() - 14 * 24 * 60 * 60 * 1000, // 14 days ago
        },
      ]

      await setupEvolutionFiles(TEST_DIR, { prompts })

      const analyzer = new EvolutionAnalyzer(TEST_DIR)
      const result = await analyzer.analyzePrompts()

      expect(result.issues.some((i: any) => i.type === "prompt_outdated")).toBe(true)
    })

    it("should return usage statistics", async () => {
      const prompts: PromptEvolution[] = [
        {
          id: "prompt-high",
          originalPrompt: "High usage",
          optimizedPrompt: "Optimized",
          reason: "Test",
          sessionID: "session-1",
          usageCount: 10,
          createdAt: Date.now(),
        },
        {
          id: "prompt-low",
          originalPrompt: "Low usage",
          optimizedPrompt: "Optimized",
          reason: "Test",
          sessionID: "session-2",
          usageCount: 2,
          createdAt: Date.now(),
        },
        {
          id: "prompt-zero",
          originalPrompt: "Zero usage",
          optimizedPrompt: "Optimized",
          reason: "Test",
          sessionID: "session-3",
          usageCount: 0,
          createdAt: Date.now(),
        },
      ]

      await setupEvolutionFiles(TEST_DIR, { prompts })

      const analyzer = new EvolutionAnalyzer(TEST_DIR)
      const result = await analyzer.analyzePrompts()

      expect(result.usage_stats.high_usage).toBe(1)
      expect(result.usage_stats.low_usage).toBe(1)
      expect(result.usage_stats.zero_usage).toBe(1)
    })
  })

  describe("analyzeSkills", () => {
    it("should detect unused draft skills", async () => {
      const skills: SkillEvolution[] = [
        {
          id: "skill-draft",
          name: "draft-skill",
          description: "A draft skill",
          content: "# Draft Skill\n\nThis is a test skill",
          triggerPatterns: ["test"],
          sessionID: "session-1",
          status: "draft",
          createdAt: Date.now() - 20 * 24 * 60 * 60 * 1000, // 20 days ago
        },
      ]

      await setupEvolutionFiles(TEST_DIR, { skills })

      const analyzer = new EvolutionAnalyzer(TEST_DIR)
      const result = await analyzer.analyzeSkills()

      expect(result.total_skills).toBe(1)
      expect(result.issues.some((i: any) => i.type === "skill_unused")).toBe(true)
    })

    it("should detect code quality issues in skills", async () => {
      const skills: SkillEvolution[] = [
        {
          id: "skill-bad-code",
          name: "bad-code-skill",
          description: "Skill with bad code",
          content: `# Bad Code Skill

\`\`\`typescript
function test() {
  console.log("debug")
  const x: any = 1
  // TODO: fix this
}
\`\`\``,
          triggerPatterns: ["test"],
          sessionID: "session-1",
          status: "approved",
          createdAt: Date.now(),
        },
      ]

      await setupEvolutionFiles(TEST_DIR, { skills })

      const analyzer = new EvolutionAnalyzer(TEST_DIR)
      const result = await analyzer.analyzeSkills()

      expect(result.issues.some((i: any) => i.type === "skill_code_quality")).toBe(true)
    })
  })

  describe("analyzeMemories", () => {
    it("should detect duplicate memories with same key", async () => {
      const now = new Date()
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
      const memories: MemoryEntry[] = [
        {
          id: "mem-1",
          key: "typescript-tips",
          value: "Use strict mode",
          context: "TS config",
          sessionIDs: ["session-1"],
          usageCount: 5,
          lastUsedAt: Date.now(),
          createdAt: Date.now(),
          sensitive: false,
          encrypted: false,
          archived: false,
        },
        {
          id: "mem-2",
          key: "typescript-tips",
          value: "Enable noImplicitAny",
          context: "TS config",
          sessionIDs: ["session-2"],
          usageCount: 3,
          lastUsedAt: Date.now(),
          createdAt: Date.now(),
          sensitive: false,
          encrypted: false,
          archived: false,
        },
        {
          id: "mem-3",
          key: "typescript-tips",
          value: "Use interfaces",
          context: "TS config",
          sessionIDs: ["session-3"],
          usageCount: 2,
          lastUsedAt: Date.now(),
          createdAt: Date.now(),
          sensitive: false,
          encrypted: false,
          archived: false,
        },
        {
          id: "mem-4",
          key: "typescript-tips",
          value: "Generic types",
          context: "TS config",
          sessionIDs: ["session-4"],
          usageCount: 1,
          lastUsedAt: Date.now(),
          createdAt: Date.now(),
          sensitive: false,
          encrypted: false,
          archived: false,
        },
      ]

      await setupEvolutionFiles(TEST_DIR, { memories })

      const analyzer = new EvolutionAnalyzer(TEST_DIR)
      const result = await analyzer.analyzeMemories()

      expect(result.total_memories).toBe(4)
      expect(result.issues.some((i: any) => i.type === "memory_duplicate")).toBe(true)
    })

    it("should detect stale memories", async () => {
      const now = new Date()
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
      const memories: MemoryEntry[] = [
        {
          id: "mem-stale",
          key: "old-tip",
          value: "Old advice",
          context: "Old context",
          sessionIDs: ["session-old"],
          usageCount: 1,
          lastUsedAt: Date.now() - 100 * 24 * 60 * 60 * 1000, // 100 days ago
          createdAt: Date.now() - 100 * 24 * 60 * 60 * 1000,
          sensitive: false,
          encrypted: false,
          archived: false,
        },
      ]

      await setupEvolutionFiles(TEST_DIR, { memories })

      const analyzer = new EvolutionAnalyzer(TEST_DIR)
      const result = await analyzer.analyzeMemories()

      expect(result.issues.some((i: any) => i.type === "memory_stale")).toBe(true)
    })
  })

  describe("prioritizeIssues", () => {
    it("should sort issues by severity and type", () => {
      const issues = [
        { type: "memory_stale" as const, severity: "low" as const, artifact_type: "memory" as const, artifact_id: "1", message: "stale" },
        { type: "skill_code_quality" as const, severity: "medium" as const, artifact_type: "skill" as const, artifact_id: "2", message: "bad code" },
        { type: "prompt_redundant" as const, severity: "low" as const, artifact_type: "prompt" as const, artifact_id: "3", message: "redundant" },
      ]

      const prioritized = EvolutionAnalyzer.prioritizeIssues(issues)

      // Medium severity should come first
      expect(prioritized[0].type).toBe("skill_code_quality")
    })
  })
})

describe("LearningToEvolutionModifier", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  describe("createProposal", () => {
    it("should create a modification proposal", async () => {
      const modifier = new LearningToEvolutionModifier(TEST_DIR)
      await modifier.init()

      const proposal = await modifier.createProposal({
        type: "prompt_optimization",
        target_id: "prompt-123",
        target_name: "Test Prompt",
        changes: {
          optimizedPrompt: "New optimized prompt",
          originalPrompt: "Original prompt",
        },
        reason: "Learning identified better phrasing",
      })

      expect(proposal.id).toBeDefined()
      expect(proposal.type).toBe("prompt_optimization")
      expect(proposal.status).toBe("draft")
      expect(proposal.target_id).toBe("prompt-123")
    })

    it("should save proposal to file", async () => {
      const modifier = new LearningToEvolutionModifier(TEST_DIR)
      await modifier.init()

      const proposal = await modifier.createProposal({
        type: "memory_compress",
        target_id: "mem-1",
        target_name: "test-key",
        changes: { compress_with: ["mem-2", "mem-3"] },
        reason: "Duplicate memories detected",
      })

      const proposalsDir = join(TEST_DIR, ".opencode", "evolution", "proposals")
      const proposalFile = join(proposalsDir, `${proposal.id}.json`)

      await expect(access(proposalFile)).resolves.toBeUndefined()
    })
  })

  describe("getProposals", () => {
    it("should retrieve all proposals", async () => {
      const modifier = new LearningToEvolutionModifier(TEST_DIR)
      await modifier.init()

      await modifier.createProposal({
        type: "prompt_optimization",
        target_id: "prompt-1",
        changes: { optimizedPrompt: "test" },
        reason: "test",
      })

      await modifier.createProposal({
        type: "skill_code_fix",
        target_id: "skill-1",
        changes: { fix_type: "test" },
        reason: "test",
      })

      const proposals = await modifier.getProposals()
      expect(proposals.length).toBe(2)
    })

    it("should filter proposals by status", async () => {
      const modifier = new LearningToEvolutionModifier(TEST_DIR)
      await modifier.init()

      const draftProposal = await modifier.createProposal({
        type: "prompt_optimization",
        target_id: "prompt-1",
        changes: {},
        reason: "test",
      })

      const proposals = await modifier.getProposals("draft")
      expect(proposals.some((p: any) => p.id === draftProposal.id)).toBe(true)

      const applied = await modifier.getProposals("applied")
      expect(applied.length).toBe(0)
    })
  })

  describe("autoGenerateProposals", () => {
    it("should generate proposals from evolution analysis", async () => {
      // Setup evolution files with issues
      const prompts: PromptEvolution[] = [
        {
          id: "prompt-old",
          originalPrompt: "Old prompt",
          optimizedPrompt: "Optimized",
          reason: "Test",
          sessionID: "session-1",
          usageCount: 0,
          createdAt: Date.now() - 14 * 24 * 60 * 60 * 1000,
        },
      ]

      await setupEvolutionFiles(TEST_DIR, { prompts })

      const modifier = new LearningToEvolutionModifier(TEST_DIR)
      await modifier.init()

      const proposals = await modifier.autoGenerateProposals({ minSeverity: "low" })

      expect(proposals.length).toBeGreaterThan(0)
      expect(proposals[0].type).toMatch(/prompt_|memory_|skill_/)
    })
  })
})

describe("LearningFeedbackLoop", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  describe("runCycle", () => {
    it("should complete a full feedback cycle", async () => {
      // Setup evolution files with issues
      const prompts: PromptEvolution[] = [
        {
          id: "prompt-issue",
          originalPrompt: "Prompt with issue",
          optimizedPrompt: "Optimized",
          reason: "Test",
          sessionID: "session-1",
          usageCount: 0,
          createdAt: Date.now() - 14 * 24 * 60 * 60 * 1000,
        },
      ]

      await setupEvolutionFiles(TEST_DIR, { prompts })

      const feedbackLoop = new LearningFeedbackLoop(TEST_DIR, {
        autoGenerateProposals: true,
        minSeverity: "low",
        maxProposalsPerCycle: 5,
        requireHumanReview: false, // Skip review for testing
      })

      await feedbackLoop.initialize()
      const result = await feedbackLoop.runCycle()

      expect(result.issues_analyzed).toBeGreaterThan(0)
      expect(result.proposals_created).toBeGreaterThanOrEqual(0)
    })

    it("should track errors without crashing", async () => {
      const feedbackLoop = new LearningFeedbackLoop(TEST_DIR)
      await feedbackLoop.initialize()

      const result = await feedbackLoop.runCycle()

      // Should complete even with no evolution files
      expect(result).toBeDefined()
    })
  })

  describe("processLearningInsight", () => {
    it("should convert insight to proposal", async () => {
      const feedbackLoop = new LearningFeedbackLoop(TEST_DIR, {
        requireHumanReview: false,
      })
      await feedbackLoop.initialize()

      const insight = {
        type: "improvement" as const,
        category: "prompt" as const,
        description: "Better prompt phrasing identified",
        evidence: "Analysis of 100 sessions",
        severity: "medium" as const,
        suggested_action: "Use more specific instructions",
        metadata: {
          prompt_id: "prompt-123",
          original_prompt: "Original prompt",
        },
      }

      const proposal = await feedbackLoop.processLearningInsight(insight)

      expect(proposal).toBeDefined()
      expect(proposal?.type).toBe("prompt_optimization")
    })

    it("should return null for unsupported insight types", async () => {
      const feedbackLoop = new LearningFeedbackLoop(TEST_DIR)
      await feedbackLoop.initialize()

      const insight = {
        type: "anomaly" as const,
        category: "code_quality" as const,
        description: "Unknown category",
        evidence: "test",
        severity: "low" as const,
      }

      const proposal = await feedbackLoop.processLearningInsight(insight)

      expect(proposal).toBeNull()
    })
  })

  describe("getStats", () => {
    it("should return feedback loop statistics", async () => {
      const feedbackLoop = new LearningFeedbackLoop(TEST_DIR)
      await feedbackLoop.initialize()

      const stats = await feedbackLoop.getStats()

      expect(stats.total_proposals).toBeDefined()
      expect(stats.by_status).toBeDefined()
      expect(stats.pending_reviews).toBeDefined()
      expect(stats.applied_count).toBeDefined()
    })
  })
})
