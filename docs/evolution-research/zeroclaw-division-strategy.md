# ZeroClaw Division Strategy for Hierarchical Code Understanding

## Strategy Overview

Based on the **Hierarchical Memory Strategy**, we divide the work across multiple ZeroClaw instances, each responsible for a specific layer of code understanding.

---

## Division of Labor

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ZEROCLAW TASK ALLOCATION                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐       │
│  │  ZeroClaw #1   │    │  ZeroClaw #2    │    │  ZeroClaw #3    │       │
│  │  PROJECT        │    │  MODULE         │    │  DETAIL         │       │
│  │  OVERVIEW       │    │  SUMMARIES      │    │  ANALYSIS       │       │
│  │                 │    │                 │    │                 │       │
│  │  - package.json │    │  - src/*.ts    │    │  - Deep dive   │       │
│  │  - Architecture │    │  - Group by     │    │  - Relationships│       │
│  │  - Tech stack   │    │    directory    │    │  - Edge cases  │       │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘       │
│           │                     │                     │                  │
│           └─────────────────────┴─────────────────────┘                  │
│                                 │                                          │
│                                 ▼                                          │
│                    ┌─────────────────────────┐                             │
│                    │    VECTOR STORE        │                             │
│                    │  (sqlite-vec)          │                             │
│                    └─────────────────────────┘                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Task Assignments

### ZeroClaw #1: Project Overview Layer

**Purpose**: Understand the high-level architecture and tech stack.

**Responsibility**:

```
TASK: Generate Project Overview
INPUT:
  - package.json (all workspace packages)
  - tsconfig.json files
  - Root level README/ARCHITECTURE.md
  - Main entry points (src/index.ts, src/cli/*.ts)

OUTPUT: JSON
{
  "project_name": "opencode",
  "language": "typescript",
  "framework": ["hono", "solid-js", "drizzle"],
  "architecture": "description of overall architecture",
  "key_modules": ["session", "tool", "learning", "storage"],
  "capabilities": ["code editing", "LLM integration", "self-evolution"],
  "dependencies": {
    "runtime": ["bun", "node"],
    "ai": ["openai", "anthropic", "google"],
    "storage": ["sqlite", "drizzle-orm"]
  },
  "known_gaps": ["multimodal", "skill_verification"],
  "recent_changes": ["added vector search", "improved memory"]
}
```

**File Patterns**:

- `package.json`
- `packages/*/package.json`
- `tsconfig.json`
- `README.md`
- `ARCHITECTURE.md`
- `src/index.ts`
- `src/cli/**/*.ts`

---

### ZeroClaw #2: Module Summary Layer

**Purpose**: Generate summaries for each module/package.

**Strategy**: Split by directory, assign to ZeroClaw #2 instances.

```
TASK: Generate Module Summaries for [PACKAGE_NAME]
INPUT:
  - All .ts files in package/src/
  - package.json for dependencies

OUTPUT: JSON (one per file)
[
  {
    "file": "src/session/prompt.ts",
    "module": "session",
    "purpose": "Manages session prompts and context injection",
    "key_functions": [
      "createSystemPrompt()",
      "loadModuleSummaries()",
      "injectMemoryContext()"
    ],
    "dependencies": ["learning/memory", "tool/registry"],
    "public_api": ["createSystemPrompt", "getRelevantMemories"],
    "complexity": "medium"
  },
  ...
]

AGGREGATED OUTPUT:
{
  "package": "opencode",
  "modules": [...],
  "total_files": 150,
  "summary_timestamp": 1234567890
}
```

**File Patterns by Instance**:

```
ZeroClaw #2a: packages/opencode/src/session/**/*
ZeroClaw #2b: packages/opencode/src/tool/**/*
ZeroClaw #2c: packages/opencode/src/learning/**/*
ZeroClaw #2d: packages/opencode/src/storage/**/*
ZeroClaw #2e: packages/app/src/**/*
```

---

### ZeroClaw #3: Detail Analysis Layer

**Purpose**: Deep dive into specific files when needed.

**Trigger**: When query requires more than summary-level understanding.

```
TASK: Detailed Code Analysis
INPUT:
  - Specific file(s) requested
  - Related test files
  - Import/export relationships

