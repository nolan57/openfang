import type { ResolvedQQBotAccount, GatewayOptions, SessionInfo, MessageContext } from "./types.js"
import {
  getAccessToken,
  getGatewayUrl,
  sendC2CMessage,
  sendGroupMessage,
  sendChannelMessage,
  sendTypingIndicator,
} from "./api.js"
import { sendTyping } from "./outbound.js"
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"
import os from "os"

declare const WebSocket: any

const MESSAGE_REPLY_LIMIT = 4
const MESSAGE_REPLY_TTL = 60 * 60 * 1000
const INTENT_QUEUE_MAX_SIZE = 1000
const CONNECTION_TIMEOUT_MS = 30000

const TEMP_DIR = path.join(os.tmpdir(), "qqbot-voice")

async function ensureTempDir(): Promise<void> {
  await fs.mkdir(TEMP_DIR, { recursive: true })
}

async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath)
  } catch (err) {
    console.error(`[qqbot] Failed to cleanup temp file ${filePath}: ${err}`)
  }
}

interface MessageReplyRecord {
  count: number
  firstReplyAt: number
}

const messageReplyTracker = new Map<string, MessageReplyRecord>()

function checkMessageReplyLimit(messageId: string): { allowed: boolean; remaining: number; shouldFallback: boolean } {
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

export class QQBotGateway {
  private account: ResolvedQQBotAccount
  private directory: string
  private sessionsPath: string
  private sessions: Map<string, SessionInfo> = new Map()
  private client: any
  private defaultAgent: string
  private maxChunkSize: number
  private onStatus: GatewayOptions["onStatus"]
  private onMessage?: GatewayOptions["onMessage"]
  private ws: any = null
  private heartbeatInterval: any = null
  private reconnectAttempts = 0
  private maxReconnectAttempts: number
  private sessionId: string | null = null
  private isIntentQueueProcessing = false
  private intentQueue: Array<{ type: string; data: unknown }> = []
  private isConnecting = false
  private accessToken: string = ""
  private authError = false
  private stopped = false
  private currentStreamAbort: AbortController | null = null
  private sessionsLoaded = false

  constructor(options: GatewayOptions) {
    this.account = options.account
    this.directory = options.directory
    this.sessionsPath = options.sessionsPath
    this.client = options.client
    this.defaultAgent = options.defaultAgent || "build"
    this.maxChunkSize = options.maxChunkSize || 1500
    this.onStatus = options.onStatus
    this.onMessage = options.onMessage
    this.maxReconnectAttempts = 10
  }

  private getSessionKey(ctx: MessageContext): string {
    if (ctx.type === "GROUP") return `group:${ctx.groupId}`
    if (ctx.type === "CHANNEL") return `channel:${ctx.channelId}`
    return `c2c:${ctx.senderId}`
  }

  private log(level: "info" | "warning" | "error", msg: string) {
    if (this.onStatus.log) {
      this.onStatus.log(level, msg)
    }
  }

  private async loadSessions(): Promise<void> {
    if (this.sessionsLoaded) {
      return
    }
    this.sessionsLoaded = true

    try {
      const file = Bun.file(this.sessionsPath)
      if (await file.exists()) {
        const data = await file.json()
        for (const [key, value] of Object.entries(data)) {
          this.sessions.set(key, value as SessionInfo)
        }
        this.onStatus.message(`Loaded ${this.sessions.size} sessions`)
      }
    } catch (err) {
      this.onStatus.error(`Failed to load sessions: ${err}`)
    }
  }

  private async saveSessions(): Promise<void> {
    try {
      const dir = this.sessionsPath.replace(/\/[^/]+$/, "")
      await Bun.$`mkdir -p ${dir}`.quiet()
      const data: Record<string, SessionInfo> = {}
      for (const [key, value] of this.sessions) {
        data[key] = value
      }
      await Bun.write(this.sessionsPath, JSON.stringify(data, null, 2))
    } catch (err) {
      this.onStatus.error(`Failed to save sessions: ${err}`)
    }
  }

  async start(): Promise<void> {
    if (!this.account.enabled) {
      this.onStatus.message("QQ Bot plugin disabled")
      return
    }

    if (this.stopped) {
      this.onStatus.message("QQ Bot stopped")
      return
    }

    if (this.authError) {
      this.onStatus.error("Authentication failed, not retrying")
      return
    }

    await this.loadSessions()

    try {
      this.onStatus.message("Getting access token...")
      this.accessToken = await getAccessToken(this.account)
      this.onStatus.message(`Access token obtained (${this.accessToken.slice(0, 10)}...)`)

      this.onStatus.message("Getting gateway URL...")
      const gatewayUrl = await getGatewayUrl(this.account)

      this.onStatus.message("Connecting to gateway...")
      await this.connect(gatewayUrl)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.onStatus.error(`Failed to start: ${message}`)
      this.scheduleReconnect()
    }
  }

  private async connect(url: string): Promise<void> {
    if (this.isConnecting) {
      throw new Error("Already connecting")
    }
    this.isConnecting = true

    let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      this.onStatus.error("Connection timeout")
      if (this.ws) {
        this.ws.close()
      }
    }, CONNECTION_TIMEOUT_MS)

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        this.onStatus.connected()
        this.onStatus.message("Connected to QQ Gateway")
        this.reconnectAttempts = 0
        this.isConnecting = false
        this.startHeartbeat()
        resolve()
      }

      this.ws.onmessage = (event: any) => {
        this.handleMessage(event.data)
      }

      this.ws.onclose = (event: any) => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        this.isConnecting = false
        this.onStatus.disconnected()
        this.onStatus.message(`Disconnected: ${event.code}`)
        this.stopHeartbeat()
        this.scheduleReconnect()
      }

      this.ws.onerror = (err: any) => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        this.isConnecting = false
        this.onStatus.error("WebSocket error")
        reject(err)
      }
    })
  }

  private handleMessage(data: string): void {
    try {
      const payload = JSON.parse(data)

      switch (payload.op) {
        case 9:
          this.authError = true
          this.onStatus.error("Invalid session (authentication failed), not retrying")
          break
        case 10:
          this.handleHello(payload.d)
          break
        case 11:
          break
        case 0:
          this.handleDispatch(payload)
          break
      }
    } catch (err) {
      this.log("error", `Error parsing message: ${err}`)
    }
  }

  private handleHello(data: { heartbeat_interval: number }): void {
    this.startHeartbeat(data.heartbeat_interval)
    this.sendIdentify()
  }

  private sendIdentify(): void {
    const GUILDS = 1 << 0
    const GUILD_MEMBERS = 1 << 1
    const GROUP_AND_C2C_EVENT = 1 << 25
    const PUBLIC_GUILD_MESSAGES = 1 << 30

    const intents = GUILDS | GUILD_MEMBERS | GROUP_AND_C2C_EVENT | PUBLIC_GUILD_MESSAGES

    const identify: any = {
      op: 2,
      d: {
        token: `QQBot ${this.accessToken}`,
        intents: intents,
        shard: [0, 1],
        properties: {},
      },
    }

    this.ws.send(JSON.stringify(identify))
  }

  private handleDispatch(payload: { t: string; d: unknown; s: number }): void {
    const eventType = payload.t
    const eventData = payload.d

    this.queueIntent(eventType, eventData)
  }

  private queueIntent(type: string, data: unknown): void {
    if (this.intentQueue.length >= INTENT_QUEUE_MAX_SIZE) {
      this.log("warning", `Intent queue full (${INTENT_QUEUE_MAX_SIZE}), dropping intent: ${type}`)
      return
    }

    this.intentQueue.push({ type, data })

    if (!this.isIntentQueueProcessing) {
      this.processIntentQueue()
    }
  }

  private async processIntentQueue(): Promise<void> {
    if (this.isIntentQueueProcessing) return
    this.isIntentQueueProcessing = true

    while (this.intentQueue.length > 0) {
      const intent = this.intentQueue.shift()!
      await this.handleIntent(intent.type, intent.data)
    }

    this.isIntentQueueProcessing = false
  }

  private async handleIntent(type: string, data: unknown): Promise<void> {
    this.onStatus.message(`Event: ${type}`)

    switch (type) {
      case "READY":
        this.sessionId = (data as { session_id: string }).session_id
        this.onStatus.message(`Session: ${this.sessionId?.slice(0, 8)}...`)
        break

      case "C2C_MESSAGE_CREATE":
        await this.handleC2CMessage(
          data as {
            author: { id: string }
            content: string
            id: string
            attachments?: Array<{ content_type: string; url: string; filename?: string }>
          },
        )
        break

      case "GROUP_AT_MESSAGE_CREATE":
        await this.handleGroupMessage(
          data as {
            author: { id: string }
            content: string
            group_id: string
            id: string
            attachments?: Array<{ content_type: string; url: string; filename?: string }>
          },
        )
        break

      case "AT_MESSAGE_CREATE":
        await this.handleChannelMessage(
          data as {
            author: { id: string }
            content: string
            channel_id: string
            id: string
            attachments?: Array<{ content_type: string; url: string; filename?: string }>
          },
        )
        break
    }
  }

  private stripQQPrefix(content: string): string {
    return content.replace(/^[•\d\.\)\-\*\+\>\s]+/, "").trim()
  }

  private async downloadAttachment(url: string, filename: string): Promise<string | null> {
    try {
      let downloadDir = "/tmp/qqbot-downloads"
      const sessionsDir = this.sessionsPath.replace(/[^\/]+$/, "")
      if (sessionsDir && sessionsDir !== "/") {
        try {
          const dirCheck = Bun.file(sessionsDir)
          if (await dirCheck.exists()) {
            downloadDir = sessionsDir + "downloads"
          }
        } catch {}
      }
      const filePath = `${downloadDir}/${filename}`
      const response = await fetch(url)
      if (!response.ok) {
        this.log("error", `Failed to download attachment: ${response.status}`)
        return null
      }
      const buffer = await response.arrayBuffer()
      await Bun.write(filePath, Buffer.from(buffer))
      return filePath
    } catch (err) {
      this.log("error", `Error downloading attachment: ${err}`)
      return null
    }
  }

  private async handleC2CMessage(data: {
    author: { id: string }
    content: string
    id: string
    attachments?: Array<{ content_type: string; url: string; filename?: string; voice_duration?: number }>
  }): Promise<void> {
    const senderId = data.author.id
    const content = this.stripQQPrefix(data.content.trim())
    const msgId = data.id
    const attachments = data.attachments

    this.onStatus.message(`DM from ${senderId.slice(0, 8)}...`)

    if (!this.isAllowed(senderId, "C2C")) {
      this.onStatus.message("User not allowed, ignoring")
      return
    }

    await sendTyping(this.account, `c2c:${senderId}`)

    await this.processMessage({
      id: msgId,
      type: "C2C",
      content,
      senderId,
      timestamp: Date.now(),
      attachments,
    })
  }

  private async handleGroupMessage(data: {
    author: { id: string }
    content: string
    group_id: string
    id: string
    attachments?: Array<{ content_type: string; url: string; filename?: string; voice_duration?: number }>
  }): Promise<void> {
    const senderId = data.author.id
    const content = this.stripQQPrefix(data.content.trim().replace(/<@!\d+>\s*/, ""))
    const groupId = data.group_id
    const msgId = data.id
    const attachments = data.attachments

    this.onStatus.message(`Group msg from ${senderId.slice(0, 8)}...`)

    if (!this.isAllowed(groupId, "GROUP")) {
      this.onStatus.message("Group not allowed, ignoring")
      return
    }

    await sendTyping(this.account, `group:${groupId}`)

    await this.processMessage({
      id: msgId,
      type: "GROUP",
      content,
      senderId,
      groupId,
      timestamp: Date.now(),
      attachments,
    })
  }

  private async handleChannelMessage(data: {
    author: { id: string }
    content: string
    channel_id: string
    id: string
    attachments?: Array<{ content_type: string; url: string; filename?: string; voice_duration?: number }>
  }): Promise<void> {
    const senderId = data.author.id
    const content = this.stripQQPrefix(data.content.trim().replace(/<@!\d+>\s*/, ""))
    const channelId = data.channel_id
    const msgId = data.id
    const attachments = data.attachments

    this.onStatus.message(`Channel msg from ${senderId.slice(0, 8)}...`)

    await sendTyping(this.account, `channel:${channelId}`)

    await this.processMessage({
      id: msgId,
      type: "CHANNEL",
      content,
      senderId,
      channelId,
      timestamp: Date.now(),
      attachments,
    })
  }

  private async processMessage(ctx: MessageContext): Promise<void> {
    try {
      const content = ctx.content.trim()
      const sessionKey = this.getSessionKey(ctx)

      if (content.startsWith("#new") || content.startsWith("/new")) {
        const query = content.replace(/^#new\s*/, "").replace(/^\/new\s*/, "")
        if (query) {
          this.sessions.delete(sessionKey)
          await this.saveSessions()
          await this.doProcessMessage(ctx, query)
        } else {
          const sessionResult: any = await this.client.session.create({
            query: { directory: this.directory },
          })
          const sessionId = sessionResult.data.id
          this.sessions.set(sessionKey, { sessionId, createdAt: Date.now() })
          await this.saveSessions()
          await this.sendReply(ctx, "New session created. What would you like to discuss?")
        }
        return
      }

      if (content.startsWith("#switch ")) {
        const sessionId = content.slice(8).trim()
        const oldSession = this.sessions.get(sessionKey)
        this.sessions.set(sessionKey, { sessionId, createdAt: Date.now() })
        await this.saveSessions()
        await this.sendReply(ctx, `Switched to session: ${sessionId}`)
        return
      }

      if (content === "#list") {
        const sessions: string[] = []
        for (const [key, info] of this.sessions) {
          sessions.push(`${key}: ${info.sessionId}`)
        }
        await this.sendReply(ctx, sessions.length > 0 ? sessions.join("\n") : "No active sessions")
        return
      }

      if (content === "#clear") {
        this.sessions.delete(sessionKey)
        await this.saveSessions()
        await this.sendReply(ctx, "Session cleared. Send a message to start a new conversation.")
        return
      }

      if (content === "#abort") {
        if (this.currentStreamAbort) {
          this.currentStreamAbort.abort()
          this.currentStreamAbort = null
          await this.sendReply(ctx, "Aborted current response")
        } else {
          await this.sendReply(ctx, "No active response to abort")
        }
        return
      }

      if (content.startsWith("#send ")) {
        const match = content.slice(6).match(/^(\S+)\s+(.+)$/)
        if (match) {
          const [, target, message] = match
          await this.sendToTarget(target, message)
          await this.sendReply(ctx, `Message sent to ${target}`)
        } else {
          await this.sendReply(ctx, "Usage: #send <target> <message>")
        }
        return
      }

      await this.doProcessMessage(ctx, content)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.onStatus.error(`Error: ${message}`)
    }
  }

  private async *callPromptStream(
    sessionId: string,
    parts: Array<{ type: "text"; text: string } | { type: "file"; url: string; mime?: string; filename?: string }>,
  ): AsyncGenerator<{ type: "chunk" | "done" | "error"; content?: string; messageId?: string; error?: string }> {
    const clientConfig = (this.client as any).client?.getConfig?.() ?? {}
    const baseUrl = clientConfig.baseUrl ?? "http://localhost:4096"
    const url = new URL(`${baseUrl}/session/${sessionId}/prompt/stream`)
    url.searchParams.set("directory", this.directory)

    const headers = new Headers(clientConfig.headers as Record<string, string>)
    headers.set("Content-Type", "application/json")

    const body = JSON.stringify({ parts })

    const fetchFn = (clientConfig.fetch as typeof fetch | undefined) ?? globalThis.fetch
    const response = await fetchFn(url.toString(), {
      method: "POST",
      headers,
      body,
    })

    if (!response.ok) {
      const errorText = await response.text()
      yield { type: "error", error: `HTTP ${response.status}: ${errorText}` }
      return
    }

    if (!response.body) {
      yield { type: "error", error: "No response body" }
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split("\n").filter((line) => line.trim())

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6)
            if (data === "[DONE]") {
              yield { type: "done" }
              return
            }
            try {
              const parsed = JSON.parse(data)
              yield parsed
            } catch {
              yield { type: "chunk", content: data }
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  private async doProcessMessage(ctx: MessageContext, content: string): Promise<void> {
    this.onStatus.message(`Processing: ${content.slice(0, 50)}...`)

    let currentSessionId: string | undefined
    const sessionKey = this.getSessionKey(ctx)
    const sessionInfo = this.sessions.get(sessionKey)
    currentSessionId = sessionInfo?.sessionId

    if (!currentSessionId) {
      try {
        const sessionResult: any = await this.client.session.create({
          query: { directory: this.directory },
        })
        currentSessionId = sessionResult.data.id as string
        this.sessions.set(sessionKey, { sessionId: currentSessionId, createdAt: Date.now() })
        await this.saveSessions()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.onStatus.error(`Failed to create session: ${message}`)
        await this.sendReply(ctx, `Sorry, I couldn't create a new session. Error: ${message}`)
        return
      }
    }

    const parts: Array<
      { type: "text"; text: string } | { type: "file"; url: string; mime?: string; filename?: string }
    > = [{ type: "text", text: content }]

    if (ctx.attachments && ctx.attachments.length > 0) {
      for (const att of ctx.attachments) {
        if (att.content_type?.startsWith("image/")) {
          const filename = att.filename || `image_${Date.now()}.${att.content_type.split("/")[1]}`
          const localPath = await this.downloadAttachment(att.url, filename)
          if (localPath) {
            parts.push({
              type: "file",
              url: `file://${localPath}`,
              mime: att.content_type,
              filename,
            })
          }
        } else if (att.content_type?.startsWith("audio/") || att.content_type === "voice") {
          if (!this.account.config.enableStt) {
            this.log("info", "STT disabled, ignoring voice attachment")
            continue
          }
          const filename = att.filename || `voice_${Date.now()}.silk`
          const localPath = await this.downloadAttachment(att.url, filename)
          if (localPath) {
            const wavPath = await decodeSilkToWav(localPath)
            if (wavPath) {
              parts.push({
                type: "file",
                url: `file://${wavPath}`,
                mime: "audio/wav",
                filename: filename.replace(".silk", ".wav"),
              })
            } else {
              parts.push({
                type: "text",
                text: "[Received voice message but unable to transcribe]",
              })
            }
          }
        }
      }
    }

    this.currentStreamAbort = new AbortController()

    try {
      let fullResponse = ""
      let buffer = ""
      let lastSendTime = 0
      const responseMode = this.account.config.responseMode || "streaming"
      const streamingDelayMs = this.account.config.streamingDelayMs || 300
      const streamingMinChunk = this.account.config.streamingMinChunk || 200

      const useStreaming = responseMode === "streaming"

      this.onStatus.message(`Starting response (mode=${responseMode}, useStreaming=${useStreaming})`)

      for await (const chunk of this.callPromptStream(currentSessionId, parts)) {
        if (this.currentStreamAbort?.signal.aborted) {
          this.onStatus.message("Stream aborted")
          break
        }

        if (chunk.type === "chunk" && chunk.content) {
          fullResponse += chunk.content
          buffer += chunk.content

          if (useStreaming) {
            const now = Date.now()
            const timeSinceLastSend = now - lastSendTime
            const shouldSendByTime = timeSinceLastSend >= streamingDelayMs
            const shouldSendBySize = buffer.length >= streamingMinChunk

            if (shouldSendByTime || shouldSendBySize) {
              let textToSend = buffer.trim()
              if (textToSend) {
                // Clean up markdown code blocks for display
                textToSend = textToSend
                  .replace(/^```json\s*/, "")
                  .replace(/\s*```$/, "")
                  .trim()

                // Try to extract description from JSON if present
                try {
                  const json = JSON.parse(textToSend)
                  if (json && json.description) {
                    textToSend = json.description
                  }
                } catch {
                  // Not valid JSON, try regex extraction
                  const descMatch = textToSend.match(/"description"\s*:\s*"([^"]+)"/)
                  if (descMatch) {
                    textToSend = descMatch[1]
                  }
                }

                if (textToSend) {
                  this.onStatus.message(`Sending chunk (${textToSend.length} chars)`)
                  await this.sendReply(ctx, textToSend)
                  buffer = ""
                  lastSendTime = now
                }
              }
            }
          }
        } else if (chunk.type === "done") {
          this.onStatus.message("Stream done")

          // For blocking mode, send the full response at once
          if (!useStreaming && fullResponse) {
            let textToSend = fullResponse.trim()
            textToSend = textToSend
              .replace(/^```json\s*/, "")
              .replace(/\s*```$/, "")
              .trim()
            try {
              const json = JSON.parse(textToSend)
              if (json && json.description) {
                textToSend = json.description
              }
            } catch (e) {
              const descMatch = textToSend.match(/"description"\s*:\s*"([^"]+)"/)
              if (descMatch) {
                textToSend = descMatch[1]
              }
            }
            if (textToSend) {
              this.onStatus.message(`Sending blocking response (${textToSend.length} chars)`)
              await this.sendReply(ctx, textToSend)
            }
          } else if (buffer.trim()) {
            // For streaming mode, send remaining buffer
            let finalText = buffer.trim()
            finalText = finalText
              .replace(/^```json\s*/, "")
              .replace(/\s*```$/, "")
              .trim()
            try {
              const json = JSON.parse(finalText)
              if (json && json.description) {
                finalText = json.description
              }
            } catch (e) {
              const descMatch = finalText.match(/"description"\s*:\s*"([^"]+)"/)
              if (descMatch) {
                finalText = descMatch[1]
              }
            }
            if (finalText) {
              this.onStatus.message(`Sending final chunk (${finalText.length} chars)`)
              await this.sendReply(ctx, finalText)
            }
          }
          break
        } else if (chunk.type === "error") {
          this.log("error", `Stream error: ${chunk.error}`)
          throw new Error(chunk.error)
        }
      }
    } finally {
      this.currentStreamAbort = null
    }
  }

  private async sendReply(ctx: MessageContext, content: string): Promise<void> {
    const chunks = this.splitMessage(content)

    let replyToId: string | undefined = ctx.id
    if (replyToId) {
      const limitCheck = checkMessageReplyLimit(replyToId)
      if (!limitCheck.allowed) {
        replyToId = undefined
      }
    }

    for (const chunk of chunks) {
      try {
        if (ctx.type === "C2C") {
          await sendC2CMessage(this.account, ctx.senderId, chunk, replyToId ?? undefined)
          this.onStatus.message(`Sent C2C reply to ${ctx.senderId.slice(0, 8)}...`)
        } else if (ctx.type === "GROUP") {
          await sendGroupMessage(this.account, ctx.groupId!, chunk, replyToId ?? undefined)
          this.onStatus.message(`Sent group reply to ${ctx.groupId}`)
        } else if (ctx.type === "CHANNEL") {
          await sendChannelMessage(this.account, ctx.channelId!, chunk, replyToId ?? undefined)
          this.onStatus.message(`Sent channel reply to ${ctx.channelId}`)
        }
        if (replyToId) {
          recordMessageReply(replyToId)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.onStatus.error(`Failed to send reply: ${message}`)
        this.log("error", `sendReply error: ${message}`)
      }
    }
  }

  private async sendToTarget(target: string, message: string): Promise<void> {
    if (target.startsWith("user:")) {
      const userId = target.slice(5)
      await sendC2CMessage(this.account, userId, message)
    } else if (target.startsWith("group:")) {
      const groupId = target.slice(6)
      await sendGroupMessage(this.account, groupId, message)
    } else if (target.startsWith("channel:")) {
      const channelId = target.slice(8)
      await sendChannelMessage(this.account, channelId, message)
    }
  }

  private splitMessage(content: string): string[] {
    const chunks: string[] = []
    let current = ""

    for (const line of content.split("\n")) {
      if (current.length + line.length + 1 > this.maxChunkSize) {
        if (current) chunks.push(current)
        current = line
      } else {
        current += (current ? "\n" : "") + line
      }
    }

    if (current) chunks.push(current)
    return chunks
  }

  private isAllowed(userId: string, type: "C2C" | "GROUP"): boolean {
    const allowFrom = this.account.config.allowFrom
    if (!allowFrom || allowFrom.length === 0 || allowFrom.includes("*")) return true

    const policy = type === "C2C" ? this.account.config.dmPolicy : this.account.config.groupPolicy

    switch (policy) {
      case "open":
        return true
      case "disabled":
        return false
      case "allowlist":
      case "pairing":
      default:
        return allowFrom.includes(userId)
    }
  }

  private startHeartbeat(interval?: number): void {
    const ms = interval || 30000
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op: 1, d: null }))
      }
    }, ms) as any
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

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

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectAttempts++

    this.onStatus.message(`Reconnecting in ${delay / 1000}s...`)

    setTimeout(() => {
      this.start().catch((err) => {
        this.onStatus.error(`Reconnect failed: ${err}`)
      })
    }, delay)
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.stopHeartbeat()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

