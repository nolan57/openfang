# OpenClaw iMessage Connection Mechanism Analysis

This document analyzes how OpenClaw connects to iMessage, including architecture design, connection methods, authentication mechanisms, and message flows.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                            │
├────────────────────────┬────────────────────────────────────────┤
│  extensions/imessage   │       extensions/bluebubbles          │
│     (Legacy 插件)      │         (推荐插件)                     │
├────────────┬───────────┴───────────────────┬───────────────────┤
│src/imessage│                               │ BlueBubbles REST  │
│(JSON-RPC)  │                               │     Client        │
└─────┬──────┘                               └─────────┬─────────┘
      │                                                │
      ▼                                                ▼
   imsg CLI                                    BlueBubbles Server
   (stdio)                                      (HTTP REST)
      │                                                │
      └──────────────────┬─────────────────────────────┘
                          ▼
               macOS Messages.app / chat.db
```

## Two Connection Methods Comparison

| Feature                    | imsg (Legacy)            | BlueBubbles (Recommended)       |
| -------------------------- | ------------------------ | ------------------------------- |
| **Communication Protocol** | JSON-RPC over stdio      | REST API + Webhook              |
| **Deployment Location**    | Local Mac or SSH remote  | BlueBubbles Server              |
| **Authentication**         | macOS system permissions | URL + password                  |
| **Features**               | Basic send/receive       | Reactions/edit/recall/effects   |
| **Status**                 | Marked as legacy         | Recommended for new deployments |

---

## Method 1: imsg (JSON-RPC)

### Core Files

| File                                       | Description                 |
| ------------------------------------------ | --------------------------- |
| `src/imessage/client.ts`                   | RPC client implementation   |
| `src/imessage/monitor/monitor-provider.ts` | Message monitoring provider |
| `src/imessage/send.ts`                     | Message sending logic       |
| `src/imessage/targets.ts`                  | Target address resolution   |
| `extensions/imessage/src/channel.ts`       | Plugin entry point          |

### How It Works

Communicates via the external CLI tool `imsg`, using JSON-RPC 2.0 protocol over stdio:

```
OpenClaw Gateway ←→ imsg CLI (JSON-RPC) ←→ macOS Messages.app
```

### Message Sending Flow

```typescript
sendMessageIMessage(to, text, opts)
    │
    ├── resolveIMessageAccount()     // Resolve account config
    │
    ├── parseIMessageTarget()        // Parse target address
    │   ├── chat_id:123              // Database chat ID (recommended)
    │   ├── chat_guid:xxx            // Chat GUID
    │   ├── chat_identifier:xxx      // Chat identifier
    │   └── handle (phone/email)     // Phone number or email
    │
    ├── resolveOutboundAttachmentFromUrl()  // Handle attachments
    │
    ├── createIMessageRpcClient()    // Create RPC client
    │
    └── client.request("send", params)  // Send request
```

### Message Receiving Flow

```typescript
monitorIMessageProvider(opts)
    │
    ├── probeIMessage()              // Wait for imsg RPC to be ready
    │
    ├── createIMessageRpcClient()    // Create RPC client
    │
    ├── client.request("watch.subscribe")  // Subscribe to message monitoring
    │
    └── Handle message notifications
        │
        ├── parseIMessageNotification()  // Parse message
        │
        ├── inboundDebouncer.enqueue()   // Debounce and merge
        │
        ├── resolveIMessageInboundDecision()  // Determine handling decision
        │   ├── drop: discard message
        │   ├── pairing: trigger pairing flow
        │   └── dispatch: dispatch to agent
        │
        └── dispatchInboundMessage()  // Dispatch message
```

### Message Structure

```typescript
type IMessagePayload = {
  id?: number | null // Message ID
  chat_id?: number | null // Chat ID
  sender?: string | null // Sender
  is_from_me?: boolean | null // Whether sent by self
  text?: string | null // Message text
  reply_to_id?: number | string | null // Reply message ID
  reply_to_text?: string | null // Reply text
  reply_to_sender?: string | null // Reply sender
  created_at?: string | null // Creation time
  attachments?: IMessageAttachment[] | null // Attachments
  chat_identifier?: string | null // Chat identifier
  chat_guid?: string | null // Chat GUID
  chat_name?: string | null // Chat name
  participants?: string[] | null // Participant list
  is_group?: boolean | null // Whether group chat
}
```

---

## Method 2: BlueBubbles (REST API)

### Core Files

| File                                    | Description                 |
| --------------------------------------- | --------------------------- |
| `extensions/bluebubbles/src/send.ts`    | REST sending implementation |
| `extensions/bluebubbles/src/monitor.ts` | Webhook monitoring          |
| `extensions/bluebubbles/src/types.ts`   | Type definitions            |

### How It Works

Communicates via BlueBubbles macOS server's REST API:

```
OpenClaw Gateway ←→ BlueBubbles Server (HTTP REST) ←→ macOS Messages.app
```

### Authentication Configuration

```typescript
type BlueBubblesAccountConfig = {
  serverUrl?: string // API base URL
  password?: string // API password
  webhookPath?: string // Webhook path
  sendReadReceipts?: boolean // Send read receipts
  blockStreaming?: boolean // Block streaming
  actions?: BlueBubblesActionConfig // Advanced action config
}
```

### Webhook Authentication

- Uses `timingSafeEqual` for secure password comparison
- Supports multiple authentication methods:
  - Query parameters: `guid` + `password`
  - Headers: `x-guid` + `x-password` + `authorization`

### Message Sending Flow

```typescript
sendMessageBlueBubbles(to, text, opts)
    │
    ├── Parse account config
    │
    ├── resolveBlueBubblesSendTarget()  // Resolve target address
    │
    ├── resolveChatGuidForTarget()      // Find chatGuid
    │   ├── Iterate existing chats to find match
    │   └── Auto-create new chat if no match
    │
    ├── Build request parameters
    │   ├── effectId (message effect)
    │   ├── selectedMessageGuid (reply thread)
    │   └── method: "private-api" (if needed)
    │
    └── POST /api/v1/message/text
