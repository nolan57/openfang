# QQ Bot 消息发送问题修复记录

## 问题描述

QQ Bot 在处理用户纯文本消息时，出现以下错误：

```
Error: undefined is not an object (evaluating 'url.indexOf')
```

以及后续的消息发送错误：

```
Error: Failed to send C2C message: 400 - {"message":"消息被去重，请检查请求msgseq","code":40054005,"err_code":40054005}
```

## 问题排查过程

### 第一阶段：URL 错误

**错误信息**：`undefined is not an object (evaluating 'url.indexOf')`

**排查步骤**：

1. 搜索代码中所有 `.indexOf` 调用
2. 定位到 `prompt.ts:1056` 和 `message-v2.ts:539`
3. 发现是处理 FilePart 时 URL 可能为 undefined

**修复**：

- 在 `packages/opencode/src/session/prompt.ts` 添加 URL 存在性检查
- 在 `packages/opencode/src/session/message-v2.ts` 添加防御性检查

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

### 第二阶段：Hono fetch 类型错误

**错误信息**：真正的根因是 Hono 4.10.7 的 fetch 在接收字符串 URL 时有 bug

```
at getPath (../../../node_modules/.bun/hono@4.10.7/node_modules/hono/dist/utils/url.js:70:17)
at fetch (src/plugin/index.ts:30:46)
at promptStream (../sdk/js/src/client.ts:46:28)
```

**修复**：
在 `packages/opencode/src/plugin/index.ts` 中，将字符串 URL 转换为 Request 对象：

```typescript
fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = typeof input === "string" ? new Request(input, init) : input as Request
  return Server.App().fetch(request as Request)
},
```

### 第三阶段：QQ 消息去重错误

**错误信息**：`消息被去重，请检查请求msgseq`

**原因分析**：

- QQ 机器人 API 对同一消息的多次回复有去重机制
- 需要使用唯一的 `msg_seq` 参数来区分每条消息
- 参考 qqbot (OpenClaw 实现) 的实现

**修复方案**：

#### 1. 添加限流检查 (gateway.ts)

参考 qqbot 实现，添加消息回复限流检查：

```typescript
const MESSAGE_REPLY_LIMIT = 4
const MESSAGE_REPLY_TTL = 60 * 60 * 1000 // 1小时

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

#### 2. 在 sendReply 中使用限流检查 (gateway.ts)

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

#### 3. 添加 msg_seq 生成器 (api.ts)

这是关键修复！QQ API 要求每条消息使用唯一的 `msg_seq`：

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

#### 4. 在发送消息时使用 msg_seq (api.ts)

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

同样修复 `sendGroupMessage` 和 `sendChannelMessage`。

## 修改的文件

1. `packages/opencode/src/session/prompt.ts` - 添加 FilePart URL 检查
2. `packages/opencode/src/session/message-v2.ts` - 添加防御性检查
3. `packages/opencode/src/plugin/index.ts` - 修复 Hono fetch 类型问题
4. `packages/plugin-qqbot/src/gateway.ts` - 添加限流检查和消息记录
5. `packages/plugin-qqbot/src/api.ts` - 添加 msg_seq 生成器和修复

## QQ 机器人 API 关键知识点

### 消息类型

- **被动消息**：带 `msg_id`，用于回复用户，必须在收到消息 60 分钟内回复，每条消息最多回复 5 次
- **主动消息**：不带 `msg_id`，由机器人主动推送，每月每用户有限制（4 条）

### msg_seq 的重要性

- QQ API 使用 `msg_seq` 来区分对同一消息的多次回复
- 必须为每条消息生成唯一的 `msg_seq`，否则会报去重错误
- 使用时间戳 + 计数器确保唯一性

### 限流规则

- 被动消息：60 分钟内每消息最多回复 4 次
- 主动消息：每月每用户 4 条（沙箱环境）

## 参考文档

- [QQ 机器人官方文档](https://bot.q.qq.com/wiki/)
- 参考实现：`/Users/lpcw/Documents/opencode/qqbot/src/`
