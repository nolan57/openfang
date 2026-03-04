# OpenCode Self-Evolving and Long-Range Consistency System

**Version**: 1.0  
**Date**: 2026-03-04  
**Status**: ✅ Complete (100%)

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core Modules](#core-modules)
4. [Complete Flow](#complete-flow)
5. [Commands](#commands)
6. [Data Models](#data-models)
7. [Safety Mechanisms](#safety-mechanisms)
8. [Integration](#integration)
9. [Quick Start](#quick-start)

---

## Overview

This system implements two core capabilities:

1. **Self-Evolving** - AI automatically collects information, analyzes, generates improvements, and executes deployments
2. **Long-Range Consistency** - Cross-time, cross-session memory consistency and knowledge correlation

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        OpenCode Intelligent System                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Layer 1: Researcher                            │    │
│  │  ├── Collector: Collect (search/arxiv/github/pypi)              │    │
│  │  └── Researcher: Generate proposals (relevance/risk)           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Layer 2: Architect                            │    │
│  │  ├── NegativeMemory: Filter known failures                       │    │
│  │  ├── Architect: Decide (approve/reject/human_review)           │    │
│  │  ├── ConstraintLoader: Load architecture constraints          │    │
│  │  └── SemanticAnchor: Semantic similarity matching            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Layer 3: Engineer                            │    │
│  │  ├── Installer: Install new skills                             │    │
│  │  ├── CodeSuggester: Generate code suggestions                 │    │
│  │  └── NoteGenerator: Generate learning notes                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Layer 4: Critic + Safety                      │    │
│  │  ├── Critic: Verify + adaptive retry (exponential backoff)     │    │
│  │  ├── Benchmark: Performance measurement                        │    │
│  │  ├── Safety: Cooldown + human approval                        │    │
│  │  ├── Archive: Snapshots + rollback                            │    │
│  │  └── ConsistencyChecker: Consistency validation               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                     ZeroClaw (Independent Execution Engine)                  │
│  - Execute shell commands                                                  │
│  - Compile code                                                            │
│  - Restart services                                                       │
│  - Health checks                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Modules

### 1. KnowledgeGraph

Unified storage for all entities and relationships.

**File**: `src/learning/knowledge-graph.ts`

```typescript
// Node types
type NodeType = "file" | "skill" | "memory" | "constraint" | "agenda"

// Relationship types
type RelationType = "depends_on" | "related_to" | "conflicts_with" | "derives_from" | "implements" | "may_affect"

class KnowledgeGraph {
  addNode(node) // Add entity
  addEdge(edge) // Add relationship
  getRelatedNodes() // Get related nodes
  searchByContent() // Keyword search
}
```

### 2. ChangeImpactTracker

Automatically tracks affected memories and constraints when code changes.

**File**: `src/learning/change-impact.ts`

```typescript
class ChangeImpactTracker {
  trackChange({ file, changed_by, changes_summary })
  // 1. Find related memories/constraints
  // 2. Create relationship edges
  // 3. Mark as potentially outdated
}
```

### 3. SemanticAnchor

Feature-based similarity matching.

**File**: `src/learning/semantic-anchor.ts`

```typescript
class SemanticAnchor {
  findSimilar(content, types, limit) // Find similar content
  findRelatedByContext(context) // Find related memories
  findConflicting(content) // Find conflicts
  suggestConnections(newNode) // Suggest connections
}
```

### 4. ConstraintLoader

Automatically loads ARCHITECTURE.md and constraint files.

**File**: `src/learning/constraint-loader.ts`

```typescript
class ConstraintLoader {
  loadFromProject(rootDir) // Load project constraints
  validateAgainstConstraints() // Validate constraints
  getConstraint(type) // Get constraints
}
```

### 5. ConsistencyChecker

Periodic consistency validation of knowledge graph.

**File**: `src/learning/consistency-checker.ts`

```typescript
class ConsistencyChecker {
  runFullCheck() // Full check
  // Check types:
  // - Conflict
  // - Outdated
  // - Orphan
  // - Redundant
}
```

### 6. EvolutionTrigger

Detects changes and creates deployment tasks.

**File**: `src/learning/evolution-trigger.ts`

```typescript
class EvolutionTrigger {
  checkAndTrigger() // Check and trigger
  detectCodeChanges() // Detect code changes
  detectNewSkills() // Detect new skills
  startMonitoring() // Start monitoring
}
```

### 7. EvolutionExecutor

Executes deployment tasks via ZeroClaw.

**File**: `src/learning/evolution-executor.ts`

```typescript
class EvolutionExecutor {
  executeTask(task) // Execute single task
  executeAll() // Execute all pending tasks
  healthCheck() // Health check
  // Features:
  // - Retry on failure (exponential backoff)
  // - Automatic rollback
  // - Record execution history
}
```

---

## Complete Flow

### Trigger Methods

1. **Manual**: `/evolve` command
2. **Scheduled**: Cron task (needs configuration)

### Execution Flow

```
User triggers /evolve
    ↓
┌─ Cooldown Check ─────────────────────┐
│  Is it > 24h since last evolution?    │
└────────────────────────────────────┘
    ↓ Yes
┌─ 1. Researcher ────────────────────┐
│  Search arXiv/GitHub/PyPI            │
│  Generate ResearchProposal          │
└────────────────────────────────────┘
    ↓
┌─ 2. Architect ─────────────────────┐
│  - NegativeMemory: filter failures  │
│  - ConstraintLoader: load constraints│
│  - SemanticAnchor: find similar    │
│  - Decision: approve/reject/review │
└────────────────────────────────────┘
    ↓
┌─ 3. Archive Snapshot ──────────────┐
│  Save current state (SHA256)       │
└────────────────────────────────────┘
    ↓
┌─ 4. Engineer ─────────────────────┤
│  - Install skills                   │
│  - Generate code suggestions      │
│  - Generate learning notes         │
└────────────────────────────────────┘
    ↓
┌─ 5. Critic ────────────────────────┤
│  - Run tests                        │
│  - Fail? → Retry (max 3)          │
│  - Retry exceeded? → Rollback     │
└────────────────────────────────────┘
    ↓
┌─ 6. KnowledgeGraph Record ─────────┤
│  - Record execution results        │
│  - Update relationship edges      │
└────────────────────────────────────┘
    ↓
┌─ 7. Reporter ──────────────────────┤
│  Output JSON report to file         │
└────────────────────────────────────┘
    ↓
Complete → Notify user
```

### ZeroClaw Deployment Flow

```
Deployment task created (docs/learning/tasks/{id}.json)
    ↓
ZeroClaw polls and detects task
    ↓
Mark as executing
    ↓
Execute commands:
  - git add -A
  - git commit -m 'feat: ...'
  - bun run build
  - echo 'restart'
    ↓
Health check (curl /health)
    ↓
Success → Mark completed
Failure → Execute rollback_commands → Mark rolled_back
```

---

## Commands

### /evolve Command

| Command             | Function                    |
| ------------------- | --------------------------- |
| `/evolve`           | Full self-evolution cycle   |
| `/evolve --execute` | Execute pending tasks       |
| `/evolve --status`  | View status                 |
| `/evolve --check`   | Consistency check           |
| `/evolve --trigger` | Trigger task creation only  |
| `/evolve --monitor` | Start continuous monitoring |

### Tool Usage

```typescript
import { EvolveTool, LearningTool } from "./tool/learning"

// Available in session automatically
@evolve(mode="full")
@learning(topics=["AI", "agent"])
```

---

## Data Models

### Database Tables

```sql
-- Knowledge nodes
CREATE TABLE knowledge_node (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,        -- file/skill/memory/constraint/agenda
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  embedding TEXT,            -- JSON vector
  metadata TEXT,             -- JSON
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);

-- Knowledge edges
CREATE TABLE knowledge_edge (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL,     -- depends_on/related_to/conflicts_with
  weight INTEGER DEFAULT 1,
  time_created INTEGER NOT NULL
);

-- Negative memory (failure record)
CREATE TABLE negative_memory (
  id TEXT PRIMARY KEY,
  failure_type TEXT NOT NULL,
  description TEXT NOT NULL,
  context TEXT NOT NULL,
  severity INTEGER DEFAULT 1,
  times_encountered INTEGER DEFAULT 1,
  blocked_items TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);

-- Archive snapshot
CREATE TABLE archive_snapshot (
  id TEXT PRIMARY KEY,
  snapshot_type TEXT NOT NULL,  -- pre_evolution/pre_skill_install/golden
  description TEXT NOT NULL,
  state TEXT NOT NULL,           -- JSON
  checksum TEXT NOT NULL,       -- SHA256
  parent_id TEXT,
  is_golden INTEGER DEFAULT 0,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);

-- Learning run records
CREATE TABLE learning_run (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  topics TEXT NOT NULL,
  items_collected INTEGER DEFAULT 0,
  items_processed INTEGER DEFAULT 0,
  time_created INTEGER NOT NULL
);

-- Knowledge entries
CREATE TABLE knowledge (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags TEXT NOT NULL,
  value_score INTEGER DEFAULT 0,
  action TEXT NOT NULL,
  processed INTEGER DEFAULT 0,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
```

### Deployment Task Format

```json
{
  "id": "abc12345",
  "type": "code_change",
  "status": "pending",
  "title": "Self-evolution: Code change",
  "description": "Applying changes to 3 files",
  "changes": {
    "files": ["src/learning/a.ts", "src/learning/b.ts"],
    "diff_summary": "Add new feature X"
  },
  "commands": ["git add -A", "git commit -m 'feat: ...'", "bun run build", "echo 'restart'"],
  "rollback_commands": ["git reset --hard HEAD~1", "echo 'restart'"],
  "created_at": 1699999999999,
  "updated_at": 1699999999999
}
```

---

## Safety Mechanisms

### 1. Cooldown

- Default 24-hour mandatory wait
- Prevents frequent changes

```typescript
const safety = new Safety()
const result = await safety.checkCooldown()
// { allowed: false, reason: "Cooldown period active", cooldown_remaining_ms: 3600000 }
```

### 2. Golden Snapshot

- Always keeps a known stable version
- Automatic rollback on failure

```typescript
await safety.createGoldenSnapshot(state)
await safety.rollbackToSafeState()
```

### 3. Auto-Retry (Self-Correction)

- Exponential backoff on failure (2, 4, 8 seconds)
- Max 3 retries

### 4. Change Risk Assessment

```typescript
const result = await safety.checkChangeRisk(files_affected, risk)
// >50 lines or high risk → requires human approval
```

### 5. Negative Memory

- Records failure experience
- Prevents repeating mistakes

```typescript
const nm = new NegativeMemory()
await nm.recordFailure({
  failure_type: "install_failed",
  description: "...",
  context: { url: "..." },
  severity: 3,
})
const isBlocked = await nm.isBlocked("https://...")
```

---

## Integration

### 1. Configure ZeroClaw

`~/.config/opencode/opencode.json`:

```json
{
  "zeroclaw": {
    "enabled": true,
    "url": "http://127.0.0.1:42617",
    "token": "zc_xxx",
    "autoStart": true,
    "startPort": 42617
  }
}
```

### 2. Environment Variables

`~/.zshrc`:

```bash
export ZEROCLAW_URL=http://127.0.0.1:42617
export ZEROCLAW_TOKEN=zc_xxx
export ZEROCLAW_AUTO_START=true
export ZEROCLAW_START_PORT=42617
```

### 3. Code Usage

```typescript
import { EvolutionTrigger, EvolutionExecutor, KnowledgeGraph, ConsistencyChecker } from "./learning"

// Trigger evolution
const trigger = new EvolutionTrigger()
const result = await trigger.checkAndTrigger()

// Execute tasks
const executor = new EvolutionExecutor()
const results = await executor.executeAll()

// Check consistency
const checker = new ConsistencyChecker()
const report = await checker.runFullCheck()
```

---

## Quick Start

### 1. Start OpenCode

```bash
opencode
```

### 2. Trigger Self-Evolution

```
/evolve
```

### 3. View Status

```
/evolve --status
```

### 4. Execute Pending Tasks

```
/evolve --execute
```

### 5. Check Consistency

```
/evolve --check
```

---

## File Structure

```
packages/opencode/src/learning/
├── knowledge-graph.ts       # Unified knowledge graph
├── change-impact.ts        # Change impact tracking
├── semantic-anchor.ts      # Semantic similarity
├── constraint-loader.ts    # Constraint loading
├── consistency-checker.ts  # Consistency checking
├── evolution-trigger.ts   # Trigger
├── evolution-executor.ts   # Executor
├── negative.ts             # Failure memory
├── archive.ts              # Snapshot/rollback
├── safety.ts               # Safety mechanisms
├── reporter.ts             # Report generation
├── deployer.ts             # Deployment tasks
├── collector.ts            # Information collection
├── analyzer.ts             # Analysis
├── researcher.ts            # Research proposals
├── architect.ts            # Planning/decision
├── critic.ts               # Verification
└── learning.sql.ts         # Database tables
```

---

## Summary

| Capability             | Completion |
| ---------------------- | ---------- |
| Self-Evolving          | ✅ 100%    |
| Long-Range Consistency | ✅ 100%    |
| Deployment Loop        | ✅ 100%    |
| Safety Mechanisms      | ✅ 100%    |
| User Commands          | ✅ 100%    |

---

_Generated: 2026-03-04_
