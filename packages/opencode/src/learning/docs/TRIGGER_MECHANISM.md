# Memory, Evolution, Learning Trigger Mechanism

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Trigger Sources                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐ │
│  │ Session End  │   │ CLI Command  │   │ Cron Schedule│   │ Code Change  │ │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘ │
│         │                  │                  │                  │          │
│         ▼                  ▼                  ▼                  ▼          │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    Trigger Manager                                       ││
│  │  • triggerSessionEndIndex()  • runLearning()  • EvolutionTrigger       ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                    │                                        │
│         ┌──────────────────────────┼──────────────────────────┐             │
│         ▼                          ▼                          ▼             │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐       │
│  │    Memory       │     │   Evolution     │     │   Learning      │       │
│  │    System       │     │   System        │     │   System        │       │
│  └─────────────────┘     └─────────────────┘     └─────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Memory System Trigger

### Trigger Path

```
User Session Ends
    │
    ▼
Session.endSession(sessionId)
    │
    └─→ Memory.endSession() [memory/service.ts:557]
            │
            ▼
        triggerSessionEndIndex() [learning/knowledge-index-manager.ts:460]
            │
            ▼
        KnowledgeIndexManager.onSessionEnd()
            │
            ├─→ Extract session messages
            ├─→ Analyze code entities (CodeAnalyzer)
            ├─→ Store to Knowledge Graph
            └─→ Store to Vector Store
```

### Trigger Code Location

**File**: `packages/opencode/src/memory/service.ts`

```typescript
async endSession(sessionId: string): Promise<void> {
  // ... end session logic ...

  // Trigger knowledge graph indexing
  try {
    const { triggerSessionEndIndex } = await import("../learning/knowledge-index-manager")
    await triggerSessionEndIndex()
  } catch (error) {
    log.warn("failed_to_trigger_session_end_index", { error: String(error) })
  }
}
```

**File**: `packages/opencode/src/learning/knowledge-index-manager.ts`

```typescript
export async function triggerSessionEndIndex(): Promise<void> {
  const manager = getKnowledgeIndexManager()
  await manager.onSessionEnd()
}
```

### Trigger Timing

| Trigger Event | Description |
|---------|------|
| `Session.endSession()` | Automatically triggered when session ends |
| `Memory.endSession()` | Memory singleton call |
| `triggerSessionEndIndex()` | Import and call index manager |

---

## 2. Evolution System Trigger

### 2.1 CLI Command Trigger

```
User executes command
    │
    ▼
opencode evolve [mode]
    │
    ├─→ opencode evolve list       # List evolution artifacts
    ├─→ opencode evolve approve    # Approve skill
    ├─→ opencode evolve reject     # Reject skill
    ├─→ opencode evolve run        # Run learning
    └─→ opencode evolve status     # Check status
```

**File**: `packages/opencode/src/cli/cmd/evolve.ts`

```typescript
export const EvolveCommand: CommandModule = {
  command: "evolve",
  builder: (yargs) =>
    yargs
      .option("mode", {
        type: "string",
        choices: ["full", "execute", "status", "check", "trigger", "monitor", "spec", "tasks"],
      })
      .command("list", "List evolution artifacts", {}, listArtifacts)
      .command("approve <skillID>", "Approve and create a skill", {}, approveSkill)
      .command("reject <skillID>", "Reject a skill proposal", {}, rejectSkill)
      .command("memories", "List learned memories", {}, listMemories)
}
```

### 2.2 Scheduled Trigger (EvolutionTrigger)

```
EvolutionTrigger.start()
    │
    ▼
setInterval(checkAndTrigger, check_interval_ms)
    │
    ▼
checkAndTrigger()
    │
    ├─→ Check cooldown
    ├─→ Check circuit breaker
    ├─→ Check consistency (ConsistencyChecker)
    ├─→ Generate deployment tasks (Deployer)
    └─→ Execute evolution (EvolutionExecutor)
```

**File**: `packages/opencode/src/learning/evolution-trigger.ts`

```typescript
export class EvolutionTrigger {
  async checkAndTrigger(): Promise<TriggerResult> {
    // Check circuit breaker
    if (this.circuitBreaker.state === "open") {
      return { tasks_created: 0, circuit_breaker_active: true }
    }

    // Check cooldown
    const cooldownActive = this.checkCooldown()
    if (cooldownActive) {
      return { tasks_created: 0, cooldown_active: true }
    }

    // Check consistency
    const consistency = await this.consistency.check()

    // Generate deployment tasks
    const tasks = await this.deployer.plan()

    return { tasks_created: tasks.length }
  }
}
```

### 2.3 SelfRefactor Scheduled Scan

```
SelfEvolutionScheduler.start()
    │
    ▼
setInterval(runEvolutionCycle, scanIntervalMs)  // Default 24 hours
    │
    ▼
runEvolutionCycle()
    │
    ├─→ SelfRefactor.scanForIssues()
    ├─→ Analyze code issues
    ├─→ Auto-fix (console.log, TODO, etc.)
    └─→ Create PR (if GitHub configured)
```

**File**: `packages/opencode/src/learning/self-evolution-scheduler.ts`

