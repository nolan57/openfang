# OpenCode Permanent Memory System - Implementation Guide

## Overview

This document provides a comprehensive technical overview of OpenCode's permanent memory system, including architecture, implementation details, usage instructions, and comparison with OpenClaw.

---

## 1. System Architecture

### 1.1 Core Components

The permanent memory system consists of four main modules located in `packages/opencode/src/evolution/`:

| Component       | File                           | Responsibility                                                                 |
| --------------- | ------------------------------ | ------------------------------------------------------------------------------ |
| **Types**       | `src/evolution/types.ts`       | Zod schemas for data validation (MemoryEntry, PromptEvolution, SkillEvolution) |
| **Store**       | `src/evolution/store.ts`       | File-based JSON persistence operations                                         |
| **Memory**      | `src/evolution/memory.ts`      | Memory extraction and retrieval logic                                          |
| **Integration** | `src/evolution/integration.ts` | Session lifecycle hooks                                                        |

### 1.2 Data Storage

**Location**: `.opencode/evolution/` (project-level)

**Key Feature**: Monthly sharded storage to prevent file bloat

```
.opencode/evolution/
├── memories-2026-01.json   # January 2026 memories
├── memories-2026-02.json   # February 2026 memories
├── memories-2026-03.json   # March 2026 memories (current)
├── skills.json            # Generated skills (draft/approved/rejected)
└── prompts.json           # Optimized prompts from session analysis
```

```typescript
interface MemoryEntry {
  id: string // UUID
  key: string // Memory key (e.g., "typescript-tips")
  value: string // Memory value (actionable advice)
  context: string // Task context when extracted
  sessionIDs: string[] // Associated session IDs
  createdAt: number // Creation timestamp
  lastUsedAt: number // Last access timestamp
  usageCount: number // Number of times retrieved
}
```

---

## 2. Implementation Details

### 2.1 Memory Extraction

The system uses two extraction methods:

#### Method 1: Pattern-based Extraction (JSON Config)

Patterns are now loaded from a configurable JSON file with bilingual (English + Chinese) keyword support:

**Default config**: `src/evolution/memory-patterns.json`

```json
{
  "patterns": [
    {
      "keywords": ["typescript", "tsconfig", "type annotation", "类型", "类型注解"],
      "key": "typescript-tips",
      "value": "Use explicit type annotations for better clarity"
    },
    {
      "keywords": ["test", "testing", "jest", "vitest", "测试", "单元测试", "TDD"],
      "key": "testing-approach",
      "value": "Write tests first (TDD) for better design"
    },
    {
      "keywords": ["refactor", "clean", "improve", "重构", "优化"],
      "key": "refactoring-guidance",
      "value": "Make small, incremental changes"
    },
    {
      "keywords": ["error", "bug", "fix", "issue", "错误", "bug", "修复", "调试"],
      "key": "debugging-tips",
      "value": "Start with minimal reproduction case"
    },
    {
      "keywords": ["security", "安全", "漏洞", "xss", "sql injection"],
      "key": "security-best-practices",
      "value": "Validate and sanitize all user inputs"
    },
    {
      "keywords": ["performance", "性能", "优化", "缓存"],
      "key": "performance-tips",
      "value": "Profile before optimizing, focus on bottlenecks"
    },
    {
      "keywords": ["api", "rest", "endpoint", "接口", "API"],
      "key": "api-design",
      "value": "Design APIs with clear contracts and version them"
    },
    {
      "keywords": ["database", "sql", "query", "数据库", "查询"],
      "key": "database-tips",
      "value": "Use indexes and avoid N+1 queries"
    },
    {
      "keywords": ["git", "commit", "branch", "版本控制", "提交"],
      "key": "git-workflow",
      "value": "Make small, focused commits with clear messages"
    },
    {
      "keywords": ["docker", "container", "镜像", "容器", "部署"],
      "key": "container-best-practices",
      "value": "Keep images small and use multi-stage builds"
    }
  ]
}
```

Users can override by creating `.opencode/memory-patterns.json` in project root.

#### Method 2: LLM Dynamic Extraction

Uses the current session's model to extract memories:

```typescript
const MEMORY_EXTRACTION_PROMPT = `Extract 0-3 key learnings from this task...
Respond ONLY with valid JSON array.

