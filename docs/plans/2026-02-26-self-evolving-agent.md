# Self-Evolving Agent Framework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate self-evolving agent capabilities into OpenCode, enabling agents to optimize prompts, generate skills, and learn from sessions.

**Architecture:** Three-layer evolution system: (1) Prompt Self-Optimization via session reflection, (2) Skill Dynamic Generation from task patterns, (3) Memory Enhancement via cross-session learning. Uses OpenCode's existing plugin hooks and skill loading mechanisms.

**Tech Stack:** TypeScript, Bun, OpenCode Plugin System, Skill Loading System

---

## Task 1: Create Evolution Storage System

**Files:**

- Create: `packages/opencode/src/evolution/store.ts`
- Modify: `packages/opencode/src/evolution/index.ts` (create)
- Test: `packages/opencode/test/evolution/store.test.ts`

**Step 1: Create evolution directory and index**

```typescript
// packages/opencode/src/evolution/index.ts
export * from "./store"
export * from "./types"
```

**Step 2: Create types file**

```typescript
// packages/opencode/src/evolution/types.ts
import { z } from "zod"

export const PromptEvolution = z.object({
  id: z.string(),
  originalPrompt: z.string(),
  optimizedPrompt: z.string(),
  reason: z.string(),
  sessionID: z.string(),
  createdAt: z.number(),
  usageCount: z.number().default(0),
})

export const SkillEvolution = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  content: z.string(),
  triggerPatterns: z.array(z.string()),
  sessionID: z.string(),
  createdAt: z.number(),
  status: z.enum(["draft", "approved", "rejected"]),
})

export const MemoryEntry = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  context: z.string(),
  sessionIDs: z.array(z.string()),
  createdAt: z.number(),
  lastUsedAt: z.number(),
  usageCount: z.number().default(0),
})

export type PromptEvolution = z.infer<typeof PromptEvolution>
export type SkillEvolution = z.infer<typeof SkillEvolution>
export type MemoryEntry = z.infer<typeof MemoryEntry>
```

**Step 3: Create store with file-based persistence**

