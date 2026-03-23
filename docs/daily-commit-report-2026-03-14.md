# Daily Commit Report - 2026-03-14

This report summarizes all commits made on March 14, 2026.

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Total Commits | 2 |
| Files Modified | 8 |
| Files Created | 1 |
| Lines Added | ~650 |
| Lines Removed | ~90 |

---

## Commit Details

### 1. feat(learning): implement automatic knowledge graph indexing with multi-trigger support

**Commit:** (pending)

**Reason:** Implemented a unified Knowledge Index Manager with automatic triggers (file watcher, scheduler, session end) and conflict prevention mechanisms (debounce, lock, queue). Also added CLI commands for manual indexing and migration.

**Changes:**

| Status | File Path |
|--------|-----------|
| Created | `packages/opencode/src/learning/knowledge-index-manager.ts` |
| Modified | `packages/opencode/src/cli/cmd/evolve.ts` |
| Modified | `packages/opencode/src/learning/index.ts` |
| Modified | `packages/opencode/src/learning/sqlite-vec-store.ts` |
| Modified | `packages/opencode/src/learning/vector-store-interface.ts` |
| Modified | `packages/opencode/src/memory/service.ts` |
| Modified | `packages/opencode/src/project/bootstrap.ts` |

**Details:**

**1. Knowledge Index Manager (`knowledge-index-manager.ts`):**
- Unified manager for automatic knowledge graph indexing
- Three trigger types: File Watcher (real-time), Scheduler (periodic), Session End (on close)
- Conflict prevention: Debounce (5s), Lock mechanism, Queue batching
- Status tracking and configuration options

**2. Auto-sync from vector_memory to knowledge_node:**
- `sqlite-vec-store.ts`: Added `syncToKnowledgeNode()` method called on every `store()`
- Automatic node type mapping and memory type inference
- `migrateToKnowledgeGraph()`: One-time migration for existing data

**3. CLI Commands:**
- `evolve index [path]`: Index project files into knowledge graph via AST analysis
- `evolve migrate [path]`: Migrate vector_memory to knowledge_node + run AST for edges
- Both commands use `Memory.indexProject()` for accurate edge generation

**4. Session End Trigger:**
- `memory/service.ts`: Added `triggerSessionEndIndex()` call in `endSession()`
- Automatic indexing when session closes

**5. Bootstrap Integration:**
- `project/bootstrap.ts`: Initialize knowledge index manager on startup
- Subscribes to file watcher events for real-time indexing

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│              Knowledge Index Manager Flow                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  File Watcher Event ──┐                                     │
│                       │     ┌──────────────┐               │
│  Scheduler (30min) ───┼────→│   Debounce   │               │
│                       │     │   (5s wait)  │               │
│  Session End ─────────┘     └──────┬───────┘               │
│                                    │                        │
│                              ┌─────▼─────┐                  │
│                              │   Lock    │                  │
│                              │  Check    │                  │
│                              └─────┬─────┘                  │
│                                    │                        │
│                              ┌─────▼─────┐                  │
│                              │  Queue    │                  │
│                              │  Merge    │                  │
│                              └─────┬─────┘                  │
│                                    │                        │
│                              ┌─────▼─────┐                  │
│                              │ Memory.   │                  │
│                              │ indexProject()               │
│                              └───────────┘                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Configuration:**
```typescript
{
  debounceMs: 5000,           // 5s debounce
  maxQueueSize: 50,           // Max 50 files in queue
  enableFileWatcher: true,    // Real-time file monitoring
  enableScheduler: true,      // Periodic indexing
  enableSessionEnd: true,     // Index on session close
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  ignorePatterns: ["node_modules", "dist", ".git"]
}
```

**Benefits:**
- Automatic knowledge graph synchronization without manual intervention
- Efficient batching with debounce and queue mechanisms
- No concurrent indexing conflicts via lock system
- Graceful handling of rapid file changes

