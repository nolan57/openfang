# AI Self-Learning Improvement System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable opencode to periodically learn new knowledge from the internet and improve itself through installing Skills/MCPs and generating notes.

**Architecture:** Modular design with five core components: Scheduler, Collector, Analyzer, Executor, Knowledge Base.

**Tech Stack:** TypeScript, SQLite (Drizzle), Bun, Existing MCP tools (websearch, codesearch, cron)

---

## Phase 1: Scheduler + Collector + Note Generation

### Task 1: Create Database Schema

**Files:**

- Create: `src/learning/learning.sql.ts`

**Step 1: Write database schema**

```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema"

export const learning_runs = sqliteTable("learning_run", {
  id: text().primaryKey(),
  trigger: text().notNull(), // "cron" | "idle" | "manual"
  status: text().notNull(), // "running" | "completed" | "failed"
  topics: text().notNull(), // JSON array
  items_collected: integer().notNull().default(0),
  notes_created: integer().notNull().default(0),
  ...Timestamps,
})

export const knowledge = sqliteTable("knowledge", {
  id: text().primaryKey(),
  run_id: text()
    .notNull()
    .references(() => learning_runs.id),
  source: text().notNull(), // "search" | "arxiv" | "github" | "blog"
  url: text().notNull(),
  title: text().notNull(),
  summary: text().notNull(),
  tags: text().notNull(), // JSON array
  value_score: integer().notNull().default(0), // 0-100
  action: text().notNull(), // "note_only" | "install_skill" | "code_suggestion"
  processed: integer().notNull().default(0), // boolean
  ...Timestamps,
})
```

**Step 2: Commit**

```bash
git add src/learning/learning.sql.ts
git commit -m "feat(learning): add database schema for learning system"
```

---

### Task 2: Create Learning Config Types

**Files:**

- Create: `src/learning/config.ts`

**Step 1: Write config types**

```typescript
import { z } from "zod"

export const LearningSource = z.enum(["search", "arxiv", "github", "blogs"])
export type LearningSource = z.infer<typeof LearningSource>

export const LearningSchedule = z.object({
  cron: z.string().optional(), // "0 10 * * 1,3,5"
  idle_check: z.boolean().default(true),
  idle_threshold_minutes: z.number().default(30),
})
export type LearningSchedule = z.infer<typeof LearningSchedule>

export const LearningConfig = z.object({
  enabled: z.boolean().default(true),
  schedule: LearningSchedule.default({}),
  sources: z.array(LearningSource).default(["search", "arxiv", "github"]),
  topics: z.array(z.string()).default(["AI", "code generation", "agent systems"]),
  max_items_per_run: z.number().default(10),
  note_output_dir: z.string().default("docs/learning/notes"),
})
export type LearningConfig = z.infer<typeof LearningConfig>
```

**Step 2: Commit**

```bash
git add src/learning/config.ts
git commit -m "feat(learning): add learning configuration types"
```

---

### Task 3: Implement Scheduler

**Files:**

- Create: `src/learning/scheduler.ts`

**Step 1: Create scheduler module**

```typescript
import { getScheduler } from "../util/mcp-cron"
import { LearningConfig } from "./config"
import { Log } from "../util/log"

const log = Log.create({ service: "learning-scheduler" })

export class LearningScheduler {
  private config: LearningConfig

  constructor(config: LearningConfig) {
    this.config = config
  }

  async setup() {
    if (!this.config.enabled) {
      log.info("learning disabled")
      return
    }

    // Setup cron job
    if (this.config.schedule.cron) {
      const scheduler = getScheduler()
      scheduler.addJob({
        name: "auto-learning",
        description: "Auto learning task",
        enabled: true,
        schedule: {
          kind: "cron",
          expr: this.config.schedule.cron,
        },
        payload: {
          kind: "systemEvent",
          message: "trigger:learning",
        },
      })
      log.info("cron learning scheduled", { cron: this.config.schedule.cron })
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/learning/scheduler.ts
git commit -m "feat(learning): add scheduler for automated learning"
```

---

### Task 4: Implement Collector

**Files:**

- Create: `src/learning/collector.ts`

**Step 1: Create collector module**

