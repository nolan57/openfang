import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Global } from "../../global"
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"
import { Registry, Coordinator } from "../../collab"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "../../util/filesystem"
import matter from "gray-matter"
import { Instance } from "../../project/instance"
import { EOL } from "os"
import type { Argv } from "yargs"

type AgentMode = "all" | "primary" | "subagent"

const AVAILABLE_TOOLS = [
  "bash",
  "read",
  "write",
  "edit",
  "list",
  "glob",
  "grep",
  "webfetch",
  "task",
  "todowrite",
  "todoread",
]

const AgentCreateCommand = cmd({
  command: "create",
  describe: "create a new agent",
  builder: (yargs: Argv) =>
    yargs
      .option("path", {
        type: "string",
        describe: "directory path to generate the agent file",
      })
      .option("description", {
        type: "string",
        describe: "what the agent should do",
      })
      .option("mode", {
        type: "string",
        describe: "agent mode",
        choices: ["all", "primary", "subagent"] as const,
      })
      .option("tools", {
        type: "string",
        describe: `comma-separated list of tools to enable (default: all). Available: "${AVAILABLE_TOOLS.join(", ")}"`,
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const cliPath = args.path
        const cliDescription = args.description
        const cliMode = args.mode as AgentMode | undefined
        const cliTools = args.tools

        const isFullyNonInteractive = cliPath && cliDescription && cliMode && cliTools !== undefined

        if (!isFullyNonInteractive) {
          UI.empty()
          prompts.intro("Create agent")
        }

        const project = Instance.project

        // Determine scope/path
        let targetPath: string
        if (cliPath) {
          targetPath = path.join(cliPath, "agent")
        } else {
          let scope: "global" | "project" = "global"
          if (project.vcs === "git") {
            const scopeResult = await prompts.select({
              message: "Location",
              options: [
                {
                  label: "Current project",
                  value: "project" as const,
                  hint: Instance.worktree,
                },
                {
                  label: "Global",
                  value: "global" as const,
                  hint: Global.Path.config,
                },
              ],
            })
            if (prompts.isCancel(scopeResult)) throw new UI.CancelledError()
            scope = scopeResult
          }
          targetPath = path.join(
            scope === "global" ? Global.Path.config : path.join(Instance.worktree, ".opencode"),
            "agent",
          )
        }

        // Get description
        let description: string
        if (cliDescription) {
          description = cliDescription
        } else {
          const query = await prompts.text({
            message: "Description",
            placeholder: "What should this agent do?",
            validate: (x) => (x && x.length > 0 ? undefined : "Required"),
          })
          if (prompts.isCancel(query)) throw new UI.CancelledError()
          description = query
        }

        // Generate agent
        const spinner = prompts.spinner()
        spinner.start("Generating agent configuration...")
        const model = args.model ? Provider.parseModel(args.model) : undefined
        const generated = await Agent.generate({ description, model }).catch((error) => {
          spinner.stop(`LLM failed to generate agent: ${error.message}`, 1)
          if (isFullyNonInteractive) process.exit(1)
          throw new UI.CancelledError()
        })
        spinner.stop(`Agent ${generated.identifier} generated`)

        // Select tools
        let selectedTools: string[]
        if (cliTools !== undefined) {
          selectedTools = cliTools ? cliTools.split(",").map((t) => t.trim()) : AVAILABLE_TOOLS
        } else {
          const result = await prompts.multiselect({
            message: "Select tools to enable (Space to toggle)",
            options: AVAILABLE_TOOLS.map((tool) => ({
              label: tool,
              value: tool,
            })),
            initialValues: AVAILABLE_TOOLS,
          })
          if (prompts.isCancel(result)) throw new UI.CancelledError()
          selectedTools = result
        }

        // Get mode
        let mode: AgentMode
        if (cliMode) {
          mode = cliMode
        } else {
          const modeResult = await prompts.select({
            message: "Agent mode",
            options: [
              {
                label: "All",
                value: "all" as const,
                hint: "Can function in both primary and subagent roles",
              },
              {
                label: "Primary",
                value: "primary" as const,
                hint: "Acts as a primary/main agent",
              },
              {
                label: "Subagent",
                value: "subagent" as const,
                hint: "Can be used as a subagent by other agents",
              },
            ],
            initialValue: "all" as const,
          })
          if (prompts.isCancel(modeResult)) throw new UI.CancelledError()
          mode = modeResult
        }

        // Build tools config
        const tools: Record<string, boolean> = {}
        for (const tool of AVAILABLE_TOOLS) {
          if (!selectedTools.includes(tool)) {
            tools[tool] = false
          }
        }

        // Build frontmatter
        const frontmatter: {
          description: string
          mode: AgentMode
          tools?: Record<string, boolean>
        } = {
          description: generated.whenToUse,
          mode,
        }
        if (Object.keys(tools).length > 0) {
          frontmatter.tools = tools
        }

        // Write file
        const content = matter.stringify(generated.systemPrompt, frontmatter)
        const filePath = path.join(targetPath, `${generated.identifier}.md`)

        await fs.mkdir(targetPath, { recursive: true })

        if (await Filesystem.exists(filePath)) {
          if (isFullyNonInteractive) {
            console.error(`Error: Agent file already exists: ${filePath}`)
            process.exit(1)
          }
          prompts.log.error(`Agent file already exists: ${filePath}`)
          throw new UI.CancelledError()
        }

        await Filesystem.write(filePath, content)

        if (isFullyNonInteractive) {
          console.log(filePath)
        } else {
          prompts.log.success(`Agent created: ${filePath}`)
          prompts.outro("Done")
        }
      },
    })
  },
})

