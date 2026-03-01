import type { OpencodeClient } from "@opencode-ai/sdk"
import type { QQBotPluginConfig, MessageContext, GatewayOptions, SessionInfo } from "./types.js"
import { getAccessToken, getGatewayUrl, sendC2CMessage, sendGroupMessage, sendChannelMessage } from "./api.js"

declare const WebSocket: any

const SESSIONS_FILE = "sessions.json"

const MESSAGE_REPLY_LIMIT = 4
const MESSAGE_REPLY_TTL = 60 * 60 * 1000

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
  private config: QQBotPluginConfig
  private client: OpencodeClient
  private directory: string
  private sessionsPath: string
  private defaultAgent: string
  private maxChunkSize: number
  private onStatus: GatewayOptions["onStatus"]
  private pluginState: GatewayOptions["state"]
  private ws: any = null
  private heartbeatInterval: any = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private sessionId: string | null = null
  private isIntentQueueProcessing = false
  private intentQueue: Array<{ type: string; data: unknown }> = []
  private accessToken: string = ""
  private authError = false
  private stopped = false
  private currentStreamAbort: AbortController | null = null

  constructor(options: GatewayOptions) {
    this.config = options.config
    this.client = options.client
    this.directory = options.directory
    this.sessionsPath = options.sessionsPath
    this.defaultAgent = options.defaultAgent
    this.maxChunkSize = options.maxChunkSize
    this.onStatus = options.onStatus
    this.pluginState = options.state
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
    try {
      const file = Bun.file(this.sessionsPath)
      if (await file.exists()) {
        const data = await file.json()
        for (const [key, value] of Object.entries(data)) {
          this.pluginState.sessions.set(key, value as SessionInfo)
        }
        this.onStatus.message(`Loaded ${this.pluginState.sessions.size} sessions`)
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
      for (const [key, value] of this.pluginState.sessions) {
        data[key] = value
      }
      await Bun.write(this.sessionsPath, JSON.stringify(data, null, 2))
    } catch (err) {
      this.onStatus.error(`Failed to save sessions: ${err}`)
    }
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
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
      this.accessToken = await getAccessToken(this.config)
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

  private async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        this.onStatus.connected()
        this.onStatus.message("Connected to QQ Gateway")
        this.reconnectAttempts = 0
        this.startHeartbeat()
        resolve()
      }

      this.ws.onmessage = (event: any) => {
        this.handleMessage(event.data)
      }

      this.ws.onclose = (event: any) => {
        this.onStatus.disconnected()
        this.onStatus.message(`Disconnected: ${event.code}`)
        this.stopHeartbeat()
        this.scheduleReconnect()
      }

      this.ws.onerror = (err: any) => {
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
    const PUBLIC_GUILD_MESSAGES = (1 >>> 0) << 30

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
    attachments?: Array<{ content_type: string; url: string; filename?: string }>
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
    attachments?: Array<{ content_type: string; url: string; filename?: string }>
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
    attachments?: Array<{ content_type: string; url: string; filename?: string }>
  }): Promise<void> {
    const senderId = data.author.id
    const content = this.stripQQPrefix(data.content.trim().replace(/<@!\d+>\s*/, ""))
    const channelId = data.channel_id
    const msgId = data.id
    const attachments = data.attachments

    this.onStatus.message(`Channel msg from ${senderId.slice(0, 8)}...`)

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
          this.pluginState.sessions.delete(sessionKey)
          await this.saveSessions()
          await this.doProcessMessage(ctx, query)
        } else {
          const sessionResult: any = await this.client.session.create({
            query: { directory: this.directory },
          })
          const sessionId = sessionResult.data.id
          this.pluginState.sessions.set(sessionKey, { sessionId, createdAt: Date.now() })
          await this.saveSessions()
          await this.sendReply(ctx, "New session created. What would you like to discuss?")
        }
        return
      }

      if (content.startsWith("#switch ")) {
        const sessionId = content.slice(8).trim()
        const oldSession = this.pluginState.sessions.get(sessionKey)
        this.pluginState.sessions.set(sessionKey, { sessionId, createdAt: Date.now() })
        await this.saveSessions()
        await this.sendReply(ctx, `Switched to session: ${sessionId}`)
        return
      }

      if (content === "#list") {
        const sessions: string[] = []
        for (const [key, info] of this.pluginState.sessions) {
          sessions.push(`${key}: ${info.sessionId}`)
        }
        await this.sendReply(ctx, sessions.length > 0 ? sessions.join("\n") : "No active sessions")
        return
      }

      if (content === "#clear") {
        this.pluginState.sessions.delete(sessionKey)
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

  private async doProcessMessage(ctx: MessageContext, content: string): Promise<void> {
    this.onStatus.message(`Processing: ${content.slice(0, 50)}...`)

    let currentSessionId: string | undefined
    const sessionKey = this.getSessionKey(ctx)
    const sessionInfo = this.pluginState.sessions.get(sessionKey)
    currentSessionId = sessionInfo?.sessionId

    if (!currentSessionId) {
      const sessionResult: any = await this.client.session.create({
        query: { directory: this.directory },
      })
      currentSessionId = sessionResult.data.id as string
      this.pluginState.sessions.set(sessionKey, { sessionId: currentSessionId, createdAt: Date.now() })
      await this.saveSessions()
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
        }
      }
    }

    this.currentStreamAbort = new AbortController()

    try {
      let fullResponse = ""

      for await (const chunk of (this.client as any).promptStream({
        sessionID: currentSessionId,
        directory: this.directory,
        parts,
      })) {
        if (this.currentStreamAbort?.signal.aborted) {
          break
        }

        if (chunk.type === "chunk" && chunk.content) {
          fullResponse += chunk.content
        } else if (chunk.type === "done") {
          let text = fullResponse.trim()
          if (text) {
            text = text
              .replace(/^```json\s*/, "")
              .replace(/\s*```$/, "")
              .trim()
            try {
              const json = JSON.parse(text)
              if (json && json.description) {
                text = json.description
              }
            } catch (e) {
              const descMatch = text.match(/"description"\s*:\s*"([^"]+)"/)
              if (descMatch) {
                text = descMatch[1]
              }
            }
            if (text) {
              await this.sendReply(ctx, text)
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
      if (ctx.type === "C2C") {
        await sendC2CMessage(this.config, ctx.senderId, chunk, replyToId ?? undefined)
      } else if (ctx.type === "GROUP") {
        await sendGroupMessage(this.config, ctx.groupId!, chunk, replyToId ?? undefined)
      } else if (ctx.type === "CHANNEL") {
        await sendChannelMessage(this.config, ctx.channelId!, chunk, replyToId ?? undefined)
      }
      if (replyToId) {
        recordMessageReply(replyToId)
      }
    }
  }

  private async sendToTarget(target: string, message: string): Promise<void> {
    if (target.startsWith("user:")) {
      const userId = target.slice(5)
      await sendC2CMessage(this.config, userId, message)
    } else if (target.startsWith("group:")) {
      const groupId = target.slice(6)
      await sendGroupMessage(this.config, groupId, message)
    } else if (target.startsWith("channel:")) {
      const channelId = target.slice(8)
      await sendChannelMessage(this.config, channelId, message)
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
    if (this.config.allowFrom === "*") return true

    const policy = type === "C2C" ? this.config.dmPolicy : this.config.groupPolicy

    switch (policy) {
      case "open":
        return true
      case "disabled":
        return false
      case "allowlist":
        return this.pluginState.allowedUsers.has(userId) || this.pluginState.allowedGroups.has(userId)
      case "pairing":
      default:
        return this.pluginState.pendingPairing.has(userId)
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

  async stop(): Promise<void> {
    this.stopped = true
    this.stopHeartbeat()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}