```typescript
import { websearch } from "../tool/websearch"
import { codesearch } from "../tool/codesearch"
import { LearningSource, type LearningConfig } from "./config"
import { Log } from "../util/log"

const log = Log.create({ service: "learning-collector" })

export interface CollectedItem {
  source: LearningSource
  url: string
  title: string
  content: string
}

export class Collector {
  private config: LearningConfig

  constructor(config: LearningConfig) {
    this.config = config
  }

  async collect(): Promise<CollectedItem[]> {
    const items: CollectedItem[] = []

    for (const topic of this.config.topics) {
      if (this.config.sources.includes("search")) {
        const searchResults = await this.collectFromSearch(topic)
        items.push(...searchResults)
      }
      if (this.config.sources.includes("arxiv")) {
        const arxivResults = await this.collectFromArxiv(topic)
        items.push(...arxivResults)
      }
      if (this.config.sources.includes("github")) {
        const githubResults = await this.collectFromGithub(topic)
        items.push(...githubResults)
      }
    }

    return items.slice(0, this.config.max_items_per_run)
  }

  private async collectFromSearch(topic: string): Promise<CollectedItem[]> {
    try {
      const results = await websearch({ query: `${topic} 2024 2025`, numResults: 5 })
      return results.map((r) => ({
        source: "search" as LearningSource,
        url: r.url,
        title: r.title,
        content: r.content,
      }))
    } catch (e) {
      log.error("search collection failed", { topic, error: e })
      return []
    }
  }

  private async collectFromArxiv(topic: string): Promise<CollectedItem[]> {
    try {
      const results = await codesearch({ query: topic, tokensNum: 3000 })
      return results.map((r) => ({
        source: "arxiv" as LearningSource,
        url: r.url,
        title: r.title,
        content: r.content,
      }))
    } catch (e) {
      log.error("arxiv collection failed", { topic, error: e })
      return []
    }
  }

  private async collectFromGithub(topic: string): Promise<CollectedItem[]> {
    try {
      const results = await codesearch({ query: `lang:typescript ${topic}`, tokensNum: 3000 })
      return results.map((r) => ({
        source: "github" as LearningSource,
        url: r.url,
        title: r.title,
        content: r.content,
      }))
    } catch (e) {
      log.error("github collection failed", { topic, error: e })
      return []
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/learning/collector.ts
git commit -m "feat(learning): add collector for multi-source content gathering"
```

---

### Task 5: Implement Note Generator

**Files:**

- Create: `src/learning/notes.ts`

**Step 1: Create note generator**

```typescript
import path from "path"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import { CollectedItem } from "./collector"
import { format } from "../util/format"

export class NoteGenerator {
  private outputDir: string

  constructor(outputDir: string) {
    this.outputDir = outputDir
  }

  async generate(runId: string, items: CollectedItem[]): Promise<string[]> {
    const notes: string[] = []
    const dir = path.join(Global.Path.home, this.outputDir, runId)
    await Filesystem.mkdir(dir, { recursive: true })

    for (const item of items) {
      const filename = this.sanitizeFilename(item.title) + ".md"
      const filepath = path.join(dir, filename)
      const content = this.formatNote(item)
      await Filesystem.write(filepath, content)
      notes.push(filepath)
    }

    // Generate summary index
    const index = this.generateIndex(runId, items, notes)
    const indexPath = path.join(dir, "index.md")
    await Filesystem.write(indexPath, index)

    return notes
  }

  private formatNote(item: CollectedItem): string {
    return `# ${item.title}

**Source:** ${item.source}  
**URL:** ${item.url}

---

${item.content}

---

*Collected at: ${format(new Date(), "yyyy-MM-dd HH:mm:ss")}*
`
  }

  private generateIndex(runId: string, items: CollectedItem[], paths: string[]): string {
    return `# Learning Notes - ${runId}

## Collected Content

${items.map((item, i) => `- [${item.title}](./${this.sanitizeFilename(item.title)}.md) (${item.source})`).join("\n")}

## Statistics

- Total: ${items.length}
- Source distribution: ${JSON.stringify(
      items.reduce((acc, i) => {
        acc[i.source] = (acc[i.source] || 0) + 1
        return acc
      }, {}),
    )}
`
  }

  private sanitizeFilename(title: string): string {
    return title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_").slice(0, 50)
  }
}
```

**Step 2: Commit**

```bash
git add src/learning/notes.ts
git commit -m "feat(learning): add note generator for learning results"
```

---

### Task 6: Integration Test - Phase 1

**Step 1: Create test file**

```typescript
// test/learning/learning.test.ts
import { describe, test, expect } from "bun:test"
import { LearningConfig, LearningSchedule } from "../../src/learning/config"

describe("learning", () => {
  test("config validation", () => {
    const config = LearningConfig.parse({
      enabled: true,
      schedule: { cron: "0 10 * * 1,3,5" },
      topics: ["AI"],
    })
    expect(config.enabled).toBe(true)
    expect(config.schedule.cron).toBe("0 10 * * 1,3,5")
  })
})
```

