import { Log } from "../util/log"
import { getClient } from "./client"
import { ToolRouter } from "./router"

const log = Log.create({ service: "zeroclaw.controller" })

export interface UpdateOptions {
  version?: string
  channel?: "stable" | "beta" | "nightly"
}

export interface DeployConfig {
  host: string
  platform: "linux-x64" | "linux-arm64" | "linux-armv7"
  auth: {
    type: "ssh"
    user?: string
    keyFile: string
  }
  security: {
    policy: "supervised" | "read_only" | "full"
    estopEnabled: boolean
  }
}

export interface UpdateResult {
  success: boolean
  version?: string
  target: string
  error?: string
}

export interface RestartResult {
  success: boolean
  target: string
  error?: string
}

export interface DeployResult {
  success: boolean
  target: string
  platform: string
  endpoint?: string
  error?: string
}

export class ZeroClawController {
  private shellExec: (command: string) => Promise<{ stdout: string; stderr: string; code: number }>

  constructor(shellExec?: (command: string) => Promise<{ stdout: string; stderr: string; code: number }>) {
    this.shellExec = shellExec ?? this.defaultShellExec
  }

  private async defaultShellExec(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    const process = Bun.spawn(["sh", "-c", command])
    const stdout = await new Response(process.stdout).text()
    const stderr = await new Response(process.stderr).text()
    const code = await process.exited
    return { stdout, stderr, code }
  }

  async update(target: "local" | string, options?: UpdateOptions): Promise<UpdateResult> {
    const version = options?.version ?? "latest"
    const channel = options?.channel ?? "stable"

    log.info("Updating ZeroClaw", { target, version, channel })

    try {
      if (target === "local") {
        await this.updateLocal(version)
      } else {
        await this.updateRemote(target, version)
      }

      await this.restart(target)

      return { success: true, version, target }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("ZeroClaw update failed", { target, error: message })
      return { success: false, target, error: message }
    }
  }

  private async updateLocal(version: string): Promise<void> {
    const releaseUrl =
      version === "latest"
        ? "https://github.com/zeroclaw-labs/zeroclaw/releases/latest/download/zeroclaw"
        : `https://github.com/zeroclaw-labs/zeroclaw/releases/download/${version}/zeroclaw`

    const result = await this.shellExec(`
      curl -L "${releaseUrl}" -o /tmp/zeroclaw && 
      chmod +x /tmp/zeroclaw && 
      sudo mv /tmp/zeroclaw $(which zeroclaw)
    `)

    if (result.code !== 0) {
      throw new Error(`Failed to update ZeroClaw: ${result.stderr}`)
    }
  }

  private async updateRemote(host: string, version: string): Promise<void> {
    const releaseUrl =
      version === "latest"
        ? "https://github.com/zeroclaw-labs/zeroclaw/releases/latest/download/zeroclaw"
        : `https://github.com/zeroclaw-labs/zeroclaw/releases/download/${version}/zeroclaw`

    const result = await this.shellExec(`
      ssh ${host} "curl -L '${releaseUrl}' -o /tmp/zeroclaw && sudo mv /tmp/zeroclaw \\$(which zeroclaw)"
    `)

    if (result.code !== 0) {
      throw new Error(`Failed to update remote ZeroClaw: ${result.stderr}`)
    }
  }

  async restart(target: "local" | string): Promise<RestartResult> {
    log.info("Restarting ZeroClaw", { target })

    try {
      if (target === "local") {
        await this.restartLocal()
      } else {
        await this.restartRemote(target)
      }

      await this.waitForHealth(target)

      return { success: true, target }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("ZeroClaw restart failed", { target, error: message })
      return { success: false, target, error: message }
    }
  }

  private async restartLocal(): Promise<void> {
    const platform = process.platform

    if (platform === "darwin") {
      const result = await this.shellExec("launchctl stop com.zeroclaw.daemon 2>/dev/null || true")
      await new Promise((r) => setTimeout(r, 1000))
      await this.shellExec("launchctl start com.zeroclaw.daemon 2>/dev/null || true")
    } else if (platform === "linux") {
      await this.shellExec(
        "sudo systemctl restart zeroclaw 2>/dev/null || sudo service zeroclaw restart 2>/dev/null || true",
      )
    } else {
      await this.shellExec("zeroclaw daemon &")
    }
  }

