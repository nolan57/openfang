# OpenCode Interface, Multi-Session, and Memory Sharing Analysis

**Date:** 2026-03-02  
**Branch:** feature/zeroclaw-integration

---

## Executive Summary

This document provides a comprehensive analysis of OpenCode's user interfaces (TUI and Web), multi-session concurrency capabilities, and cross-session memory/context sharing mechanisms.

---

## Part 1: User Interfaces

### 1.1 Overview

OpenCode has **two separate client applications** that connect to the same backend server:

| Interface | Technology | Start Command | Access |
|-----------|------------|---------------|--------|
| **TUI** (Terminal UI) | opentui + SolidJS (terminal rendering) | `opencode` or `opencode <directory>` | Terminal |
| **Web Interface** | SolidJS + Astro (browser DOM) | `opencode web` | Browser at `http://localhost:4096` |

### 1.2 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Backend Server                         │
│  (packages/opencode/src/server/)                        │
│  - HTTP API                                              │
│  - WebSocket/SSE Events                                  │
│  - Session Management                                    │
│  - Plugin System                                         │
└─────────────────────────────────────────────────────────┘
           │                        │
           │                        │
    ┌──────▼──────┐          ┌─────▼──────┐
    │    TUI      │          │    Web     │
    │  (terminal) │          │ (browser)  │
    │  opentui    │          │  SolidJS   │
    └─────────────┘          └────────────┘
