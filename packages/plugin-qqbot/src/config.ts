import type { PluginInput } from "@opencode-ai/plugin"
import type { QQBotPluginConfig } from "./types.js"

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
