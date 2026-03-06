# Novel Writing Engine: Auto-Extraction & CLI Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend self-evolution system to read specification documents and auto-generate implementation code.

**Architecture:** 
1. Add `spec_file` parameter to evolve tool
2. Evolution reads spec → generates code → writes files via Deployer
3. Use the extended system to implement novel writing features

**Tech Stack:** Extended evolve tool, LLM code generation, Deployer for file writes.

---

## Current Limitation

Current `evolve` tool only accepts `topics: string[]`:
```typescript
// packages/opencode/src/tool/learning.ts
topics: z.array(z.string()).optional()  // Only keywords!
```

Cannot pass detailed spec like `docs/plans/novel-implementation-plan.md`.

---

## Phase 1: Extend Evolve Tool to Support Specification Files

### Task 1: Add spec_file Parameter to Evolve Tool

**Files:**
- Modify: `packages/opencode/src/tool/learning.ts:62-72`
- Modify: `packages/opencode/src/learning/command.ts`

**Step 1: Add spec_file parameter**

```typescript
// In packages/opencode/src/tool/learning.ts, modify EvolveTool:
export const EvolveTool = Tool.define("evolve", async () => {
  return {
    description: "Trigger OpenCode self-evolution system - collect, analyze, and evolve",
    parameters: z.object({
      mode: z
        .enum(["full", "execute", "status", "check", "trigger", "monitor"])
        .optional()
        .default("full")
        .describe("Evolution mode"),
      topics: z.array(z.string()).optional().describe("Custom topics (default: from config evolution.directions)"),
      spec_file: z.string().optional().describe("Path to specification document (markdown/json) to implement"),
    }),
    // ...
  }
})
```

**Step 2: Modify runLearning to handle spec_file**

```typescript
// In packages/opencode/src/learning/command.ts

export async function runLearning(config?: Partial<LearningConfig>): Promise<LearningResult> {
  // ... existing config merging ...

  // If spec_file is provided, use spec-driven mode
  if (finalConfig.spec_file) {
    return runSpecImplementation(finalConfig.spec_file)
  }

  // Otherwise, use existing web-collecting mode
  // ... existing logic ...
}

async function runSpecImplementation(specFilePath: string): Promise<LearningResult> {
  const specContent = await readFile(specFilePath, "utf-8")
  
  // Use LLM to generate code from spec
  const generated = await llmGenerateFromSpec(specContent)
  
  // Write files via Deployer
  const deployer = new Deployer()
  for (const file of generated.files) {
    await deployer.createTask({
      type: "code_change",
      title: `Implement ${file.path}`,
      description: file.description,
      changes: { files: [file.path], diff_summary: file.summary },
      commands: [`write ${file.path} ${file.content}`],
      rollback_commands: [`rm ${file.path}`],
    })
  }
  
  // Execute tasks
  await deployer.executePending()
  
  return { success: true, collected: 0, notes: 0, installs: 0, suggestions: generated.files.length }
}
```

**Step 3: Test - verify file compiles**

Run: `cd packages/opencode && bun run typecheck`

**Step 4: Commit**

```bash
git add packages/opencode/src/tool/learning.ts packages/opencode/src/learning/command.ts
git commit -m "feat: add spec_file parameter to evolve tool"
```

---

## Phase 2: Use Extended Evolve to Implement Novel Features

### Task 2: Trigger Evolution with Specification

**Step 1: Run evolution with spec file**

```bash
cd packages/opencode
opencode evolve --spec-file "../todos/novel-implementation-plan.md"
```

**What happens:**
1. System reads the spec document
2. LLM analyzes requirements (PatternMiner, CLI commands, Story Bible)
3. Generates TypeScript code
4. Creates deployment tasks
5. Executes writes to files

**Step 2: Verify generated files**

```bash
ls -la src/evolution/
ls -la src/cli/cmd/
```

**Step 3: Run typecheck**

```bash
cd packages/opencode && bun run typecheck
```

---

## Phase 3: Enhanced Self-Modification Capabilities

Based on the meta-cognition analysis, we need additional capabilities for full self-evolution:

### Task 3: Add Sandbox Testing for Generated Code

**Files:**
- Modify: `packages/opencode/src/learning/command.ts`

**Step 1: Add sandbox execution**

```typescript
async function testInSandbox(code: string, testType: "typecheck" | "syntax"): Promise<boolean> {
  // Write temp file
  const tempFile = `.temp_sandbox_${Date.now()}.ts`
  await writeFile(tempFile, code)
  
  try {
    if (testType === "typecheck") {
      const result = await execAsync(`bunx tsc --noEmit ${tempFile}`)
      return result.exitCode === 0
    }
    // syntax check via bun
    const result = await execAsync(`bun build ${tempFile} --outdir /tmp 2>&1`)
    return result.exitCode === 0
  } finally {
    await rm(tempFile).catch(() => {})
  }
}
```

**Step 2: Integrate into runSpecImplementation**

```typescript
// After generating code, test before writing
for (const file of generated) {
  const isSafe = await testInSandbox(file.content, "typecheck")
  if (!isSafe) {
    log.warn("generated code failed typecheck, skipping", { path: file.path })
    continue
  }
  // Write file
}
```

---

### Task 4: Add Safety Guards (Core Code Protection)

**Files:**
- Create: `packages/opencode/src/learning/safety-guard.ts`

**Step 1: Define protected paths**

```typescript
const PROTECTED_PATHS = [
  "bin/",
  "src/index.ts",
  "src/bootstrap.ts",
]

const ALLOWED_PATHS = [
  "src/evolution/",
  "src/cli/cmd/",
  "src/skill/",
  "src/config/",
]

export function isPathAllowed(filePath: string): boolean {
  // Check if in allowed paths and NOT in protected paths
  const isAllowed = ALLOWED_PATHS.some(p => filePath.startsWith(p))
  const isProtected = PROTECTED_PATHS.some(p => filePath.startsWith(p))
  return isAllowed && !isProtected
}
```

---

### Task 5: Add Hot Reload Support

**Files:**
- Modify: `packages/opencode/src/skill/skill.ts`

**Step 1: Add dynamic skill reload**

```typescript
export async function reloadSkills(): Promise<void> {
  // Clear skill cache
  skillCache.clear()
  
  // Reload from filesystem
  await loadSkillsFromDir(path.join(Global.Path.data, "skills"))
  
  // Reload dynamic skills
  const dynamicDir = path.join(Global.Path.data, "skills", "novel-patterns")
  if (await exists(dynamicDir)) {
    await loadSkillsFromDir(dynamicDir)
  }
}
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add spec_file to evolve tool | `tool/learning.ts`, `learning/command.ts`, `learning/config.ts` |
| 2 | Run evolution with spec | CLI command |
| 3 | Add sandbox testing | `learning/command.ts` |
| 4 | Add safety guards | `learning/safety-guard.ts` |
| 5 | Add hot reload | `skill/skill.ts` |

> **Key insight:** With Tasks 3-5, the system gains "Meta-Evolution" capability:
> - Read spec → Generate code → Test in sandbox → Apply if safe → Hot reload
> - This is the "Architect Agent" mentioned in the meta-cognition analysis
> - Only the initial skill needs manual creation; subsequent features auto-generate

---

**Plan saved to:** `docs/plans/2026-03-06-novel-cli-commands.md`

**Worktree:** `.worktrees/novel-features`

**Next step:** Execute Task 2 to test spec-driven generation, then Tasks 3-5 for enhanced safety.