```

**Key Principle:** Both interfaces are **thin clients** - all state and logic resides in the server.

---

### 1.3 TUI (Terminal UI)

**Location:** `packages/opencode/src/cli/cmd/tui/`

**Technology Stack:**
- [opentui](https://github.com/sst/opentui) - Terminal UI framework
- SolidJS for component logic
- Custom terminal rendering (`<box>`, `<ScrollBoxRenderable>`)

**Layout Structure:**
```
┌──────────────────────────────────────────────────────────┐
│  Header (project, model, agent, status)                  │
├─────────────┬────────────────────────────────────────────┤
│  Sidebar    │  Main Content                              │
│  - Sessions │  - Chat messages                           │
│  - Files    │  - Code blocks                             │
│             │  - Tool calls                              │
├─────────────┴────────────────────────────────────────────┤
│  Prompt Input (with autocomplete, history)               │
├──────────────────────────────────────────────────────────┤
│  Footer (keybinds hints, status)                         │
└──────────────────────────────────────────────────────────┘
```

**Key Features:**
- Keyboard-only navigation (vim-like keybinds)
- Session list dialog (`DialogSessionList`)
- Model/agent switching dialogs
- Timeline view for message history
- Fork session from any message
- Toast notifications
- Command palette (`DialogCommand`)

**Keybinds (configurable):**
```json
{
  "session_list": "ctrl+s",
  "session_new": "ctrl+n",
  "session_fork": "none",
  "model_list": "ctrl+m",
  "agent_list": "ctrl+a",
  "theme_list": "ctrl+t"
}
```

---

### 1.4 Web Interface

**Location:** `packages/app/`

**Technology Stack:**
- SolidJS for reactive UI
- Astro for routing
- `@opencode-ai/ui` component library
- Standard HTML/CSS/DOM rendering

**Layout Structure:**
```
┌──────────────────────────────────────────────────────────┐
│  Titlebar (window controls, project name, settings)      │
├──────────┬───────────────────────────────────────────────┤
│  Sidebar │  Session Header (model, agent, status)        │
│  - Proj. │  ───────────────────────────────────────────  │
│  - Files │  Chat Messages                                │
│          │  - User prompts                               │
│          │  - Assistant responses (markdown + code)      │
│          │  - Tool calls (file edits, bash, etc.)        │
│          │  ───────────────────────────────────────────  │
│          │  Composer Input (prompt, attachments, context)│
├──────────┴───────────────────────────────────────────────┤
│  Status Bar (session info, token usage, keybind hints)   │
└──────────────────────────────────────────────────────────┘
```

**Key Components:**
```
packages/app/src/
├── pages/
│   ├── layout.tsx              # Main app shell
│   ├── session.tsx             # Session chat view
│   ├── home.tsx                # Dashboard
│   └── layout/
│       ├── sidebar-shell.tsx   # Sidebar container
│       ├── sidebar-workspace.tsx  # Workspace tree
│       └── sidebar-project.tsx    # Project list
├── components/
│   ├── session/              # Session components
│   ├── prompt-input.tsx      # Chat input
│   ├── file-tree.tsx         # File explorer
│   ├── terminal.tsx          # Embedded xterm.js
│   └── dialog-*.tsx          # Settings dialogs
```

**Features:**
- Mouse + keyboard interaction
- Resizable panels
- File tree with diff view
- Embedded terminal (xterm.js)
- Review panel for code changes
- Mobile-responsive design
- Settings dialogs (models, permissions, MCP, keybinds, agents)

---

### 1.5 Interface Comparison

| Feature | TUI | Web |
|---------|-----|-----|
| **Input** | Keyboard only | Mouse + keyboard |
| **Rendering** | Terminal characters | Browser DOM |
| **UI Library** | opentui primitives | HTML/CSS + `@opencode-ai/ui` |
| **Layout** | Fixed terminal grid | Flexible/resizable |
| **Scrolling** | Custom acceleration | Native browser |
| **Code Highlighting** | shiki (terminal) | shiki (DOM) |
| **Images/Attachments** | ❌ Limited | ✅ Full support |
| **Mobile Support** | ❌ No | ✅ Responsive |
| **Accessibility** | Terminal a11y | Web a11y standards |

---

## Part 2: Multi-Session Support

### 2.1 Overview

OpenCode **fully supports multiple concurrent sessions** with complete isolation and independent state management.

---

### 2.2 Session Hierarchy

**Data Model:**
```typescript
// packages/opencode/src/session/index.ts
export const Info = z.object({
  id: Identifier.schema("session"),
  slug: z.string(),
  projectID: z.string(),
  directory: z.string(),
  parentID: Identifier.schema("session").optional(),  // Parent session reference
  title: z.string(),
  version: z.string(),
  summary: z.object({
    additions: z.number(),
    deletions: z.number(),
    files: z.number(),
    diffs: Snapshot.FileDiff.array().optional(),
  }).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    compacting: z.number().optional(),
    archived: z.number().optional(),
  }),
})
```

**Session Types:**
| Type | Description | Title Prefix |
|------|-------------|--------------|
| **Parent Session** | Original conversation | - |
| **Child Session** | Forked from parent | `"Child session - <timestamp>"` |
| **Forked Session** | Branch at specific message | `"<original> (fork #1)"` |

---

### 2.3 Session Concurrency Features

#### 2.3.1 Multiple Sessions Per Project

**Unlimited sessions** can exist simultaneously per project/directory:

```typescript
// packages/app/src/context/layout.tsx
sessionTabs: {} as Record<string, SessionTabs>,  // Tabs per session
sessionView: {} as Record<string, SessionView>,  // View state per session
```

#### 2.3.2 Session Forking

**API Endpoint:**
```
POST /session/:id/fork
Body: { messageID?: string }  // Fork at specific message (defaults to latest)
Response: Session
```

**CLI Usage:**
```bash
# Fork from latest message
opencode --fork --continue

