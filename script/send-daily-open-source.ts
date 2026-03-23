#!/usr/bin/env bun

/**
 * Send daily open source recommendations via QQ Bot
 */

import { sendC2CMessage, sendGroupMessage } from "../packages/plugin-qqbot/src/api.js"
import type { QQBotPluginConfig } from "../packages/plugin-qqbot/src/types.js"

const config: QQBotPluginConfig = {
  enabled: true,
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
}

// Daily open source recommendations content
const recommendations = `🔥 今日开源项目推荐

1️⃣ build-your-own-x
⭐ Stars: 400K+ | 🔗 https://github.com/codecrafters-io/build-your-own-x
📖 通过从头重现你喜欢的技术来掌握编程
🛠 技术栈：Multiple Languages
💡 推荐理由：极佳的学习资源，包含 Git、Docker、Redis 等 14 个项目的从零实现教程

2️⃣ developer-roadmap
⭐ Stars: 350K+ | 🔗 https://github.com/kamranahmedse/developer-roadmap
📖 交互式路线图，帮助开发者提升职业技能
🛠 技术栈：TypeScript, Next.js
💡 推荐理由：清晰的学习路径图，涵盖前端、后端、DevOps 等方向

3️⃣ openclaw
⭐ Stars: 1.2K+ | 🔗 https://github.com/openclaw/openclaw
📖 你的个人 AI 助手，支持任何操作系统和平台
🛠 技术栈：TypeScript, Bun, SolidJS
💡 推荐理由：强大的 AI 编程助手，本地优先，支持多平台部署

---
📅 每日 9 点自动推送 | 配置：cron "0 9 * * *"`

async function sendRecommendations(): Promise<void> {
  try {
    // Send to C2C (personal message)
    const userId = "A14385633368AB4D8591B3301AAAC3B2" // From sessions.json
    await sendC2CMessage(config, userId, recommendations)
    console.log(`✅ Recommendations sent to user ${userId}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`❌ Failed to send recommendations: ${message}`)
    process.exit(1)
  }
}

sendRecommendations()
