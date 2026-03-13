# Daily Commit Report - 2026-03-14

This report summarizes all commits made on March 14, 2026.

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Total Commits | 1 |
| Files Modified | 8 |
| Lines Added | ~350 |
| Lines Removed | ~83 |

---

## Commit Details

### 1. feat(scheduler): integrate external mcp-cron with in-process execution

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

### Modified Files

| File Path | Purpose |
|-----------|---------|
| `packages/opencode/src/cli/cmd/serve.ts` | Added mcp-cron startup with server URL |
| `packages/opencode/src/cli/cmd/tui/thread.ts` | Default server mode, mcp-cron integration |
| `packages/opencode/src/index.ts` | Removed global mcp-cron startup (moved to entry points) |
| `packages/opencode/src/scheduler/executor.ts` | Added executeDirect and helper functions |
| `packages/opencode/src/scheduler/index.ts` | Exported executeDirect function |
| `packages/opencode/src/server/routes/scheduler.ts` | Added POST /execute endpoint |
| `packages/opencode/src/session/message-v2.ts` | Fixed circular dependency with local FileDiff |
| `packages/opencode/src/util/mcp-cron.ts` | Enhanced with serverUrl, PID management, error handling |

---

## Thematic Summary

### Features (1 commit)
- Integrated external mcp-cron with in-process execution for efficient task scheduling

### Bug Fixes (1 commit)
- Fixed circular dependency in message-v2.ts that prevented application startup

### Key Architectural Improvements

1. **In-Process Execution API**: External schedulers can now call `POST /scheduler/execute` to run tasks within the same process, eliminating process spawning overhead.

2. **Single mcp-cron Instance**: PID file management ensures only one mcp-cron process runs per OpenCode instance, preventing duplicate processes.

3. **Default Server Mode**: HTTP server now starts by default, enabling external integrations without additional configuration.

4. **Graceful Fallback**: When OpenCode server is unavailable, mcp-cron automatically falls back to traditional process spawning.

5. **Non-Blocking Startup**: mcp-cron startup failures are logged but don't block application startup.

6. **Circular Dependency Resolution**: Local FileDiff schema in message-v2.ts breaks the circular import chain that caused startup crashes.

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

---

*Report generated on 2026-03-14*