# Fork from specific session
opencode --fork --session <id>
```

**Keybind:** `session_fork` (configurable, default: none)

**TUI Dialog:** `DialogForkFromTimeline` - fork from any message in timeline

#### 2.3.3 Parallel Session Execution

Sessions run in **complete isolation** with no state bleeding:

```typescript
// packages/opencode/test/acp/event-subscription.test.ts
test("keeps concurrent sessions isolated when message.part.delta events are interleaved", async () => {
  const sessionA = await agent.newSession({ cwd, mcpServers: [] })
  const sessionB = await agent.newSession({ cwd, mcpServers: [] })
  // Sessions run in parallel with isolated state
})
```

#### 2.3.4 Subagent Parallel Sessions

Agents can spawn **subagents** for parallel task execution:

```json
{
  "name": "research",
  "mode": "subagent",
  "tools": ["webfetch", "read", "glob"]
}
```

**Use Cases:**
- Complex multi-step tasks
- Background research while main session continues
- Isolated tool permissions per subagent

---

### 2.4 Session State Isolation

Each session maintains **independent state**:

| State | Scope | Persistence |
|-------|-------|-------------|
| **Message History** | Per-session | Database (SQLite) |
| **File Changes/Diffs** | Per-session | In-memory + diff store |
| **Terminal State** | Per-session | In-memory |
| **Scroll Position** | Per-session | LocalStorage (`layout.v6`) |
| **Todo Lists** | Per-session | In-memory |
| **Context Attachments** | Per-session | Per-message |
| **Model/Agent Selection** | Per-session | Inherited from parent on fork |
| **Permissions** | Per-session | Database |

**State Management:**
```typescript
// packages/app/src/context/layout.tsx
const scroll = createScrollPersistence({
  getSnapshot: (sessionKey) => store.sessionView[sessionKey]?.scroll,
  onFlush: (sessionKey, next) => {
    // Isolated scroll state per session
  },
})
```

---

### 2.5 Session Management UI

#### Web Interface

**Session List Dialog:**
- Browse all sessions in project
- Search by title
- Sort by last updated
- Delete/archive sessions

**Session Tabs:**
- Multiple file tabs per session
- Review panel for code changes
- Context panel for attachments

#### TUI

**Session Commands:**
```
/sessions          # Open session list dialog
/new               # Create new session
#fork              # Fork current session (via dialog)
```

**Session Navigation:**
- `DialogSessionList` - Browse and switch sessions
- Timeline view - Navigate message history
- Fork from timeline - Branch at any message

---

### 2.6 Cross-Directory Sessions

Sessions are **scoped per workspace/project directory**:

```typescript
// Session key format: `${directory}/${sessionId}`
const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
```

**Implications:**
- Different directories have separate session lists
- Same session ID can exist in different directories (isolated)
- Global session switching across all projects via SDK

---

### 2.7 Session Concurrency Summary

| Feature | Support | Implementation |
|---------|---------|----------------|
| **Multiple sessions per project** | ✅ Unlimited | Database + in-memory state |
| **Session forking/branching** | ✅ At any message | `POST /session/:id/fork` |
| **Parent-child relationships** | ✅ Hierarchical | `parentID` field |
| **Parallel execution** | ✅ Isolated state | Separate message queues |
| **Subagent sessions** | ✅ Concurrent tasks | `mode: "subagent"` |
| **Session switching** | ✅ Dialog + keybinds | `DialogSessionList` |
| **State persistence** | ✅ Per-session | SQLite + LocalStorage |
| **Cross-project sessions** | ✅ Scoped by directory | `${directory}/${sessionId}` |

---

## Part 3: Memory and Context Sharing

### 3.1 Overview

OpenCode implements a **project-level permanent memory system** that enables cross-session knowledge sharing while maintaining session isolation.

---

### 3.2 Permanent Memory Architecture

**Storage Location:** `.opencode/evolution/` (project-level)

**File Structure:**
```
.opencode/evolution/
├── memories-2026-01.json   # January 2026 memories
├── memories-2026-02.json   # February 2026 memories
├── memories-2026-03.json   # March 2026 memories (current)
├── skills.json            # Generated skills (draft/approved/rejected)
└── prompts.json           # Optimized prompts from session analysis
```

**Memory Entry Schema:**
```typescript
interface MemoryEntry {
  id: string              // UUID
  key: string             // Memory key (e.g., "typescript-tips")
  value: string           // Actionable advice
  context: string         // Task context when extracted
  sessionIDs: string[]    // All sessions that contributed
  createdAt: number       // Creation timestamp
  lastUsedAt: number      // Last access timestamp
  usageCount: number      // Number of times retrieved
}
```

---

### 3.3 Memory Extraction

Two methods for extracting memories from completed sessions:

#### 3.3.1 Pattern-Based Extraction

**Configuration:** `packages/opencode/src/evolution/memory-patterns.json`

**Default Patterns (Bilingual: English + Chinese):**
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
    }
  ]
}
```