Task: {task}
Tool calls: {toolCalls}
Outcome: {outcome}`
```

### 2.2 Memory Retrieval

Retrieval algorithm in `src/evolution/memory.ts` - **Hybrid Search with Vector + Keyword + MMR**:

```typescript
export async function getRelevantMemories(projectDir: string, currentTask: string): Promise<MemorySuggestion[]> {
  const allMemories = await getMemories(projectDir)

  if (allMemories.length === 0) return []

  const taskWords = currentTask.toLowerCase().split(/\s+/).filter((w) => w.length > 2)

  // 1. Try vector search first (uses SQLite + sqlite-vec)
  let vectorResults: Array<{ key: string; value: string; score: number }> = []
  try {
    const vs = await getVectorStore()
    const vecSearchResults = await vs.search(currentTask, {
      limit: 20,
      min_similarity: 0.1,
    })

    // Map vector results to memory format
    for (const r of vecSearchResults) {
      const memory = allMemories.find((m) => m.id === r.id || m.entity_title === r.entity_title)
      if (memory) {
        vectorResults.push({
          key: memory.key,
          value: memory.value,
          score: r.similarity,
        })
      }
    }
  } catch (error) {
    log.warn("vector_search_failed", { error: String(error) })
  }

  // 2. Fallback to keyword matching with temporal decay and usage boost
  const keywordResults = allMemories.map((memory) => {
    const keywordMatches = taskWords.filter(
      (word) => memory.key.toLowerCase().includes(word) || memory.value.toLowerCase().includes(word),
    ).length

    // Temporal decay: ~1% per day
    const temporalScore = Math.exp(-0.00001 * (Date.now() - memory.lastUsedAt))
    // Usage boost: log10(usageCount + 1) * 0.1
    const usageBoost = Math.log10(memory.usageCount + 1) * 0.1

    return {
      key: memory.key,
      value: memory.value,
      score: keywordMatches * temporalScore + usageBoost,
    }
  }).filter((m) => m.score > 0)

  // 3. Merge results: combine vector and keyword results
  const mergedMap = new Map<string, { key: string; value: string; score: number }>()

  // Add vector results with higher weight (1.5x boost)
  for (const r of vectorResults) {
    mergedMap.set(r.key, { ...r, score: r.score * 1.5 })
  }

  // Add keyword results, keep higher score if duplicate
  for (const r of keywordResults) {
    const existing = mergedMap.get(r.key)
    if (!existing || r.score > existing.score) {
      mergedMap.set(r.key, r)
    }
  }

  const mergedResults = Array.from(mergedMap.values()).sort((a, b) => b.score - a.score)

  // 4. Apply MMR re-ranking for diversity (lambda=0.5)
  const diverseResults = mmrReRank(mergedResults, 0.5)

  // 5. Update usage stats for returned memories (async)
  for (const result of diverseResults.slice(0, 5)) {
    const memory = allMemories.find((m) => m.key === result.key)
    if (memory) {
      incrementMemoryUsage(projectDir, memory.id)
    }
  }

  return diverseResults.slice(0, 5)
}
```

**Key Features**:
- **Vector Search**: Uses SQLite + sqlite-vec for semantic similarity
- **Hybrid Merge**: Combines vector + keyword results (vector weighted 1.5x)
- **MMR Re-ranking**: Ensures diverse results using Maximum Marginal Relevance
- **Temporal Decay**: Exponential decay (~1% per day) prioritizes recent memories
- **Usage Boost**: Frequently used memories get slight score boost

### 2.3 Session Integration

Memory retrieval is integrated into the session loop in `src/session/prompt.ts`:

```typescript
// Inject relevant memories into system prompt on first step
if (step === 1) {
  const taskText = msgs
    .filter((m) => m.info.role === "user")
    .flatMap((m) => m.parts)
    .filter((p) => p.type === "text")
    .map((p) => ("text" in p ? p.text : ""))
    .join(" ")

  if (taskText) {
    const memories = await getRelevantMemories(Instance.directory, taskText)
    if (memories.length > 0) {
      // Update usage statistics
      const allMemories = await getMemories(Instance.directory)
      for (const m of memories) {
        const entry = allMemories.find((e) => e.key === m.key)
        if (entry) await incrementMemoryUsage(Instance.directory, entry.id)
      }

      // Inject into system prompt
      const memoryContext = memories.map((m) => `• ${m.key}: ${m.value}`).join("\n")
      system.push(`\n<system-reminder>\nPast session learnings:\n${memoryContext}\n</system-reminder>`)
    }
  }
}
```

