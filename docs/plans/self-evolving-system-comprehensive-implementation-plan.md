# OpenCodeClaw Self-Evolving System: Comprehensive Implementation Plan

> **Document Version:** 1.0
> **Created:** 2026-03-04
> **Based on:** docs/evolving-system/* vision documents + existing codebase analysis

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current System Analysis](#current-system-analysis)
3. [Architecture Overview](#architecture-overview)
4. [Phase 1: Passive Observer](#phase-1-passive-observer)
5. [Phase 2: Controlled Experimenter](#phase-2-controlled-experimenter)
6. [Phase 3: Limited Autonomist](#phase-3-limited-autonomist)
7. [Phase 4: Full Self-Evolution](#phase-4-full-self-evolution)
8. [Safety & Risk Mitigation](#safety--risk-mitigation)
9. [File Implementation Guide](#file-implementation-guide)
10. [Testing Strategy](#testing-strategy)

---

## Executive Summary

This document outlines a comprehensive implementation plan for transforming OpenCodeClaw into a self-evolving digital organism. The system will autonomously monitor technology trends, evaluate improvements, safely refactor its own codebase, and continuously verify evolutionary outcomes.

**Key Goals:**
- Break the static software paradigm → create a "lifelong learning developer"
- Leverage existing LRC (Long-Range Consistency) and memory systems
- Implement rigorous safety gates (Critic Agent) to prevent runaway automation
- Enable compound growth where each evolution makes future evolutions more effective

---

## Current System Analysis

### What Already Exists

Based on codebase analysis of `packages/opencode/src/`:

#### Evolution Foundation (packages/opencode/src/evolution/)

| File | Purpose | Status |
|------|---------|--------|
| `evolution/types.ts` | Zod schemas for PromptEvolution, SkillEvolution, MemoryEntry | ✅ Implemented |
| `evolution/store.ts` | File-based persistence for evolutions, skills, memories | ✅ Implemented |
| `evolution/memory.ts` | Memory extraction (keyword + LLM), retrieval, relevance scoring | ✅ Implemented |
| `evolution/prompt.ts` | Session reflection for prompt optimization | ✅ Implemented |
| `evolution/skill.ts` | Skill generation from task patterns, approval workflow | ✅ Implemented |
| `evolution/index.ts` | Module exports | ✅ Implemented |

#### Agent System (packages/opencode/src/agent/)

| File | Purpose | Status |
|------|---------|--------|
| `agent/agent.ts` | Agent definitions (build, plan, explore, general, etc.) | ✅ Implemented |
| `agent/agent.ts:76-203` | Built-in agents with permission systems | ✅ Implemented |

#### Tool System (packages/opencode/src/tool/)

| Tool | Purpose | Status |
|------|---------|--------|
| `tool/websearch.ts` | Web search via Exa AI | ✅ Implemented |
| `tool/codesearch.ts` | Code search via Exa Code API | ✅ Implemented |
| `tool/memory.ts` | Memory search tool | ✅ Implemented |
| `tool/task.ts` | Subagent spawning | ✅ Implemented |
| `tool/plan.ts` | Plan mode entry/exit | ✅ Implemented |

#### Storage System

- **Location:** `.opencode/evolution/` (project-relative)
- **Files:**
  - `prompts.json` - Prompt evolution history
  - `skills.json` - Generated skills (draft/approved/rejected)
  - `memories-YYYY-MM.json` - Monthly memory archives

### Current Architecture Flow

```
Session Complete
       ↓
┌──────────────────┐
│  Memory Extract  │  ← Keyword patterns + LLM
└────────┬─────────┘
         ↓
┌──────────────────┐
│   Save to Store  │  → .opencode/evolution/
└────────┬─────────┘
         ↓
┌──────────────────┐
│ Skill Generation │  → Draft skills for approval
└────────┬─────────┘
         ↓
Next Session Start
       ↓
┌──────────────────┐
│ Memory Retrieval │  → Relevant memories injected
└──────────────────┘
```

### Gaps vs. Vision

| Vision Requirement | Current State | Gap |
|-------------------|---------------|-----|
| **Research Agent (Scout)** | websearch/codesearch tools exist, but no autonomous scheduled scanning | Need agent + scheduling |
| **Architect Agent (Judge)** | No feasibility evaluation, risk assessment | Need new agent |
| **Engineer Agent (Builder)** | No isolated branch creation, atomic commits | Need new agent |
| **Critic Agent (Guardian)** | No benchmark comparison, security scanning | Need new agent |
| **Negative Memory** | Only positive memories stored | Need failure tracking |
| **Circuit Breaker** | No cooldown, retry limits | Need safety system |
| **Golden Snapshot** | No git tag management for revert | Need snapshot system |
| **Tech Trend Reports** | No scheduled arXiv/GitHub scanning | Need reporter |
| **Constitutional AI** | No hard-coded safety rules | Need constitution layer |

---

## Architecture Overview

### Four-Layer Agent Swarm

```
┌─────────────────────────────────────────────────────────────────┐
│                    LRC-Driven Memory System                     │
│         (.opencode/evolution/ + architecture.md)                │
└─────────────────────────────────────────────────────────────────┘
                              ↑
┌─────────────────────────────────────────────────────────────────┐
│ Layer 4: The Critic (Guardian) - Verification & Safety         │
│   - Full test suite execution                                   │
│   - Benchmark comparison (must prove >5% improvement)           │
│   - Security audit (SAST)                                        │
│   - Visual/logic regression                                      │
└─────────────────────────────────────────────────────────────────┘
                              ↑
┌─────────────────────────────────────────────────────────────────┐
│ Layer 3: The Engineer (Builder) - Safe Execution               │
│   - Isolated git branch (feat/auto-evolve-{timestamp})          │
│   - Context-aware coding (type safety, imports)                  │
│   - Atomic commits                                               │
│   - Docker/sandbox isolation                                     │
└─────────────────────────────────────────────────────────────────┘
                              ↑
┌─────────────────────────────────────────────────────────────────┐
│ Layer 2: The Architect (Judge) - Evaluation & Planning          │
│   - Consistency check (vs architecture.md + negative memories)   │
│   - Risk assessment (impact analysis)                           │
│   - Plan generation (files to modify, rollback strategy)        │
│   - Decision gate (low risk → auto, high risk → PR)              │
└─────────────────────────────────────────────────────────────────┘
                              ↑
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1: The Researcher (Scout) - Discovery & Filtering         │
│   - Scheduled triggers (daily/weekly)                            │
│   - Multi-source search (arXiv, GitHub, PyPI, StackOverflow)    │
│   - Relevance scoring against code bottlenecks                  │
│   - Output: Research Proposal with evidence                     │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
[External Tech World] → [Researcher] → [Architect] → [Engineer] → [Critic]
                              ↓                                       ↓
                    [Negative Memory]                        [Merge to Main]
                              ↓                                       ↓
                    [LRC Memory System] ←──────────────────── [Positive Memory]
```

---

## Phase 1: Passive Observer

**Timeline:** Weeks 1-4  
**Goal:** Build trust through observation, no code modifications

### Objectives

1. Deploy Researcher agent for continuous tech monitoring
2. Generate daily/weekly innovation reports for human review
3. Initialize negative memory bank
4. Build architecture specification library

### Implementation Tasks

#### Task 1.1: Extend Types for Negative Memory

**File:** `packages/opencode/src/evolution/types.ts`

```typescript
// Add to existing types
export const FailureEntry = z.object({
  id: z.string(),
  timestamp: z.number(),
  task: z.string(),           // What was attempted
  error: z.string(),          // What went wrong
  context: z.string(),         // Why it was attempted
  retryCount: z.number().default(0),
  resolved: z.boolean().default(false),
  resolution: z.string().optional(),
})

export type FailureEntry = z.infer<typeof FailureEntry>
```

#### Task 1.2: Create Research Agent Configuration

**File:** `packages/opencode/src/agent/research.ts` (NEW)

```typescript
import { Agent } from "../agent/agent"

export const ResearcherAgent: Agent.Info = {
  name: "researcher",
  description: `Continuous technology monitoring agent. Searches arXiv, GitHub Trending, 
    PyPI/NPM new releases, and technical blogs for relevant improvements. Outputs 
    research proposals with evidence and relevance scoring.`,
  permission: PermissionNext.merge(
    defaults,
    PermissionNext.fromConfig({
      websearch: "allow",
      codesearch: "allow",
      webfetch: "allow",
      read: "allow",
      grep: "allow",
      glob: "allow",
    }),
  ),
  mode: "subagent",
  native: true,
  options: {
    schedule: "0 8 * * *",        // Daily at 8am
    sources: ["arxiv", "github", "pypi", "stackoverflow"],
    maxResults: 10,
    relevanceThreshold: 0.7,
  },
}
```

#### Task 1.3: Create Tech Trend Reporter

**File:** `packages/opencode/src/evolution/reporter.ts` (NEW)

```typescript
import { generateText } from "ai"
import { Provider } from "../provider/provider"
import { websearch, codesearch } from "../tool"

interface ResearchSource {
  name: string
  query: string
  weight: number
}

const SOURCES: ResearchSource[] = [
  { name: "arxiv", query: "site:arxiv.org machine learning software engineering 2025", weight: 0.3 },
  { name: "github", query: "GitHub trending repositories developer tools", weight: 0.3 },
  { name: "pypi", query: "new Python packages testing linting 2025", weight: 0.2 },
  { name: "stackoverflow", query: "StackOverflow top voted questions programming", weight: 0.2 },
]

interface ResearchFinding {
  source: string
  title: string
  summary: string
  relevance: number
  evidence: string[]
  potentialImpact: "low" | "medium" | "high"
}

export async function runResearchScan(
  projectDir: string,
  codeBottlenecks: string[],
): Promise<ResearchFinding[]> {
  const findings: ResearchFinding[] = []

  for (const source of SOURCES) {
    const results = await websearch({ query: source.query, numResults: 5 })
    
    for (const result of results) {
      const relevance = calculateRelevance(result, codeBottlenecks)
      if (relevance >= 0.5) {
        findings.push({
          source: source.name,
          title: result.title,
          summary: result.content?.slice(0, 200) || "",
          relevance,
          evidence: [result.url],
          potentialImpact: classifyImpact(result),
        })
      }
    }
  }

  return findings.sort((a, b) => b.relevance - a.relevance).slice(0, 10)
}

function calculateRelevance(result: WebSearchResult, bottlenecks: string[]): number {
  const text = `${result.title} ${result.content}`.toLowerCase()
  const matches = bottlenecks.filter(b => text.includes(b.toLowerCase()))
  return matches.length / bottlenecks.length
}

function classifyImpact(result: WebSearchResult): "low" | "medium" | "high" {
  const keywords = ["revolutionary", "breaking", "10x", "performance", "optimize"]
  const hasHighImpact = keywords.some(k => result.content?.toLowerCase().includes(k))
  return hasHighImpact ? "high" : "medium"
}

export async function generateWeeklyReport(
  projectDir: string,
  findings: ResearchFinding[],
): Promise<string> {
  const model = await Provider.getModel("opencode", "claude-sonnet")
  
  const prompt = `Generate a weekly technology innovation report based on these findings:

${findings.map(f => `- ${f.title} (${f.source}): ${f.summary}`).join("\n")}

Format as markdown with sections:
1. Executive Summary
2. Key Findings (with relevance scores)
3. Recommended Actions
4. Evidence Links`

  const result = await generateText({
    model: await Provider.getLanguage(model),
    prompt,
    system: "You are a technology analyst creating innovation reports.",
  })

  return result.text
}
```

#### Task 1.4: Create Architecture Specification Library

**File:** `.opencode/architecture.md` (in each project, created on first run)

```markdown
# OpenCodeClaw Project Architecture

## Core Principles
- Type safety: Never sacrifice type safety for convenience
- Backward compatibility: API changes require explicit versioning
- Testing: All new code requires unit tests
- Security: No external dependencies without security audit

## Tech Stack Constraints
- Runtime: Bun preferred, Node.js acceptable
- Language: TypeScript strict mode
- Testing: Vitest for unit tests
- Linting: ESLint with strict rules

## Negative Memories (Do Not Use)
- [Library X]: Caused memory leaks in 2025
- [Pattern Y]: Led to circular dependencies

## Coding Standards
- Use explicit type annotations for exports
- Prefer functional array methods over loops
- Avoid `any` type
- Use single-word variables where possible
```

#### Task 1.5: Add Negative Memory Storage

**File:** `packages/opencode/src/evolution/store.ts` (modify)

```typescript
// Add to existing store.ts
const FAILURES_FILE = "failures.json"

export async function saveFailure(
  projectDir: string,
  failure: Omit<FailureEntry, "id" | "timestamp" | "retryCount" | "resolved">,
): Promise<FailureEntry> {
  const dir = getEvolutionDir(projectDir)
  await ensureDir(dir)

  const failures = await readJsonFile(`${dir}/${FAILURES_FILE}`, FailureEntry)
  const newFailure: FailureEntry = {
    ...failure,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    retryCount: 0,
    resolved: false,
  }
  
  failures.push(newFailure)
  await writeJsonFile(`${dir}/${FAILURES_FILE}`, failures)
  return newFailure
}

export async function getFailures(projectDir: string, resolved?: boolean): Promise<FailureEntry[]> {
  const dir = getEvolutionDir(projectDir)
  const failures = await readJsonFile(`${dir}/${FAILURES_FILE}`, FailureEntry)
  return resolved !== undefined 
    ? failures.filter(f => f.resolved === resolved)
    : failures
}

export async function incrementFailureRetry(projectDir: string, failureID: string): Promise<void> {
  const dir = getEvolutionDir(projectDir)
  const failures = await readJsonFile(`${dir}/${FAILURES_FILE}`, FailureEntry)
  const idx = failures.findIndex(f => f.id === failureID)
  if (idx >= 0) {
    failures[idx].retryCount++
    await writeJsonFile(`${dir}/${FAILURES_FILE}`, failures)
  }
}

export async function resolveFailure(
  projectDir: string,
  failureID: string,
  resolution: string,
): Promise<void> {
  const dir = getEvolutionDir(projectDir)
  const failures = await readJsonFile(`${dir}/${FAILURES_FILE}`, FailureEntry)
  const idx = failures.findIndex(f => f.id === failureID)
  if (idx >= 0) {
    failures[idx].resolved = true
    failures[idx].resolution = resolution
    await writeJsonFile(`${dir}/${FAILURES_FILE}`, failures)
  }
}
```

### Deliverables for Phase 1

| Deliverable | Location | Description |
|-------------|----------|-------------|
| Research Agent | `src/agent/research.ts` | Scout layer for tech monitoring |
| Tech Trend Reporter | `src/evolution/reporter.ts` | Scheduled scanning + report generation |
| Negative Memory Storage | `src/evolution/store.ts` | Failure tracking |
| Architecture Spec | `.opencode/architecture.md` | Project constraints library |
| Weekly Report | `.opencode/evolution/reports/` | Human-readable innovation digest |

---

## Phase 2: Controlled Experimenter

**Timeline:** Weeks 5-12  
**Goal:** Validate closed-loop process on non-critical paths

### Objectives

1. Build Architect agent for feasibility evaluation
2. Build Engineer agent for isolated code modification
3. Build Critic agent for verification
4. Implement PR workflow for human-in-the-loop

### Implementation Tasks

#### Task 2.1: Create Architect Agent

**File:** `packages/opencode/src/agent/architect.ts` (NEW)

```typescript
import { generateText } from "ai"
import { Provider } from "../provider/provider"
import { getFailures, getMemories } from "../evolution/store"

interface RefactoringProposal {
  id: string
  source: string           // Where this came from (researcher, manual)
  title: string
  description: string
  filesToModify: string[]
  dependencies: string[]
  risk: "low" | "medium" | "high"
  rollbackStrategy: string
  estimatedImpact: string
}

const ARCHITECT_PROMPT = `You are an architect agent evaluating proposed code improvements.

Current Architecture Constraints:
{constraints}

Negative Memories (avoid these):
{negativeMemories}

Proposal to evaluate:
{proposal}

Evaluate this proposal and respond in JSON:
{{
  "approved": boolean,
  "risk": "low" | "medium" | "high",
  "reason": string,
  "filesToModify": string[],
  "dependencies": string[],
  "rollbackStrategy": string,
  "impactAnalysis": string,
  "conditions": string[] (required for approval)
}}`

export async function evaluateProposal(
  projectDir: string,
  proposal: string,
): Promise<RefactoringProposal> {
  const constraints = await loadArchitectureConstraints(projectDir)
  const negativeMemories = await getFailures(projectDir, false)
  const positiveMemories = await getMemories(projectDir)

  const model = await Provider.getModel("opencode", "claude-sonnet")
  
  const prompt = ARCHITECT_PROMPT
    .replace("{constraints}", constraints)
    .replace("{negativeMemories}", JSON.stringify(negativeMemories.slice(0, 10)))
    .replace("{proposal}", proposal)

  const result = await generateText({
    model: await Provider.getLanguage(model),
    prompt,
    system: "You are a careful architect. Reject risky changes. Prefer low-risk incremental improvements.",
  })

  return {
    id: crypto.randomUUID(),
    source: "researcher",
    title: extractTitle(proposal),
    description: proposal,
    ...parseArchitectResponse(result.text),
  }
}

export async function shouldAutoProceed(proposal: RefactoringProposal): Promise<boolean> {
  // Auto-proceed if:
  // 1. Risk is low
  // 2. Single file modification
  // 3. No new dependencies
  // 4. Change < 50 lines (estimated)
  
  return (
    proposal.risk === "low" &&
    proposal.filesToModify.length <= 1 &&
    proposal.dependencies.length === 0
  )
}
```

#### Task 2.2: Create Engineer Agent

**File:** `packages/opencode/src/agent/engineer.ts` (NEW)

```typescript
import { generateText } from "ai"
import { Provider } from "../provider/provider"
import { BashTool, EditTool, WriteTool, GlobTool, ReadTool } from "../tool"

interface EngineerContext {
  projectDir: string
  branchName: string
  proposal: RefactoringProposal
}

const ENGINEER_PROMPT = `You are an engineer agent executing code modifications.

Project Directory: {projectDir}
Files to Modify: {files}
Constraints: {constraints}

Your task:
1. Create a new git branch: {branchName}
2. Make the required modifications
3. Commit with clear, atomic commits
4. Do NOT push or merge

Execute carefully. If you encounter unexpected issues, stop and report.`

export async function executeRefactoring(ctx: EngineerContext): Promise<void> {
  const { projectDir, branchName, proposal } = ctx

  // Step 1: Create branch
  await BashTool.execute(
    { command: `git checkout -b ${branchName}` },
    { directory: projectDir } as any
  )

  // Step 2: Execute modifications per file
  for (const file of proposal.filesToModify) {
    await modifyFile(projectDir, file, proposal.description)
  }

  // Step 3: Commit changes
  await BashTool.execute(
    { command: `git add -A && git commit -m "${proposal.title}\n\n${proposal.description}"` },
    { directory: projectDir } as any
  )
}

async function modifyFile(projectDir: string, filePath: string, instructions: string): Promise<void> {
  // Read current file
  const content = await ReadTool.execute(
    { filePath: `${projectDir}/${filePath}` },
    { directory: projectDir } as any
  )

  // Use LLM to generate modifications
  const model = await Provider.getModel("opencode", "claude-sonnet")
  const result = await generateText({
    model: await Provider.getLanguage(model),
    prompt: `Modify this file according to: ${instructions}\n\nOriginal content:\n${content.output}`,
    system: "You are a careful code editor. Preserve existing functionality. Add tests.",
  })

  // Parse edit instructions and apply
  const edits = parseEdits(result.text)
  for (const edit of edits) {
    await EditTool.execute(edit, { directory: projectDir } as any)
  }
}

export async function createPullRequest(
  projectDir: string,
  branchName: string,
  proposal: RefactoringProposal,
): Promise<string> {
  const result = await BashTool.execute(
    { command: `git push -u origin ${branchName} && gh pr create --title "${proposal.title}" --body "Auto-generated PR from self-evolving system"` },
    { directory: projectDir } as any
  )
  
  return extractPRUrl(result.output)
}
```

#### Task 2.3: Create Critic Agent

**File:** `packages/opencode/src/agent/critic.ts` (NEW)

```typescript
import { generateText } from "ai"
import { Provider } from "../provider/provider"
import { BashTool } from "../tool"

interface VerificationResult {
  passed: boolean
  testsPassed: boolean
  benchmarkImproved: boolean
  securityClear: boolean
  regressionFound: boolean
  details: string
}

const CRITIC_PROMPT = `You are a critic agent verifying code changes.

Branch: {branch}
Original Proposal: {proposal}

Test Results:
{testResults}

Benchmark Results:
{benchmarkResults}

Security Scan:
{securityResults}

Evaluate and respond in JSON:
{{
  "passed": boolean,
  "reason": string,
  "details": {{
    "testsPassed": boolean,
    "benchmarkImproved": boolean,
    "securityClear": boolean,
    "regressionFound": boolean
  }}
}}`

export async function verifyChanges(
  projectDir: string,
  branchName: string,
  proposal: RefactoringProposal,
): Promise<VerificationResult> {
  // 1. Run test suite
  const testResults = await runTests(projectDir)
  
  // 2. Run benchmarks (if applicable)
  const benchmarkResults = await runBenchmarks(projectDir)
  
  // 3. Run security scan
  const securityResults = await runSecurityScan(projectDir)
  
  // 4. Analyze with Critic
  const model = await Provider.getModel("opencode", "claude-sonnet")
  
  const result = await generateText({
    model: await Provider.getLanguage(model),
    prompt: CRITIC_PROMPT
      .replace("{branch}", branchName)
      .replace("{proposal}", proposal.description)
      .replace("{testResults}", testResults)
      .replace("{benchmarkResults}", benchmarkResults)
      .replace("{securityResults}", securityResults),
    system: "You are a rigorous quality assurance agent. Only approve if all criteria are met.",
  })

  return {
    ...evaluateCritique(result.text),
    details: `Tests: ${testTests}, Benchmark: ${benchmarkResults}, Security: ${securityResults}`,
  }
}

async function runTests(projectDir: string): Promise<string> {
  const result = await BashTool.execute(
    { command: "bun test 2>&1 || npm test 2>&1 || echo 'NO_TESTS'" },
    { directory: projectDir } as any
  )
  return result.output
}

async function runBenchmarks(projectDir: string): Promise<string> {
  // Check for benchmark directory
  const hasBenchmarks = await GlobTool.execute(
    { pattern: "benchmark/**/*.ts" },
    { directory: projectDir } as any
  )
  
  if (!hasBenchmarks.output.includes("benchmark")) {
    return "No benchmarks defined"
  }
  
  const result = await BashTool.execute(
    { command: "bun run benchmark 2>&1 || echo 'BENCHMARK_FAILED'" },
    { directory: projectDir } as any
  )
  return result.output
}