**Extraction Logic:**
```typescript
// packages/opencode/src/evolution/memory.ts
export async function extractMemories(
  projectDir: string,
  sessionID: string,
  task: string,
  toolCalls: string[],
  outcome: string,
): Promise<void> {
  const patterns = await loadMemoryPatterns()
  const existingMemories = await getMemories(projectDir)
  const combinedText = `${task} ${toolCalls.join(" ")}`.toLowerCase()

  for (const pattern of patterns) {
    const keywordRegex = new RegExp(pattern.keywords.join("|"), "i")
    if (keywordRegex.test(combinedText)) {
      const existing = existingMemories.find((m) => m.key === pattern.key)
      
      if (existing) {
        if (!existing.sessionIDs.includes(sessionID)) {
          existing.sessionIDs.push(sessionID)
        }
      } else {
        await saveMemory(projectDir, {
          key: pattern.key,
          value: pattern.value,
          context: task,
          sessionIDs: [sessionID],
        })
      }
    }
  }
}
```

#### 3.3.2 LLM-Based Extraction

**Prompt Template:**
```
Extract 0-3 key learnings from this task that would help with future similar tasks.
Return a JSON array with objects containing:
- key: short descriptive key in kebab-case (e.g., "typescript-tips")
- value: actionable advice in 1-2 sentences

Task: {task}
Tool calls: {toolCalls}
Outcome: {outcome}
```

**User Confirmation Flow:**
1. Session completes → LLM extracts memories
2. `TuiEvent.MemoryConfirm` published
3. TUI shows `DialogMemoryConfirm`
4. User approves/rejects each memory
5. Approved memories saved to `.opencode/evolution/`

---

### 3.4 Memory Retrieval

**Automatic Injection on Session Start:**

```typescript
// packages/opencode/src/session/prompt.ts (line 723)
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
      // Increment usage tracking
      const allMemories = await getMemories(Instance.directory)
      for (const m of memories) {
        const entry = allMemories.find((e) => e.key === m.key)
        if (entry) await incrementMemoryUsage(Instance.directory, entry.id)
      }
      
      // Inject into system prompt
      const memoryContext = memories.map((m) => `• ${m.key}: ${m.value}`).join("\n")
      system.push(
        `\n<system-reminder>\nPast session learnings relevant to this task:\n${memoryContext}\n</system-reminder>`
      )
    }
  }
}
```

**Retrieval Algorithm:**
```typescript
// packages/opencode/src/evolution/memory.ts
export async function getRelevantMemories(
  projectDir: string,
  currentTask: string
): Promise<MemorySuggestion[]> {
  const allMemories = await getMemories(projectDir)
  
  // Split task into keywords
  const taskWords = currentTask.toLowerCase().split(/\s+/)
  
  // Score each memory by keyword matches
  return allMemories
    .map((memory) => ({
      key: memory.key,
      value: memory.value,
      relevance: taskWords.filter(
        (word) => 
          memory.key.toLowerCase().includes(word) || 
          memory.value.toLowerCase().includes(word)
      ).length,
    }))
    .filter((m) => m.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 5)  // Top 5 most relevant
}
```

---

### 3.5 Manual Memory Search Tool