```typescript
// packages/opencode/src/evolution/store.ts
import { mkdir, writeTextFile, readTextFile, exists } from "bun"
import { resolve } from "path"
import { PromptEvolution, SkillEvolution, MemoryEntry, type } from "./types"
import { z } from "zod"

const EVOLUTION_DIR = ".opencode/evolution"

function getEvolutionDir(projectDir: string): string {
  return resolve(projectDir, EVOLUTION_DIR)
}

async function ensureDir(dir: string): Promise<void> {
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
}

async function readJsonFile<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
  try {
    const content = await readTextFile(path)
    return schema.array().parse(JSON.parse(content))
  } catch {
    return []
  }
}

async function writeJsonFile<T>(path: string, data: T[]): Promise<void> {
  await writeTextFile(path, JSON.stringify(data, null, 2))
}

export async function savePromptEvolution(
  projectDir: string,
  evolution: Omit<PromptEvolution, "id" | "createdAt" | "usageCount">,
): Promise<PromptEvolution> {
  const dir = getEvolutionDir(projectDir)
  await ensureDir(dir)

  const prompts = await readJsonFile(`${dir}/prompts.json`, PromptEvolution)
  const newEvolution: PromptEvolution = {
    ...evolution,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    usageCount: 0,
  }
  prompts.push(newEvolution)
  await writeJsonFile(`${dir}/prompts.json`, prompts)
  return newEvolution
}

export async function getPromptEvolutions(projectDir: string): Promise<PromptEvolution[]> {
  const dir = getEvolutionDir(projectDir)
  return readJsonFile(`${dir}/prompts.json`, PromptEvolution)
}

export async function saveSkillEvolution(
  projectDir: string,
  skill: Omit<SkillEvolution, "id" | "createdAt" | "status">,
): Promise<SkillEvolution> {
  const dir = getEvolutionDir(projectDir)
  await ensureDir(dir)

  const skills = await readJsonFile(`${dir}/skills.json`, SkillEvolution)
  const newSkill: SkillEvolution = {
    ...skill,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    status: "draft",
  }
  skills.push(newSkill)
  await writeJsonFile(`${dir}/skills.json`, skills)
  return newSkill
}

export async function getSkillEvolutions(
  projectDir: string,
  status?: SkillEvolution["status"],
): Promise<SkillEvolution[]> {
  const dir = getEvolutionDir(projectDir)
  const skills = await readJsonFile(`${dir}/skills.json`, SkillEvolution)
  return status ? skills.filter((s) => s.status === status) : skills
}

export async function updateSkillStatus(
  projectDir: string,
  skillID: string,
  status: SkillEvolution["status"],
): Promise<void> {
  const dir = getEvolutionDir(projectDir)
  const skills = await readJsonFile(`${dir}/skills.json`, SkillEvolution)
  const idx = skills.findIndex((s) => s.id === skillID)
  if (idx >= 0) {
    skills[idx].status = status
    await writeJsonFile(`${dir}/skills.json`, skills)
  }
}

export async function saveMemory(
  projectDir: string,
  entry: Omit<MemoryEntry, "id" | "createdAt" | "lastUsedAt" | "usageCount">,
): Promise<MemoryEntry> {
  const dir = getEvolutionDir(projectDir)
  await ensureDir(dir)

  const memories = await readJsonFile(`${dir}/memories.json`, MemoryEntry)
  const newMemory: MemoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    usageCount: 0,
  }
  memories.push(newMemory)
  await writeJsonFile(`${dir}/memories.json`, memories)
  return newMemory
}

export async function getMemories(projectDir: string, key?: string): Promise<MemoryEntry[]> {
  const dir = getEvolutionDir(projectDir)
  const memories = await readJsonFile(`${dir}/memories.json`, MemoryEntry)
  return key ? memories.filter((m) => m.key.includes(key)) : memories
}

export async function incrementMemoryUsage(projectDir: string, memoryID: string): Promise<void> {
  const dir = getEvolutionDir(projectDir)
  const memories = await readJsonFile(`${dir}/memories.json`, MemoryEntry)
  const idx = memories.findIndex((m) => m.id === memoryID)
  if (idx >= 0) {
    memories[idx].usageCount++
    memories[idx].lastUsedAt = Date.now()
    await writeJsonFile(`${dir}/memories.json`, memories)
  }
}
```

**Step 4: Create test file**

```typescript
// packages/opencode/test/evolution/store.test.ts
import { describe, test, expect, beforeEach } from "bun:test"
import {
  savePromptEvolution,
  getPromptEvolutions,
  saveSkillEvolution,
  getSkillEvolutions,
  updateSkillStatus,
  saveMemory,
  getMemories,
} from "../../src/evolution/store"
import { resolve } from "path"
import { rm } from "bun"

const testDir = resolve(__dirname, ".test-evolution")

describe("Evolution Store", () => {
  beforeEach(async () => {
    try {
      await rm(testDir, { recursive: true })
    } catch {}
  })

  test("save and get prompt evolutions", async () => {
    const evolution = await savePromptEvolution(testDir, {
      originalPrompt: "You are a coder",
      optimizedPrompt: "You are an expert coder who writes clean code",
      reason: "Added expertise emphasis based on task analysis",
      sessionID: "ses123",
    })

    const evolutions = await getPromptEvolutions(testDir)
    expect(evolutions.length).toBe(1)
    expect(evolutions[0].optimizedPrompt).toBe("You are an expert coder who writes clean code")
  })

  test("save and get skill evolutions", async () => {
    const skill = await saveSkillEvolution(testDir, {
      name: "test-skill",
      description: "A test skill",
      content: "# Test Skill\n\nDo things",
      triggerPatterns: ["test", "demo"],
      sessionID: "ses123",
    })

    const skills = await getSkillEvolutions(testDir)
    expect(skills.length).toBe(1)
    expect(skills[0].status).toBe("draft")
  })

  test("update skill status", async () => {
    const skill = await saveSkillEvolution(testDir, {
      name: "test-skill",
      description: "A test skill",
      content: "# Test Skill",
      triggerPatterns: [],
      sessionID: "ses123",
    })

    await updateSkillStatus(testDir, skill.id, "approved")

    const approved = await getSkillEvolutions(testDir, "approved")
    expect(approved.length).toBe(1)
  })

  test("save and get memories", async () => {
    const memory = await saveMemory(testDir, {
      key: "typescript-best-practices",
      value: "Use type inference when possible",
      context: "TypeScript coding tasks",
      sessionIDs: ["ses123", "ses456"],
    })

    const memories = await getMemories(testDir)
    expect(memories.length).toBe(1)
    expect(memories[0].key).toBe("typescript-best-practices")
  })
})
```