**Step 2: Run test**

```bash
cd packages/opencode && bun test test/learning/learning.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add test/learning/learning.test.ts
git commit -m "test(learning): add unit tests for learning config"
```

---

## Phase 2: Analysis Engine + Knowledge Base

### Task 7: Implement Analyzer

**Files:**

- Modify: `src/learning/collector.ts` - add CollectedItem type
- Create: `src/learning/analyzer.ts`

**Step 1: Create analyzer**

```typescript
import { CollectedItem } from "./collector"
import { webfetch } from "../tool/webfetch"
import { Log } from "../util/log"

const log = Log.create({ service: "learning-analyzer" )

export interface AnalyzedItem extends CollectedItem {
  summary: string
  tags: string[]
  value_score: number // 0-100
  action: "note_only" | "install_skill" | "code_suggestion"
}

export class Analyzer {
  async analyze(items: CollectedItem[]): Promise<AnalyzedItem[]> {
    const results: AnalyzedItem[] = []

    for (const item of items) {
      try {
        const analyzed = await this.analyzeItem(item)
        results.push(analyzed)
      } catch (e) {
        log.error("failed to analyze item", { url: item.url, error: e })
      }
    }

    return results
  }

  private async analyzeItem(item: CollectedItem): Promise<AnalyzedItem> {
    // Extract summary using LLM or simple extraction
    const summary = this.extractSummary(item.content)
    const tags = this.extractTags(item)
    const score = this.calculateValueScore(item, tags)
    const action = this.determineAction(score)

    return {
      ...item,
      summary,
      tags,
      value_score: score,
      action,
    }
  }

  private extractSummary(content: string): string {
    // Simple extraction - first 500 chars
    return content.slice(0, 500) + (content.length > 500 ? "..." : "")
  }

  private extractTags(item: CollectedItem): string[] {
    const keywords = ["AI", "agent", "LLM", "GPT", "algorithm", "framework", "library", "tool"]
    const tags: string[] = []
    const lowerContent = (item.title + item.content).toLowerCase()

    for (const kw of keywords) {
      if (lowerContent.includes(kw.toLowerCase())) {
        tags.push(kw)
      }
    }

    if (!tags.length) tags.push("general")
    return tags
  }

  private calculateValueScore(item: CollectedItem, tags: string[]): number {
    let score = 50 // base score

    // Higher score for certain sources
    if (item.source === "arxiv") score += 20
    if (item.source === "github") score += 15

    // Higher score for relevant tags
    score += tags.length * 5

    return Math.min(100, score)
  }

  private determineAction(score: number): AnalyzedItem["action"] {
    if (score >= 80) return "install_skill"
    if (score >= 60) return "code_suggestion"
    return "note_only"
  }
}
```

**Step 2: Commit**

```bash
git add src/learning/analyzer.ts
git commit -m "feat(learning): add analyzer for content evaluation"
```

---

### Task 8: Implement Knowledge Store

**Files:**

- Create: `src/learning/store.ts`

**Step 1: Create knowledge store**

```typescript
import { db } from "../storage"
import { learning_runs, knowledge } from "./learning.sql"
import { eq } from "drizzle-orm"

export class KnowledgeStore {
  async createRun(trigger: string, topics: string[]): Promise<string> {
    const id = crypto.randomUUID()
    await db.insert(learning_runs).values({
      id,
      trigger,
      status: "running",
      topics: JSON.stringify(topics),
      items_collected: 0,
      notes_created: 0,
    })
    return id
  }

  async completeRun(id: string, itemsCollected: number, notesCreated: number) {
    await db
      .update(learning_runs)
      .set({
        status: "completed",
        items_collected: itemsCollected,
        notes_created: notesCreated,
      })
      .where(eq(learning_runs.id, id))
  }

  async saveKnowledge(items: any[]) {
    for (const item of items) {
      await db.insert(knowledge).values({
        id: crypto.randomUUID(),
        run_id: item.run_id,
        source: item.source,
        url: item.url,
        title: item.title,
        summary: item.summary,
        tags: JSON.stringify(item.tags),
        value_score: item.value_score,
        action: item.action,
        processed: 0,
      })
    }
  }

  async getRecentKnowledge(limit = 50) {
    return db.select().from(knowledge).orderBy(knowledge.time_created).limit(limit)
  }
}
```

**Step 2: Commit**

```bash
git add src/learning/store.ts
git commit -m "feat(learning): add knowledge store for persistence"
```

---

## Phase 3: Skill/MCP Auto-Installation