**Tool Definition:**
```typescript
// packages/opencode/src/tool/memory.ts
export const MemorySearchTool = Tool.define("memory_search", {
  description: "Search permanent memories from past sessions for relevant learnings and patterns",
  parameters: {
    query: z.string().describe("Search query to find relevant memories"),
    maxResults: z.number().optional().describe("Maximum number of results (default: 5)"),
  },
  execute: async (args, ctx) => {
    const memories = await getRelevantMemories(Instance.directory, args.query)
    const limit = args.maxResults ?? 5
    const results = memories.slice(0, limit)
    
    // Track usage
    const allMemories = await getMemories(Instance.directory)
    for (const m of results) {
      const entry = allMemories.find((e) => e.key === m.key)
      if (entry) await incrementMemoryUsage(Instance.directory, entry.id)
    }
    
    // Format output
    const output = results.length > 0
      ? results.map((m, i) => `${i + 1}. **${m.key}**: ${m.value} (relevance: ${m.relevance})`).join("\n")
      : "No relevant memories found."
    
    return {
      title: "Memory Search",
      metadata: { query: args.query, count: results.length },
      output,
    }
  }
})
```

---

### 3.6 Context Sharing Scope

| Context Type | Shared Across Sessions? | Mechanism |
|--------------|------------------------|-----------|
| **Permanent Memories** | ✅ Yes (same project) | `.opencode/evolution/memories-*.json` |
| **Generated Skills** | ✅ Yes (same project) | `.opencode/evolution/skills.json` |
| **Optimized Prompts** | ✅ Yes (same project) | `.opencode/evolution/prompts.json` |
| **Message History** | ❌ No | Isolated per session (SQLite) |
| **File Changes/Diffs** | ❌ No | Per-session state |
| **Terminal State** | ❌ No | Per-session |
| **Context Attachments** | ❌ No | Per-message |
| **Model/Agent Selection** | ❌ No | Per-session (inherited on fork) |
| **Permissions** | ❌ No | Per-session ruleset |

---

### 3.7 CLI Commands

```bash
# List all evolution artifacts
opencode evolve list

# List learned memories
opencode evolve memories

# List pending skill approvals
opencode evolve pending

# Approve a skill proposal
opencode evolve approve <id>

# Reject a skill proposal
opencode evolve reject <id>
```

---

### 3.8 Memory System Limitations

| Limitation | Current State | Future Improvement |
|------------|---------------|-------------------|
| **Search Algorithm** | Keyword matching only | Vector/semantic search |
| **Pattern Config** | Fixed JSON file | User-extensible patterns |
| **Cross-Project Sharing** | ❌ Project-scoped only | Optional global memory pool |
| **Memory Expiration** | ❌ No automatic cleanup | TTL-based archival |
| **Usage Analytics** | Basic count tracking | Detailed usage graphs |
| **Memory Visualization** | ❌ CLI only | UI dashboard |

---

## Part 4: Integration Summary

### 4.1 How It All Works Together

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Interaction                          │
│  ┌─────────────┐                           ┌──────────────┐    │
│  │    TUI      │                           │    Web UI    │    │
│  │  (terminal) │                           │   (browser)  │    │
│  └──────┬──────┘                           └──────┬───────┘    │
│         │                                         │             │
│         └─────────────────┬───────────────────────┘             │
│                           │                                     │
│                  ┌────────▼────────┐                            │
│                  │  Backend Server │                            │
│                  │  (HTTP + WS)    │                            │
│                  └────────┬────────┘                            │
│                           │                                     │
└───────────────────────────┼─────────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
┌────────▼────────┐  ┌──────▼───────┐  ┌──────▼──────┐
│  Session Store  │  │   Memory     │  │   Plugin    │
│  (SQLite)       │  │   Store      │  │   System    │
│  - Messages     │  │  (JSON)      │  │  - MCP      │
│  - Diffs        │  │  - Memories  │  │  - Skills   │
│  - Permissions  │  │  - Skills    │  │  - Tools    │
└─────────────────┘  └──────────────┘  └─────────────┘
```

### 4.2 Session Lifecycle with Memory

```
1. User starts new session
         │
2. Load relevant memories from .opencode/evolution/
         │