### 2.4 Session End Extraction

On session completion or session switch, memories are extracted:

**Trigger Points:**

1. AI completes response without tool calls (natural end)
2. User runs `/new` command (new session)
3. User runs `/sessions` command (switch session)

**Implementation in `src/session/prompt.ts`:**

```typescript
if (lastAssistant?.finish && !["tool-calls", "unknown"].includes(lastAssistant.finish)) {
  // Extract memories using pattern matching
  await extractMemories(Instance.directory, sessionID, taskText, toolCallTexts, outcome)

  // Try LLM extraction (async, fire and forget)
  extractMemoriesWithLLM(
    Instance.directory,
    sessionID,
    taskText,
    toolCallTexts,
    outcome,
    lastUser.model.providerID,
    lastUser.model.modelID,
  )
    .then(async (llmMemories) => {
      // Save new memories from LLM
    })
    .catch((err) => log.error("Failed to extract memories with LLM", { error: String(err) }))
}
```

**TUI Integration in `src/cli/cmd/tui/app.tsx`:**

```typescript
// When user runs /new command
onSelect: async () => {
  if (route.data.type === "session") {
    await fetch(`${sdk.url}/tui/session/extract-memories`, {
      method: "POST",
      body: JSON.stringify({ sessionID }),
    })
  }
  // Navigate to new session
}

// When user runs /sessions command
onSelect: () => {
  if (route.data.type === "session") {
    fetch(`${sdk.url}/tui/session/extract-memories`, {...})
  }
  // Show session list
}
```

**API Endpoint in `src/server/routes/tui.ts`:**

````typescript
.post("/session/extract-memories", async (c) => {
  const { sessionID } = c.req.valid("json")
  // Extract memories from session messages
  // Save to memory store
  return c.json({ extracted: count, keys: [...] })
})

---

## 3. Memory Search Tool

### 3.1 Tool Definition

A new `memory_search` tool is registered in `src/tool/memory.ts`:

```typescript
export const MemorySearchTool: Tool.Info<typeof params> = {
  id: "memory_search",
  init: async () => ({
    description: "Search permanent memories from past sessions",
    parameters: params,
    async execute(args, ctx) {
      const memories = await getRelevantMemories(Instance.directory, args.query)
      const results = memories.slice(0, args.maxResults ?? 5)

      // Update usage statistics
      // ...

      return {
        title: "Memory Search",
        metadata: { query: args.query, count: results.length },
        output: results.map((m, i) => `${i + 1}. **${m.key}**: ${m.value}`).join("\n"),
      }
    },
  }),
}
````

### 3.2 Registration

Registered in `src/tool/registry.ts`:

```typescript
import { MemorySearchTool } from "./memory"

return [
  MemorySearchTool,
  // ... other tools
]
```

---

## 4. CLI Commands

### 4.1 Available Commands

```bash
# List all evolution artifacts
opencode evolve list

# List learned memories
opencode evolve memories

# List pending skill approvals
opencode evolve pending

# Approve and create a skill
opencode evolve approve <skillID>

# Reject a skill proposal
opencode evolve reject <skillID>

# Reload skills cache
opencode evolve reload
```

### 4.2 Example Output

```
$ opencode evolve memories

[typescript-tips]
  Use explicit type annotations for better clarity
  Used 5 times

[testing-approach]
  Write tests first (TDD) for better design
  Used 3 times
