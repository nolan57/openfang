# QQ Bot Plugin for OpenCode - Development Summary

## Overview

This document summarizes the complete process of designing, building, testing, and fixing the QQ Bot plugin for OpenCode. The plugin enables users to interact with OpenCode through QQ (Tencent's instant messaging platform).

## 1. Project Background

### Original Project

The original `qqbot` project was designed as a channel plugin for the OpenClaw framework. It implemented the `ChannelPlugin<ResolvedQQBotAccount>` interface and used a custom dispatch mechanism for message handling.

### Target Platform

OpenCode uses a different plugin architecture:
- Entry point: `Plugin` function that returns `Hooks`
- Message handling: Through `client.session.prompt()` SDK calls
- Configuration: Environment variables (not custom JSON fields due to strict schema validation)

## 2. Architecture Comparison

| Aspect | OpenClaw Plugin | OpenCode Plugin |
|--------|-----------------|-----------------|
| Entry Interface | `ChannelPlugin` interface | `Plugin` function returning `Hooks` |
| Message Processing | `dispatchReplyWithBufferedBlockDispatcher` | `client.session.prompt()` |
| Configuration | `~/.openclaw/openclaw.json` | Environment variables |
| Runtime Context | `PluginRuntime` injection | `PluginInput` context |
| WebSocket | Node.js `ws` library | Native WebSocket (browser compatible) |

## 3. Development Process

### 3.1 Initial Setup

Created the plugin package structure:

```
packages/plugin-qqbot/
├── package.json          # Package configuration
├── tsconfig.json         # TypeScript configuration
└── src/
    ├── index.ts          # Plugin entry point
    ├── gateway.ts        # WebSocket connection management
    ├── api.ts            # QQ Bot API wrapper
    ├── outbound.ts       # Message sending logic
    └── types.ts          # TypeScript type definitions
```

### 3.2 Core Implementation

#### Plugin Entry (`index.ts`)

The plugin function implements the OpenCode `Plugin` interface:

```typescript
export const QQBotPlugin: Plugin = async (input: PluginInput) => {
  const { client, directory } = input
  
  // Load configuration from environment variables
  config = loadConfig(input)
  
  // Initialize Gateway
  gateway = new QQBotGateway({
    config,
    client,
    directory,
    state: pluginState,
    defaultAgent: "build",
    maxChunkSize: 1500,
  })
  
  // Start Gateway
  gateway.start()
  
  // Return Hooks with custom tools
  return {
    tool: {
      qqbot_pair: tool({ ... }),
      qqbot_users: tool({ ... }),
      qqbot_send: tool({ ... }),
    },
  }
}
```

#### Gateway Connection (`gateway.ts`)

Manages WebSocket connection to QQ Bot Gateway:

- **Auto-reconnect**: Exponential backoff retry with session recovery
- **Heartbeat**: Periodic heartbeat to detect connection liveness
- **Intent handling**: Supports C2C (private chat), Group, and Guild messages
- **Message queue**: Async message processing to prevent heartbeat blocking

#### API Wrapper (`api.ts`)

Encapsulates QQ Bot API calls:

- Token management with caching and background refresh
- Message sending (C2C, Group, Channel)
- Media upload (images)
- Markdown support configuration

#### Message Sending (`outbound.ts`)

Handles outbound message logic:

- Message reply rate limiting (max 4 replies per message within 1 hour)
- Fallback to proactive messaging when passive reply times out
- Image tag parsing (`<qqimg>path</qqimg>`)
- Automatic Base64 encoding for local images

### 3.3 Configuration

Since OpenCode's configuration schema uses `.strict()` mode, custom configuration fields in `opencode.json` are not recognized. The plugin uses environment variables instead:

```bash
# Required
QQBOT_ENABLED=true
QQBOT_APP_ID=your-app-id
QQBOT_CLIENT_SECRET=your-client-secret

# Optional
QQBOT_MARKDOWN_SUPPORT=true
QQBOT_IMAGE_SERVER_BASE_URL=http://your-ip:18765
QQBOT_DEFAULT_AGENT=build
QQBOT_DM_POLICY=pairing
QQBOT_GROUP_POLICY=allowlist
QQBOT_ALLOW_FROM=*
```

## 4. Testing and Debugging

### 4.1 Initial Test

Created a standalone test script (`test-connection.mjs`) to verify QQ Bot connectivity:

```javascript
// Test results showed successful connection:
// ✅ Access token obtained
// ✅ Gateway URL retrieved
// ✅ WebSocket connected
// ✅ Bot READY with session_id
```

### 4.2 First Error: Browser Environment

**Error:**
```
error: ws does not work in the browser. Browser clients must use the native WebSocket object
```

**Cause:** OpenCode runs plugins in a browser-like environment, but the `ws` library is Node.js-only.

**Fix:** Modified `gateway.ts` to use native WebSocket:

```typescript
// Use native WebSocket (compatible with both browser and Node.js)
const WebSocketClass = typeof WebSocket !== "undefined" 
  ? WebSocket 
  : (await import("ws")).default

// Use native event handlers instead of .on() method
ws.onopen = () => { ... }
ws.onmessage = (event) => { ... }
ws.onclose = (event) => { ... }
ws.onerror = (err) => { ... }
```

Also removed `ws` from dependencies in `package.json`.

### 4.3 Second Error: Agent Not Found

**Error:**
```
TypeError: undefined is not an object (evaluating 'agent.model')
    at createUserMessage (src/session/prompt.ts:957:34)
```

**Cause:** The `agent` parameter passed to `client.session.prompt()` was invalid, causing `Agent.get()` to return `undefined`.

**Fix:** Removed the `agent` parameter from the prompt call, letting the OpenCode server use its default agent:

```typescript
// Before (with explicit agent):
const response = await this.client.session.prompt({
  path: { id: sessionId },
  body: {
    parts: [{ type: "text", text: cleanContent }],
    agent: this.defaultAgent,  // This could cause issues
  },
})

// After (using server default):
const response = await this.client.session.prompt({
  path: { id: sessionId },
  body: {
    parts: [{ type: "text", text: cleanContent }],
    // No agent parameter - server will use default
  },
})
```

## 5. Final Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        OpenCode                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   Plugin System                       │    │
│  │  ┌─────────────────────────────────────────────┐    │    │
│  │  │            QQ Bot Plugin                     │    │    │
│  │  │  ┌─────────────────────────────────────┐   │    │    │
│  │  │  │          Gateway                     │   │    │    │
│  │  │  │  • WebSocket Connection              │   │    │    │
│  │  │  │  • Heartbeat Management              │   │    │    │
│  │  │  │  • Auto-reconnect                    │   │    │    │
│  │  │  └─────────────────────────────────────┘   │    │    │
│  │  │  ┌─────────────────────────────────────┐   │    │    │
│  │  │  │          API Layer                   │   │    │    │
│  │  │  │  • Token Management                  │   │    │    │
│  │  │  │  • Message Sending                   │   │    │    │
│  │  │  │  • Media Upload                      │   │    │    │
│  │  │  └─────────────────────────────────────┘   │    │    │
│  │  │  ┌─────────────────────────────────────┐   │    │    │
│  │  │  │       Message Handler                │   │    │    │
│  │  │  │  • Access Control                    │   │    │    │
│  │  │  │  • Pairing System                    │   │    │    │
│  │  │  │  • OpenCode Integration              │   │    │    │
│  │  │  └─────────────────────────────────────┘   │    │    │
│  │  └─────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    QQ Bot Gateway                            │
│                    (Tencent Platform)                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ QQ Messages
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      QQ Client                               │
│                    (User's Phone)                            │
└─────────────────────────────────────────────────────────────┘
```

## 6. Key Features

1. **Message Reception**
   - C2C (private chat) messages
   - Group @ mentions
   - Guild (channel) messages

2. **Access Control**
   - `pairing`: Users must be approved via pairing code
   - `allowlist`: Only whitelisted users/groups
   - `open`: No restrictions
   - `disabled`: Block all messages

3. **Rate Limiting**
   - Max 4 replies per message within 1 hour
   - Automatic fallback to proactive messaging when limit exceeded

4. **Rich Media Support**
   - Image sending via `<qqimg>` tag
   - Local images auto-converted to Base64
   - Network URLs supported

5. **Markdown Support**
   - Configurable via `QQBOT_MARKDOWN_SUPPORT`
   - Falls back to plain text when disabled

## 7. Lessons Learned

1. **Browser Compatibility**: OpenCode plugins run in a browser-like environment, so Node.js-specific libraries (like `ws`) cannot be used directly.

2. **Configuration Schema**: OpenCode's strict JSON schema validation prevents custom configuration fields. Use environment variables instead.

3. **Agent Selection**: When using the OpenCode SDK, omit the `agent` parameter to let the server use its configured default agent.

4. **Error Handling**: QQ Bot API has strict rate limits. Implement fallback mechanisms for message sending.

5. **Testing Strategy**: Standalone test scripts help isolate issues between the plugin code and the QQ Bot API.

## 8. Usage

### Installation

```bash
# From source (development)
cd packages/plugin-qqbot
bun link

# Or add to opencode.json
{
  "plugin": ["@opencode-ai/plugin-qqbot"]
}
```

### Configuration

```bash
export QQBOT_ENABLED=true
export QQBOT_APP_ID=your-app-id
export QQBOT_CLIENT_SECRET=your-client-secret
```

### Running

```bash
opencode
```

### Available Tools

- `qqbot_pair approve <code>` - Approve a pairing request
- `qqbot_pair reject <code>` - Reject a pairing request
- `qqbot_pair list` - List pending pairing requests
- `qqbot_users` - List approved users and groups
- `qqbot_send <to> <message>` - Send a message to a QQ user or group

## 9. Future Improvements

1. **Streaming Responses**: Support for streaming AI responses in real-time
2. **Voice Messages**: Add support for voice message processing
3. **Multi-account**: Support multiple QQ Bot accounts
4. **Session Persistence**: Persist session mappings across restarts
5. **Webhook Support**: Alternative to WebSocket for server deployments