**Step 5: Run test to verify it fails**

Expected: Test files don't exist yet, compilation errors

**Step 6: Run test after implementation**

Run: `cd packages/opencode && bun test test/evolution/store.test.ts`
Expected: PASS

---

## Task 2: Create Reflection Agent for Prompt Optimization

**Files:**

- Create: `packages/opencode/src/evolution/prompt.ts`
- Modify: `packages/opencode/src/evolution/index.ts`

**Step 1: Create prompt evolution module**

```typescript
// packages/opencode/src/evolution/prompt.ts
import type { MessageV2 } from "@opencode-ai/sdk"
import { savePromptEvolution, getPromptEvolutions } from "./store"

const REFLECTION_PROMPT = `You are an expert at analyzing agent interactions and optimizing system prompts.

Analyze the following session interaction and provide improved system prompts if needed.

Session Summary:
- Task: {task}
- Success: {success}
- Issues: {issues}

Recent Messages:
{messages}

Based on this analysis:
1. What prompt improvements would help the agent perform better?
2. What specific instructions were missing?
3. What worked well that should be emphasized?

Respond in JSON format:
{{
  "shouldOptimize": boolean,
  "optimizedPrompt": string (if shouldOptimize is true),
  "reason": string (explain why this optimization would help)
}}`

export interface ReflectionInput {
  task: string
  success: boolean
  issues: string[]
  messages: MessageV2.WithParts[]
}

export async function reflectOnSession(
  projectDir: string,
  sessionID: string,
  input: ReflectionInput,
): Promise<{ shouldOptimize: boolean; optimizedPrompt?: string; reason?: string }> {
  // Build messages for reflection
  const messageTexts = input.messages
    .slice(-10)
    .map((m) => `[${m.role}]: ${m.parts.map((p) => ("text" in p ? p.text : "")).join(" ")}`)
    .join("\n\n")

  const prompt = REFLECTION_PROMPT.replace("{task}", input.task)
    .replace("{success}", input.success ? "Yes" : "No")
    .replace("{issues}", input.issues.join(", ") || "None")
    .replace("{messages}", messageTexts)

  // In a full implementation, this would call the LLM
  // For now, return a simple heuristic-based response
  return {
    shouldOptimize: false,
    reason: "Self-reflection disabled for initial implementation",
  }
}

export async function suggestPromptOptimization(
  projectDir: string,
  agentName: string,
  currentPrompt: string,
  taskContext: string,
): Promise<string | null> {
  const evolutions = await getPromptEvolutions(projectDir)

  // Find relevant evolutions for this agent type
  const relevant = evolutions.filter(
    (e) =>
      e.originalPrompt.includes(agentName) ||
      e.originalPrompt.split("\n")[0].toLowerCase().includes(agentName.toLowerCase()),
  )

  if (relevant.length === 0) return null

  // Return the most used evolution
  return relevant.sort((a, b) => b.usageCount - a.usageCount)[0]?.optimizedPrompt ?? null
}
```

**Step 2: Export from index**