```

---

## 5. Logging System

### 5.1 Overview

All evolution system logs are now saved to the OpenCode log file instead of console output. Events are also published to TUI for user notifications.

### 5.2 Log Location

Logs are saved to OpenCode's log directory:

```bash
# Linux/macOS
~/.local/share/opencode/log/
```

### 5.3 TUI Notifications

When memories are extracted, users see a toast notification:

```
Session complete. X memory(ies) extracted.
Run "opencode evolve memories" to review.
```

### 5.4 Log Events

| Event                           | Description                        |
| ------------------------------- | ---------------------------------- |
| `Loaded memory patterns`        | Pattern config loaded successfully |
| `Memory extraction completed`   | Patterns matched and processed     |
| `Saved new memory from pattern` | New memory created                 |
| `Saved LLM-extracted memories`  | LLM extraction completed           |
| `Failed to extract memories`    | Extraction error                   |

---

## 6. Comparison with OpenClaw (Updated)

### 6.1 Feature Comparison

| Feature                 | OpenCode                | OpenClaw                 |
| ----------------------- | ----------------------- | ------------------------ |
| **Storage**             | Monthly JSON            | SQLite + sqlite-vec      |
| **Search**              | **Hybrid (Vector + Keyword)** | Vector + FTS hybrid |
| **Pattern Extraction**  | Configurable + LLM      | LLM-powered              |
| **Multi-Backend**       | ❌                      | ✅ (Builtin/QMD/LanceDB) |
| **Bilingual Support**   | ✅ English/Chinese      | ❌                       |
| **Session Integration** | ✅ Automatic            | ✅ Lifecycle hooks       |
| **Tool Access**         | ✅ memory_search        | ✅ memory_search/recall  |
| **Usage Tracking**      | ✅ **Full**             | ✅ Full                  |
| **MMR Re-ranking**      | ✅                      | ✅                       |
| **Temporal Decay**      | ✅                      | ✅                       |
| **Vector Search**       | ✅ **sqlite-vec**       | ✅ sqlite-vec            |
| **Embedding Provider**  | Simple (hash-based)     | OpenAI/Gemini/Voyage/Local |

### 6.2 Key Differences (Updated)

1. **Storage**: OpenCode uses monthly-sharded JSON files vs OpenClaw's SQLite
2. **Search**: OpenCode now uses **hybrid vector + keyword search** (similar to OpenClaw)
3. **Patterns**: OpenCode supports bilingual (English/Chinese) keyword patterns via JSON config
4. **Backends**: OpenClaw supports multiple backends, OpenCode is single-backend
5. **Embeddings**: OpenCode uses simple hash-based embeddings; OpenClaw supports external providers
6. **Advanced Features**: Both now have MMR re-ranking and temporal decay

### 6.3 OpenCode Advantages

- **Simpler Architecture**: Easier to understand and maintain
- **No External Dependencies**: Works out of the box without API keys
- **Bilingual Support**: Built-in English/Chinese keyword patterns
- **Monthly Sharding**: Prevents single file bloat

### 6.4 OpenClaw Advantages

- **Multi-Backend**: Flexible deployment options (Builtin/QMD/LanceDB)
- **Better Embeddings**: Supports OpenAI, Gemini, Voyage, and local models
- **Auto-Capture/Recall**: LanceDB integration for automatic memory management

---

## 7. Usage Workflow

### 7.1 Automatic Flow

```
1. User starts a new session
   │
   ▼
2. System retrieves relevant memories using HYBRID SEARCH:
   - Vector search (SQLite + sqlite-vec) for semantic similarity
   - Keyword matching as fallback
   - MMR re-ranking for diversity
   - Temporal decay + usage boost for ranking
   │
   ▼
3. Memories injected into system prompt
   │
   ▼
4. User works on task
   │
   ▼
5. Session ends (triggered by any of):
   - AI completes response without tools
   - User runs /new command
   - User runs /sessions to switch
   │
   ▼
6. System extracts memories using DUAL EXTRACTION:
   - Pattern matching (JSON config with bilingual keywords)
   - LLM dynamic extraction (async, fire-and-forget)
   │
   ▼
7. Memories saved to monthly file (e.g., memories-2026-03.json)
   - Embeddings stored in SQLite for vector search
   │
   ▼
8. Log saved to file + TUI notification shown
```

### 7.2 Manual Flow

```bash
# Search memories during session
> Use memory_search tool to find relevant memories

# View all memories
$ opencode evolve memories

