# Plugin Status System Implementation Plan

## Overview

This document outlines the implementation plan for a unified status and logging system that integrates plugins (QQ Bot, iMessage, etc.) with the OpenCode scheduler. The system will display real-time status and activity logs in the TUI sidebar.

## Goals

1. **Unified Status Management** - Single source of truth for all component statuses
2. **Real-time Updates** - Status changes reflected immediately in TUI
3. **Extensibility** - New plugins can integrate without core modifications
4. **Scheduler Integration** - Display scheduled job status alongside plugin status
5. **Clean Logs** - Move verbose logging from terminal to dedicated UI panel

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      OpenCode Core System                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Scheduler (Cron)                          │   │
│  │  - Jobs management                                           │   │
│  │  - Timer execution                                           │   │
│  │  - Status events (NEW)                                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Plugin System                             │   │
│  │  - QQ Bot Gateway                                            │   │
│  │  - iMessage Gateway                                          │   │
│  │  - Status report hook (NEW)                                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Unified Status Store                            │   │
│  │  - plugin_status: { [name]: PluginStatusInfo }              │   │
│  │  - scheduler_jobs: { [id]: SchedulerJobInfo }               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      TUI Sidebar                             │   │
│  │  - Scheduler panel                                           │   │
│  │  - Plugins panel                                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Type Definitions

### Status Types

```typescript
// Component status enum
export type ComponentStatus = 
  | "connected" 
  | "disconnected" 
  | "connecting" 
  | "error" 
  | "disabled" 
  | "pending"

// Log entry type
export interface StatusLog {
  id: string
  timestamp: number
  type: "info" | "message" | "warning" | "error" | "status" | "execution"
  source: "plugin" | "scheduler" | "system"
  sourceName: string
  message: string
  metadata?: Record<string, unknown>
}

// Plugin status info
export interface PluginStatusInfo {
  name: string
  displayName: string
  status: ComponentStatus
  error?: string
  logs: StatusLog[]
  lastActivity?: number
  metadata?: {
    sessionCount?: number
    messageCount?: number
    [key: string]: unknown
  }
}

// Scheduler job info (for future integration)
export interface SchedulerJobInfo {
  id: string
  name: string
  status: "active" | "paused" | "completed" | "failed"
  schedule: {
    type: "cron" | "at" | "every"
    expression?: string
    nextRun?: number
    lastRun?: number
  }
  logs: StatusLog[]
  runCount: number
  errorCount: number
}
```

### Event Definition

```typescript
// Status update event
export const PluginStatusEvent = BusEvent.define(
  "plugin.status",
  z.object({
    plugin: z.string(),
    status: z.enum(["connected", "disconnected", "connecting", "error", "disabled", "pending"]),
    error: z.string().optional(),
    log: z.object({
      type: z.enum(["info", "message", "warning", "error", "status", "execution"]),
      message: z.string(),
    }).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
)
```

## Implementation Steps

### Phase 1: Core Infrastructure (P0)

#### Step 1.1: Add Event Definition
**File:** `packages/opencode/src/cli/cmd/tui/event.ts`

Add new event type for plugin status:
```typescript
PluginStatus: BusEvent.define(
  "tui.plugin.status",
  z.object({
    plugin: z.string(),
    status: z.enum(["connected", "disconnected", "connecting", "error", "disabled", "pending"]),
    error: z.string().optional(),
    log: z.object({
      type: z.enum(["info", "message", "warning", "error", "status"]),
      message: z.string(),
    }).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
),
```

#### Step 1.2: Extend Sync Store
**File:** `packages/opencode/src/cli/cmd/tui/context/sync.tsx`