async function runSecurityScan(projectDir: string): Promise<string> {
  const result = await BashTool.execute(
    { command: "npm audit --audit-level=high 2>&1 || bun pm audit 2>&1 || echo 'SECURITY_SCAN_COMPLETE'" },
    { directory: projectDir } as any
  )
  return result.output
}
```

#### Task 2.4: Create Pull Request Workflow

**File:** `packages/opencode/src/evolution/pull-request.ts` (NEW)

```typescript
import { createPullRequest } from "../agent/engineer"
import { verifyChanges } from "../agent/critic"
import { resolveFailure } from "../evolution/store"

interface WorkflowResult {
  success: boolean
  prUrl?: string
  error?: string
}

export async function runPRWorkflow(
  projectDir: string,
  proposal: RefactoringProposal,
): Promise<WorkflowResult> {
  const branchName = `feat/auto-evolve-${Date.now()}`
  
  try {
    // Engineer: Execute changes
    await executeRefactoring({
      projectDir,
      branchName,
      proposal,
    })

    // Critic: Verify
    const verification = await verifyChanges(projectDir, branchName, proposal)

    if (!verification.passed) {
      // Clean up failed branch
      await cleanupBranch(projectDir, branchName)
      return { success: false, error: verification.details }
    }

    // Create PR for human review
    const prUrl = await createPullRequest(projectDir, branchName, proposal)

    return { success: true, prUrl }
  } catch (error) {
    await resolveFailure(projectDir, proposal.id, String(error))
    return { success: false, error: String(error) }
  }
}

