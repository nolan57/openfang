# Plugin-QQBot Rewrite Summary

## Overview

This document details the process of rewriting and fixing the `plugin-qqbot` in OpenCode to work properly with QQ Bot by referencing the OpenClaw implementation.

## Background

### Problem Statement

The original plugin-qqbot had several issues:

1. **Invalid Credentials**: API returned `{"code":100016,"message":"invalid appid or secret"}`
2. **Different Plugin Systems**: OpenCode uses `@opencode-ai/plugin` system, while OpenClaw uses `openclaw/plugin-sdk`
3. **Architecture Mismatch**: The plugin wasn't following the proper account-based token management pattern

### Reference Implementation

A full working qqbot implementation existed in `/Users/lpcw/Documents/opencode/openclaw-qqbot/` with proper:

- Token caching (per-appId Map-based)
- Account resolution from config
- Gateway WebSocket handling

## Changes Made

### 1. Types Update (`types.ts`)

Added OpenClaw-style types for proper account management:

```typescript
// New interface for resolved account
export interface ResolvedQQBotAccount {
  accountId: string
  name?: string
  enabled: boolean
  appId: string
  clientSecret: string
  secretSource: "config" | "file" | "env" | "none"
  systemPrompt?: string
  imageServerBaseUrl?: string
  markdownSupport: boolean
  config: QQBotAccountConfig
}

// Account configuration
export interface QQBotAccountConfig {
  enabled?: boolean
  name?: string
  appId?: string
  clientSecret?: string
  dmPolicy?: "open" | "pairing" | "allowlist" | "disabled"
  groupPolicy?: "open" | "pairing" | "allowlist" | "disabled"
  allowFrom?: string[]
  systemPrompt?: string
  imageServerBaseUrl?: string
  markdownSupport?: boolean
  sandbox?: boolean
}

// Gateway options with account support
export interface GatewayOptions {
  account: ResolvedQQBotAccount
  directory: string
  sessionsPath: string
  client: any
  defaultAgent?: string
  maxChunkSize?: number
  onStatus: {
    message(msg: string): void
    connected(): void
    disconnected(): void
    error(msg: string): void
    log?(level: "info" | "warning" | "error", msg: string): void
  }
  onMessage?(msg: QQBotMessage, type: "c2c" | "group" | "channel"): void
}
```

### 2. API Rewrite (`api.ts`)

Rewrote to use per-account token caching with Map-based storage:

```typescript
// Per-account token cache
const tokenCacheMap = new Map<string, { token: string; expiresAt: number; appId: string }>()
const tokenFetchPromises = new Map<string, Promise<string>>()

export async function getAccessToken(account: ResolvedQQBotAccount): Promise<string> {
  const normalizedAppId = account.appId.trim()
  const cachedToken = tokenCacheMap.get(normalizedAppId)

  // Check if token is still valid (with 5 minute buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 5 * 60 * 1000) {
    return cachedToken.token
  }

  // Fetch new token if needed
  let fetchPromise = tokenFetchPromises.get(normalizedAppId)
  if (fetchPromise) {
    return fetchPromise
  }

  fetchPromise = (async () => {
    try {
      return await doFetchToken(normalizedAppId, account.clientSecret)
    } finally {
      tokenFetchPromises.delete(normalizedAppId)
    }
  })()

  tokenFetchPromises.set(normalizedAppId, fetchPromise)
  return fetchPromise
}
```

Key improvements:

- Per-appId token caching instead of global variables
- Concurrent request deduplication using Promise caching
- Automatic token expiration handling
- Support for sandbox vs production API endpoints

### 3. Config Update (`config.ts`)

Added `resolveQQBotAccount` function to convert config to resolved account:

```typescript
export function resolveQQBotAccount(config: QQBotPluginConfig, _accountId?: string | null): ResolvedQQBotAccount {
  const resolvedAccountId = DEFAULT_ACCOUNT_ID

  let appId = config.appId
  let clientSecret = config.clientSecret
  let secretSource: "config" | "file" | "env" | "none" = "none"

  if (clientSecret) {
    secretSource = "config"
  } else if (Bun.env.QQBOT_CLIENT_SECRET) {
    clientSecret = Bun.env.QQBOT_CLIENT_SECRET
    secretSource = "env"
  }

  // ... resolve account with proper defaults

  return {
    accountId: resolvedAccountId,
    name: "default",
    enabled: config.enabled,
    appId: appId?.trim() ?? "",
    clientSecret: clientSecret ?? "",
    secretSource,
    imageServerBaseUrl: config.imageServerBaseUrl,
    markdownSupport: config.markdownSupport,
    config: accountConfig,
  }
}
```

### 4. Gateway Update (`gateway.ts`)

Major refactoring to use `account` instead of `config`:

- Changed from `QQBotPluginConfig` to `ResolvedQQBotAccount`
- Uses internal `sessions` Map instead of external `pluginState`
- Simplified `isAllowed()` to use `account.config.allowFrom` and policies

Before:

```typescript
export class QQBotGateway {
  private config: QQBotPluginConfig
  private client: OpencodeClient
  private pluginState: GatewayOptions["state"]
  // ...
}
```

After:

```typescript
export class QQBotGateway {
  private account: ResolvedQQBotAccount
  private client: any
  private sessions: Map<string, SessionInfo> = new Map()
  // ...
}
```

### 5. Outbound Update (`outbound.ts`)

Updated to use `ResolvedQQBotAccount` instead of `QQBotPluginConfig`:

```typescript
export async function sendText(
  account: ResolvedQQBotAccount,
  recipient: string,
  content: string,
  msgId?: string,
): Promise<void>
```

### 6. Index Update (`index.ts`)

Updated to pass `client` to gateway constructor:

```typescript
let gateway = new QQBotGateway({
  account,
  directory: input.directory,
  sessionsPath,
  client: input.client, // Added this
  onStatus,
})
```

## Configuration

The plugin is configured in `~/.opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///Users/lpcw/Documents/opencode/packages/plugin-qqbot/dist/index.js"]
}
```

Environment variables:

- `QQBOT_ENABLED=true` - Enable the plugin
- `QQBOT_APP_ID` - QQ Bot App ID
- `QQBOT_CLIENT_SECRET` - QQ Bot Client Secret
- `QQBOT_DM_POLICY` - DM policy: `pairing`, `allowlist`, `open`, `disabled`
- `QQBOT_GROUP_POLICY` - Group policy: `pairing`, `allowlist`, `open`, `disabled`
- `QQBOT_SANDBOX=true` - Use sandbox API

## Testing

### Build

```bash
cd packages/plugin-qqbot
bun run build
```

### Type Check

```bash
bun run typecheck
```

### Manual Test

```bash
cd packages/plugin-qqbot
bun -e "
import { QQBotPlugin } from './dist/index.js';

const mockInput = {
  client: { session: { create: async () => ({ data: { id: 'test' } }) } },
  project: { id: 'test' },
  worktree: null,
  directory: '/tmp/qqbot-test',
  serverUrl: 'http://localhost:4096',
  \$: () => {}
};

const hooks = await QQBotPlugin(mockInput);
const status = await hooks['plugin.status']();
console.log('Status:', status);
"
```

Output:

```
Plugin loaded successfully
Hooks: [ "plugin.status", "plugin.restart" ]
Status: {
  "status": "disconnected",
  "metadata": {
    "reconnectAttempts": 0
  }
}
```

## Key Differences from Original

| Aspect           | Original         | New                               |
| ---------------- | ---------------- | --------------------------------- |
| Token Management | Global variables | Per-appId Map-based caching       |
| Account Handling | Direct config    | Resolved account object           |
| Config Source    | Environment only | Config + environment + file       |
| API Endpoints    | Hardcoded        | Based on `account.config.sandbox` |