```typescript
// packages/opencode/src/evolution/index.ts (add)
export * from "./prompt"
export * from "./skill"
export * from "./memory"
```

---

## Task 3: Create Skill Generation System

**Files:**

- Create: `packages/opencode/src/evolution/skill.ts`
- Modify: `packages/opencode/src/evolution/index.ts`

**Step 1: Create skill evolution module**

```typescript
// packages/opencode/src/evolution/skill.ts
import { mkdir, writeTextFile, exists } from "bun"
import { resolve } from "path"
import { saveSkillEvolution, getSkillEvolutions, updateSkillStatus } from "./store"

export interface SkillPattern {
  name: string
  description: string
  triggerPatterns: string[]
  template: string
}

const SKILL_GENERATION_PROMPT = `Analyze this task and determine if it should be turned into a reusable skill.

Task: {task}
Tool calls: {toolCalls}
Success: {success}

Should this be a skill? Respond in JSON:
{{
  "shouldCreate": boolean,
  "skillName": string (kebab-case),
  "skillDescription": string (2-3 sentences),
  "triggerPatterns": string[] (keywords that would trigger this skill),
  "skillContent": string (the SKILL.md content with instructions)
}}`

export async function analyzeTaskForSkill(
  projectDir: string,
  sessionID: string,
  task: string,
  toolCalls: string[],
  success: boolean,
): Promise<{ shouldCreate: boolean; skill?: Omit<import("./types").SkillEvolution, "id" | "createdAt" | "status"> }> {
  if (!success) return { shouldCreate: false }

  // Simple heuristic: only create skill if multiple similar tool calls
  const toolFrequency = toolCalls.reduce(
    (acc, call) => {
      const toolName = call.split(" ")[0]
      acc[toolName] = (acc[toolName] || 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )

  const repeatedTools = Object.entries(toolFrequency).filter(([_, count]) => count >= 3)

  if (repeatedTools.length === 0) {
    return { shouldCreate: false }
  }

  // Generate skill content based on tool patterns
  const skillName = `auto-${repeatedTools[0][0].toLowerCase()}-task`
  const skillContent = generateSkillContent(
    task,
    repeatedTools.map(([tool]) => tool),
  )

  const skillData = {
    name: skillName,
    description: `Auto-generated skill for ${task.slice(0, 100)}`,
    content: skillContent,
    triggerPatterns: extractKeywords(task),
    sessionID,
  }

  // Save as draft (requires approval)
  const saved = await saveSkillEvolution(projectDir, skillData)

  return {
    shouldCreate: true,
    skill: { ...skillData, id: saved.id, createdAt: saved.createdAt, status: saved.status },
  }
}

function generateSkillContent(task: string, tools: string[]): string {
  return `# ${task.slice(0, 50)}

## Description

Auto-generated skill for: ${task}

## Triggers

This skill activates when:
${tools.map((t) => `- Working with ${t} operations`).join("\n")}

## Actions

1. Analyze the task requirements
2. Execute relevant tool calls
3. Verify results

## Notes

Generated from session analysis on ${new Date().toISOString().split("T")[0]}
`
}

function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3)

  // Return top keywords
  return [...new Set(words)].slice(0, 5)
}

export async function approveSkill(projectDir: string, skillID: string): Promise<string | null> {
  await updateSkillStatus(projectDir, skillID, "approved")

  const skills = await getSkillEvolutions(projectDir, "approved")
  const skill = skills.find((s) => s.id === skillID)

  if (!skill) return null

  // Create actual skill file
  const skillDir = resolve(projectDir, ".opencode/skills", skill.name)
  await mkdir(skillDir, { recursive: true })

  const skillFile = resolve(skillDir, "SKILL.md")
  await writeTextFile(skillFile, skill.content)

  return skillDir
}

export async function rejectSkill(projectDir: string, skillID: string): Promise<void> {
  await updateSkillStatus(projectDir, skillID, "rejected")
}

export async function getPendingSkills(projectDir: string) {
  return getSkillEvolutions(projectDir, "draft")
}
```

