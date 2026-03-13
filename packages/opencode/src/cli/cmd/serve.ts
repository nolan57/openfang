import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { checkAndStartMcpCron } from "../../util/mcp-cron"
import { Log } from "../../util/log"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    // Start mcp-cron with server URL for in-process execution
    const mcpCronResult = await checkAndStartMcpCron(server.url.toString())
    if (mcpCronResult.started) {
      Log.Default.info("mcp-cron started", { pid: mcpCronResult.pid })
    }

    await new Promise(() => {})
    await server.stop()
  },
})
