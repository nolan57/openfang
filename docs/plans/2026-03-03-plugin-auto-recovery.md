# Plugin Auto-Recovery System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable plugins to automatically recover from connection failures through a unified recovery mechanism with manual + auto recovery support.

**Architecture:** Core system polls plugin.status hook periodically, tracks failures, and triggers plugin.restart hook. Plugins implement their own internal recovery logic.

**Tech Stack:** TypeScript, OpenCode Plugin SDK, Drizzle (for persistence if needed)

---

## Task 1:art`hook Add`plugin.rest to SDK

**Files:**

- Modify: `packages/plugin/src/index.ts:255-270`

**Step 1: Read existing hooks structure**

Run: `read packages/plugin/src/index.ts offset:250 limit:20`

**Step 2: Add plugin.restart hook**

Add after existing `plugin.status` hook definition:

```typescript
/**
 * Trigger plugin recovery/restart
 * Called when recovery manager detects failure and decides to restart
 */
"plugin.restart"?: () => Promise<{
  success: boolean
  error?: string
}>
```

**Step 3: Commit**

```bash
git add packages/plugin/src/index.ts
git commit -m "feat(plugin): add plugin.restart hook for recovery"
```

---

## Task 2: Create Plugin Recovery Manager

**Files:**

- Create: `packages/opencode/src/plugin/recovery.ts`

**Step 1: Write the recovery manager**

```typescript
import { Log } from "../util/log"

const log = Log.create({ service: "plugin-recovery" })

interface PluginRecoveryState {
  lastCheck: number
  restartCount: number
  lastRestartTime: number
  backoffUntil: number
}

const state = new Map<string, PluginRecoveryState>()
const defaultConfig = {
  interval: 30000,
  maxPerHour: 10,
  maxBackoff: 600000,
}

let timer: Timer | null = null
let config = defaultConfig

export namespace PluginRecovery {
  export async function start(
    plugins: Array<{ name: string; restart?: () => Promise<{ success: boolean; error?: string }> }>,
  ) {
    if (timer) return

    timer = setInterval(async () => {
      for (const plugin of plugins) {
        await checkAndRecover(plugin)
      }
    }, config.interval)

    log.info("started", { interval: config.interval })
  }

  export async function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    log.info("stopped")
  }

  export async function restart(pluginName: string, restartFn: () => Promise<{ success: boolean; error?: string }>) {
    const now = Date.now()
    const s = state.get(pluginName)

    if (s && s.restartCount >= config.maxPerHour) {
      log.warn("max-restarts-reached", { plugin: pluginName, count: s.restartCount })
      return { success: false, error: "max restarts per hour reached" }
    }

    if (s && s.backoffUntil > now) {
      log.info("in-backoff", { plugin: pluginName, until: s.backoffUntil - now })
      return { success: false, error: "in backoff period" }
    }

    const result = await restartFn()

    if (result.success) {
      state.set(pluginName, {
        lastCheck: now,
        restartCount: s ? s.restartCount + 1 : 1,
        lastRestartTime: now,
        backoffUntil: 0,
      })
      log.info("restart-success", { plugin: pluginName })
    } else {
      const backoff = Math.min(config.maxBackoff, (s?.restartCount ?? 0) * 60000)
      state.set(pluginName, {
        ...(s ?? { lastCheck: now, restartCount: 0, lastRestartTime: 0 }),
        backoffUntil: now + backoff,
      })
      log.error("restart-failed", { plugin: pluginName, error: result.error })
    }

    return result
  }

  export function setConfig(c: Partial<typeof defaultConfig>) {
    config = { ...config, ...c }
  }
}
```

**Step 2: Commit**

```bash
git add packages/opencode/src/plugin/recovery.ts
git commit -m "feat: add plugin recovery manager"
```

---

## Task 3: Integrate Recovery Manager with Plugin System

**Files:**

- Modify: `packages/opencode/src/plugin/index.ts:100-160`

**Step 1: Read current plugin initialization**

Run: `read packages/opencode/src/plugin/index.ts offset:100 limit:70`

**Step 2: Add recovery integration**

After hook loading, add:

```typescript
import { PluginRecovery } from "./recovery"

// After hooks are loaded (around line 102):
const pluginList = hooks.map((h, i) => ({
  name: plugins[i] || `plugin-${i}`,
  restart: h["plugin.restart"],
}))

PluginRecovery.start(pluginList)
```

**Step 3: Commit**

```bash
git add packages/opencode/src/plugin/index.ts
git commit -m "feat: integrate recovery manager with plugin system"
```

---

## Task 4: Add manual restart tool

**Files:**

- Modify: `packages/opencode/src/tool/registry.ts` or create new plugin tools

**Step 1: Find where tools are registered**

Run: `grep "register.*tool\|tool.*register" packages/opencode/src/tool/registry.ts | head -10`

**Step 2: Add plugin_restart tool**

Add a tool definition that calls PluginRecovery.restart():

```typescript
{
  name: "plugin_restart",
  description: "Restart a failed plugin",
  parameters: {
    type: "object",
    properties: {
      plugin: { type: "string", description: "Plugin name" },
    },
    required: ["plugin"],
  },
}
```

**Step 3: Commit**

```bash
git add packages/opencode/src/tool/registry.ts
git commit -m "feat: add plugin_restart tool for manual recovery"
```

---

## Task 5: Update plugin-qqbot to implement restart hook

**Files:**

- Modify: `packages/plugin-qqbot/src/index.ts:100-150`

**Step 1: Read current qq structure**

Run: `read packages/pluginbot plugin-qqbot/src/index.ts limit:50 offset:100`

**Step 2: Add restart hook implementation**

Add to the returned hooks object:

```typescript
"plugin.restart": async () => {
  try {
    await gateway?.stop()
    gateway = new QQBotGateway({
      config,
      client,
      directory,
      state: pluginState,
      defaultAgent: config.defaultAgent ?? "build",
      maxChunkSize: 1500,
    })
    await gateway.start()
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
```

**Step 3: Commit**

```bash
git add packages/plugin-qqbot/src/index.ts
git commit -m "feat(qqbot): implement plugin.restart hook"
```

---

## Task 6: Test the implementation

**Step 1: Start OpenCode with qqbot plugin**

```bash
cd packages/opencode && bun run src/index.ts
```

**Step 2: Verify plugin loads**

Check TUI sidebar shows qqbot as connected

**Step 3: Test manual restart**

In chat:

```
Use plugin_restart tool to restart qqbot
```

**Step 4: Test auto-recovery (simulate disconnect)**

Kill the qqbot gateway connection, wait 30s, verify auto-recovery triggers

**Step 5: Commit**

```bash
git add -A
git commit -m "test: verify plugin auto-recovery works"
```

---

## Plan complete

**Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