```typescript
export class SelfEvolutionScheduler {
  start(): void {
    // Run immediately on start
    this.runEvolutionCycle()

    // Schedule periodic runs
    this.intervalId = setInterval(() => {
      this.runEvolutionCycle()
    }, this.config.scanIntervalMs) // Default 24 hours
  }

  private async runEvolutionCycle() {
    const issues = await this.refactor.scanForIssues()
    await this.refactor.fixIssues(issues)
  }
}
```

---

## 3. Learning System Trigger

### 3.1 LearningScheduler Resource-Aware Scheduling

```
LearningScheduler.setup()
    │
    ├─→ startResourceMonitoring()
    │     └─→ Check system resources every 30 seconds
    │
    └─→ startIdleMonitoring()
          └─→ Detect user idle state

When resources are sufficient and system is idle:
    │
    ▼
executeTask(task)
    │
    ├─→ Check resource usage
    ├─→ Execute learning task
    └─→ Collect knowledge → Store to Knowledge Graph
```

**File**: `packages/opencode/src/learning/scheduler.ts`

```typescript
export class LearningScheduler {
  async setup(): Promise<void> {
    // Cron scheduling
    if (this.config.schedule.cron) {
      log.info("cron learning configured", {
        cron: this.config.schedule.cron,
      })
    }

    // Idle detection
    if (this.config.schedule.idle_check) {
      this.startIdleMonitoring()
    }

    // Resource monitoring
    this.startResourceMonitoring()
  }

  private startResourceMonitoring() {
    this.resourceCheckInterval = setInterval(() => {
      const status = this.checkResourceStatus()
      if (status.isIdle && status.cpuUsage < threshold) {
        this.executeNextTask()
      }
    }, this.schedulerConfig.checkIntervalMs)
  }
}
```

### 3.2 runLearning Command

```
opencode evolve run
    │
    ▼
runLearning(config)
    │
    ├─→ LearningScheduler.setup()
    ├─→ Collector.collect()      # Collect information
    ├─→ Analyzer.analyze()       # Analyze content
    ├─→ Installer.install()      # Install knowledge
    └─→ Reporter.report()        # Generate report
```

**File**: `packages/opencode/src/learning/command.ts`

```typescript
export async function runLearning(config?: Partial<LearningConfig>): Promise<LearningResult> {
  const scheduler = new LearningScheduler(finalConfig)
  await scheduler.setup()

  const collector = new Collector()
  const analyzer = new Analyzer()
  const installer = new Installer()

  // Collect
  const items = await collector.collect(finalConfig)

  // Analyze
  const analyzed = await analyzer.analyze(items)

  // Install
  await installer.install(analyzed)

  return { items_collected: items.length }
}
```

### 3.3 LearningFeedbackLoop (New)

```
LearningFeedbackLoop.initialize()
    │
    ▼
runCycle()
    │
    ├─→ EvolutionAnalyzer.analyzeAll()
    │     ├─→ Analyze prompts.json
    │     ├─→ Analyze skills.json
    │     └─→ Analyze memories-*.json
    │
    ├─→ Generate ModificationProposal
    │
    ├─→ submitForReview() (if review required)
    │
    └─→ processReviewDecision() (after user approval)
          └─→ applyModification()
```

**File**: `packages/opencode/src/learning/feedback-loop.ts`

```typescript
export class LearningFeedbackLoop {
  async runCycle(): Promise<FeedbackCycleResult> {
    // 1. Analyze evolution artifacts
    const analysis = await this.analyzer.analyzeAll()

    // 2. Auto-generate modification proposals
    const proposals = await this.modifier.autoGenerateProposals()

    // 3. Submit for review
    if (this.config.requireHumanReview) {
      for (const proposal of proposals) {
        await this.modifier.submitForReview(proposal)
      }
    }

    // 4. Process approved proposals
    const approved = await this.modifier.getProposals("approved")
    for (const proposal of approved) {
      await this.modifier.applyModification(proposal)
    }
  }
}
```

---

## Trigger Timing Summary

| System | Trigger Method | Trigger Condition | Frequency |
|--------|---------------|-------------------|-----------|
| **Memory** | Session End | Session ends | Every session end |
| **Memory** | Manual | `Memory.addMemory()` | Manual call |
| **Evolution** | CLI | `opencode evolve [cmd]` | User manual |
| **Evolution** | Scheduler | `EvolutionTrigger` | Every 60 seconds |
| **Evolution** | SelfRefactor | `SelfEvolutionScheduler` | Every 24 hours |
| **Learning** | Cron | `LearningScheduler` | By cron expression |
| **Learning** | Idle Check | System idle | After 5 minutes idle |
| **Learning** | FeedbackLoop | `runCycle()` | Manual or scheduled |
| **Learning** | Resource Check | Resources sufficient | Every 30 seconds |

---

## Complete Trigger Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Complete Trigger Flow                              │
└─────────────────────────────────────────────────────────────────────────────┘

