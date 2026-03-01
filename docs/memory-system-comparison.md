# Permanent Memory System Comparison: OpenCode vs OpenClaw

## Executive Summary

This document provides a comprehensive analysis and comparison of the permanent memory systems implemented in OpenCode and OpenClaw. It covers the architecture, implementation details, strengths and weaknesses of each system, proposed improvements for OpenCode, and a detailed implementation roadmap.

---

## 1. OpenCode Permanent Memory System

### 1.1 Overview

OpenCode implements a lightweight, file-based permanent memory system as part of its Self-Evolving Agent Framework. The system is designed to learn from session interactions and improve over time through pattern recognition and memory persistence.

### 1.2 Architecture

The OpenCode memory system consists of four core modules:

| Component       | File Path                      | Responsibility                  |
| --------------- | ------------------------------ | ------------------------------- |
| **Types**       | `src/evolution/types.ts`       | Zod schemas for data validation |
| **Store**       | `src/evolution/store.ts`       | File-based JSON persistence     |
| **Memory**      | `src/evolution/memory.ts`      | Extraction and retrieval logic  |
| **Integration** | `src/evolution/integration.ts` | Session lifecycle hooks         |

### 1.3 Data Storage

**Location**: `.opencode/evolution/memories.json` (project-level)

**Data Structure**:

```typescript
interface MemoryEntry {
  id: string // UUID
  key: string // Memory key (e.g., "typescript-tips")
  value: string // Memory value
  context: string // Task context when extracted
  sessionIDs: string[] // Associated session IDs
  createdAt: number // Creation timestamp
  lastUsedAt: number // Last access timestamp
  usageCount: number // Number of times retrieved
}
```

### 1.4 Memory Extraction

The system uses predefined regex patterns to extract memories from completed sessions:

| Pattern           | Key                    | Value                                              |
| ----------------- | ---------------------- | -------------------------------------------------- |
| TypeScript tasks  | `typescript-tips`      | "Use explicit type annotations for better clarity" |
| Testing tasks     | `testing-approach`     | "Write tests first (TDD) for better design"        |
| Refactoring tasks | `refactoring-guidance` | "Make small, incremental changes"                  |
| Debugging tasks   | `debugging-tips`       | "Start with minimal reproduction case"             |

**Extraction Logic**:

1. Session completes → triggers `runSessionEvolution()`
2. Checks task description and tool calls against `MEMORY_PATTERNS`
3. If match found and memory doesn't exist → saves new memory
4. If memory exists → appends session ID to `sessionIDs` array

### 1.5 Memory Retrieval

```typescript
async function getRelevantMemories(projectDir: string, currentTask: string): Promise<MemorySuggestion[]>
```

**Retrieval Algorithm**:

1. Split current task into keywords
2. Match against stored memories' `key` and `value` fields
3. Calculate relevance score (number of matching keywords)
4. Sort by relevance descending
5. Return top 5 results

### 1.6 CLI Commands

```bash
opencode evolve list          # List all evolution artifacts
opencode evolve memories      # List learned memories
opencode evolve pending       # List pending skill approvals
opencode evolve approve <id>  # Approve and create a skill
opencode evolve reject <id>   # Reject a skill proposal
```

### 1.7 Current Limitations

1. **No Vector Search**: Relies on simple string inclusion, not semantic understanding
2. **Fixed Patterns**: Only 4 predefined regex patterns, not extensible
3. **Not Integrated**: `getRelevantMemories()` is implemented but never called during session initialization
4. **No Usage Tracking**: `incrementMemoryUsage()` exists but is never invoked
5. **Keyword-Only Matching**: Cannot understand synonyms or related concepts

---

## 2. OpenClaw Permanent Memory System

### 2.1 Overview

OpenClaw implements a sophisticated, multi-layer permanent memory system with support for multiple backends, vector embeddings, hybrid search, and advanced retrieval algorithms.