Add plugin_status to store:
```typescript
// In store type definition
plugin_status: {
  [pluginName: string]: PluginStatusInfo
}

// In initial state
plugin_status: {},

// Add event handler for plugin.status
case "plugin.status": {
  const { plugin, status, error, log, metadata } = event.properties
  const existing = store.plugin_status[plugin]
  
  const logs = log 
    ? [...(existing?.logs ?? []).slice(-49), {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        type: log.type,
        source: "plugin" as const,
        sourceName: plugin,
        message: log.message,
      }]
    : (existing?.logs ?? [])
  
  setStore("plugin_status", plugin, {
    name: plugin,
    displayName: existing?.displayName ?? plugin,
    status,
    error,
    logs,
    lastActivity: Date.now(),
    metadata: { ...existing?.metadata, ...metadata },
  })
  break
}
```

### Phase 2: Plugin Integration (P0)

#### Step 2.1: Update Plugin Hooks Interface
**File:** `packages/plugin/src/index.ts`

Add status report hook:
```typescript
export interface Hooks {
  // ... existing hooks ...
  
  /**
   * Report plugin status
   * Called periodically or when status changes
   */
  "plugin.status"?: () => Promise<{
    status: "connected" | "disconnected" | "connecting" | "error" | "disabled"
    error?: string
    metadata?: Record<string, unknown>
  }>
}

// Add helper function for plugins to emit status
export type StatusReporter = {
  (status: ComponentStatus, log?: { type: LogType; message: string }, metadata?: Record<string, unknown>): void
  connected: (message?: string) => void
  disconnected: (message?: string) => void
  error: (error: string) => void
  message: (msg: string) => void
}
```

#### Step 2.2: Update QQ Bot Plugin
**File:** `packages/plugin-qqbot/src/index.ts`

Implement status reporting:
```typescript
// Create status reporter using SDK client
const createStatusReporter = (client: OpencodeClient) => {
  const report = (status, log, metadata) => {
    // Use global event API to send status
    client.global.event({
      type: "plugin.status",
      properties: { plugin: "qqbot", status, log, metadata }
    })
  }
  
  return {
    connected: (msg = "Connected") => report("connected", { type: "status", message: msg }),
    disconnected: (msg = "Disconnected") => report("disconnected", { type: "status", message: msg }),
    error: (err) => report("error", { type: "error", message: err }),
    message: (msg) => report("connected", { type: "message", message: msg }),
  }
}

// In plugin initialization
export const QQBotPlugin: Plugin = async (input) => {
  const { client } = input
  
  const status = createStatusReporter(client)
  
  // Initialize gateway with status reporter
  gateway = new QQBotGateway({
    // ... other options ...
    onStatus: status,
  })
  
  return {
    "plugin.status": async () => ({
      status: gateway.isConnected() ? "connected" : "disconnected",
      metadata: { sessionCount: sessions.size }
    }),
    // ... other hooks
  }
}
```

#### Step 2.3: Update Gateway
**File:** `packages/plugin-qqbot/src/gateway.ts`

Add status callback:
```typescript
export interface GatewayOptions {
  // ... existing options ...
  onStatus: {
    connected: (message?: string) => void
    disconnected: (message?: string) => void
    error: (error: string) => void
    message: (msg: string) => void
  }
}

// In gateway, replace console.log with onStatus calls:
// Before: console.log(`[qqbot] ✓ Connected`)
// After: this.options.onStatus.connected()

// Before: console.log(`[qqbot] DM from ${senderId.slice(0, 8)}...`)
// After: this.options.onStatus.message(`DM from ${senderId.slice(0, 8)}...`)
```

### Phase 3: UI Components (P1)

#### Step 3.1: Add Plugin Panel to Sidebar
**File:** `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx`