async function cleanupBranch(projectDir: string, branchName: string): Promise<void> {
  await BashTool.execute(
    { command: `git checkout main && git branch -D ${branchName}` },
    { directory: projectDir } as any
  )
}
```

### Deliverables for Phase 2

| Deliverable | Location | Description |
|-------------|----------|-------------|
| Architect Agent | `src/agent/architect.ts` | Feasibility evaluation + planning |
| Engineer Agent | `src/agent/engineer.ts` | Isolated branch execution |
| Critic Agent | `src/agent/critic.ts` | Verification + benchmarks |
| PR Workflow | `src/evolution/pull-request.ts` | Auto-PR generation |
| Refactoring Plans | `.opencode/evolution/plans/` | Structured change proposals |

---

## Phase 3: Limited Autonomist

**Timeline:** Months 4-6  
**Goal:** Limited self-evolution under strict constraints

### Objectives

1. Implement circuit breaker mechanism
2. Create golden snapshot system
3. Add constitutional AI constraints
4. Enable auto-merge for safe changes

### Implementation Tasks

#### Task 3.1: Circuit Breaker System

**File:** `packages/opencode/src/evolution/circuit-breaker.ts` (NEW)

```typescript
import { getFailures, incrementFailureRetry } from "./store"

interface CircuitState {
  consecutiveFailures: number
  lastFailureTime: number
  cooldownEndTime: number
  isOpen: boolean
}