3. Inject memories into system prompt
         │
4. User interacts (messages, tools, file edits)
         │
5. Session completes (user exits or task done)
         │
6. Extract memories (pattern + LLM)
         │
7. User confirms memories (TUI dialog)
         │
8. Save memories to .opencode/evolution/memories-YYYY-MM.json
         │
9. Next session automatically benefits from accumulated knowledge
```

### 4.3 Key Benefits

| Benefit | Description |
|---------|-------------|
| **Cumulative Learning** | Each session contributes to project knowledge base |
| **Automatic Context** | No manual context sharing - happens automatically |
| **Session Isolation** | Clean separation between concurrent sessions |
| **Flexible Interface** | Use TUI or Web based on preference |
| **Parallel Workflows** | Multiple sessions for different tasks simultaneously |
| **Forking** | Branch conversations at any point for exploration |

---

## Part 5: Files Reference

### 5.1 Interface Code

| File | Purpose |
|------|---------|
| `packages/opencode/src/cli/cmd/tui/app.tsx` | TUI root component |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | TUI session view |
| `packages/app/src/app.tsx` | Web app root component |
| `packages/app/src/pages/session.tsx` | Web session view |
| `packages/app/src/pages/layout.tsx` | Web layout with sidebar |

### 5.2 Session Management

| File | Purpose |
|------|---------|
| `packages/opencode/src/session/index.ts` | Session CRUD operations |
| `packages/opencode/src/session/session.sql.ts` | Database schema |
| `packages/opencode/src/session/prompt.ts` | Session prompt processing |
| `packages/app/src/context/layout.tsx` | UI state per session |

### 5.3 Memory System

| File | Purpose |
|------|---------|
| `packages/opencode/src/evolution/memory.ts` | Memory extraction/retrieval |
| `packages/opencode/src/evolution/store.ts` | JSON file persistence |
| `packages/opencode/src/evolution/types.ts` | Zod schemas |
| `packages/opencode/src/evolution/memory-patterns.json` | Pattern config |
| `packages/opencode/src/evolution/integration.ts` | Session lifecycle hooks |
| `packages/opencode/src/tool/memory.ts` | Memory search tool |

### 5.4 TUI Events

| File | Purpose |
|------|---------|
| `packages/opencode/src/cli/cmd/tui/event.ts` | TUI event definitions |
| `packages/opencode/src/cli/cmd/tui/ui/dialog-memory-confirm.tsx` | Memory confirmation dialog |
| `packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx` | Session list dialog |

### 5.5 Server Routes

| File | Purpose |
|------|---------|
| `packages/opencode/src/server/routes/tui.ts` | TUI server routes |
| `packages/opencode/src/server/routes/session.ts` | Session API endpoints |

---

## Part 6: Conclusion

OpenCode provides a **sophisticated multi-session architecture** with:

1. **Dual Interface Options** - TUI for terminal power users, Web for visual/mouse interaction
2. **Full Session Concurrency** - Unlimited parallel sessions with complete isolation
3. **Cross-Session Memory** - Automatic knowledge sharing via permanent memory system
4. **Flexible Forking** - Branch conversations at any point for exploration
5. **Project-Scoped Learning** - Memories, skills, and prompts persist per project

**Key Strengths:**
- Clean separation between session state (isolated) and memory (shared)
- Automatic memory injection requires no user intervention
- Both interfaces share the same backend - switch seamlessly
- Monthly sharded memory storage prevents file bloat

**Areas for Improvement:**
- Keyword-based memory search (no semantic understanding)
- No cross-project memory sharing
- Limited memory visualization/management UI
- Fixed pattern configuration (not user-extensible)

---

**Related Documentation:**
- [Permanent Memory System](./permanent-memory-system.md)
- [Memory System Comparison](./memory-system-comparison.md)
- [TUI Design](./tui-design.md)
- [Self-Evolving Agent](./plans/2026-02-26-self-evolving-agent.md)