OUTPUT: JSON
{
  "file": "src/learning/vector-store.ts",
  "analysis": {
    "flow": "Flow description of how vector search works",
    "edge_cases": ["empty database", "embedding mismatch", "sync failures"],
    "integration_points": ["knowledge_graph", "sqlite-vec", "memory_critic"],
    "potential_issues": [
      "SQL injection risk in line 119",
      "SYNC_VERSION not used"
    ]
  },
  "relevant_tests": ["test/learning/vector-store.test.ts"],
  "similar_patterns": ["src/storage/db.ts", "src/learning/memory-critic.ts"]
}
```

---

## Execution Instructions for LLM

### Step 1: Project Overview (Do First)

```
You are ZeroClaw Instance #1. Your task is to analyze the project at /path/to/project.

1. Read all package.json files to understand the monorepo structure
2. Identify tech stack: languages, frameworks, key libraries
3. Understand architecture: how do packages relate to each other?
4. List key capabilities and known gaps
5. Check recent changes in git log --oneline -20

Output your findings as JSON in the format specified.
```

### Step 2: Module Summaries (Do Second)

```
You are ZeroClaw Instance #2. Your task is to generate summaries for all TypeScript
files in the directory: [DIRECTORY_PATH]

For each .ts file:
1. Read the file content
2. Identify:
   - Purpose (what does this file do?)
   - Key functions/classes (name + one-line purpose)
   - Dependencies (what does it import?)
   - Public API (what does it export?)

Output JSON array with one entry per file.
```

### Step 3: Detail Analysis (On Demand)

```
You are ZeroClaw Instance #3. A query requires deep understanding of specific code.

Query: [USER_QUESTION]
Relevant files: [FILE_LIST]

1. Read each file thoroughly
2. Analyze the code flow and logic
3. Identify edge cases and potential issues
4. Find related tests and integration points
5. Answer the query with specific references to the code

Output detailed analysis as JSON.
```

---

## Coordination Protocol

```
┌─────────────────────────────────────────────────────────────────┐
│                    COORDINATION PROTOCOL                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Phase 1: Discovery (ZeroClaw #1)                              │
│  ─────────────────────────────────                             │
│  1. Scan project structure                                      │
│  2. Identify all packages/directories                           │
│  3. Generate package.json overview                              │
│  4. Store in: .opencode/memory/project-overview.json            │
│                                                                  │
│  Phase 2: Summarization (ZeroClaw #2a-#2e)                     │
│  ────────────────────────────────────────                       │
│  1. ZeroClaw #2a → packages/opencode/src/session/              │
│  2. ZeroClaw #2b → packages/opencode/src/tool/                 │
│  3. ZeroClaw #2c → packages/opencode/src/learning/             │
│  4. ZeroClaw #2d → packages/opencode/src/storage/             │
│  5. ZeroClaw #2e → packages/app/src/                          │
│                                                                  │
│  Phase 3: Indexing                                             │
│  ────────────────                                               │
│  1. All ZeroClaw #2 instances submit summaries                 │
│  2. Central indexer combines them                              │
│  3. Generate vector embeddings                                 │
│  4. Store in sqlite-vec                                        │
│                                                                  │
│  Phase 4: Query Resolution (On Demand)                         │
│  ──────────────────────────────────────────                    │
│  1. Query hits vector store                                   │
│  2. ZeroClaw #1 returns relevant module summaries             │
│  3. If deeper analysis needed → ZeroClaw #3 dives in          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Summary Table

| Instance  | Layer            | Focus                    | When      | Output                    |
| --------- | ---------------- | ------------------------ | --------- | ------------------------- |
| **#1**    | Project Overview | Architecture, tech stack | First     | `project-overview.json`   |
| **#2a-e** | Module Summaries | Per-package analysis     | Second    | `module-summaries/*.json` |
| **#3**    | Detail Analysis  | Deep dive                | On demand | `detail-analysis/*.json`  |

---

## Key Principles

1. **Sequential not Parallel for Discovery**: ZeroClaw #1 must complete before #2 starts
2. **Parallel for Summarization**: All #2 instances work simultaneously on different directories
3. **On-Demand for Details**: #3 only activates for specific queries
4. **Caching**: Re-use existing summaries; only update changed files

---

## Example: Complete Workflow

```bash
# Phase 1: Project Overview
ZeroClaw #1 → scan all package.json → project-overview.json

# Phase 2: Module Summaries (parallel)
ZeroClaw #2a → src/session/**/*.ts → summaries/session.json
ZeroClaw #2b → src/tool/**/*.ts    → summaries/tool.json
ZeroClaw #2c → src/learning/**/*.ts → summaries/learning.json
...

# Phase 3: Vector Index
Combine all summaries → embed → store in sqlite-vec

# Query Time
User: "How does the memory system work?"
→ Search vector store
→ Return top 5 module summaries
→ If needed, ZeroClaw #3 does deep analysis
```

---

## This is the reference strategy for LLM execution.