const AgentListCommand = cmd({
  command: "list",
  describe: "list all available agents",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const agents = await Agent.list()
        const sortedAgents = agents.sort((a, b) => {
          if (a.native !== b.native) {
            return a.native ? -1 : 1
          }
          return a.name.localeCompare(b.name)
        })

        for (const agent of sortedAgents) {
          process.stdout.write(`${agent.name} (${agent.mode})` + EOL)
          process.stdout.write(`  ${JSON.stringify(agent.permission, null, 2)}` + EOL)
        }
      },
    })
  },
})

export const AgentCommand = cmd({
  command: "agent",
  describe: "manage agents",
  builder: (yargs) =>
    yargs.command(AgentCreateCommand).command(AgentListCommand).command(CollabAgentCommand).demandCommand(),
  async handler() {},
})

const CollabListCommand = cmd({
  command: "list",
  describe: "list collaborative agents",
  async handler() {
    const agents = await Registry.list()
    if (agents.length === 0) {
      console.log("No collaborative agents registered")
      return
    }
    for (const agent of agents) {
      console.log(`${agent.name} [${agent.type}] - ${agent.state}`)
      console.log(`  ID: ${agent.id}`)
      console.log(`  Role: ${agent.role}`)
      console.log(`  Capabilities: ${agent.capabilities.join(", ")}`)
      console.log()
    }
  },
})

const CollabAddCommand = cmd({
  command: "add <name>",
  describe: "register a new collaborative agent",
  builder: (yargs: Argv) =>
    yargs
      .option("type", {
        type: "string",
        describe: "agent type",
        choices: ["build", "review", "test", "explore", "general", "custom"] as const,
        default: "general",
      })
      .option("role", {
        type: "string",
        describe: "agent role",
        choices: ["coordinator", "worker", "specialist"] as const,
        default: "worker",
      })
      .option("capabilities", {
        type: "string",
        describe: "comma-separated capabilities",
      }),
  async handler(args) {
    const name = args.name as string
    const type = args.type as "build" | "review" | "test" | "explore" | "general" | "custom"
    const role = args.role as "coordinator" | "worker" | "specialist"
    const capabilities = args.capabilities ? (args.capabilities as string).split(",") : []

    await Registry.register({
      id: crypto.randomUUID(),
      name,
      type,
      role,
      state: "idle",
      capabilities,
      config: {
        model: { providerID: "openai", modelID: "gpt-4" },
        tools: [],
        permission: {},
      },
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    })

    console.log(`Agent "${name}" registered successfully`)
  },
})

const CollabRemoveCommand = cmd({
  command: "remove <agentId>",
  describe: "unregister a collaborative agent",
  async handler(args) {
    const agentId = args.agentId as string
    await Registry.unregister(agentId)
    console.log(`Agent "${agentId}" removed`)
  },
})

const CollabStatusCommand = cmd({
  command: "status [agentId]",
  describe: "show agent status",
  async handler(args) {
    if (args.agentId) {
      const agent = await Registry.get(args.agentId as string)
      if (!agent) {
        console.log("Agent not found")
        return
      }
      console.log(`${agent.name} [${agent.type}] - ${agent.state}`)
      console.log(`  ID: ${agent.id}`)
      console.log(`  Role: ${agent.role}`)
      console.log(`  Capabilities: ${agent.capabilities.join(", ")}`)
      console.log(`  Last active: ${agent.lastActiveAt}`)
    } else {
      const agents = await Registry.list()
      console.log(`Total agents: ${agents.length}`)
      const idle = agents.filter((a) => a.state === "idle").length
      const busy = agents.filter((a) => a.state === "busy").length
      console.log(`  Idle: ${idle}, Busy: ${busy}`)
    }
  },
})

export const CollabAgentCommand = cmd({
  command: "collab",
  describe: "manage collaborative agents",
  builder: (yargs) =>
    yargs
      .command(CollabListCommand)
      .command(CollabAddCommand)
      .command(CollabRemoveCommand)
      .command(CollabStatusCommand)
      .demandCommand(),
  async handler() {},
})
