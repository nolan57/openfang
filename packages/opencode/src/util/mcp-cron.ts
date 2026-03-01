import { spawn } from "child_process"
import path from "path"
import { Global } from "../global"
import { Filesystem } from "./filesystem"
import { Log } from "./log"

const log = Log.create({ service: "mcp-cron" })

const MCP_CRON_PATH = "/Users/lpcw/Documents/opencode-mcp-cron/dist/index.js"
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
    return parseInt(content.trim(), 10)
  } catch {
    return null
  }
}

async function savePid(pid: number): Promise<void> {
  await Filesystem.write(PID_FILE, String(pid))
}

export async function checkAndStartMcpCron(): Promise<{ started: boolean; pid?: number }> {
  const storedPid = await getStoredPid()
  if (storedPid && (await isRunning(storedPid))) {
    log.info("mcp-cron already running", { pid: storedPid })
    return { started: false, pid: storedPid }
  }

  const mcpCron = spawn("node", [MCP_CRON_PATH], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: {
      ...process.env,
      OPENCODE_DATA_DIR: Global.Path.data,
    },
  })

  mcpCron.unref()

  mcpCron.stderr?.on("data", (chunk) => {
    log.info("mcp-cron: " + chunk.toString().trim())
  })

  mcpCron.on("error", (err) => {
    log.error("mcp-cron error", { error: err.message })
  })

  await savePid(mcpCron.pid!)

  log.info("mcp-cron started", { pid: mcpCron.pid })

  return { started: true, pid: mcpCron.pid }
}