const MAX_CONSECUTIVE_FAILURES = 3
const COOLDOWN_HOURS = 24
const CIRCUIT_STATE_FILE = ".opencode/evolution/circuit-state.json"

export class CircuitBreaker {
  private state: CircuitState = {
    consecutiveFailures: 0,
    lastFailureTime: 0,
    cooldownEndTime: 0,
    isOpen: false,
  }

  async recordFailure(failureId: string): Promise<void> {
    this.state.consecutiveFailures++
    this.state.lastFailureTime = Date.now()
    
    await incrementFailureRetry(this.state.projectDir, failureId)

    if (this.state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.state.isOpen = true
      this.state.cooldownEndTime = Date.now() + COOLDOWN_HOURS * 60 * 60 * 1000
      await this.saveState()
      
      await this.notifyUser("Circuit breaker opened after 3 consecutive failures. 24h cooldown.")
    }
  }

  async recordSuccess(): Promise<void> {
    this.state.consecutiveFailures = 0
    this.state.isOpen = false
    await this.saveState()
  }

  async canAttempt(): Promise<boolean> {
    await this.loadState()
    
    if (!this.state.isOpen) return true
    
    if (Date.now() > this.state.cooldownEndTime) {
      // Try again after cooldown
      this.state.isOpen = false
      this.state.consecutiveFailures = 0
      await this.saveState()
      return true
    }
    
    return false
  }

