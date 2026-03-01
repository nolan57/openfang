import type { OpencodeClient } from "@opencode-ai/sdk"

export interface QQBotPluginConfig {
  enabled: boolean
  appId: string
  clientSecret: string
  defaultAgent: string
  markdownSupport: boolean
  imageServerBaseUrl?: string
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled"
  groupPolicy: "pairing" | "allowlist" | "open" | "disabled"
  allowFrom: string
  streamingDelayMs: number
  streamingMinChunk: number
  responseMode: "blocking" | "streaming"
}

export interface Attachment {
  content_type: string
  url: string
  filename?: string
}

export interface MessageContext {
  id: string
  type: "C2C" | "GROUP" | "CHANNEL"
  content: string
  senderId: string
  senderName?: string
  groupId?: string
  channelId?: string
  guildId?: string
  timestamp: number
  attachments?: Attachment[]
}

export interface SessionInfo {
  sessionId: string
  createdAt: number
}

export interface PluginState {
  sessions: Map<string, SessionInfo>
  pendingPairing: Map<string, { code: string; userId: string; timestamp: number }>
  allowedUsers: Set<string>
  allowedGroups: Set<string>
}

export interface GatewayOptions {
  config: QQBotPluginConfig
  client: OpencodeClient
  directory: string
  sessionsPath: string
  state: PluginState
  defaultAgent: string
  maxChunkSize: number
  onStatus: {
    message(msg: string): void
    connected(): void
    disconnected(): void
    error(msg: string): void
    log?(level: "info" | "warning" | "error", msg: string): void
  }
}