---

### 2. feat(scheduler): integrate external mcp-cron with in-process execution

**Commit:** `478a1ce93`

**Reason:** Integrated external mcp-cron service with OpenCode's in-process execution capability, enabling efficient task scheduling without process spawning overhead while maintaining backward compatibility.

**Changes:**

| Status | File Path |
|--------|-----------|
| Modified | `packages/opencode/src/cli/cmd/serve.ts` |
| Modified | `packages/opencode/src/cli/cmd/tui/thread.ts` |
| Modified | `packages/opencode/src/index.ts` |
| Modified | `packages/opencode/src/scheduler/executor.ts` |
| Modified | `packages/opencode/src/scheduler/index.ts` |
| Modified | `packages/opencode/src/server/routes/scheduler.ts` |
| Modified | `packages/opencode/src/session/message-v2.ts` |
| Modified | `packages/opencode/src/util/mcp-cron.ts` |

**Details:**

**1. HTTP API for External Scheduler Integration:**
- Added `POST /scheduler/execute` endpoint for external schedulers to call
- Implemented `executeDirect()` function for direct execution without creating job records
- Added `executeAgentTurnDirect()` and `executeSystemEventDirect()` helper functions
- Supports timeout and abort signal for controlled execution

**2. mcp-cron Integration:**
- Modified `checkAndStartMcpCron()` to accept optional `serverUrl` parameter
- Pass `OPENCODE_SERVER_URL` environment variable to mcp-cron process
- PID file management to ensure single mcp-cron process per OpenCode instance
- Non-blocking startup with comprehensive error handling
- Validates mcpCronPath existence before spawning

**3. Default TUI+Server Mode:**
- HTTP server now starts by default when running `opencode` command
- Added `--no-server` CLI flag to explicitly disable server
- mcp-cron receives server URL for in-process task execution
- Fallback to process execution when server not available

**4. Circular Dependency Fix:**
- Removed `Snapshot` import from `message-v2.ts`
- Defined local `FileDiff` schema to break circular dependency chain:
  ```
  message-v2.ts → Snapshot → Scheduler → Executor → SessionPrompt → message-v2.ts
  ```