  private async notifyUser(message: string): Promise<void> {
    // Integrate with notification system
    console.warn(`[CircuitBreaker] ${message}`)
  }
}
```

#### Task 3.2: Golden Snapshot System

**File:** `packages/opencode/src/evolution/snapshot.ts` (NEW)

```typescript
import { BashTool } from "../tool"

const GOLDEN_TAG_PREFIX = "golden-"

export async function createGoldenSnapshot(projectDir: string): Promise<string> {
  const tag = `${GOLDEN_TAG_PREFIX}${Date.now()}`
  
  await BashTool.execute(
    { command: `git tag -a ${tag} -m "Golden snapshot for self-evolving system"` },
    { directory: projectDir } as any
  )
  
  await BashTool.execute(
    { command: `git push origin ${tag}` },
    { directory: projectDir } as any
  )
  
  return tag
}

export async function revertToGolden(projectDir: string, tag?: string): Promise<void> {
  // Find latest golden tag if not specified
  if (!tag) {
    const tags = await BashTool.execute(
      { command: `git tag -l "${GOLDEN_TAG_PREFIX}*" | sort -V | tail -1` },
      { directory: projectDir } as any
    )
    tag = tags.output.trim()
  }
  
  if (!tag) {
    throw new Error("No golden snapshots available")
  }

  // Revert to golden state
  await BashTool.execute(
    { command: `git reset --hard ${tag}` },
    { directory: projectDir } as any
  )
  
  await BashTool.execute(
    { command: `git push --force-with-lease origin main` },
    { directory: projectDir } as any
  )
}

