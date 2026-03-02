import z from "zod"
import { Tool } from "../tool/tool"
import { getClient } from "./client"
import { ToolRouter } from "./router"
import { Log } from "../util/log"

const log = Log.create({ service: "zeroclaw.tools" })

async function executeViaZeroClaw(
  name: string,
  args: Record<string, unknown>,
): Promise<{ title: string; output: string; metadata: Record<string, unknown> }> {
  const client = await getClient()
  if (!client) {
    return {
      title: "ZeroClaw Not Available",
      output:
        "ZeroClaw is not configured. Please set ZEROCLAW_URL and ZEROCLAW_TOKEN environment variables or configure in opencode.json.",
      metadata: {},
    }
  }

  const security = await ToolRouter.getSecurityConfig()

  try {
    const result = await client.executeTool({
      name,
      args,
      securityPolicy: security.policy,
    })

    return {
      title: `ZeroClaw: ${name}`,
      output: result.output,
      metadata: {
        success: result.success,
        exitCode: result.exitCode,
        memoryUsed: result.memoryUsed,
        duration: result.duration,
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error("ZeroClaw tool execution failed", { tool: name, error: message })
    return {
      title: `ZeroClaw: ${name} (Failed)`,
      output: `Error: ${message}`,
      metadata: { error: message },
    }
  }
}

export namespace ZeroClawTools {
  export const ShellTool = Tool.define("zeroclaw_shell", async () => {
    const parameters = z.object({
      command: z.string().describe("Shell command to execute"),
    })

    const description = "Execute a shell command via ZeroClaw backend"

    const execute = async (args: z.infer<typeof parameters>, _ctx: Tool.Context) => {
      const shouldRoute = await ToolRouter.shouldRoute("shell")
      if (!shouldRoute) {
        return {
          title: "Shell",
          output: "Shell tool is not routed to ZeroClaw. Use native shell tool instead.",
          metadata: {} as Record<string, unknown>,
        }
      }
      return executeViaZeroClaw("shell", { command: args.command })
    }

    return { description, parameters, execute }
  })

  export const FileReadTool = Tool.define("zeroclaw_file_read", async () => {
    const parameters = z.object({
      path: z.string().describe("File path to read"),
    })

    const description = "Read a file via ZeroClaw backend"

    const execute = async (args: z.infer<typeof parameters>, _ctx: Tool.Context) => {
      const shouldRoute = await ToolRouter.shouldRoute("file_read")
      if (!shouldRoute) {
        return {
          title: "File Read",
          output: "File tool is not routed to ZeroClaw. Use native read tool instead.",
          metadata: {} as Record<string, unknown>,
        }
      }
      return executeViaZeroClaw("file_read", { path: args.path })
    }

    return { description, parameters, execute }
  })

  export const FileWriteTool = Tool.define("zeroclaw_file_write", async () => {
    const parameters = z.object({
      path: z.string().describe("File path to write"),
      content: z.string().describe("Content to write"),
    })

    const description = "Write content to a file via ZeroClaw backend"

    const execute = async (args: z.infer<typeof parameters>, _ctx: Tool.Context) => {
      const shouldRoute = await ToolRouter.shouldRoute("file_write")
      if (!shouldRoute) {
        return {
          title: "File Write",
          output: "File tool is not routed to ZeroClaw. Use native write tool instead.",
          metadata: {} as Record<string, unknown>,
        }
      }
      return executeViaZeroClaw("file_write", { path: args.path, content: args.content })
    }

    return { description, parameters, execute }
  })

  export const HttpRequestTool = Tool.define("zeroclaw_http_request", async () => {
    const parameters = z.object({
      url: z.string().describe("URL to request"),
      method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET").describe("HTTP method"),
      headers: z.record(z.string(), z.string()).optional().describe("Request headers"),
      body: z.string().optional().describe("Request body"),
    })

    const description = "Make an HTTP request via ZeroClaw backend"

    const execute = async (args: z.infer<typeof parameters>, _ctx: Tool.Context) => {
      const shouldRoute = await ToolRouter.shouldRoute("http_request")
      if (!shouldRoute) {
        return {
          title: "HTTP Request",
          output: "HTTP tool is not routed to ZeroClaw. Use native webfetch tool instead.",
          metadata: {} as Record<string, unknown>,
        }
      }
      return executeViaZeroClaw("http_request", {
        url: args.url,
        method: args.method,
        headers: args.headers,
        body: args.body,
      })
    }

    return { description, parameters, execute }
  })

  export const MemoryStoreTool = Tool.define("zeroclaw_memory_store", async () => {
    const parameters = z.object({
      key: z.string().describe("Memory key"),
      value: z.string().describe("Memory value"),
    })

    const description = "Store a memory in ZeroClaw backend"

    const execute = async (args: z.infer<typeof parameters>, _ctx: Tool.Context) => {
      const shouldRoute = await ToolRouter.shouldRoute("memory_store")
      if (!shouldRoute) {
        return {
          title: "Memory Store",
          output: "Memory tool is not routed to ZeroClaw. Use native memory tool instead.",
          metadata: {} as Record<string, unknown>,
        }
      }
      return executeViaZeroClaw("memory_store", { key: args.key, value: args.value })
    }

    return { description, parameters, execute }
  })

  export const MemoryRecallTool = Tool.define("zeroclaw_memory_recall", async () => {
    const parameters = z.object({
      query: z.string().describe("Memory query"),
    })

    const description = "Recall a memory from ZeroClaw backend"

    const execute = async (args: z.infer<typeof parameters>, _ctx: Tool.Context) => {
      const shouldRoute = await ToolRouter.shouldRoute("memory_recall")
      if (!shouldRoute) {
        return {
          title: "Memory Recall",
          output: "Memory tool is not routed to ZeroClaw. Use native memory search instead.",
          metadata: {} as Record<string, unknown>,
        }
      }
      return executeViaZeroClaw("memory_recall", { query: args.query })
    }

    return { description, parameters, execute }
  })

  export const StatusTool = Tool.define("zeroclaw_status", async () => {
    const parameters = z.object({})

    const description = "Get ZeroClaw backend status and resource usage"

    const execute = async (_args: z.infer<typeof parameters>, _ctx: Tool.Context) => {
      const client = await getClient()
      if (!client) {
        return {
          title: "ZeroClaw Status",
          output:
            "ZeroClaw is not configured. Please set ZEROCLAW_URL and ZEROCLAW_TOKEN environment variables or configure in opencode.json.",
          metadata: {} as Record<string, unknown>,
        }
      }

      try {
        const [health, status] = await Promise.all([client.health(), client.status().catch(() => null)])

        const output = [
          `Status: ${health.status}`,
          `Version: ${health.version}`,
          `Uptime: ${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m`,
          `Memory: ${health.memory_usage}`,
          `Available Tools: ${health.available_tools.length}`,
        ]

        if (status) {
          output.push(
            "",
            "--- Security ---",
            `E-Stop Enabled: ${status.estop.enabled}`,
            `E-Stop Level: ${status.estop.level}`,
            `E-Stop Engaged: ${status.estop.engaged}`,
            `Sandbox: ${status.sandbox}`,
          )
        }

        return {
          title: "ZeroClaw Status",
          output: output.join("\n"),
          metadata: {
            status: health.status,
            version: health.version,
            uptime: health.uptime,
            memory: health.memory_usage,
            tools: health.available_tools,
            estop: status?.estop,
          } as Record<string, unknown>,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          title: "ZeroClaw Status (Error)",
          output: `Failed to get status: ${message}`,
          metadata: { error: message } as Record<string, unknown>,
        }
      }
    }

    return { description, parameters, execute }
  })

  export const EStopTool = Tool.define("zeroclaw_estop", async () => {
    const parameters = z.object({
      action: z.enum(["status", "engage", "release"]).describe("E-Stop action"),
      level: z
        .enum(["none", "tool-freeze", "domain-block", "network-kill", "kill-all"])
        .optional()
        .describe("E-Stop level (for engage action)"),
      otp: z.string().optional().describe("One-time password (for release action)"),
    })

    const description = "Control ZeroClaw emergency stop (estop)"

    const execute = async (args: z.infer<typeof parameters>, _ctx: Tool.Context) => {
      const client = await getClient()
      if (!client) {
        return {
          title: "ZeroClaw E-Stop",
          output:
            "ZeroClaw is not configured. Please set ZEROCLAW_URL and ZEROCLAW_TOKEN environment variables or configure in opencode.json.",
          metadata: {} as Record<string, unknown>,
        }
      }

      try {
        switch (args.action) {
          case "status": {
            const status = await client.status()
            return {
              title: "ZeroClaw E-Stop Status",
              output: `Enabled: ${status.estop.enabled}\nLevel: ${status.estop.level}\nEngaged: ${status.estop.engaged}`,
              metadata: { ...status.estop } as Record<string, unknown>,
            }
          }
          case "engage": {
            if (!args.level) {
              return {
                title: "ZeroClaw E-Stop",
                output: "Error: level is required for engage action",
                metadata: { error: "level_required" } as Record<string, unknown>,
              }
            }
            await client.estopEngage(args.level)
            return {
              title: "ZeroClaw E-Stop Engaged",
              output: `E-Stop engaged at level: ${args.level}`,
              metadata: { level: args.level, engaged: true } as Record<string, unknown>,
            }
          }
          case "release": {
            if (!args.otp) {
              return {
                title: "ZeroClaw E-Stop",
                output: "Error: OTP is required for release action",
                metadata: { error: "otp_required" } as Record<string, unknown>,
              }
            }
            await client.estopRelease(args.otp)
            return {
              title: "ZeroClaw E-Stop Released",
              output: "E-Stop has been released",
              metadata: { engaged: false } as Record<string, unknown>,
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          title: "ZeroClaw E-Stop (Error)",
          output: `Error: ${message}`,
          metadata: { error: message } as Record<string, unknown>,
        }
      }
    }

    return { description, parameters, execute }
  })
}