1. Session End Trigger
   ─────────────────────────────────────────────────────────────────────────
   Session Ends
       │
       ▼
   Memory.endSession()
       │
       ▼
   triggerSessionEndIndex()
       │
       ▼
   KnowledgeIndexManager.onSessionEnd()
       │
       ├─→ Extract session messages → Vector Store
       ├─→ Analyze code entities → Knowledge Graph
       └─→ Update Project Memory

2. CLI Command Trigger
   ─────────────────────────────────────────────────────────────────────────
   opencode evolve [command]
       │
       ├─→ list       → Read .opencode/evolution/*.json
       ├─→ approve    → approveSkill() → Update status → Deploy skill
       ├─→ reject     → rejectSkill() → Update status
       ├─→ run        → runLearning() → Collect → Analyze → Install
       └─→ status     → Display system status

3. Scheduled Trigger
   ─────────────────────────────────────────────────────────────────────────
   EvolutionTrigger (every 60 seconds)
       │
       ▼
   checkAndTrigger()
       │
       ├─→ Check circuit breaker → Return if open
       ├─→ Check cooldown → Return if active
       ├─→ ConsistencyChecker.check()
       └─→ Deployer.plan() → Generate task queue

   SelfEvolutionScheduler (every 24 hours)
       │
       ▼
   runEvolutionCycle()
       │
       ├─→ SelfRefactor.scanForIssues()
       ├─→ Auto-fix code issues
       └─→ Create GitHub PR (if configured)

   LearningScheduler (by cron or idle)
       │
       ▼
   executeTask()
       │
       ├─→ Check resources (CPU < 80%, Memory < 85%)
       ├─→ Check idle (5 minutes no activity)
       └─→ Execute learning task → Store knowledge

4. Learning → Evolution Feedback Trigger (New)
   ─────────────────────────────────────────────────────────────────────────
   LearningFeedbackLoop.runCycle()
       │
       ▼
   EvolutionAnalyzer.analyzeAll()
       │
       ├─→ Analyze prompts.json → Find redundant/outdated
       ├─→ Analyze skills.json → Find unused/code quality issues
       └─→ Analyze memories-*.json → Find duplicate/outdated
       │
       ▼
   Generate ModificationProposal
       │
       ▼
   Submit for review (if requireHumanReview=true)
       │
       ▼
   User review (approve/reject)
       │
       ▼
   applyModification()
       │
       ├─→ prompt_optimization → Save new prompt
       ├─→ skill_code_fix → Fix skill code
       ├─→ memory_compress → Compress duplicate memories
       └─→ memory_archive → Archive outdated memories
```

---

## Configuration Examples

### opencode.jsonc

```jsonc
{
  "evolution": {
    "enabled": true,
    "directions": ["code quality", "performance"],
    "sources": ["search", "arxiv", "github"],
    "maxItemsPerRun": 10,
    "cooldownHours": 24
  },
  "experimental": {
    "openTelemetry": true,
    "mcp_timeout": 60000
  }
}
```

### LearningScheduler Configuration

```typescript
const config: LearningConfig = {
  enabled: true,
  schedule: {
    cron: "0 2 * * *",        // Daily at 2 AM
    idle_check: true,
    idle_threshold_minutes: 5,
  },
  topics: ["typescript", "AI"],
  sources: ["web", "arxiv"],
}
```

### SelfEvolutionScheduler Configuration

```typescript
const config: SelfEvolutionConfig = {
  enabled: true,
  scanIntervalMs: 24 * 60 * 60 * 1000,  // 24 hours
  autoFixPatterns: ["console_log", "TODO"],
  requireHumanReview: true,
  maxAutoFixPerRun: 10,
  github: {
    owner: "myorg",
    repo: "myrepo",
    token: "ghp_xxx",
    base_branch: "main",
  },
}
```

---

## Review Request Handling (User Interaction)

```typescript
import { LearningFeedbackLoop } from "@opencode-ai/learning"

const feedbackLoop = new LearningFeedbackLoop(projectDir)
await feedbackLoop.initialize()

// 1. Check pending reviews
const pending = await feedbackLoop.getPendingReviews()
console.log(`Pending: ${pending.length}`)

for (const review of pending) {
  console.log(`${review.title} - ${review.proposal_type}`)
}

// 2. Approve review
await feedbackLoop.approveProposal("proposal-123")

// 3. Reject review
await feedbackLoop.rejectProposal("proposal-456", "Not needed")

// 4. Check statistics
const stats = await feedbackLoop.getReviewStats()
console.log(stats)
```

---

## Related Files Index

| File | Purpose |
|------|---------|
| `src/memory/service.ts` | Memory system main service, contains `endSession()` trigger |
| `src/learning/knowledge-index-manager.ts` | Session end index trigger |
| `src/learning/scheduler.ts` | LearningScheduler resource-aware scheduling |
| `src/learning/self-evolution-scheduler.ts` | SelfRefactor scheduled scan |
| `src/learning/evolution-trigger.ts` | Evolution scheduled trigger |
| `src/learning/feedback-loop.ts` | Learning→Evolution feedback loop |
| `src/learning/command.ts` | `runLearning()` command implementation |
| `src/cli/cmd/evolve.ts` | CLI command entry point |