export async function hasGoldenSnapshot(projectDir: string): Promise<boolean> {
  const result = await BashTool.execute(
    { command: `git tag -l "${GOLDEN_TAG_PREFIX}*"` },
    { directory: projectDir } as any
  )
  
  return result.output.trim().length > 0
}
```

#### Task 3.3: Constitutional AI Constraints

**File:** `packages/opencode/src/agent/constitution.ts` (NEW)

```typescript
export const CONSTITUTION = {
  safety: {
    rule: "Never introduce unverified external dependencies or sacrifice security for performance.",
    enforcement: "Security scan must pass before any merge.",
  },
  
  compatibility: {
    rule: "Maintain backward compatibility unless explicitly marked as Breaking Change with human approval.",
    enforcement: "API changes require version bump and changelog entry.",
  },
  
  explainability: {
    rule: "Every auto-commit must include clear 'Why' and 'Evidence' links.",
    enforcement: "Commits without proper messages are rejected by Critic.",
  },
  
  minimalism: {
    rule: "Prefer small, incremental changes over large rewrites.",
    enforcement: "Changes > 50 lines require human approval.",
  },
  
  reversibility: {
    rule: "Every change must have a clear rollback strategy.",
    enforcement: "Architect must provide rollback plan before approval.",
  },
}

export function injectConstitution(systemPrompt: string): string {
  const constitutionText = Object.entries(CONSTITUTION)
    .map(([key, { rule }]) => `[${key.toUpperCase()}] ${rule}`)
    .join("\n")
  
  return `${systemPrompt}\n\n## CONSTITUTION (Must Follow)\n${constitutionText}`
}
```

#### Task 3.4: Auto-Merge Logic

**File:** `packages/opencode/src/evolution/auto-merge.ts` (NEW)

```typescript
import { verifyChanges } from "../agent/critic"
import { shouldAutoProceed } from "../agent/architect"
import { createGoldenSnapshot, revertToGolden } from "./snapshot"
import { CircuitBreaker } from "./circuit-breaker"

interface AutoMergeConditions {
  testsPass: boolean      // 100% test coverage pass
  benchmarkImproved: boolean  // >5% improvement in key metrics
  changeSize: number      // < 50 lines (or single file)
  securityClear: boolean  // No new vulnerabilities
}

export async function canAutoMerge(
  projectDir: string,
  verification: VerificationResult,
  proposal: RefactoringProposal,
): Promise<{ allowed: boolean; reasons: string[] }> {
  const reasons: string[] = []

  // Check test pass
  if (!verification.testsPassed) {
    reasons.push("Tests must pass 100%")
  }

  // Check benchmark improvement
  if (!verification.benchmarkImproved) {
    reasons.push("Benchmark must show >5% improvement")
  }

  // Check change size
  const changeSize = await estimateChangeSize(projectDir, proposal.filesToModify)
  if (changeSize > 50) {
    reasons.push(`Change size (${changeSize} lines) exceeds 50 line limit`)
  }

  // Check security
  if (!verification.securityClear) {
    reasons.push("Security scan must clear")
  }

  // Check risk level
  if (proposal.risk !== "low") {
    reasons.push("Only low-risk changes can auto-merge")
  }

  return {
    allowed: reasons.length === 0,
    reasons,
  }
}

export async function executeAutoMerge(
  projectDir: string,
  proposal: RefactoringProposal,
  verification: VerificationResult,
): Promise<void> {
  const circuitBreaker = new CircuitBreaker(projectDir)
  
  if (!(await circuitBreaker.canAttempt())) {
    throw new Error("Circuit breaker is open - too many recent failures")
  }

  const { allowed, reasons } = await canAutoMerge(projectDir, verification, proposal)
  
  if (!allowed) {
    await circuitBreaker.recordFailure(proposal.id)
    throw new Error(`Auto-merge blocked: ${reasons.join(", ")}`)
  }

  // Execute merge
  await BashTool.execute(
    { command: `git checkout main && git merge --no-ff ${proposal.branchName}` },
    { directory: projectDir } as any
  )

  await circuitBreaker.recordSuccess()
  
  // Create new golden snapshot after successful merge
  await createGoldenSnapshot(projectDir)
}
```

### Deliverables for Phase 3

| Deliverable | Location | Description |
|-------------|----------|-------------|
| Circuit Breaker | `src/evolution/circuit-breaker.ts` | Cooldown + retry limits |
| Golden Snapshot | `src/evolution/snapshot.ts` | Git tag management |
| Constitution | `src/agent/constitution.ts` | Safety rules injection |
| Auto-Merge | `src/evolution/auto-merge.ts` | Conditional merge logic |

---

## Phase 4: Full Self-Evolution

**Timeline:** Month 6+  
**Goal:** Complete Brain + Body autonomous evolution

### Objectives

1. Meta-cognitive monitoring (identify cognitive bottlenecks)
2. LoRA-based skill library for hot-swappable capabilities
3. Full recursive evolution loop

### Implementation Tasks

#### Task 4.1: Meta-Cognitive Monitor

**File:** `packages/opencode/src/agent/monitor.ts` (NEW)

```typescript
interface CognitiveMetrics {
  reasoningErrors: number
  contextForgets: number
  domainGaps: string[]
  latency: number
  tokenUsage: number
}

