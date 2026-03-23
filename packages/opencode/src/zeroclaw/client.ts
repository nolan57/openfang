import { Log } from "../util/log"

const log = Log.create({ service: "zeroclaw" })

export interface ZeroClawConfig {
  url: string
  token: string
  timeout?: number
  autoStart?: boolean
  startPort?: number
}

export interface ZeroClawChatRequest {
  message: string
  session_id?: string
  context?: string[]
}

export interface ZeroClawChatResponse {
  reply: string
  model: string
  session_id?: string
}

export interface ZeroClawToolRequest {
  name: string
  args: Record<string, unknown>
  securityPolicy?: "supervised" | "read_only" | "full"
  estopLevel?: "none" | "tool-freeze" | "domain-block" | "network-kill" | "kill-all"
  estopEnabled?: boolean
}

export interface ZeroClawToolResponse {
  success: boolean
  output: string
  exitCode: number
  memoryUsed: string
  duration: string
}

export interface ZeroClawHealthResponse {
  status: string
  uptime: number
  memory_usage: string
  version: string
  available_tools: string[]
}

export interface ZeroClawStatusResponse {
  status: string
  memory: {
    used: string
    total: string
    percentage: number
  }
  cpu: {
    usage: number
  }
  estop: {
    enabled: boolean
    level: string
    engaged: boolean
  }
  sandbox: string
}

export class ZeroClawError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = "ZeroClawError"
  }
}

export class ZeroClawClient {
  private url: string
  private token: string
  private timeout: number

  constructor(config: ZeroClawConfig) {
    this.url = config.url.replace(/\/$/, "")
    this.token = config.token
    this.timeout = config.timeout ?? 30000
  }

  async chat(request: ZeroClawChatRequest): Promise<ZeroClawChatResponse> {
    const response = await this.request("/api/chat", {
      method: "POST",
      body: JSON.stringify(request),
    })
    return response as unknown as ZeroClawChatResponse
  }

  async executeTool(request: ZeroClawToolRequest): Promise<ZeroClawToolResponse> {
    const headers: Record<string, string> = {
      "X-Security-Policy": request.securityPolicy ?? "supervised",
    }

    if (request.estopLevel) {
      headers["X-EStop-Level"] = request.estopLevel
    }

    if (request.estopEnabled !== undefined) {
      headers["X-EStop-Enabled"] = request.estopEnabled ? "true" : "false"
    }

    try {
      const response = await this.request("/tools/exec", {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: crypto.randomUUID(),
          method: "tool.execute",
          params: {
            name: request.name,
            args: request.args,
          },
        }),
      })
      return response.result as ZeroClawToolResponse
    } catch (error) {
      if (error instanceof ZeroClawError && error.status === 405) {
        log.warn("Tool execution endpoint not available, falling back to chat API", {
          tool: request.name,
        })
        return this.executeToolViaChat(request)
      }
      throw error
    }
  }

  private async executeToolViaChat(request: ZeroClawToolRequest): Promise<ZeroClawToolResponse> {
    const prompt = `Execute the tool "${request.name}" with the following arguments: ${JSON.stringify(request.args, null, 2)}. Return only the output of the command, nothing else.`

    const chatResponse = await this.chat({
      message: prompt,
    })

    return {
      success: true,
      output: chatResponse.reply,
      exitCode: 0,
      memoryUsed: "N/A",
      duration: "N/A",
    }
  }

  async health(): Promise<ZeroClawHealthResponse> {
    const response = await this.request("/health", { method: "GET" })
    return response as unknown as ZeroClawHealthResponse
  }

  async status(): Promise<ZeroClawStatusResponse> {
    const response = await this.request("/estop/status", { method: "GET" })
    return response as unknown as ZeroClawStatusResponse
  }

  async estopEngage(level: string): Promise<void> {
    await this.request("/estop/engage", {
      method: "POST",
      body: JSON.stringify({ level }),
    })
  }

  async estopRelease(otp: string): Promise<void> {
    await this.request("/estop/release", {
      method: "POST",
      body: JSON.stringify({ otp }),
    })
  }

  private async request(path: string, options: RequestInit = {}): Promise<Record<string, unknown>> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(`${this.url}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new ZeroClawError(errorText, response.status)
      }

      return response.json()
    } catch (error) {
      if (error instanceof ZeroClawError) throw error
      if (error instanceof Error && error.name === "AbortError") {
        throw new ZeroClawError(`Request timeout after ${this.timeout}ms`, 408)
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}

let client: ZeroClawClient | undefined

export async function getClient(): Promise<ZeroClawClient | undefined> {
  if (client) return client

  const { Env } = await import("../env")
  const { Config } = await import("../config/config")

  let url = Env.get("ZEROCLAW_URL")
  let token = Env.get("ZEROCLAW_TOKEN")
  let autoStart = Env.get("ZEROCLAW_AUTO_START") === "true"
  let startPort = parseInt(Env.get("ZEROCLAW_START_PORT") ?? "42617")

  if (!url || !token) {
    const config = await Config.get()
    const zeroclawConfig = config.zeroclaw
    if (!zeroclawConfig?.enabled || !zeroclawConfig?.url || !zeroclawConfig?.token) {
      return undefined
    }
    url = zeroclawConfig.url
    token = zeroclawConfig.token
    autoStart = zeroclawConfig.autoStart ?? autoStart
    startPort = zeroclawConfig.startPort ?? startPort
  }

  client = new ZeroClawClient({ url, token })

  const isRunning = await checkIfRunning(url, token)
  if (isRunning) {
    log.info("zeroclaw_already_running", { url })
    return client
  }

  if (autoStart) {
    log.info("zeroclaw_not_running_attempting_start", { url, startPort })
    const started = await tryStartZeroClaw(startPort)
    if (started) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const afterStart = await checkIfRunning(url, token)
      if (afterStart) {
        log.info("zeroclaw_started_successfully", { url })
        return client
      }
    }
    log.warn("zeroclaw_auto_start_failed", { url })
  }

  client = undefined
  return undefined
}

async function checkIfRunning(url: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/health`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

async function tryStartZeroClaw(port: number): Promise<boolean> {
  try {
    const { spawn } = await import("child_process")

    const proc = spawn("zeroclaw", ["--port", String(port)], {
      stdio: "ignore",
      detached: true,
    })
    proc.unref()

    log.info("zeroclaw_spawned", { port, pid: proc.pid })
    return true
  } catch (error) {
    log.error("zeroclaw_spawn_failed", { error: String(error) })
    return false
  }
}
