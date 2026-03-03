# plugin-qqbot Reconnection and Recovery Analysis

**Date:** 2026-03-02  
**Branch:** feature/zeroclaw-integration

---

## Overview

This document analyzes how the `plugin-qqbot` handles WebSocket connection failures, reconnection attempts, and recovery mechanisms.

---

## 1. Reconnection Mechanism

### 1.1 Connection State Tracking

The `QQBotGateway` class maintains the following state for connection management:

| Variable | Type | Purpose |
|----------|------|---------|
| `ws` | `any` | WebSocket instance |
| `reconnectAttempts` | `number` | Counter for reconnection attempts |
| `maxReconnectAttempts` | `number` | Maximum retry limit (default: 10) |
| `stopped` | `boolean` | Flag to prevent reconnection when manually stopped |
| `authError` | `boolean` | Flag to skip reconnection on authentication failures |
| `heartbeatInterval` | `any` | Heartbeat timer ID |

### 1.2 Disconnection Detection

When the WebSocket closes, the `onclose` handler triggers reconnection:

```typescript
// gateway.ts
this.ws.onclose = (event: any) => {
  this.onStatus.disconnected()
  this.onStatus.message(`Disconnected: ${event.code}`)
  this.stopHeartbeat()
  this.scheduleReconnect()  // Triggers reconnection logic
}
```

### 1.3 Exponential Backoff Strategy

The reconnection uses exponential backoff with a cap:

```typescript
// gateway.ts - scheduleReconnect()
private scheduleReconnect(): void {
  if (this.stopped) {
    this.onStatus.message("Stopped, not reconnecting")
    return
  }

  if (this.authError) {
    this.onStatus.message("Clearing auth error, will retry with fresh token...")
    this.authError = false
  }

  if (this.reconnectAttempts >= this.maxReconnectAttempts) {
    this.onStatus.error("Max reconnect attempts reached, stopping")
    this.stopped = true
    return
  }

  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
  const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
  this.reconnectAttempts++

  this.onStatus.message(`Reconnecting in ${delay / 1000}s...`)

  setTimeout(() => {
    this.start().catch((err) => {
      this.onStatus.error(`Reconnect failed: ${err}`)
    })
  }, delay)
}
```

**Delay Progression:**

| Attempt | Delay |
|---------|-------|
| 1 | 1s |
| 2 | 2s |
| 3 | 4s |
| 4 | 8s |
| 5 | 16s |
| 6+ | 30s (capped) |

### 1.4 Fresh Token on Reconnect

Each reconnection attempt obtains a new access token:

```typescript
// gateway.ts - start()
async start(): Promise<void> {
  // ... checks omitted ...
  
  try {
    this.onStatus.message("Getting access token...")
    this.accessToken = await getAccessToken(this.config)  // Fresh token
    this.onStatus.message(`Access token obtained (${this.accessToken.slice(0, 10)}...)`)

    this.onStatus.message("Getting gateway URL...")
    const gatewayUrl = await getGatewayUrl(this.config)

    this.onStatus.message("Connecting to gateway...")
    await this.connect(gatewayUrl)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    this.onStatus.error(`Failed to start: ${message}`)
    this.scheduleReconnect()
  }
}
```

### 1.5 Reset on Successful Connection

```typescript
// gateway.ts - connect()
this.ws.onopen = () => {
  this.onStatus.connected()
  this.onStatus.message("Connected to QQ Gateway")
  this.reconnectAttempts = 0  // Reset counter
  this.startHeartbeat()
  resolve()
}
```

---

## 2. Recovery Behavior

### 2.1 What Happens When Reconnection Stops

After 10 failed attempts, the gateway sets `stopped = true` but **the plugin itself remains loaded**:

```typescript
// gateway.ts
if (this.reconnectAttempts >= this.maxReconnectAttempts) {
  this.onStatus.error("Max reconnect attempts reached, stopping")
  this.stopped = true  // Only stops the Gateway, NOT the plugin
  return
}
```

### 2.2 Plugin Lifecycle

The plugin entry point (`index.ts`) has no recovery mechanism:

```typescript
// index.ts
const gateway = new QQBotGateway({ ... })

// Fire-and-forget - no error handling, no restart logic
gateway.start().catch((err) => {
  publishStatus(input.client, input.directory, "error", ...)
  publishLog(input.client, input.directory, PLUGIN_NAME, "error", `Failed to start: ${err}`)
})

return {}  // Empty hooks - no cleanup/unload mechanism
```

### 2.3 Current State After Reconnection Exhaustion

| Component | State |
|-----------|-------|
| WebSocket | Closed |
| Gateway | Stopped (`stopped = true`) |
| Plugin | Still loaded but non-functional ("zombie") |
| Recovery | Requires manual OpenClaw restart |

---

## 3. Summary Table

| Feature | Implementation | Status |
|---------|---------------|--------|
| **Disconnection detection** | `ws.onclose` handler | ✅ Implemented |
| **Exponential backoff** | `1s → 30s` cap | ✅ Implemented |
| **Max retry limit** | 10 attempts | ✅ Implemented |
| **Fresh token on retry** | `getAccessToken()` each time | ✅ Implemented |
| **Auth error handling** | Clear error, retry once | ✅ Implemented |
| **Manual stop flag** | `stopped` boolean | ✅ Implemented |
| **Session recovery** | Reload from `sessions.json` | ✅ Implemented |
| **Auto-restart after max** | None | ❌ Missing |
| **Plugin reload mechanism** | None | ❌ Missing |
| **Health check** | None | ❌ Missing |
| **Manual reconnection tool** | None | ❌ Missing |

---

## 4. Identified Issues

### 4.1 Plugin Zombie State

After reconnection exhaustion:
- The gateway stops attempting to reconnect
- The plugin remains loaded but cannot process messages
- No automatic recovery or reload mechanism exists
- **User must restart OpenClaw to recover**

### 4.2 No Long-term Recovery

The current design assumes transient failures. For extended outages:
- 10 attempts may be exhausted quickly (~3 minutes with exponential backoff)
- No periodic retry after a longer cooldown (e.g., 5 minutes)
- No notification to user about recovery options

### 4.3 Missing Cleanup Hooks

The plugin returns empty hooks `{}`:
```typescript
return {}  // No hooks.unload for cleanup
```

This means:
- No graceful shutdown on plugin unload
- No way to trigger restart from external command
- Resource cleanup depends on process termination

---

## 5. Recommendations

### 5.1 Add Periodic Long-term Retry

```typescript
private scheduleLongTermRetry(): void {
  const LONG_RETRY_DELAY = 5 * 60 * 1000  // 5 minutes
  setTimeout(() => {
    this.reconnectAttempts = 0
    this.stopped = false
    this.start()
  }, LONG_RETRY_DELAY)
}
```

### 5.2 Add Manual Reconnection Tool

Expose a tool/command for users to trigger reconnection:

```typescript
return {
  tools: {
    qqbot_reconnect: tool({
      description: "Manually trigger QQ Bot reconnection",
      parameters: z.object({}),
      execute: async () => {
        gateway.stop()
        gateway.start()
        return { success: true }
      }
    })
  }
}
```

### 5.3 Add Health Check Endpoint

Implement periodic health checks to detect zombie state and trigger auto-recovery.

### 5.4 Implement Plugin Reload

Add a mechanism to reload the plugin after max attempts:
- Use OpenClaw's plugin reload API (if available)
- Or notify user to reload via configuration change

---

## 6. Related Files

| File | Purpose |
|------|---------|
| `packages/plugin-qqbot/src/gateway.ts` | WebSocket connection & reconnection logic |
| `packages/plugin-qqbot/src/index.ts` | Plugin entry point & lifecycle |
| `packages/plugin-qqbot/src/api.ts` | Token & gateway URL APIs |
| `packages/plugin-qqbot/src/types.ts` | Type definitions |

---

## 7. Conclusion

The `plugin-qqbot` has a robust **short-term reconnection mechanism** with exponential backoff and fresh token acquisition. However, it lacks **long-term recovery** after exhausting retry attempts, leaving the plugin in a non-functional state until manual intervention.

**Priority improvements:**
1. Add periodic long-term retry (5+ minute intervals)
2. Expose manual reconnection tool/command
3. Implement plugin reload mechanism
4. Add health monitoring for zombie detection