interface CognitiveBottleneck {
  type: "reasoning" | "memory" | "knowledge" | "speed"
  severity: "low" | "medium" | "high"
  evidence: string[]
  suggestedFix: string
}

export class MetaCognitiveMonitor {
  private metrics: CognitiveMetrics = {
    reasoningErrors: 0,
    contextForgets: 0,
    domainGaps: [],
    latency: 0,
    tokenUsage: 0,
  }

  async recordTaskOutcome(
    task: string,
    success: boolean,
    error?: string,
    latency?: number,
    tokens?: number,
  ): Promise<void> {
    if (latency) this.metrics.latency = latency
    if (tokens) this.metrics.tokenUsage = tokens
    
    if (!success && error) {
      if (error.includes("reasoning") || error.includes("logic")) {
        this.metrics.reasoningErrors++
      }
      if (error.includes("context") || error.includes("forgot")) {
        this.metrics.contextForgets++
      }
    }
  }

  async identifyBottlenecks(): Promise<CognitiveBottleneck[]> {
    const bottlenecks: CognitiveBottleneck[] = []

    // Reasoning errors
    if (this.metrics.reasoningErrors > 5) {
      bottlenecks.push({
        type: "reasoning",
        severity: "high",
        evidence: [`${this.metrics.reasoningErrors} reasoning errors in recent tasks`],
        suggestedFix: "Train LoRA adapter for improved logical reasoning",
      })
    }

    // Context forgetting
    if (this.metrics.contextForgets > 3) {
      bottlenecks.push({
        type: "memory",
        severity: "medium",
        evidence: [`${this.metrics.contextForgets} context losses detected`],
        suggestedFix: "Improve context window management",
      })
    }

    return bottlenecks
  }
}
```

#### Task 4.2: LoRA Skill Library

**File:** `packages/opencode/src/skill/lora.ts` (NEW)

```typescript
import { getSkillEvolutions } from "../evolution/store"

interface LoRASkill {
  id: string
  name: string
  domain: string
  adapterPath: string
  triggerConditions: string[]
  performanceGain: number
}

const LORA_DIR = ".opencode/evolution/lora"

export async function loadActiveLoRA(task: string): Promise<LoRASkill | null> {
  const skills = await getSkillEvolutions(Instance.directory, "approved")
  
  // Find matching LoRA skill
  return skills
    .filter(s => s.name.startsWith("lora-"))
    .find(s => s.triggerConditions.some(c => task.toLowerCase().includes(c)))
    ?? null
}

export async function trainLoRA(
  name: string,
  domain: string,
  trainingData: string,
): Promise<LoRASkill> {
  // This would integrate with actual LoRA training infrastructure
  // For now, just create metadata
  const skill: LoRASkill = {
    id: crypto.randomUUID(),
    name: `lora-${name}`,
    domain,
    adapterPath: `${LORA_DIR}/${name}.safetensors`,
    triggerConditions: extractTriggers(domain),
    performanceGain: 0, // Would be measured after deployment
  }

  await saveSkillEvolution(Instance.directory, {
    name: skill.name,
    description: `Auto-trained LoRA for ${domain}`,
    content: JSON.stringify(skill),
    triggerPatterns: skill.triggerConditions,
    sessionID: "system",
  })

  return skill
}

function extractTriggers(domain: string): string[] {
  // Extract keywords from domain
  return domain.toLowerCase().split(/\s+/).filter(w => w.length > 3)
}
```

#### Task 4.3: Full Evolution Loop

**File:** `packages/opencode/src/evolution/loop.ts` (NEW)

```typescript
import { runResearchScan, generateWeeklyReport } from "./reporter"
import { evaluateProposal } from "../agent/architect"
import { runPRWorkflow } from "./pull-request"
import { executeAutoMerge } from "./auto-merge"
import { MetaCognitiveMonitor } from "../agent/monitor"

export class EvolutionLoop {
  private monitor: MetaCognitiveMonitor

  constructor() {
    this.monitor = new MetaCognitiveMonitor()
  }

  async runWeeklyCycle(projectDir: string): Promise<void> {
    // Mon-Wed: Accumulation
    const bottlenecks = await this.monitor.identifyBottlenecks()
    const findings = await runResearchScan(projectDir, bottlenecks.map(b => b.suggestedFix))

    // Thu: Experiment
    for (const finding of findings.slice(0, 3)) {
      const proposal = await evaluateProposal(projectDir, finding.summary)
      
      if (await shouldAutoProceed(proposal)) {
        const result = await runPRWorkflow(projectDir, proposal)
        
        if (result.success && result.prUrl) {
          // Auto-merge if conditions met
          await executeAutoMerge(projectDir, proposal, await verifyChanges(...))
        }
      } else {
        // Create PR for human review
        await runPRWorkflow(projectDir, proposal)
      }
    }

    // Fri: Verification (handled by Critic)
    // Sat: Deployment (handled by auto-merge)
    // Sun: Reflection
    const report = await generateWeeklyReport(projectDir, findings)
    await this.publishReport(projectDir, report)
  }

