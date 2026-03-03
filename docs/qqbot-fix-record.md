# QQ Bot Message Sending Issue Fix Record

## Issue Description

When processing user plain text messages, QQ Bot encountered the following errors:

```
Error: undefined is not an object (evaluating 'url.indexOf')
```

And subsequent message sending errors:

```
Error: Failed to send C2C message: 400 - {"message":"Message deduplicated, please check msgseq in request","code":40054005,"err_code":40054005}
```

## Troubleshooting Process

### Phase 1: URL Error

**Error:** `undefined is not an object (evaluating 'url.indexOf')`

**Troubleshooting Steps:**

1. Searched codebase for all `.indexOf` calls
2. Located `prompt.ts:1056` and `message-v2.ts:539`
3. Found that URL could be undefined when processing FilePart

**Fix:**

- Added URL existence check in `packages/opencode/src/session/prompt.ts`
- Added defensive check in `packages/opencode/src/session/message-v2.ts`

```typescript
// prompt.ts:1056
if (!part.url) {
  log.error("file part missing url", { part })
  return [
    {
      messageID: info.id,
      sessionID: input.sessionID,
      type: "text",
      synthetic: true,
      text: `Error: File part is missing URL`,
    },
  ]
}
const url = new URL(part.url)
```

### Phase 2: Hono fetch Type Error

**Error:** The actual root cause was a bug in Hono 4.10.7's fetch when receiving string URLs

```
at getPath (../../../node_modules/.bun/hono@4.10.7/node_modules/hono/dist/utils/url.js:70:17)
at fetch (src/plugin/index.ts:30:46)
at promptStream (../sdk/js/src/client.ts:46:28)
```

**Fix:**
In `packages/opencode/src/plugin/index.ts`, convert string URL to Request object:

```typescript
fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = typeof input === "string" ? new Request(input, init) : input as Request
  return Server.App().fetch(request as Request)
},
```

### Phase 3: QQ Message Deduplication Error

**Error:** `Message deduplicated, please check msgseq in request`

**Root Cause Analysis:**

- QQ Bot API has deduplication mechanism for multiple replies to the same message
- Need to use unique `msg_seq` parameter to distinguish each message
- Referenced qqbot (OpenClaw implementation) for guidance

**Fix Solution:**

#### 1. Add Rate Limiting Check (gateway.ts)

Referencing qqbot implementation, added message reply rate limiting:

```typescript
const MESSAGE_REPLY_LIMIT = 4
const MESSAGE_REPLY_TTL = 60 * 60 * 1000 // 1 hour

interface MessageReplyRecord {
  count: number
  firstReplyAt: number
}

const messageReplyTracker = new Map<string, MessageReplyRecord>()

function checkMessageReplyLimit(messageId: string): {
  allowed: boolean
  remaining: number
  shouldFallback: boolean
} {
  const now = Date.now()
  const record = messageReplyTracker.get(messageId)

  if (!record) {
    return { allowed: true, remaining: MESSAGE_REPLY_LIMIT, shouldFallback: false }
  }

  if (now - record.firstReplyAt > MESSAGE_REPLY_TTL) {
    return { allowed: false, remaining: 0, shouldFallback: true }
  }

  const remaining = MESSAGE_REPLY_LIMIT - record.count
  if (remaining <= 0) {
    return { allowed: false, remaining: 0, shouldFallback: true }
  }

  return { allowed: true, remaining, shouldFallback: false }
}

function recordMessageReply(messageId: string): void {
  const now = Date.now()
  const record = messageReplyTracker.get(messageId)

  if (!record) {
    messageReplyTracker.set(messageId, { count: 1, firstReplyAt: now })
  } else {
    if (now - record.firstReplyAt > MESSAGE_REPLY_TTL) {
      messageReplyTracker.set(messageId, { count: 1, firstReplyAt: now })
    } else {
      record.count++
    }
  }
}
```