```

### Message Receiving Flow

```typescript
handleBlueBubblesWebhookRequest(req, res)
    │
    ├── Validate request method
    │
    ├── parseBlueBubblesWebhookPayload()  // Parse request body
    │
    ├── safeEqualSecret(guid, password)   // Verify authentication
    │
    ├── Determine event type
    │   ├── new-message: handle message
    │   ├── message-reaction: handle reaction
    │   └── others: ignore
    │
    └── processMessage()
        ├── normalizeWebhookMessage()
        ├── Debounce and merge
        └── Dispatch handling
```

---

## Access Control Policies

### Configuration Options

```typescript
type IMessageRoutingConfig = {
  // DM policy (default: pairing)
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled"

  // Group policy (default: allowlist)
  groupPolicy?: "open" | "allowlist" | "disabled"

  // DM allowlist
  allowFrom?: Array<string | number>

  // Group allowlist
  groupAllowFrom?: Array<string | number>
}
```

### Policy Description

| Policy      | Description                                  |
| ----------- | -------------------------------------------- |
| `pairing`   | Requires pairing approval before interaction |
| `allowlist` | Only allows senders in the list              |
| `open`      | Allows all senders                           |
| `disabled`  | Disables this message type                   |

### Pairing Flow

```
1. New sender messages → Create pairing request
2. Auto-reply with pairing code
3. Admin runs: openclaw pairing approve imessage <CODE>
4. Pairing code expires after 1 hour
```

---

## Target Address Resolution

### imsg Target Types

```typescript
type IMessageTarget =
  | { kind: "chat_id"; chatId: number } // Recommended: stable routing
  | { kind: "chat_guid"; chatGuid: string }
  | { kind: "chat_identifier"; chatIdentifier: string }
  | { kind: "handle"; to: string; service: IMessageService }
```

### Resolution Priority

1. `chat_id:123` - Database chat ID (most stable)
2. `chat_guid:xxx` - Chat GUID
3. `chat_identifier:xxx` - Chat identifier
4. `handle` - Phone number or email address

---

## Multi-Account Support

Both connection methods support multi-account configuration:

```json5
{
  channels: {
    imessage: {
      enabled: true,
      accounts: {
        personal: {
          cliPath: "/usr/local/bin/imsg",
          dbPath: "/Users/me/Library/Messages/chat.db",
          allowFrom: ["+15551234567"],
        },
        bot: {
          cliPath: "~/.openclaw/scripts/imsg-bot",
          dbPath: "/Users/bot/Library/Messages/chat.db",
          allowFrom: ["*"],
        },
      },
    },
  },
}
```

---

## Configuration Examples

### imsg Configuration

```json5
{
  channels: {
    imessage: {
      enabled: true,
      cliPath: "/usr/local/bin/imsg", // imsg binary path
      dbPath: "/Users/me/Library/Messages/chat.db", // Database path
      remoteHost: "user@remote-mac", // Optional: SSH remote host
      dmPolicy: "pairing",
      groupPolicy: "allowlist",
      allowFrom: ["+15551234567", "user@icloud.com"],
      includeAttachments: true,
      mediaMaxMb: 20,
    },
  },
}
```

### BlueBubbles Configuration

```json5
{
  channels: {
    bluebubbles: {
      enabled: true,
      serverUrl: "http://localhost:1234",
      password: "your-password",
      webhookPath: "/webhook/bluebubbles",
      sendReadReceipts: true,
      dmPolicy: "allowlist",
      allowFrom: ["+15551234567"],
    },
  },
}
```

---

## Plugin Architecture

### Plugin Entry (extensions/imessage/src/channel.ts)

```typescript
const imessagePlugin: ChannelPlugin<ResolvedIMessageAccount> = {
  id: "imessage",
  meta: { aliases: ["imsg"] },

  // Pairing support
  pairing: {
    idLabel: "imessageSenderId",
    notifyApproval: async ({ id }) => { ... }
  },

  // Capabilities declaration
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
  },

  // Outbound sending
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => ...,
    sendText: async ({ to, text, ... }) => ...,
    sendMedia: async ({ to, text, mediaUrl, ... }) => ...,
  },

  // Gateway startup
  gateway: {
    startAccount: async (ctx) => monitorIMessageProvider(...)
  }
};
```

---

## Related Documentation

- [iMessage Documentation](https://docs.openclaw.ai/channels/imessage)
- [BlueBubbles Documentation](https://docs.openclaw.ai/channels/bluebubbles)
