import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin"
import type { ResolvedQQBotAccount, QQBotPluginConfig, PluginState } from "./types.js"
import { loadConfig, resolveQQBotAccount } from "./config.js"
import { QQBotGateway } from "./gateway.js"
import { appendFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"

const PLUGIN_NAME = "qqbot"

function getLogFilePath(directory: string): string {
  return join(directory, ".qqbot", "logs", "qqbot.log")
}

function ensureLogDir(directory: string): void {
  const logDir = join(directory, ".qqbot", "logs")
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true })
  }
}

function writeLog(directory: string, level: "info" | "warning" | "error", message: string): void {
  try {
    ensureLogDir(directory)
    const logPath = getLogFilePath(directory)
    const timestamp = new Date().toISOString()
    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`
    appendFileSync(logPath, logLine)
  } catch {}
}

async function publishLog(
  client: PluginInput["client"],
  directory: string,
  source: string,
  level: "info" | "warning" | "error",
  message: string,
) {
  writeLog(directory, level, message)
  try {
    const clientConfig = (client as any).client?.getConfig?.() ?? {}
    const baseUrl = clientConfig.baseUrl ?? "http://localhost:4096"
    await fetch(`${baseUrl}/tui/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "tui.log",
        properties: { source, level, message },
      }),
    })
  } catch {}
}

async function publishStatus(
  client: PluginInput["client"],
  directory: string,
  status: "connected" | "disconnected" | "connecting" | "error" | "disabled" | "pending",
  log?: { type: "info" | "message" | "warning" | "error" | "status" | "execution"; message: string },
  error?: string,
) {
  try {
    const clientConfig = (client as any).client?.getConfig?.() ?? {}
    const baseUrl = clientConfig.baseUrl ?? "http://localhost:4096"
    await fetch(`${baseUrl}/tui/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "tui.plugin.status",
        properties: { plugin: PLUGIN_NAME, status, log, error },
      }),
    })
  } catch {}
}

const plugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  const config = loadConfig(input)

  const pluginState: PluginState = {
    sessions: new Map(),
    pendingPairing: new Map(),
    allowedUsers: new Set(),
    allowedGroups: new Set(),
  }

  const account = resolveQQBotAccount(config)

  const publishPluginLog = (type: "info" | "message" | "warning" | "error" | "status" | "execution", msg: string) => {
    const level = type === "error" || type === "warning" ? "error" : "info"
    publishStatus(input.client, input.directory, "connected", { type, message: msg })
    publishLog(input.client, input.directory, PLUGIN_NAME, level, msg)
  }

  const onStatus = {
    message: (msg: string) => publishPluginLog("message", msg),
    connected: () => {
      publishStatus(input.client, input.directory, "connected", { type: "status", message: "Connected" })
      publishLog(input.client, input.directory, PLUGIN_NAME, "info", "Connected")
    },
    disconnected: () => {
      publishStatus(input.client, input.directory, "disconnected", { type: "status", message: "Disconnected" })
      publishLog(input.client, input.directory, PLUGIN_NAME, "info", "Disconnected")
    },
    error: (msg: string) => {
      publishStatus(input.client, input.directory, "error", { type: "error", message: msg }, msg)
      publishLog(input.client, input.directory, PLUGIN_NAME, "error", msg)
    },
  }

  publishStatus(input.client, input.directory, "connecting", { type: "status", message: "Starting QQ Bot..." })
  publishLog(input.client, input.directory, PLUGIN_NAME, "info", "Starting QQ Bot...")

  const sessionsPath = join(input.directory, ".qqbot", "sessions.json")

  let gateway = new QQBotGateway({
    account,
    directory: input.directory,
    sessionsPath,
    client: input.client,
    onStatus,
  })

  gateway.start().catch((err) => {
    publishStatus(
      input.client,
      input.directory,
      "error",
      { type: "error", message: `Failed to start: ${err}` },
      String(err),
    )
    publishLog(input.client, input.directory, PLUGIN_NAME, "error", `Failed to start: ${err}`)
  })

  return {
    "plugin.status": async () => ({
      status: gateway.isConnected() ? "connected" : "disconnected",
      metadata: { reconnectAttempts: gateway.getReconnectAttempts() },
    }),

    "plugin.restart": async () => {
      try {
        publishPluginLog("message", "Restarting QQ Bot gateway...")

        const wasConnected = gateway.isConnected()
        const reconnectAttempts = gateway.getReconnectAttempts()
        publishPluginLog("message", `Current state: connected=${wasConnected}, reconnectAttempts=${reconnectAttempts}`)

        await gateway.stop()
        publishPluginLog("message", "Gateway stopped successfully")

        gateway = new QQBotGateway({
          account,
          directory: input.directory,
          sessionsPath,
          client: input.client,
          onStatus,
        })
        publishPluginLog("message", "New gateway created, starting...")

        await gateway.start()
        publishPluginLog("status", "Restart completed successfully")
        return { success: true }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        const errorStack = error instanceof Error ? error.stack : undefined

        publishPluginLog("error", `Restart failed: ${errorMsg}`)
        publishLog(input.client, input.directory, PLUGIN_NAME, "error", `Restart error details: ${errorMsg}`)

        if (errorStack) {
          publishLog(
            input.client,
            input.directory,
            PLUGIN_NAME,
            "error",
            `Stack: ${errorStack.split("\n").slice(0, 3).join("\n")}`,
          )
        }

        return { success: false, error: errorMsg }
      }
    },
  }
}

export default plugin
export const QQBotPlugin = plugin