### 2.2 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      OpenClaw Agent Runtime                     │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────┐  ┌───────────────┐  ┌─────────────────────┐ │
│  │ memory-core   │  │memory-lancedb │  │   QMD Memory        │ │
│  │ Extension     │  │  Extension    │  │   Plugin            │ │
│  └───────┬───────┘  └───────┬───────┘  └──────────┬──────────┘ │
│          │                  │                      │            │
│          └──────────────────┼──────────────────────┘            │
│                             │                                   │
│                  ┌──────────▼──────────┐                        │
│                  │ MemoryIndexManager  │                        │
│                  │ (src/memory/)       │                        │
│                  │                     │                        │
│                  │ ┌─────────────────┐ │                        │
│                  │ │ Search Manager  │ │                        │
│                  │ │ • Vector Search │ │                        │
│                  │ │ • FTS Search    │ │                        │
│                  │ │ • Hybrid Merge  │ │                        │
│                  │ │ • MMR Re-rank   │ │                        │
│                  │ │ • Temporal Decay│ │                        │
│                  │ └─────────────────┘ │                        │
│                  │                     │                        │
│                  │ ┌─────────────────┐ │                        │
│                  │ │ Embedding Ops   │ │                        │
│                  │ │ • OpenAI        │ │                        │
│                  │ │ • Gemini        │ │                        │
│                  │ │ • Voyage        │ │                        │
│                  │ │ • Local (LLama) │ │                        │
│                  │ │ • Batch API     │ │                        │
│                  │ └─────────────────┘ │                        │
│                  │                     │                        │
│                  │ ┌─────────────────┐ │                        │
│                  │ │ Sync Ops        │ │                        │
│                  │ │ • File Watcher  │ │                        │
│                  │ │ • Session Sync  │ │                        │
│                  │ │ • Delta Tracking│ │                        │
│                  │ └─────────────────┘ │                        │
│                  └──────────┬──────────┘                        │
│                             │                                   │
│         ┌───────────────────┼───────────────────┐               │
│         │                   │                   │               │
│  ┌──────▼───────┐   ┌───────▼───────┐   ┌──────▼───────┐       │
│  │ SQLite +     │   │ Embedding     │   │ File System  │       │
│  │ sqlite-vec   │   │ Cache         │   │ (MEMORY.md)  │       │
│  │ (.sqlite)    │   │ (SQLite)      │   │ memory/*.md  │       │
│  └──────────────┘   └───────────────┘   └──────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Multi-Backend Support

| Backend     | Type         | Storage             | Key Features                           |
| ----------- | ------------ | ------------------- | -------------------------------------- |
| **Builtin** | Native       | SQLite + sqlite-vec | Hybrid search, MMR, temporal decay     |
| **QMD**     | External CLI | qmd tool            | Query expansion, auto-update           |
| **LanceDB** | Plugin       | LanceDB native      | Auto-capture/recall, prompt protection |

### 2.4 Database Schema

```sql
-- Files table
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'memory',
  hash TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL
);

-- Chunks table (stores embedding vectors as JSON)
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  source TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  hash TEXT NOT NULL,
  model TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Vector search table (sqlite-vec)
CREATE VIRTUAL TABLE chunks_vec USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[1536]
);

-- Full-text search table (FTS5)
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text, id UNINDEXED, path UNINDEXED, source UNINDEXED
);
```

### 2.5 Search Pipeline

```
User Query
    │
    ▼
┌─────────────────┐
│ Query Expansion │ ← Extract keywords (FTS mode)
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌─────────┐ ┌─────────┐
│ Vector  │ │  FTS    │
│ Search  │ │ Search  │
└────┬────┘ └────┬────┘
     │           │
     └─────┬─────┘
           │
           ▼
    ┌──────────────┐
    │ Hybrid Merge │ ← Weighted merge (vectorWeight: 0.7 / textWeight: 0.3)
    └──────┬───────┘
           │
     ┌─────┴─────┐
     │           │
     ▼           ▼
 ┌─────────┐ ┌──────────────┐
 │  MMR    │ │ Temporal     │
 │ Re-rank │ │ Decay        │
 └────┬────┘ └──────┬───────┘
      │             │
      └──────┬──────┘
             │
             ▼
     ┌───────────────┐
     │ Final Results │
     └───────────────┘
```

### 2.6 Embedding Providers

| Provider | Config Value | Default Model                  | Dimensions |
| -------- | ------------ | ------------------------------ | ---------- |
| OpenAI   | `openai`     | `text-embedding-3-small`       | 1536       |
| Gemini   | `gemini`     | `gemini-embedding-001`         | 768        |
| Voyage   | `voyage`     | `voyage-4-large`               | 1024       |
| Local    | `local`      | `embeddinggemma-300m-qat-q8_0` | Variable   |

### 2.7 Configuration

```yaml
memory:
  backend: builtin
  citations: auto

agents:
  defaults:
    memorySearch:
      enabled: true
      sources: ["memory", "sessions"]
      provider: auto
      model: text-embedding-3-small

      store:
        path: ~/.local/state/openclaw/memory/{agentId}.sqlite

      chunking:
        tokens: 400
        overlap: 80

      sync:
        onSessionStart: true
        onSearch: true
        watch: true
        intervalMinutes: 0

      query:
        maxResults: 6
        minScore: 0.35
        hybrid:
          enabled: true
          vectorWeight: 0.7
          textWeight: 0.3
```

### 2.8 Memory Tools

```typescript
// memory_search
{
  name: "memory_search",
  parameters: {
    query: string,
    maxResults?: number,
    minScore?: number
  }
}

// memory_get
{
  name: "memory_get",
  parameters: {
    path: string,
    from?: number,
    lines?: number
  }
}
```

### 2.9 Agent Integration

**Tool Registration**:

```typescript
api.registerTool(
  (ctx) => {
    const memorySearchTool = api.runtime.tools.createMemorySearchTool({...});
    const memoryGetTool = api.runtime.tools.createMemoryGetTool({...});
    return [memorySearchTool, memoryGetTool];
  },
  { names: ["memory_search", "memory_get"] },
);
```

**Lifecycle Hooks (LanceDB)**:

- `before_agent_start`: Auto-recall, inject relevant memories
- `agent_end`: Auto-capture, store important information

---

## 3. Comparative Analysis

### 3.1 Feature Comparison

| Feature                    | OpenCode               | OpenClaw                            |
| -------------------------- | ---------------------- | ----------------------------------- |
| **Storage Backend**        | JSON files             | SQLite + sqlite-vec / QMD / LanceDB |
| **Search Method**          | Keyword matching       | Vector + FTS hybrid                 |
| **Pattern Extraction**     | 4 fixed regex patterns | Unlimited (LLM-powered)             |
| **Backend Options**        | Single (file)          | Triple (Builtin/QMD/LanceDB)        |
| **Semantic Understanding** | ❌                     | ✅                                  |
| **MMR Re-ranking**         | ❌                     | ✅                                  |
| **Temporal Decay**         | ❌                     | ✅                                  |
| **Embedding Providers**    | None                   | 4 (OpenAI/Gemini/Voyage/Local)      |
| **Batch API Support**      | ❌                     | ✅                                  |
| **Session Integration**    | Partial                | Full (hooks + tools)                |
| **Auto-Capture/Recall**    | ❌                     | ✅ (LanceDB)                        |
| **Usage Tracking**         | Implemented but unused | ✅ Full                             |
| **Configuration Options**  | None                   | Extensive                           |

### 3.2 Strengths and Weaknesses

#### OpenCode Strengths

1. **Simplicity**: Lightweight, easy to understand and maintain
2. **No Dependencies**: No external services or heavy libraries required
3. **Project-Level Isolation**: Each project has independent memory
4. **Minimal Overhead**: Fast read/write operations for small datasets

#### OpenCode Weaknesses

1. **Primitive Search**: Cannot understand semantics, only exact keyword matches
2. **Inflexible Patterns**: Cannot learn new patterns without code changes
3. **Not Production-Ready**: Retrieval function exists but is never called
4. **No Vector Capability**: Missing modern AI-powered search
5. **Poor Scalability**: JSON files don't scale well with large memory pools

#### OpenClaw Strengths

1. **Sophisticated Search**: Hybrid vector + text search with MMR
2. **Multi-Backend**: Flexible deployment options
3. **Production-Ready**: Full tool integration and lifecycle hooks
4. **Semantic Understanding**: Can find related concepts, not just keywords
5. **Advanced Features**: Temporal decay, query expansion, auto-sync

#### OpenClaw Weaknesses

1. **Complexity**: Higher learning curve and maintenance burden
2. **Dependencies**: Requires external services (OpenAI, etc.)
3. **Configuration Overhead**: Many options to configure correctly
4. **Resource Usage**: Higher memory and CPU requirements

### 3.3 Use Case Suitability

| Scenario                          | Recommended System |
| --------------------------------- | ------------------ |
| Personal projects, small scale    | OpenCode           |
| Team projects, large memory pools | OpenClaw           |
| Simple pattern-based learning     | OpenCode           |
| Semantic search requirements      | OpenClaw           |
| Minimal dependencies required     | OpenCode           |
| Enterprise features needed        | OpenClaw           |

---

## 4. Proposed Improvements for OpenCode

### 4.1 Priority Matrix

| Priority   | Improvement                                     | Complexity | Impact |
| ---------- | ----------------------------------------------- | ---------- | ------ |
| **HIGH**   | Integrate memory retrieval into session startup | Low        | High   |
| **HIGH**   | Add memory_search tool for AI access            | Medium     | High   |
| **MEDIUM** | Add vector search support                       | High       | High   |
| **MEDIUM** | Implement dynamic pattern extraction (LLM)      | Medium     | High   |
| **LOW**    | Add MMR and temporal decay                      | Medium     | Medium |

### 4.2 Phase 1: Session Integration (Immediate)

**Goal**: Make existing memory system functional

**Implementation**:

```typescript
// src/evolution/memory.ts - Enhanced retrieval with usage tracking
export async function getMemoriesForSession(projectDir: string, task: string): Promise<string> {
  const memories = await getRelevantMemories(projectDir, task)
  if (memories.length === 0) return ""

  // Update usage statistics
  const all = await getMemories(projectDir)
  for (const m of memories) {
    const entry = all.find((e) => e.key === m.key)
    if (entry) await incrementMemoryUsage(projectDir, entry.id)
  }

  return memories.map((m) => `- ${m.key}: ${m.value}`).join("\n")
}
```

**Integration Point**: Modify session initialization to inject memories into context

### 4.3 Phase 2: Memory Search Tool

**Goal**: Enable AI to actively search memories

**Implementation**:

```typescript
// src/cli/tools/memory.ts
export function createMemorySearchTool(projectDir: string) {
  return {
    name: "memory_search",
    description: "Search permanent memories for relevant information from past sessions",
    parameters: {
      query: z.string().describe("Search query"),
      maxResults: z.number().default(5).describe("Maximum results to return"),
    },
    handler: async ({ query, maxResults }) => {
      const memories = await getRelevantMemories(projectDir, query)
      return memories.slice(0, maxResults).map((m) => ({
        key: m.key,
        value: m.value,
        relevance: m.relevance,
      }))
    },
  }
}
```

### 4.4 Phase 3: Vector Search Support

**Goal**: Add semantic search capability

**Implementation Steps**:

1. **Add Embedding Provider**:

```typescript
// src/evolution/embeddings.ts
export async function embed(text: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
    }),
  })
  const data = await response.json()
  return data.data[0].embedding
}
```

2. **Extend Database Schema** (switch from JSON to SQLite):

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  context TEXT,
  embedding BLOB,
  session_ids TEXT,
  created_at INTEGER,
  last_used_at INTEGER,
  usage_count INTEGER DEFAULT 0
);

CREATE VIRTUAL TABLE memories_vec USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[1536]
);
```

3. **Implement Vector Search**:

```typescript
export async function searchMemoriesByVector(
  projectDir: string,
  query: string,
  limit: number = 5,
): Promise<MemoryEntry[]> {
  const queryEmbedding = await embed(query)
  // Use sqlite-vec for similarity search
  // Combine with keyword matching for hybrid search
}
```

### 4.5 Phase 4: Dynamic Pattern Extraction

**Goal**: Replace fixed regex patterns with LLM-powered extraction

**Implementation**:

```typescript
// src/evolution/memory.ts
const MEMORY_EXTRACTION_PROMPT = `
Extract 0-3 key learnings from this task that would help with future similar tasks.
Return a JSON array with objects containing:
- key: short descriptive key (kebab-case)
- value: actionable advice (1-2 sentences)

Task: {task}
Tool calls: {toolCalls}
Outcome: {outcome}
`

export async function extractMemoriesWithLLM(
  projectDir: string,
  sessionID: string,
  task: string,
  toolCalls: string[],
  outcome: string,
): Promise<void> {
  const prompt = MEMORY_EXTRACTION_PROMPT.replace("{task}", task)
    .replace("{toolCalls}", toolCalls.join(", "))
    .replace("{outcome}", outcome)

  const response = await llm.chat(prompt) // Use existing LLM integration
  const memories = JSON.parse(response)

  for (const m of memories) {
    await saveMemory(projectDir, {
      key: m.key,
      value: m.value,
      context: task,
      sessionIDs: [sessionID],
    })
  }
}
```

### 4.6 Phase 5: Advanced Retrieval Features

**Goal**: Match OpenClaw's advanced features

**MMR (Maximum Marginal Relevance)**:

```typescript
export async function rerankWithMMR(
  candidates: MemoryEntry[],
  query: string,
  lambda: number = 0.5,
): Promise<MemoryEntry[]> {
  const queryEmbedding = await embed(query)

  // Select diverse results while maintaining relevance
  const selected: MemoryEntry[] = []
  const remaining = [...candidates]

  while (remaining.length > 0 && selected.length < 5) {
    const scored = remaining.map((m) => {
      const relevance = cosineSimilarity(m.embedding, queryEmbedding)
      const diversity = Math.max(...selected.map((s) => 1 - cosineSimilarity(m.embedding, s.embedding)))
      return { item: m, score: lambda * relevance + (1 - lambda) * diversity }
    })

    scored.sort((a, b) => b.score - a.score)
    selected.push(scored[0].item)
    remaining.splice(remaining.indexOf(scored[0].item), 1)
  }

  return selected
}
```

**Temporal Decay**:

```typescript
export function applyTemporalDecay(memories: MemoryEntry[], halfLifeDays: number = 30): MemoryEntry[] {
  const now = Date.now()
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000

  return memories
    .map((m) => {
      const daysSinceLastUse = (now - m.lastUsedAt) / halfLifeMs
      const decayFactor = Math.pow(0.5, daysSinceLastUse)
      return {
        ...m,
        adjustedScore: m.relevance * decayFactor,
      }
    })
    .sort((a, b) => b.adjustedScore - a.adjustedScore)
}
```

---

## 5. Implementation Roadmap

### 5.1 Timeline

| Phase   | Duration  | Deliverables                        |
| ------- | --------- | ----------------------------------- |
| Phase 1 | 1 week    | Session integration, usage tracking |
| Phase 2 | 1-2 weeks | memory_search tool                  |
| Phase 3 | 2-3 weeks | Vector search, SQLite migration     |
| Phase 4 | 2 weeks   | Dynamic pattern extraction          |
| Phase 5 | 2 weeks   | MMR, temporal decay                 |

**Total Estimated Time**: 8-11 weeks

### 5.2 Resource Requirements

| Phase   | Skills Needed          | Dependencies      |
| ------- | ---------------------- | ----------------- |
| Phase 1 | TypeScript             | None              |
| Phase 2 | TypeScript, API design | None              |
| Phase 3 | SQL, Vector math       | OpenAI/Voyage API |
| Phase 4 | LLM integration        | Existing LLM      |
| Phase 5 | Algorithm design       | None              |

### 5.3 Milestones

1. **M1** (Week 1): `getRelevantMemories()` called on session start
2. **M2** (Week 2): `memory_search` tool registered and functional
3. **M3** (Week 4): SQLite database with vector columns operational
4. **M4** (Week 6): LLM extracts memories from sessions automatically
5. **M5** (Week 8): Advanced retrieval features matching OpenClaw

### 5.4 Testing Strategy

```bash
# Phase 1-2 tests
bun test test/evolution/memory.test.ts

# Integration tests
bun test test/evolution/integration.test.ts

# Performance benchmarks
# (vector search vs keyword search)
```

---

## 6. Recommendations

### 6.1 For Immediate Action

1. **Enable Phase 1 immediately**: The retrieval function already exists but is unused. This is the highest ROI improvement.

2. **Register memory_search tool**: Even without vector search, the current keyword-based retrieval provides value.

### 6.2 For Long-term Strategy

1. **Adopt OpenClaw's architecture incrementally**: Rather than rebuilding, consider integrating OpenClaw's memory-core as a plugin.

2. **Evaluate hybrid approach**: Keep OpenCode's simplicity for basic use cases, optionally enable OpenClaw backend for advanced needs.

3. **Prioritize user privacy**: If adding external APIs (OpenAI embeddings), ensure users can opt out or use local embeddings.

### 6.3 Decision Matrix

| Factor             | Build Own    | Adopt OpenClaw    |
| ------------------ | ------------ | ----------------- |
| Development time   | 8-11 weeks   | 1-2 weeks         |
| Maintenance burden | High         | Low               |
| Feature parity     | Long-term    | Immediate         |
| Customization      | Full control | Limited by plugin |
| Dependencies       | Minimal      | Significant       |

---

## 7. Conclusion

OpenCode's current memory system provides a solid foundation but lacks production-ready features. The most impactful improvements are:

1. **Integration**: Making the existing retrieval function work
2. **Tool Access**: Enabling AI to actively search memories
3. **Vector Search**: Adding semantic understanding

For teams already using OpenClaw, adopting its memory system as a plugin provides the fastest path to advanced features. For OpenCode-only teams, the phased improvement plan offers a structured path to feature parity.

The key insight is that memory systems are only valuable when integrated into the agent's workflow. The current OpenCode implementation has the right data structures but fails at the integration point—fixing this alone would provide significant value.

---

## Appendix A: File Reference

### OpenCode Memory Files

| File                            | Purpose                |
| ------------------------------- | ---------------------- |
| `src/evolution/types.ts`        | Zod schemas            |
| `src/evolution/store.ts`        | Persistence layer      |
| `src/evolution/memory.ts`       | Extraction & retrieval |
| `src/evolution/integration.ts`  | Session hooks          |
| `src/cli/cmd/evolve.ts`         | CLI commands           |
| `test/evolution/memory.test.ts` | Tests                  |

### OpenClaw Memory Files

| File                           | Purpose             |
| ------------------------------ | ------------------- |
| `src/memory/manager.ts`        | Core manager        |
| `src/memory/search-manager.ts` | Search factory      |
| `src/memory/embeddings.ts`     | Embedding providers |
| `src/memory/hybrid.ts`         | Hybrid search       |
| `src/memory/mmr.ts`            | MMR re-ranking      |
| `src/memory/temporal-decay.ts` | Time decay          |

---

## Appendix B: Configuration Migration

For users migrating from OpenCode to OpenClaw backend:

```yaml
# OpenCode (current)
# No configuration needed - uses .opencode/evolution/

# OpenClaw (future)
memory:
  backend: builtin # or "qmd", "lancedb"

agents:
  defaults:
    memorySearch:
      enabled: true
      provider: openai
      model: text-embedding-3-small
```

---

_Document Version: 1.0_  
_Last Updated: 2026-03-01_  
_Author: OpenCode Analysis_