#### 2. Use Rate Limiting Check in sendReply (gateway.ts)

```typescript
private async sendReply(ctx: MessageContext, content: string): Promise<void> {
  const chunks = this.splitMessage(content)

  let replyToId: string | undefined = ctx.id
  if (replyToId) {
    const limitCheck = checkMessageReplyLimit(replyToId)
    if (!limitCheck.allowed) {
      console.log(`[qqbot] Reply limit exceeded for ${replyToId}, using proactive message`)
      replyToId = undefined
    } else {
      console.log(`[qqbot] Reply remaining for ${replyToId}: ${limitCheck.remaining}/${MESSAGE_REPLY_LIMIT}`)
    }
  }

  for (const chunk of chunks) {
    if (ctx.type === "C2C") {
      await sendC2CMessage(this.config, ctx.senderId, chunk, replyToId)
    } else if (ctx.type === "GROUP") {
      await sendGroupMessage(this.config, ctx.groupId!, chunk, replyToId)
    } else if (ctx.type === "CHANNEL") {
      await sendChannelMessage(this.config, ctx.channelId!, chunk, replyToId)
    }
    if (replyToId) {
      recordMessageReply(replyToId)
    }
  }
}
```

#### 3. Add msg_seq Generator (api.ts)

This is the key fix! QQ API requires unique `msg_seq` for each message:

```typescript
const msgSeqTracker = new Map<string, number>()
const seqBaseTime = Math.floor(Date.now() / 1000) % 100000000

function getNextMsgSeq(msgId: string): number {
  const current = msgSeqTracker.get(msgId) ?? 0
  const next = current + 1
  msgSeqTracker.set(msgId, next)

  if (msgSeqTracker.size > 1000) {
    const keys = Array.from(msgSeqTracker.keys())
    for (let i = 0; i < 500; i++) {
      msgSeqTracker.delete(keys[i])
    }
  }

  return seqBaseTime + next
}
```

#### 4. Use msg_seq When Sending Messages (api.ts)

```typescript
export async function sendC2CMessage(
  config: QQBotPluginConfig,
  userId: string,
  content: string,
  msgId?: string,
): Promise<void> {
  const token = await getAccessToken(config)
  const msgSeq = msgId ? getNextMsgSeq(msgId) : 1

  const response = await fetch(`${API_BASE}/v2/users/${userId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `QQBot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
      msg_id: msgId,
      msg_seq: msgSeq,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to send C2C message: ${response.status} - ${error}`)
  }
}
```

Similarly fixed `sendGroupMessage` and `sendChannelMessage`.

## Modified Files

1. `packages/opencode/src/session/prompt.ts` - Added FilePart URL check
2. `packages/opencode/src/session/message-v2.ts` - Added defensive check
3. `packages/opencode/src/plugin/index.ts` - Fixed Hono fetch type issue
4. `packages/plugin-qqbot/src/gateway.ts` - Added rate limiting check and message tracking
5. `packages/plugin-qqbot/src/api.ts` - Added msg_seq generator and fixes

## QQ Bot API Key Knowledge

### Message Types

- **Passive messages**: With `msg_id`, used for replying to users, must reply within 60 minutes of receiving message, each message can be replied to at most 5 times
- **Proactive messages**: Without `msg_id`, pushed by bot, limited per user per month (4 messages in sandbox environment)

### Importance of msg_seq

- QQ API uses `msg_seq` to distinguish multiple replies to the same message
- Must generate unique `msg_seq` for each message, otherwise deduplication error occurs
- Use timestamp + counter to ensure uniqueness

### Rate Limiting Rules

- Passive messages: Maximum 4 replies per message within 60 minutes
- Proactive messages: 4 messages per user per month (sandbox environment)

## Reference Documentation

- [QQ Bot Official Documentation](https://bot.q.qq.com/wiki/)
- Reference implementation: `/Users/lpcw/Documents/opencode/qqbot/src/`