- This fixed a `TypeError: undefined is not an object (evaluating 'MessageV2.Format')` error that prevented application startup

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│                    OpenCode Startup Flow                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  opencode (TUI)                                             │
│       ↓                                                     │
│  Server starts (default, random port)                       │
│       ↓                                                     │
│  checkAndStartMcpCron(serverUrl)                            │
│       ↓                                                     │
│  mcp-cron receives OPENCODE_SERVER_URL env var              │
│       ↓                                                     │
│  mcp-cron uses HTTP POST /scheduler/execute                 │
│       ↓                                                     │
│  In-process task execution (no spawning)                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Benefits:**
- Single mcp-cron process per OpenCode instance (PID file prevents duplicates)
- In-process task execution via HTTP API eliminates process spawning overhead
- Fallback to process execution when server not available
- Clean startup/shutdown with proper error handling
- Non-blocking mcp-cron startup (failures don't block app)
- Resolves circular dependency that caused startup crash

**Impact:** 8 files changed, 348 insertions(+), 83 deletions(-)

---

## External mcp-cron Changes

The external mcp-cron project (`~/Documents/opencode-mcp-cron/`) was also modified:

| File | Changes |
|------|---------|
| `src/executor.ts` | Added HTTP API execution with process fallback |

**Key Changes in mcp-cron:**
- Added `OPENCODE_SERVER_URL` environment variable support
- `executeAgentTurnViaHttp()`: Calls OpenCode HTTP API for in-process execution
- `executeAgentTurnFallback()`: Falls back to process spawning when API unavailable
- Automatic detection: Uses HTTP when URL available, falls back gracefully

---

## Files Summary

### Created Files

| File Path | Purpose |
|-----------|---------|
| `packages/opencode/src/learning/knowledge-index-manager.ts` | Unified automatic indexing manager with multi-trigger support |

### Modified Files

| File Path | Purpose |
|-----------|---------|
| `packages/opencode/src/cli/cmd/serve.ts` | Added mcp-cron startup with server URL |
| `packages/opencode/src/cli/cmd/tui/thread.ts` | Default server mode, mcp-cron integration |
| `packages/opencode/src/cli/cmd/evolve.ts` | Added `evolve index` and `evolve migrate` commands |
| `packages/opencode/src/index.ts` | Removed global mcp-cron startup (moved to entry points) |
| `packages/opencode/src/learning/index.ts` | Exported knowledge index manager |
| `packages/opencode/src/learning/sqlite-vec-store.ts` | Auto-sync to knowledge_node on store |
| `packages/opencode/src/learning/vector-store-interface.ts` | Added migrateToKnowledgeGraph to interface |
| `packages/opencode/src/memory/service.ts` | Session end trigger for indexing |
| `packages/opencode/src/project/bootstrap.ts` | Initialize knowledge index manager on startup |
| `packages/opencode/src/scheduler/executor.ts` | Added executeDirect and helper functions |
| `packages/opencode/src/scheduler/index.ts` | Exported executeDirect function |
| `packages/opencode/src/server/routes/scheduler.ts` | Added POST /execute endpoint |
| `packages/opencode/src/session/message-v2.ts` | Fixed circular dependency with local FileDiff |
| `packages/opencode/src/util/mcp-cron.ts` | Enhanced with serverUrl, PID management, error handling |

---

## Thematic Summary

### Features (2 commits)
- Implemented automatic knowledge graph indexing with multi-trigger support
- Integrated external mcp-cron with in-process execution for efficient task scheduling

### Bug Fixes (1 commit)
- Fixed circular dependency in message-v2.ts that prevented application startup

### Key Architectural Improvements

1. **Automatic Knowledge Graph Indexing**: Knowledge graph now stays synchronized automatically through file watcher, scheduler, and session end triggers.

2. **Conflict Prevention**: Debounce, lock, and queue mechanisms prevent concurrent indexing and duplicate work.

3. **In-Process Execution API**: External schedulers can now call `POST /scheduler/execute` to run tasks within the same process, eliminating process spawning overhead.

4. **Single mcp-cron Instance**: PID file management ensures only one mcp-cron process runs per OpenCode instance, preventing duplicate processes.

5. **Default Server Mode**: HTTP server now starts by default, enabling external integrations without additional configuration.

6. **Graceful Fallback**: When OpenCode server is unavailable, mcp-cron automatically falls back to traditional process spawning.

7. **Non-Blocking Startup**: mcp-cron startup failures are logged but don't block application startup.

8. **Circular Dependency Resolution**: Local FileDiff schema in message-v2.ts breaks the circular import chain that caused startup crashes.

---

## Usage Examples

### Default Usage (TUI + Server + mcp-cron)
```bash
opencode
# Server starts on random port
# mcp-cron starts with server URL
# Tasks execute in-process via HTTP API
```

### Disable Server
```bash
opencode --no-server
# No HTTP server
# mcp-cron falls back to process execution
```

### Dedicated Server Mode
```bash
opencode serve --port 4096
# Server only, no TUI
# mcp-cron starts with server URL
```

### Configure mcp-cron Path
```json
// ~/.config/opencode/opencode.json
{
  "mcpCronPath": "/path/to/opencode-mcp-cron/src/index.ts"
}
```

### Knowledge Graph Indexing Commands
```bash
# Index project files into knowledge graph
opencode evolve index

# Index specific directory with custom extensions
opencode evolve index ./src --ext ts,tsx

# Migrate existing vector_memory to knowledge graph
opencode evolve migrate

# Clear existing data before indexing
opencode evolve index --clear
```

---

*Report generated on 2026-03-14*