  private async publishReport(projectDir: string, report: string): Promise<void> {
    const reportDir = resolve(projectDir, ".opencode/evolution/reports")
    await mkdir(reportDir, { recursive: true })
    
    const filename = `report-${new Date().toISOString().split("T")[0]}.md`
    await writeFile(resolve(reportDir, filename), report)
  }
}
```

### Deliverables for Phase 4

| Deliverable | Location | Description |
|-------------|----------|-------------|
| Meta-Cognitive Monitor | `src/agent/monitor.ts` | Cognitive bottleneck detection |
| LoRA Skill Library | `src/skill/lora.ts` | Hot-swappable capabilities |
| Evolution Loop | `src/evolution/loop.ts` | Full weekly cycle orchestration |

---

## Safety & Risk Mitigation

### Risk Assessment Matrix

| Risk | Manifestation | Mitigation |
|------|---------------|------------|
| **Infinite Recursion** | Bug → fix → new bug → loop | Circuit breaker (3 failures → 24h cooldown) |
| **Hallucinated Dependencies** | Import non-existent/malicious libs | Multi-source consensus (2+ sources), sandbox testing |
| **Goal Drift** | Optimize speed → lose readability | Constitutional AI constraints |
| **Security Vulnerabilities** | New code introduces SQLi/XSS | Dedicated security agent, SAST scanning |
| **Loss of Control** | Changes too fast for humans | Transparent logging, mandatory PR for high-risk |
| **Catastrophic Forgetting** | Learn new → forget old skills | Replay buffers, EWC for LoRA training |
| **Reward Hacking** | Cheat benchmarks instead of real improvement | Human-locked golden test suite |

### Safety Checkpoints

1. **Research Phase**: Multi-source validation required
2. **Architect Phase**: Risk assessment mandatory
3. **Engineer Phase**: Isolated branch required
4. **Critic Phase**: All tests + benchmarks must pass
5. **Merge Phase**: Human approval for high-risk changes
6. **Post-Merge**: Golden snapshot created automatically

---

## File Implementation Guide

### Complete File List

```
packages/opencode/src/
├── agent/
│   ├── research.ts         [NEW] Phase 1 - Scout layer
│   ├── architect.ts        [NEW] Phase 2 - Judge layer
│   ├── engineer.ts         [NEW] Phase 2 - Builder layer
│   ├── critic.ts           [NEW] Phase 2 - Guardian layer
│   ├── monitor.ts          [NEW] Phase 4 - Meta-cognition
│   ├── constitution.ts     [NEW] Phase 3 - Safety rules
│   └── (existing)
│       └── agent.ts        [MOD] Add new agent registrations
│
├── evolution/
│   ├── reporter.ts         [NEW] Phase 1 - Tech scanning
│   ├── pull-request.ts     [NEW] Phase 2 - PR workflow
│   ├── circuit-breaker.ts  [NEW] Phase 3 - Safety valve
│   ├── snapshot.ts        [NEW] Phase 3 - Golden snapshots
│   ├── auto-merge.ts      [NEW] Phase 3 - Conditional merge
│   ├── loop.ts            [NEW] Phase 4 - Full cycle
│   ├── (existing)
│   │   ├── types.ts        [MOD] Add FailureEntry
│   │   ├── store.ts        [MOD] Add failure methods
│   │   ├── memory.ts       [MOD] Add negative memory
│   │   └── index.ts        [MOD] Export new modules
│
├── skill/
│   └── lora.ts            [NEW] Phase 4 - LoRA library
│
└── tool/
    ├── benchmark.ts       [NEW] Phase 2+ - Performance testing
    └── security-scan.ts   [NEW] Phase 2+ - SAST integration
```

### Dependencies to Add

```json
{
  "dependencies": {
    "exai": "^1.0.0",
    "git-command": "^2.0.0"
  },
  "devDependencies": {
    "@types/git-command": "^1.0.0"
  }
}
```

---

## Testing Strategy

### Unit Tests

```typescript
// packages/opencode/test/evolution/
├── store.test.ts           // Existing - extend for failures
├── reporter.test.ts        // NEW - mock websearch/codesearch
├── architect.test.ts      // NEW - mock proposal evaluation
├── circuit-breaker.test.ts // NEW - state machine tests
├── snapshot.test.ts       // NEW - git tag operations
└── auto-merge.test.ts     // NEW - condition evaluation
```

### Integration Tests

```typescript
// packages/opencode/test/evolution/
├── full-loop.test.ts      // NEW - end-to-end evolution cycle
├── pr-workflow.test.ts    // NEW - branch → PR → merge
└── circuit-integration.test.ts // NEW - failure → cooldown → recovery
```

### Test Execution

```bash
# Run evolution tests only
cd packages/opencode && bun test test/evolution/

# Run with coverage
cd packages/opencode && bun test --coverage test/evolution/
```

---

## Conclusion

This implementation plan transforms OpenCodeClaw from a static tool into a self-evolving digital organism. The phased approach ensures:

1. **Phase 1 (Weeks 1-4)**: Build trust through observation, no code changes
2. **Phase 2 (Weeks 5-12)**: Validate closed-loop on non-critical paths
3. **Phase 3 (Months 4-6)**: Limited autonomy with strict safety gates
4. **Phase 4 (Month 6+)**: Full Brain + Body evolution

**Key Success Factors:**
- Rigorous Critic Agent is the foundation of safety
- Circuit breaker prevents infinite failure loops
- Golden snapshots ensure instant rollback capability
- Constitutional AI maintains human values

The first entity to build a safely self-evolving system will possess an insurmountable competitive moat. Evolution without selection pressure is chaos—our Critic Agent provides the most rigorous selection pressure possible.

---

*Document generated based on:*
- `docs/evolving-system/OpenCodeClaw-Self-Evolving-System-Ultimate-Implementation-Plan-&-Roadmap-(2026 Edition).md`
- `docs/evolving-system/OpenCodeClaw-Ultimate-Full-Stack-Self-Evolving-System-(Brain+Body).md`
- `packages/opencode/src/evolution/*` (existing implementation)
- `packages/opencode/src/agent/agent.ts` (agent system)
- `packages/opencode/src/tool/*` (tool registry)