---

## Task 4: Create Memory Enhancement System

**Files:**

- Create: `packages/opencode/src/evolution/memory.ts`
- Modify: `packages/opencode/src/evolution/index.ts`

**Step 1: Create memory module**

```typescript
// packages/opencode/src/evolution/memory.ts
import { saveMemory, getMemories, incrementMemoryUsage } from "./store"

export interface MemorySuggestion {
  key: string
  value: string
  relevance: number
}

const MEMORY_EXTRACTION_PROMPT = `Extract actionable memories from this session that would help future sessions.

Session task: {task}
Tool calls: {toolCalls}
Outcome: {outcome}

Extract learnings that could help future similar tasks. Respond in JSON:
{{
  "memories": [
    {{
      "key": string (short identifier like "typescript-types"),
      "value": string (actionable insight),
      "context": string (when to apply this)
    }}
  ]
}}`

export async function extractMemories(
  projectDir: string,
  sessionID: string,
  task: string,
  toolCalls: string[],
  outcome: string,
): Promise<void> {
  // Simple heuristic extraction
  const memoryPatterns = [
    {
      pattern: /typescript|tsconfig|type annotation/i,
      key: "typescript-tips",
      value: "Use explicit type annotations for better clarity",
    },
    {
      pattern: /test|testing|jest|vitest/i,
      key: "testing-approach",
      value: "Write tests first (TDD) for better design",
    },
    { pattern: /refactor|clean|improve/i, key: "refactoring-guidance", value: "Make small, incremental changes" },
    { pattern: /error|bug|fix|issue/i, key: "debugging-tips", value: "Start with minimal reproduction case" },
  ]

  for (const { pattern, key, value } of memoryPatterns) {
    if (pattern.test(task) || toolCalls.some((c) => pattern.test(c))) {
      await saveMemory(projectDir, {
        key,
        value,
        context: task,
        sessionIDs: [sessionID],
      })
    }
  }
}

export async function getRelevantMemories(projectDir: string, currentTask: string): Promise<MemorySuggestion[]> {
  const allMemories = await getMemories(projectDir)

  if (allMemories.length === 0) return []

  // Score memories by keyword relevance
  const taskWords = currentTask.toLowerCase().split(/\s+/)

  return allMemories
    .map((memory) => {
      const relevance = taskWords.filter((word) => memory.key.includes(word) || memory.value.includes(word)).length

      return {
        key: memory.key,
        value: memory.value,
        relevance,
      }
    })
    .filter((m) => m.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 5)
}
```

---

## Task 5: Integrate Evolution into Session Flow

**Files:**

- Modify: `packages/opencode/src/session/index.ts`
- Modify: `packages/opencode/src/agent/agent.ts`

**Step 1: Add evolution hooks to session completion**

In session/index.ts, after session completes:

```typescript
// In session completion handler
import { reflectOnSession } from "../evolution/prompt"
import { analyzeTaskForSkill } from "../evolution/skill"
import { extractMemories } from "../evolution/memory"

// After task completion
async function handleSessionEvolution(sessionID: string, directory: string) {
  const session = await Session.get(sessionID)
  const messages = await Message.list(sessionID)

  // 1. Prompt reflection (for future optimization)
  await reflectOnSession(directory, sessionID, {
    task: session.title,
    success: true, // Determine from outcome
    issues: [],
    messages,
  })

  // 2. Skill generation
  const toolCalls = extractToolCalls(messages)
  await analyzeTaskForSkill(directory, sessionID, session.title, toolCalls, true)

  // 3. Memory extraction
  await extractMemories(directory, sessionID, session.title, toolCalls, "completed")
}

function extractToolCalls(messages: MessageV2.WithParts[]): string[] {
  return messages.flatMap((m) => m.parts.filter((p) => "tool" in p).map((p) => (p as any).tool))
}
```

**Step 2: Add evolution to agent startup**

In agent/agent.ts, when loading agent:

```typescript
import { suggestPromptOptimization } from "../evolution/prompt"
import { getRelevantMemories } from "../evolution/memory"

// In agent loading
async function loadAgent(directory: string, agentName: string, basePrompt: string) {
  // Get optimized prompt if available
  const optimizedPrompt = await suggestPromptOptimization(directory, agentName, basePrompt, "")

  // Get relevant memories
  const memories = await getRelevantMemories(directory, "")

  return {
    prompt: optimizedPrompt || basePrompt,
    memories,
  }
}
```

---

## Task 6: Add CLI Commands for Evolution Management

**Files:**

- Modify: `packages/opencode/src/cli/cmd/evolve.ts` (create)
- Modify: `packages/opencode/src/cli/index.ts`

**Step 1: Create evolve command**

```typescript
// packages/opencode/src/cli/cmd/evolve.ts
import { Command } from "cliffy"
import { getSkillEvolutions, getPromptEvolutions, getMemories, approveSkill, rejectSkill } from "../../evolution/store"
import { getPendingSkills, approveSkill as approve, rejectSkill as reject } from "../../evolution/skill"
import { resolve } from "path"

export const EvolveCommand = new Command()
  .name("evolve")
  .description("Manage self-evolving agent system")
  .action(async () => {
    console.log("Use: evolve list | approve <id> | reject <id> | memories")
  })

EvolveCommand.command("list")
  .description("List evolution artifacts")
  .action(async () => {
    const dir = process.cwd()
    const [prompts, skills, memories] = await Promise.all([
      getPromptEvolutions(dir),
      getSkillEvolutions(dir),
      getMemories(dir),
    ])

    console.log("\n=== Prompt Optimizations ===")
    console.log(prompts.length, "optimizations")

    console.log("\n=== Generated Skills ===")
    for (const s of skills) {
      console.log(`[${s.status}] ${s.name}: ${s.description}`)
    }

    console.log("\n=== Memories ===")
    console.log(memories.length, "memories")
  })

EvolveCommand.command("approve")
  .param("skillID")
  .description("Approve and create a skill")
  .action(async ({ skillID }) => {
    const dir = process.cwd()
    const skillDir = await approve(dir, skillID)
    console.log(`Skill created at: ${skillDir}`)
  })

EvolveCommand.command("reject")
  .param("skillID")
  .description("Reject a skill proposal")
  .action(async ({ skillID }) => {
    const dir = process.cwd()
    await reject(dir, skillID)
    console.log("Skill rejected")
  })

EvolveCommand.command("memories")
  .description("List learned memories")
  .action(async () => {
    const dir = process.cwd()
    const memories = await getMemories(dir)
    for (const m of memories) {
      console.log(`\n[${m.key}]`)
      console.log(`  ${m.value}`)
      console.log(`  Used ${m.usageCount} times`)
    }
  })
```

---

## Task 7: Add TUI Integration for Skill Approval

**Files:**

- Modify: `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx`

**Step 1: Add pending skills indicator**

In sidebar.tsx, add:

```tsx
// In the plugins section or create new "Evolution" section
const pendingSkills = createMemo(() => {
  // Fetch from sync store (needs event integration)
  return []
})

// Add UI element
<Show when={pendingSkills().length > 0}>
  <box>
    <text fg={theme.warning}>
      ⚠ {pendingSkills().length} skills pending approval
    </text>
  </box>
</Show>
```

---

## Summary

| Task | Description                                       |
| ---- | ------------------------------------------------- |
| 1    | Evolution storage system (file-based persistence) |
| 2    | Prompt self-optimization via reflection           |
| 3    | Skill dynamic generation                          |
| 4    | Memory enhancement system                         |
| 5    | Integration into session/agent flow               |
| 6    | CLI commands for management                       |
| 7    | TUI integration for skill approval                |

---

**Plan complete.** Save this plan to `docs/plans/2026-02-26-self-evolving-agent.md`

Two execution options:

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