Add plugins section:
```tsx
// Add after MCP section or before it
const pluginEntries = createMemo(() => 
  Object.entries(sync.data.plugin_status).sort(([a], [b]) => a.localeCompare(b))
)

const connectedPluginCount = createMemo(() => 
  pluginEntries().filter(([_, item]) => item.status === "connected").length
)

const [expanded, setExpanded] = createStore({
  // ... existing ...
  plugins: true,
})

// In JSX, add after MCP section:
<Show when={pluginEntries().length > 0}>
  <box>
    <box flexDirection="row" gap={1} onMouseDown={() => setExpanded("plugins", !expanded.plugins)}>
      <Show when={pluginEntries().length > 1}>
        <text fg={theme.text}>{expanded.plugins ? "▼" : "▶"}</text>
      </Show>
      <text fg={theme.text}>
        <b>Plugins</b>
        <Show when={!expanded.plugins}>
          <span style={{ fg: theme.textMuted }}>
            {" "}({connectedPluginCount()} active)
          </span>
        </Show>
      </text>
    </box>
    <Show when={expanded.plugins}>
      <For each={pluginEntries()}>
        {([name, info]) => (
          <box flexDirection="column" gap={0}>
            <box flexDirection="row" gap={1}>
              <text style={{ fg: {
                connected: theme.success,
                disconnected: theme.textMuted,
                connecting: theme.warning,
                error: theme.error,
                disabled: theme.textMuted,
              }[info.status] }}>•</text>
              <text fg={theme.text}>{info.displayName || name}</text>
              <text fg={theme.textMuted}>{
                { connected: "✓", disconnected: "○", connecting: "⏳", error: "✗", disabled: "○" }[info.status]
              }</text>
            </box>
            <Show when={info.logs.length > 0}>
              <For each={info.logs.slice(-5)}>
                {(log) => (
                  <text fg={theme.textMuted} paddingLeft={2}>
                    [{new Date(log.timestamp).toLocaleTimeString()}] {log.message}
                  </text>
                )}
              </For>
            </Show>
          </box>
        )}
      </For>
    </Show>
  </box>
</Show>
```

### Phase 4: Scheduler Integration (P2 - Future)

#### Step 4.1: Add Scheduler Events
**File:** `packages/opencode/src/scheduler/index.ts`

Add event emission:
```typescript
async function run(task: Task) {
  log.info("run", { id: task.id })
  
  // Emit start event
  GlobalBus.emit("event", {
    payload: {
      type: "scheduler.job.started",
      properties: { id: task.id }
    }
  })
  
  try {
    await task.run()
    
    // Emit complete event
    GlobalBus.emit("event", {
      payload: {
        type: "scheduler.job.completed",
        properties: { id: task.id }
      }
    })
  } catch (error) {
    // Emit error event
    GlobalBus.emit("event", {
      payload: {
        type: "scheduler.job.failed",
        properties: { id: task.id, error: String(error) }
      }
    })
  }
}
```

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/opencode/src/cli/cmd/tui/event.ts` | MODIFY | Add PluginStatus event |
| `packages/opencode/src/cli/cmd/tui/context/sync.tsx` | MODIFY | Add plugin_status store and handler |
| `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx` | MODIFY | Add Plugins panel |
| `packages/plugin/src/index.ts` | MODIFY | Add plugin.status hook |
| `packages/plugin-qqbot/src/index.ts` | MODIFY | Implement status reporting |
| `packages/plugin-qqbot/src/gateway.ts` | MODIFY | Add status callbacks |
| `packages/opencode/src/scheduler/index.ts` | MODIFY (P2) | Add event emission |

## Testing Checklist

- [ ] Plugin status updates in sidebar when QQ Bot connects
- [ ] Log entries appear in sidebar panel
- [ ] Plugin panel can be collapsed/expanded
- [ ] Status indicator shows correct color
- [ ] Multiple plugins display correctly
- [ ] Logs are trimmed to last 50 entries
- [ ] No console.log pollution in terminal
- [ ] Plugin status persists across session navigation

## Rollback Plan

If issues arise:
1. Revert sync.tsx changes - plugin_status store
2. Revert sidebar.tsx changes - Plugins panel
3. Revert plugin-qqbot changes - status callbacks
4. Plugin will continue to work with console.log output

## Notes

- Keep log messages short (max ~40 chars for sidebar)
- Use consistent timestamp format
- Consider adding log level filtering in future
- May want to persist logs to file for debugging