# Manage generated skills
$ opencode evolve pending
$ opencode evolve approve <skillID>
```

---

## 8. Technical Implementation

### 8.1 Key Files

| File                                           | Changes                                |
| ---------------------------------------------- | -------------------------------------- |
| `src/evolution/memory.ts`                      | LLM extraction, pattern config loading |
| `src/evolution/memory-patterns.json`           | Bilingual keyword patterns             |
| `src/evolution/store.ts`                       | Monthly sharded storage, logging       |
| `src/session/prompt.ts`                        | Memory injection + extraction triggers |
| `src/tool/memory.ts`                           | New memory_search tool                 |
| `src/tool/registry.ts`                         | Tool registration                      |
| `src/cli/cmd/tui/event.ts`                     | MemoryConfirm event type               |
| `src/server/routes/tui.ts`                     | TUI route for memory confirm           |
| `src/cli/cmd/tui/ui/dialog-memory-confirm.tsx` | TUI dialog component                   |
| `src/cli/cmd/tui/app.tsx`                      | Event listener + toast notifications   |

### 8.2 Event System

Memory-related events defined in `src/cli/cmd/tui/event.ts`:

```typescript
MemoryConfirm: BusEvent.define(
  "tui.memory.confirm",
  z.object({
    sessionID: z.string(),
    memories: z.array(z.object({
      key: z.string(),
      value: z.string(),
    })),
  }),
),
```

### 8.3 Storage Functions

```typescript
// Save new memory (writes to current month file)
saveMemory(projectDir, entry): Promise<MemoryEntry>

// Get all memories (merges across all month files)
getMemories(projectDir, filter?): Promise<MemoryEntry[]>

// Update usage statistics
incrementMemoryUsage(projectDir, memoryID): Promise<void>

// Delete memory
deleteMemory(projectDir, memoryID): Promise<boolean>
```

---

## 9. Configuration

### 9.1 Default Patterns

The system includes 10 default patterns with bilingual (English + Chinese) keyword support:

| Key                      | English Keywords                      | Chinese Keywords         |
| ------------------------ | ------------------------------------- | ------------------------ |
| typescript-tips          | typescript, tsconfig, type annotation | 类型, 类型注解, 类型推断 |
| testing-approach         | test, testing, jest, vitest           | 测试, 单元测试, TDD      |
| refactoring-guidance     | refactor, clean, improve              | 重构, 优化, 代码质量     |
| debugging-tips           | error, bug, fix, issue                | 错误, bug, 修复, 调试    |
| security-best-practices  | security, xss, sql injection          | 安全, 漏洞, 注入         |
| performance-tips         | performance, 性能                     | 优化, 缓存               |
| api-design               | api, rest, endpoint                   | 接口, API, 请求          |
| database-tips            | database, sql, query                  | 数据库, 查询, 索引       |
| git-workflow             | git, commit, branch                   | 版本控制, 提交, 分支     |
| container-best-practices | docker, container                     | 镜像, 容器, 部署         |

### 9.2 Custom Patterns

Users can create custom patterns by adding `.opencode/memory-patterns.json` in project root:

```json
{
  "patterns": [
    {
      "keywords": ["rust", "cargo", "rustc"],
      "key": "rust-best-practices",
      "value": "Use Rust's ownership system effectively"
    }
  ]
}
```

---

## 10. Testing

### 10.1 Running Tests

```bash
# Run evolution tests
bun test test/evolution/

# Run specific test file
bun test test/evolution/memory.test.ts
```

### 10.2 Test Coverage

- Memory extraction (pattern matching)
- Memory retrieval (relevance scoring)
- Memory storage (CRUD operations)
- Usage tracking (increment usage)
- Monthly file sharding
- **Vector search (sqlite-vec integration)**
- **Hybrid search (vector + keyword merge)**
- **MMR re-ranking (diversity)**
- **Temporal decay (time-based scoring)**

---

## 11. Troubleshooting

### 11.1 Common Issues

1. **No memories extracted**: Check that task contains keywords from patterns
2. **LLM extraction fails**: Check API key configuration, logs show errors
3. **Memories not showing**: Check `.opencode/evolution/` directory exists
4. **Vector search not working**: Check SQLite sqlite-vec extension is available (falls back to keyword search)
5. **Poor search results**: Try more specific keywords; vector search uses simple embeddings

### 11.2 Debug Commands

```bash
# List all memories with details
opencode evolve memories