  private async restartRemote(host: string): Promise<void> {
    const result = await this.shellExec(
      `ssh ${host} "sudo systemctl restart zeroclaw 2>/dev/null || zeroclaw daemon &"`,
    )

    if (result.code !== 0) {
      throw new Error(`Failed to restart remote ZeroClaw: ${result.stderr}`)
    }
  }

  async deploy(config: DeployConfig): Promise<DeployResult> {
    const { host, platform, auth, security } = config

    log.info("Deploying ZeroClaw", { host, platform })

    try {
      const binaryUrl = `https://github.com/zeroclaw-labs/zeroclaw/releases/latest/download/zeroclaw-${platform}`

      const sshOpts = auth.keyFile ? `-i ${auth.keyFile}` : ""
      const sshUser = auth.user ? `${auth.user}@` : ""

      await this.shellExec(`
        scp ${sshOpts} ./target/release/zeroclaw ${sshUser}${host}:/tmp/zeroclaw
        ssh ${sshOpts} ${sshUser}${host} "sudo mv /tmp/zeroclaw /usr/local/bin/ && sudo chmod +x /usr/local/bin/zeroclaw"
      `)

      const configContent = this.generateConfig(security)
      await this.shellExec(`
        ssh ${sshOpts} ${sshUser}${host} "echo '${configContent}' | sudo tee /etc/zeroclaw/config.toml"
      `)

      await this.shellExec(`
        ssh ${sshOpts} ${sshUser}${host} "sudo zeroclaw daemon --config /etc/zeroclaw/config.toml &"
      `)

      const endpoint = `http://${host}:42617`
      await this.waitForHealthRemote(host)

      return { success: true, target: host, platform, endpoint }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("ZeroClaw deployment failed", { host, error: message })
      return { success: false, target: host, platform, error: message }
    }
  }

  private generateConfig(security: DeployConfig["security"]): string {
    return `[gateway]
port = 42617
require_pairing = false

[security]
sandbox = "landlock"
estop_enabled = ${security.estopEnabled}
`.trim()
  }

  async getStatus(target: string = "local"): Promise<{
    status: string
    version: string
    uptime: number
    memory: string
    tools: string[]
  }> {
    const client = await getClient()
    if (!client) {
      throw new Error("ZeroClaw client not configured")
    }

    const health = await client.health()
    return {
      status: health.status,
      version: health.version,
      uptime: health.uptime,
      memory: health.memory_usage,
      tools: health.available_tools,
    }
  }

  private async waitForHealth(target: string, timeout: number = 30000): Promise<void> {
    const client = await getClient()
    if (!client) {
      throw new Error("ZeroClaw client not configured")
    }

    const start = Date.now()
    while (Date.now() - start < timeout) {
      try {
        await client.health()
        return
      } catch {
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
    throw new Error(`ZeroClaw health check timeout for ${target}`)
  }

  private async waitForHealthRemote(host: string, timeout: number = 30000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      const result = await this.shellExec(`curl -s -o /dev/null -w "%{http_code}" http://${host}:42617/health`)
      if (result.stdout.trim() === "200") {
        return
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error(`ZeroClaw health check timeout for remote ${host}`)
  }

  async rollingUpdate(
    hosts: string[],
    options?: UpdateOptions,
    onProgress?: (current: number, total: number, host: string, success: boolean) => void,
  ): Promise<{ success: number; failed: number; results: UpdateResult[] }> {
    const results: UpdateResult[] = []
    let success = 0
    let failed = 0

    for (let i = 0; i < hosts.length; i++) {
      const host = hosts[i]
      const result = await this.update(host, options)

      results.push(result)

      if (result.success) {
        success++
      } else {
        failed++
        log.warn("Rolling update: host failed, continuing", { host, error: result.error })
      }

      onProgress?.(i + 1, hosts.length, host, result.success)
    }

    return { success, failed, results }
  }
}

let controller: ZeroClawController | undefined

export function getController(): ZeroClawController {
  if (!controller) {
    controller = new ZeroClawController()
  }
  return controller
}