async function decodeSilkToWav(silkPath: string): Promise<string | null> {
  try {
    await ensureTempDir()

    const silkWasm = await import("silk-wasm")
    const decodeSilk = silkWasm.decode || silkWasm.default?.decode

    const silkBuffer = await fs.readFile(silkPath)
    const decodeResult = await decodeSilk(silkBuffer, 24000)

    const pcmBuffer: Uint8Array = (decodeResult as any).pcm || (decodeResult as any).data || (decodeResult as any)

    const wavHeader = createWavHeader(pcmBuffer.length, 24000, 16, 1)
    const wavBuffer = Buffer.concat([wavHeader, pcmBuffer])

    const wavFilename = path.basename(silkPath, ".silk") + ".wav"
    const wavPath = path.join(TEMP_DIR, wavFilename)

    await fs.writeFile(wavPath, wavBuffer)
    await cleanupTempFile(silkPath)

    return wavPath
  } catch (err) {
    console.error(`[qqbot] Failed to decode SILK voice: ${err}`)
    await cleanupTempFile(silkPath).catch(() => {})
    return null
  }
}

function createWavHeader(dataLength: number, sampleRate: number, bitsPerSample: number, channels: number): Buffer {
  const header = Buffer.alloc(44)
  const byteRate = (sampleRate * channels * bitsPerSample) / 8
  const blockAlign = (channels * bitsPerSample) / 8

  header.write("RIFF", 0)
  header.writeUInt32LE(36 + dataLength, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write("data", 36)
  header.writeUInt32LE(dataLength, 40)

  return header
}
