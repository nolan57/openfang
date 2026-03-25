import type { PluginInput } from "@opencode-ai/plugin"
import type { QQBotPluginConfig, ResolvedQQBotAccount, QQBotAccountConfig } from "./types.js"

const DEFAULT_ACCOUNT_ID = "default"

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

  if (!appId && Bun.env.QQBOT_APP_ID) {
    appId = Bun.env.QQBOT_APP_ID
  }

  const accountConfig: QQBotAccountConfig = {
    enabled: config.enabled,
    dmPolicy: config.dmPolicy as QQBotAccountConfig["dmPolicy"],
    allowFrom: config.allowFrom
      ? Array.isArray(config.allowFrom)
        ? config.allowFrom
        : config.allowFrom.split(",")
      : undefined,
    imageServerBaseUrl: config.imageServerBaseUrl,
    markdownSupport: config.markdownSupport,
    sandbox: config.sandbox,
    // Streaming config
    responseMode: config.responseMode,
    streamingDelayMs: config.streamingDelayMs,
    streamingMinChunk: config.streamingMinChunk,
  }

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

export function listQQBotAccountIds(_config: QQBotPluginConfig): string[] {
  return [DEFAULT_ACCOUNT_ID]
}

export function resolveDefaultQQBotAccountId(_config: QQBotPluginConfig): string {
  return DEFAULT_ACCOUNT_ID
}

export interface ConfigValidationResult {
  valid: boolean
  errors: string[]
}

export function validateConfig(config: QQBotPluginConfig): ConfigValidationResult {
  const errors: string[] = []

  if (!config.enabled) {
    return { valid: true, errors: [] }
  }

  if (!config.appId || config.appId.trim() === "") {
    errors.push("QQBOT_APP_ID is required")
  }

  if (!config.clientSecret || config.clientSecret.trim() === "") {
    errors.push("QQBOT_CLIENT_SECRET is required")
  }

  if (config.appId && !/^\d+$/.test(config.appId)) {
    errors.push("QQBOT_APP_ID must be numeric")
  }

  const validDmPolicies = ["pairing", "allowlist", "open", "disabled"]
  if (!validDmPolicies.includes(config.dmPolicy)) {
    errors.push(`QQBOT_DM_POLICY must be one of: ${validDmPolicies.join(", ")}`)
  }

  const validGroupPolicies = ["pairing", "allowlist", "open", "disabled"]
  if (!validGroupPolicies.includes(config.groupPolicy)) {
    errors.push(`QQBOT_GROUP_POLICY must be one of: ${validGroupPolicies.join(", ")}`)
  }

  const validResponseModes = ["blocking", "streaming"]
  if (!validResponseModes.includes(config.responseMode)) {
    errors.push(`QQBOT_RESPONSE_MODE must be one of: ${validResponseModes.join(", ")}`)
  }

  if (config.streamingDelayMs < 0) {
    errors.push("QQBOT_STREAMING_DELAY_MS must be non-negative")
  }

  if (config.streamingMinChunk < 1) {
    errors.push("QQBOT_STREAMING_MIN_CHUNK must be at least 1")
  }

  return { valid: errors.length === 0, errors }
}

export function loadConfig(input: PluginInput): QQBotPluginConfig {
  const config: QQBotPluginConfig = {
    enabled: Bun.env.QQBOT_ENABLED === "true",
    appId: Bun.env.QQBOT_APP_ID || "",
    clientSecret: Bun.env.QQBOT_CLIENT_SECRET || "",
    defaultAgent: Bun.env.QQBOT_DEFAULT_AGENT || "build",
    markdownSupport: Bun.env.QQBOT_MARKDOWN_SUPPORT !== "false",
    imageServerBaseUrl: Bun.env.QQBOT_IMAGE_SERVER_BASE_URL,
    dmPolicy: (Bun.env.QQBOT_DM_POLICY as QQBotPluginConfig["dmPolicy"]) || "pairing",
    groupPolicy: (Bun.env.QQBOT_GROUP_POLICY as QQBotPluginConfig["groupPolicy"]) || "allowlist",
    allowFrom: Bun.env.QQBOT_ALLOW_FROM || "*",
    streamingDelayMs: parseInt(Bun.env.QQBOT_STREAMING_DELAY_MS || "300", 10),
    streamingMinChunk: parseInt(Bun.env.QQBOT_STREAMING_MIN_CHUNK || "200", 10),
    responseMode: (Bun.env.QQBOT_RESPONSE_MODE as "blocking" | "streaming") || "streaming",
    maxReconnectAttempts: parseInt(Bun.env.QQBOT_MAX_RECONNECT_ATTEMPTS || "10", 10),
    maxChunkSize: parseInt(Bun.env.QQBOT_MAX_CHUNK_SIZE || "1500", 10),
    sandbox: Bun.env.QQBOT_SANDBOX === "true",
    // Voice features
    enableVoice: Bun.env.QQBOT_ENABLE_VOICE === "true",
    ttsVoice: Bun.env.QQBOT_TTS_VOICE || "zh-CN-XiaoxiaoNeural",
    enableStt: Bun.env.QQBOT_ENABLE_STT !== "false",
    // Video features
    enableVideo: Bun.env.QQBOT_ENABLE_VIDEO === "true",
    // File features
    enableFile: Bun.env.QQBOT_ENABLE_FILE === "true",
    // Typing indicator
    enableTyping: Bun.env.QQBOT_ENABLE_TYPING === "true",
  }

  const validation = validateConfig(config)
  if (!validation.valid) {
    console.error("[qqbot] Configuration errors:")
    for (const error of validation.errors) {
      console.error(`  - ${error}`)
    }
  }

  return config
}
