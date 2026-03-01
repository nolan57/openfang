import type { PluginInput } from "@opencode-ai/plugin"
import type { QQBotPluginConfig } from "./types.js"

export function loadConfig(_input: PluginInput): QQBotPluginConfig {
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
  }

  return config
}
