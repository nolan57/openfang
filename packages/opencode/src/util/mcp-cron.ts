import { spawn } from "child_process"
import path from "path"
import { Global } from "../global"
import { Filesystem } from "./filesystem"
import { Log } from "./log"
import { Config } from "../config/config"

const log = Log.create({ service: "mcp-cron" })

const PID_FILE = path.join(Global.Path.data, "mcp-cron.pid")

async function isRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function getStoredPid(): Promise<number | null> {
  try {
    const content = await Filesystem.readText(PID_FILE)
    const pid = parseInt(content.trim(), 10)
    if (isNaN(pid) || pid <= 0) return null
    return pid
  } catch {
    return null
  }
}

async function savePid(pid: number): Promise<void> {
  await Filesystem.write(PID_FILE, String(pid))
}

async function clearPid(): Promise<void> {
  try {
    await Bun.file(PID_FILE).unlink()
  } catch {
    // ignore
  }
}

/**
 * Start mcp-cron process
 * 
 * @param serverUrl - Optional OpenCode server URL for in-process execution
 *                    If not provided, mcp-cron will use fallback process execution
 */
export async function checkAndStartMcpCron(serverUrl?: string): Promise<{ started: boolean; pid?: number; skipped?: boolean; error?: string }> {
  // Read mcpCronPath from global config (root level)
  const globalConfig = await Config.getGlobal()
  const mcpCronPath = globalConfig.mcpCronPath

  if (!mcpCronPath) {
    log.debug("mcp-cron path not configured, skipping")
    return { started: false, skipped: true }
  }

  // Check if mcpCronPath exists
  if (!(await Filesystem.exists(mcpCronPath))) {
    log.warn("mcp-cron path does not exist", { path: mcpCronPath })
    return { started: false, error: `mcp-cron path not found: ${mcpCronPath}` }
  }

  // Check if mcp-cron is already running
  const storedPid = await getStoredPid()
  if (storedPid) {
    const running = await isRunning(storedPid)
    if (running) {
      log.info("mcp-cron already running", { pid: storedPid })
      return { started: false, pid: storedPid, skipped: true }
    } else {
      // PID file exists but process is dead, clean up
      log.info("mcp-cron PID file stale, cleaning up", { pid: storedPid })
      await clearPid()
    }
  }

  // Build environment variables for mcp-cron
  const env: Record<string, string | undefined> = {
    ...process.env,
    OPENCODE_DATA_DIR: Global.Path.data,
  }

  // Pass server URL if available (for in-process execution)
  if (serverUrl) {
    env.OPENCODE_SERVER_URL = serverUrl
    log.info("passing server URL to mcp-cron", { url: serverUrl })
  }

  // Try to start mcp-cron
  let mcpCron: ReturnType<typeof spawn>
  try {
    mcpCron = spawn("node", [mcpCronPath], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: env as Record<string, string>,
    })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    log.error("mcp-cron spawn failed", { error: errorMsg, path: mcpCronPath })
    return { started: false, error: errorMsg }
  }

  // Handle spawn errors (file not executable, etc.)
  mcpCron.on("error", (err) => {
    log.error("mcp-cron error", { error: err.message })
  })

  // Check if process started successfully
  await new Promise<void>((resolve) => {
    mcpCron.on("spawn", () => resolve())
    mcpCron.on("error", () => resolve())
    // Timeout after 2 seconds
    setTimeout(() => resolve(), 2000)
  })

  // Verify process is running
  if (!mcpCron.pid || !(await isRunning(mcpCron.pid))) {
    log.error("mcp-cron failed to start", { path: mcpCronPath })
    return { started: false, error: "mcp-cron process failed to start" }
  }

  mcpCron.unref()

  mcpCron.stderr?.on("data", (chunk) => {
    log.info("mcp-cron: " + chunk.toString().trim())
  })

  // Save PID
  await savePid(mcpCron.pid)

  log.info("mcp-cron started", { pid: mcpCron.pid, path: mcpCronPath, serverUrl: serverUrl || "none" })

  return { started: true, pid: mcpCron.pid }
}
