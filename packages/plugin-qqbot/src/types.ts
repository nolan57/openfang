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
  maxReconnectAttempts: number
  maxChunkSize: number
  sandbox: boolean
  // Voice features
  enableVoice: boolean
  ttsVoice: string
  enableStt: boolean
  // Video features
  enableVideo: boolean
  // File features
  enableFile: boolean
  // Typing indicator
  enableTyping: boolean
}

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
  enableVoice?: boolean
  ttsVoice?: string
  enableStt?: boolean
  enableVideo?: boolean
  enableFile?: boolean
  enableTyping?: boolean
  // Streaming config
  responseMode?: "blocking" | "streaming"
  streamingDelayMs?: number
  streamingMinChunk?: number
}

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

export interface QQBotMessage {
  id: string
  author: {
    id: string
    union_openid?: string
    user_openid?: string
    member_openid?: string
  }
  content: string
  timestamp: string
  message_scene?: {
    source: string
  }
  group_id?: string
  group_openid?: string
  channel_id?: string
  guild_id?: string
  attachments?: MessageAttachment[]
}

export interface MessageAttachment {
  content_type: string
  filename?: string
  height?: number
  width?: number
  size?: number
  url: string
  voice_wav_url?: string
  asr_refer_text?: string
  voice_duration?: number
}

export interface WSPayload {
  op: number
  d?: unknown
  s?: number
  t?: string
}

export interface PluginState {
  sessions: Map<string, SessionInfo>
  pendingPairing: Map<string, { code: string; userId: string; timestamp: number }>
  allowedUsers: Set<string>
  allowedGroups: Set<string>
}

export interface SessionInfo {
  sessionId: string
  createdAt: number
}

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

export interface MessageContext {
  id: string
  type: "C2C" | "GROUP" | "CHANNEL"
  content: string
  senderId: string
  timestamp: number
  groupId?: string
  channelId?: string
  attachments?: Array<{ content_type: string; url: string; filename?: string }>
}