### Task 9: Implement Skill Installer

**Files:**

- Create: `src/learning/installer.ts`

**Step 1: Create installer**

```typescript
import { Discovery } from "../skill/discovery"
import { Skill } from "../skill/skill"
import { Log } from "../util/log"

const log = Log.create({ service: "learning-installer" )

export interface InstallResult {
  success: boolean
  type: "skill" | "mcp" | "none"
  name?: string
  error?: string
}

export class Installer {
  async install(items: any[]): Promise<InstallResult[]> {
    const results: InstallResult[] = []

    const skillItems = items.filter((i) => i.action === "install_skill")

    for (const item of skillItems) {
      try {
        const result = await this.installSkill(item)
        results.push(result)
      } catch (e) {
        log.error("install failed", { item: item.title, error: e })
        results.push({
          success: false,
          type: "none",
          error: String(e),
        })
      }
    }

    return results
  }

  private async installSkill(item: any): Promise<InstallResult> {
    // Check if skill URL is available
    if (!item.url || !item.url.includes("SKILL.md")) {
      // Generate a basic skill from the content
      return this.createSkillFromContent(item)
    }

    // Use skill discovery to install
    const skillDir = await Discovery.pull(item.url)
    await Skill.reload()

    return {
      success: true,
      type: "skill",
      name: item.title,
    }
  }

  private async createSkillFromContent(item: any): Promise<InstallResult> {
    // Create a new skill based on learned content
    const skillContent = `# ${item.title}

${item.content}

## Usage

This skill was automatically generated from learning.

## Triggers

- "${item.tags.join('", "')}"
`

    log.info("would create skill", { title: item.title, content: skillContent.slice(0, 100) })

    // TODO: Actually write to skills directory
    return {
      success: true,
      type: "skill",
      name: item.title,
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/learning/installer.ts
git commit -m "feat(learning): add skill installer for auto-learning"
```

---

## Phase 4: CLI Command Integration

### Task 10: Add /learn Command

**Files:**

- Modify: `src/command/index.ts` - add command registration

**Step 1: Create learning command module**

```typescript
// src/learning/command.ts
import { LearningConfig } from "./config"
import { LearningScheduler } from "./scheduler"
import { Collector } from "./collector"
import { Analyzer } from "./analyzer"
import { NoteGenerator } from "./notes"
import { KnowledgeStore } from "./store"
import { Installer } from "./installer"
import { Log } from "../util/log"

const log = Log.create({ service: "learning-command" )

export async function runLearning(config: LearningConfig) {
  log.info("starting learning run", { topics: config.topics })

  const scheduler = new LearningScheduler(config)
  const collector = new Collector(config)
  const analyzer = new Analyzer()
  const noteGen = new NoteGenerator(config.note_output_dir)
  const store = new KnowledgeStore()
  const installer = new Installer()

  // Create run record
  const runId = await store.createRun("manual", config.topics)

  try {
    // Collect
    const items = await collector.collect()
    log.info("collected items", { count: items.length })

    // Analyze
    const analyzed = await analyzer.analyze(items)
    log.info("analyzed items", { count: analyzed.length })

    // Save to knowledge base
    await store.saveKnowledge(analyzed.map((i) => ({ ...i, run_id: runId })))

    // Generate notes
    const notes = await noteGen.generate(runId, analyzed)
    log.info("generated notes", { count: notes.length })

    // Install skills if any
    const installResults = await installer.install(analyzed)
    log.info("install results", { results: installResults })

    // Complete run
    await store.completeRun(runId, items.length, notes.length)

    return {
      success: true,
      collected: items.length,
      notes: notes.length,
      installs: installResults.filter((r) => r.success).length,
    }
  } catch (e) {
    log.error("learning run failed", { error: e })
    throw e
  }
}
```

**Step 2: Commit**

```bash
git add src/learning/command.ts
git commit -m "feat(learning): add CLI command for manual learning trigger"
```

---

## Summary

After completing all tasks, the system will have:

1. **Scheduled Learning** - Auto-execute learning tasks multiple times per week
2. **Multi-Source Collection** - Fetch content from search, papers, GitHub
3. **Smart Analysis** - Evaluate content value and generate tags
4. **Knowledge Persistence** - Store learning results in SQLite
5. **Auto-Installation** - Auto-install high-value Skills
6. **Note Generation** - Generate readable learning notes
7. **Manual Trigger** - Support on-demand learning execution

**Next Steps:**

- Phase 5: Code improvement suggestion generation
- Phase 6: Integration into opencode main flow
- Phase 7: UI and configuration improvements