## Remaining Work

1. **Valid Credentials**: The plugin needs valid QQ Bot credentials to connect
2. **Error Handling**: Could add more robust error handling for network issues
3. **Message Queue**: Consider adding message queuing for reliability
4. **Testing**: Add unit tests for API, config, and gateway modules

## Streaming Output Support (March 12, 2026)

### Problem
The plugin had streaming infrastructure but was not truly streaming - it accumulated the full response and only sent it at the end.

### Solution
Implemented true streaming output that sends chunks incrementally as they arrive from the AI.

### Changes Made

1. **Types Update (`types.ts`)**: Added streaming config to `QQBotAccountConfig`:
   ```typescript
   export interface QQBotAccountConfig {
     // ... existing fields
     // Streaming config
     responseMode?: "blocking" | "streaming"
     streamingDelayMs?: number
     streamingMinChunk?: number
   }
   ```

2. **Config Update (`config.ts`)**: Updated `resolveQQBotAccount()` to pass streaming config:
   ```typescript
   const accountConfig: QQBotAccountConfig = {
     // ... existing fields
     // Streaming config
     responseMode: config.responseMode,
     streamingDelayMs: config.streamingDelayMs,
     streamingMinChunk: config.streamingMinChunk,
   }
   ```

3. **Gateway Update (`gateway.ts`)**: Modified `doProcessMessage()` to stream incrementally:
   - Accumulates chunks in a buffer
   - Sends when time threshold reached (`streamingDelayMs`, default 300ms)
   - Or sends when size threshold reached (`streamingMinChunk`, default 200 chars)
   - Sends remaining content when stream completes
   - Supports both "streaming" and "blocking" modes

### Configuration

Environment variables for streaming:
```bash
QQBOT_RESPONSE_MODE=streaming         # "streaming" or "blocking"
QQBOT_STREAMING_DELAY_MS=300          # Send chunk every 300ms
QQBOT_STREAMING_MIN_CHUNK=200         # Or when 200 chars accumulated
```

### Streaming Behavior

- **Time-based**: Sends buffered content every `streamingDelayMs` milliseconds
- **Size-based**: Sends buffered content when buffer reaches `streamingMinChunk` characters
- **Fallback**: Any remaining content is sent when the stream ends
- **Abort support**: Users can send `#abort` to stop streaming mid-response

## Cross-Platform TTS Support (March 12, 2026)

### Problem
The `runEdgeTts` function used `cmd.exe` which only works on Windows, breaking deployment on Linux/macOS servers.

### Solution
Modified `runEdgeTts` in `outbound.ts` to detect the platform and use appropriate execution method:

```typescript
// Cross-platform: use platform-specific shell or direct execution
const isWindows = process.platform === "win32"
const proc = isWindows
  ? spawn("cmd.exe", ["/c", "edge-tts", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    })
  : spawn("edge-tts", args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    })
```

### Platform Behavior

| Platform | Execution Method |
|----------|------------------|
| Windows | `cmd.exe /c edge-tts ...` |
| Linux/macOS | Direct `edge-tts` execution |

### Requirements

- **edge-tts** Python package must be installed on the target system
- **Python** must be in PATH for edge-tts to work

## Files Modified

- `packages/plugin-qqbot/src/types.ts` - Added new interfaces, streaming config fields
- `packages/plugin-qqbot/src/api.ts` - Rewrote with Map-based token caching
- `packages/plugin-qqbot/src/config.ts` - Added `resolveQQBotAccount` function, streaming config support
- `packages/plugin-qqbot/src/gateway.ts` - Updated to use account-based approach, streaming output support
- `packages/plugin-qqbot/src/outbound.ts` - Updated function signatures, cross-platform edge-tts support
- `packages/plugin-qqbot/src/index.ts` - Updated gateway instantiation

## Date

Created: March 11, 2026
Updated: March 12, 2026 (Streaming output support, Cross-platform TTS)
