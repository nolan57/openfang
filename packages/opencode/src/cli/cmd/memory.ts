import { cmd } from "./cmd"
import { Memory } from "../../memory"
import { EOL } from "os"
import type { Argv } from "yargs"

const MemoryAddCommand = cmd({
  command: "add <content>",
  describe: "add a memory",
  builder: (yargs: Argv) =>
    yargs
      .option("type", {
        type: "string",
        describe: "memory type",
        choices: ["session", "evolution", "project"] as const,
        default: "evolution",
      })
      .option("session-id", {
        type: "string",
        describe: "session ID (required for session memory)",
      })
      .option("role", {
        type: "string",
        describe: "message role (for session memory)",
        default: "user",
      })
      .option("agent-id", {
        type: "string",
        describe: "agent ID (for session memory)",
      })
      .option("tag", {
        type: "string",
        describe: "tag to add",
      }),
  async handler(args) {
    const content = args.content as string
    const type = args.type as "session" | "evolution" | "project"
    const sessionId = args.sessionId as string | undefined
    const role = args.role as string
    const agentId = args.agentId as string | undefined
    const tag = args.tag as string | undefined

    const results = await Memory.add({
      memoryType: type,
      content,
      metadata: {
        ...(sessionId && { sessionId }),
        ...(role && { role }),
        ...(agentId && { agentId }),
      },
      tags: tag ? [tag] : undefined,
    })

    console.log(`Added ${results.length} memory(ies):`)
    for (const r of results) {
      console.log(`  ${r.id} [${r.type}]`)
    }
  },
})

const MemorySearchCommand = cmd({
  command: "search <query>",
  describe: "search memories",
  builder: (yargs: Argv) =>
    yargs
      .option("type", {
        type: "string",
        describe: "memory type",
        choices: ["session", "evolution", "project", "all"] as const,
        default: "all",
      })
      .option("limit", {
        type: "number",
        describe: "max results",
        default: 10,
      })
      .option("session-id", {
        type: "string",
        describe: "session ID (for session memory)",
      }),
  async handler(args) {
    const query = args.query as string
    const type = args.type as "session" | "evolution" | "project" | "all"
    const limit = args.limit as number
    const sessionId = args.sessionId as string | undefined

    if (type === "all") {
      const [session, evolution, project] = await Promise.all([
        sessionId
          ? Memory.search({ query, memoryType: "session", limit, filters: { sessionId } })
          : Promise.resolve([]),
        Memory.search({ query, memoryType: "evolution", limit }),
        Memory.search({ query, memoryType: "project", limit }),
      ])

      console.log(`Session memories (${session.length}):`)
      for (const m of session) {
        console.log(`  [${m.type}] ${m.content.slice(0, 80)}... (${m.similarity.toFixed(2)})`)
      }
      console.log(EOL + `Evolution memories (${evolution.length}):`)
      for (const m of evolution) {
        console.log(`  [${m.type}] ${m.content.slice(0, 80)}... (${m.similarity.toFixed(2)})`)
      }
      console.log(EOL + `Project memories (${project.length}):`)
      for (const m of project) {
        console.log(`  [${m.type}] ${m.content.slice(0, 80)}... (${m.similarity.toFixed(2)})`)
      }
    } else {
      const results = await Memory.search({
        query,
        memoryType: type,
        limit,
        filters: type === "session" && sessionId ? { sessionId } : undefined,
      })

      console.log(`Found ${results.length} results:`)
      for (const m of results) {
        console.log(`  [${m.type}] ${m.content.slice(0, 80)}...`)
        console.log(`    ID: ${m.id}, Similarity: ${m.similarity.toFixed(2)}`)
        if (m.metadata) {
          console.log(`    Metadata: ${JSON.stringify(m.metadata)}`)
        }
        console.log()
      }
    }
  },
})

const MemorySessionCreateCommand = cmd({
  command: "create",
  describe: "create a new session",
  builder: (yargs: Argv) =>
    yargs.option("agents", {
      type: "string",
      describe: "comma-separated agent IDs",
    }),
  async handler(args) {
    const agents = args.agents ? (args.agents as string).split(",") : []
    const sessionId = await Memory.getSessionService().createSession(agents)
    console.log(`Session created: ${sessionId}`)
  },
})

const MemorySessionListCommand = cmd({
  command: "list",
  describe: "list sessions",
  async handler() {
    const sessions = Memory.getSessionService()
    console.log("Session memory is in-memory only. Use search to query.")
  },
})

export const MemoryCommand = cmd({
  command: "memory",
  describe: "manage memories (session, evolution, project)",
  builder: (yargs) =>
    yargs.command(MemoryAddCommand).command(MemorySearchCommand).command(MemorySessionCommand).demandCommand(),
  async handler() {},
})

const MemorySessionCommand = cmd({
  command: "session",
  describe: "session memory commands",
  builder: (yargs) => yargs.command(MemorySessionCreateCommand).command(MemorySessionListCommand).demandCommand(),
  async handler() {},
})