# Check evolution directory
ls -la .opencode/evolution/

# View memories by month
cat .opencode/evolution/memories-2026-03.json

# View logs
ls -la ~/.local/share/opencode/log/
cat ~/.local/share/opencode/log/$(ls -t ~/.local/share/opencode/log/ | head -1)

# Check vector store stats (if available)
# Check SQLite database for vector embeddings
```

---

## 12. API Reference

### 12.1 Core Functions

```typescript
// Extract memories from session using patterns
extractMemories(projectDir, sessionID, task, toolCalls, outcome)

// Extract using LLM
extractMemoriesWithLLM(projectDir, sessionID, task, toolCalls, outcome, providerID, modelID)

// Retrieve relevant memories (HYBRID SEARCH: vector + keyword + MMR + temporal decay)
getRelevantMemories(projectDir, currentTask): Promise<MemorySuggestion[]>

// Storage operations
saveMemory(projectDir, entry): Promise<MemoryEntry>
getMemories(projectDir, filter?): Promise<MemoryEntry[]>
incrementMemoryUsage(projectDir, memoryID): Promise<void>
deleteMemory(projectDir, memoryID): Promise<boolean>

// Vector store operations
const vs = await getVectorStore()
await vs.embedAndStore({ node_type, node_id, entity_title, vector_type, metadata })
await vs.search(query, { limit, min_similarity })
```

### 12.2 Interfaces

```typescript
interface MemorySuggestion {
  key: string
  value: string
  relevance: number  // Combined score from vector, keyword, temporal, and MMR
}

interface ExtractedMemory {
  key: string
  value: string
}

interface MemoryEntry {
  id: string
  key: string
  value: string
  context: string
  sessionIDs: string[]
  createdAt: number
  lastUsedAt: number
  usageCount: number
}

interface MemoryPatternConfig {
  keywords: string[]  // Bilingual keywords (English + Chinese)
  key: string
  value: string
}

interface VectorStore {
  embedAndStore(entry: VectorEntryInput): Promise<string>
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>
}
```

---

## 13. Conclusion (Updated)

The permanent memory system enables OpenCode to learn from past sessions and provide relevant context for future tasks. Key features:

- ✅ **Automatic extraction** on session completion
- ✅ **Bilingual patterns**: English + Chinese keyword support via JSON config
- ✅ **Monthly sharded storage**: Prevents file bloat
- ✅ **Dual extraction**: Pattern matching + LLM
- ✅ **Session integration**: Memories injected into prompts
- ✅ **Tool access**: AI can actively search memories
- ✅ **Usage tracking**: Tracks memory relevance
- ✅ **File-based logging**: Logs saved to file + TUI notifications
- ✅ **CLI management**: Easy review and management
- ✅ **Vector search**: SQLite + sqlite-vec for semantic similarity
- ✅ **Hybrid search**: Combines vector + keyword results (vector weighted 1.5x)
- ✅ **MMR re-ranking**: Ensures diverse results
- ✅ **Temporal decay**: Exponential decay (~1% per day) prioritizes recent memories

### Advanced Features Implemented

The system now includes several advanced features that were not in the original design:

1. **Hybrid Search**: Combines vector similarity (sqlite-vec) with keyword matching
2. **MMR Re-ranking**: Maximum Marginal Relevance ensures diverse, non-redundant results
3. **Temporal Decay**: Exponential decay function prioritizes recently used memories
4. **Usage Boost**: Frequently accessed memories get a score boost
5. **Fallback Handling**: Gracefully degrades to keyword search if vector search fails

### Production Status

The system is **production-ready** and provides excellent long-term consistency. It works out of the box without external API dependencies, yet provides advanced features for users who need them.

**Future Enhancements** (optional):
- Better embedding providers (OpenAI, Gemini, Voyage) for improved semantic understanding
- Query expansion with synonyms for better recall
- Auto-capture/recall (LanceDB-style) for automatic memory management
- Multi-backend support for flexible deployment

---

_Document Version: 2.0 (Updated)_
_Last Updated: 2026-03-06_
_Implementation: OpenCode Team_
_Notes: Updated to reflect completed implementation of vector search, MMR, and temporal decay_
