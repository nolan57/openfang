import { Tool } from "./tool"
import { runLearning } from "../learning/command"
import { defaultLearningConfig } from "../learning/config"
import { EvolutionTrigger } from "../learning/evolution-trigger"
import { EvolutionExecutor } from "../learning/evolution-executor"
import { ConsistencyChecker } from "../learning/consistency-checker"
import { KnowledgeGraph } from "../learning/knowledge-graph"
import { Safety } from "../learning/safety"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import path from "path"
import z from "zod"

const log = Log.create({ service: "evolve-tool" })

export const LearningTool = Tool.define("learning", async () => {
  return {
    description: "Trigger AI self-learning to collect, analyze, and generate insights from web sources.",
    parameters: z.object({
      topics: z
        .array(z.string())
        .optional()
        .describe("Custom topics to learn about (default: from config evolution.directions)"),
      sources: z
        .array(z.enum(["search", "arxiv", "github", "blogs", "pypi"]))
        .optional()
        .describe("Sources to collect from (default: from config evolution.sources)"),
      max_items: z.number().optional().describe("Maximum items to collect per run (default: 10)"),
    }),
    async execute(args: any, ctx: any) {
      const cfg = await Config.get()
      const evolution = cfg.evolution ?? {} as NonNullable<typeof cfg.evolution>
      const configTopics = evolution.directions ?? defaultLearningConfig.topics
      const configSources = evolution.sources ?? defaultLearningConfig.sources

      const config = {
        topics: args.topics ?? configTopics,
        sources: args.sources ?? configSources,
        max_items_per_run: args.max_items ?? evolution.maxItemsPerRun ?? defaultLearningConfig.max_items_per_run,
      }

      await ctx.ask({
        permission: "learning",
        patterns: config.topics as string[],
        always: [],
        metadata: config,
      })

      const result = await runLearning(config as any)

      const output = result.success
        ? `Learning run completed!\n\n- Collected: ${result.collected} items\n- Notes created: ${result.notes}\n- Skills installed: ${result.installs}\n- Code suggestions: ${result.suggestions}`
        : `Learning run failed: ${result.error}`

      return {
        title: "Learning Results",
        output,
        metadata: {} as any,
      }
    },
  }
})

export const EvolveTool = Tool.define("evolve", async () => {
  return {
    description: "Trigger OpenCode self-evolution system - collect, analyze, and evolve",
    parameters: z.object({
      mode: z
        .enum(["full", "execute", "status", "check", "trigger", "monitor", "spec", "tasks"])
        .optional()
        .describe("Evolution mode (default: full)"),
      topics: z.array(z.string()).optional().describe("Custom topics (default: from config evolution.directions)"),
      spec_file: z.string().optional().describe("Path to specification document (markdown/json) to implement"),
    }),
    async execute(args: any, ctx: any) {
      const mode = args.mode ?? "full"
      const graph = new KnowledgeGraph()
      const safety = new Safety()
      const cfg = await Config.get()
      const evolution = cfg.evolution ?? {} as NonNullable<typeof cfg.evolution>
      const configTopics = evolution.directions ?? defaultLearningConfig.topics

      if (mode === "status") {
        const stats = await graph.getStats()
        const safetyCheck = await safety.checkCooldown()
        const trigger = new EvolutionTrigger()
        const status = await trigger.getStatus()

        return {
          title: "Evolution Status",
          output: `📊 Knowledge Graph: ${stats.nodes} nodes, ${stats.edges} edges\n\n🛡️ Safety: ${safetyCheck.allowed ? "Ready" : "Cooldown active"}\n\n⏱️ Last check: ${status.last_check ? new Date(status.last_check).toLocaleString() : "Never"}\n\n📋 Pending tasks: ${status.pending_tasks}\n\n📋 Directions: ${configTopics.join(", ")}`,
          metadata: {} as any,
        }
      }

      if (mode === "check") {
        const checker = new ConsistencyChecker()
        const report = await checker.runFullCheck()

        return {
          title: "Consistency Check",
          output: `✅ Consistency Check Complete\n\nTotal nodes: ${report.total_nodes}\nTotal edges: ${report.total_edges}\n\nIssues:\n- Conflicts: ${report.summary.conflicts}\n- Outdated: ${report.summary.outdated}\n- Orphans: ${report.summary.orphans}\n- Redundant: ${report.summary.redundant}\n- Constraint violations: ${report.summary.constraint_violations}`,
          metadata: {} as any,
        }
      }

      if (mode === "trigger" || mode === "full") {
        const trigger = new EvolutionTrigger()

        await ctx.ask({
          permission: "evolve",
          patterns: args.topics ?? configTopics,
          always: [],
          metadata: { mode },
        })

        const verbose = mode === "full"
        log.info("evolve_tool_executing", { mode, verbose, topics: args.topics ?? configTopics })
        const result = await trigger.checkAndTrigger(verbose)

        let output = mode === "full" ? `🚀 Full Evolution Cycle Complete\n\n` : `🔄 Evolution Check Complete\n\n`

        if (result.steps && result.steps.length > 0) {
          output += `📋 Execution Steps:\n`
          output += result.steps.map((s) => `  ${s}`).join("\n")
          output += `\n\n`
        }

        output += `📊 Results:\n`
        output += `- Tasks created: ${result.tasks_created}\n`
        output += `- Tasks pending: ${result.tasks_pending}\n`

        if (result.cooldown_active) {
          output += `\n⏸️  Cooldown is active\n`
        }

        if (result.circuit_breaker_active) {
          output += `\n⚠️  Circuit breaker is active\n`
        }

        if (result.errors.length > 0) {
          output += `\n❌ Errors:\n${result.errors.map((e) => `  - ${e}`).join("\n")}\n`
        }

        return {
          title: mode === "full" ? "Full Evolution Cycle" : "Evolution Trigger",
          output,
          metadata: { result } as any,
        }
      }

      if (mode === "execute") {
        const executor = new EvolutionExecutor()

        let output = "⚡ Starting evolution task execution...\n\n"

        const results = await executor.executeAll()

        const success = results.filter((r) => r.success).length
        const failed = results.filter((r) => !r.success).length

        output += `📊 Execution Summary:\n`
        output += `- Total tasks: ${results.length}\n`
        output += `- ✅ Successful: ${success}\n`
        output += `- ❌ Failed: ${failed}\n\n`

        if (results.length > 0) {
          output += `📋 Task Details:\n`
          for (const r of results) {
            const status = r.success ? "✅" : "❌"
            const rollback = r.rolled_back ? " (rolled back)" : ""
            output += `${status} ${r.task_id}: ${r.duration_ms}ms${rollback}\n`
            if (!r.success) {
              output += `   Error: ${r.output}\n`
            }
          }
        }

        if (failed > 0) {
          output += `\n⚠️ Failed tasks:\n`
          results
            .filter((r) => !r.success)
            .forEach((r) => {
              output += `  - ${r.task_id}: ${r.output}\n`
            })
        }

        return {
          title: "Evolution Execute",
          output,
          metadata: { results } as any,
        }
      }

      if (mode === "monitor") {
        const trigger = new EvolutionTrigger()
        trigger.startMonitoring(60000)

        return {
          title: "Evolution Monitor",
          output: `📡 Monitor started (checking every 60s)

Use /evolve --status to check progress`,
          metadata: {} as any,
        }
      }

      if (mode === "tasks") {
        const { Deployer } = await import("../learning/deployer")
        const deployer = new Deployer()
        const tasks = await deployer.getPendingTasks()

        if (tasks.length === 0) {
          return {
            title: "Evolution Tasks",
            output: "No pending tasks",
            metadata: {} as any,
          }
        }

        const taskList = tasks
          .map(
            (t: any) =>
              `- **${t.id}**: ${t.title}\n  Type: ${t.type}\n  Status: ${t.status}\n  Created: ${new Date(t.created_at).toLocaleString()}\n  Files: ${t.changes?.files?.join(", ") || "N/A"}`,
          )
          .join("\n\n")

        return {
          title: "Pending Evolution Tasks",
          output: `Found ${tasks.length} pending task(s):\n\n${taskList}`,
          metadata: { tasks } as any,
        }
      }

      if (mode === "spec") {
        if (!args.spec_file) {
          return {
            title: "Evolution Spec",
            output: "Error: --spec-file required for spec mode",
            metadata: {} as any,
          }
        }

        await ctx.ask({
          permission: "evolve",
          patterns: ["spec implementation"],
          always: [],
          metadata: { spec_file: args.spec_file },
        })

        const { runLearning } = await import("../learning/command")
        const result = await runLearning({ spec_file: args.spec_file })

        return {
          title: "Evolution Spec",
          output: result.success
            ? `✅ Spec Implementation Complete\n\nFiles created: ${result.suggestions}`
            : `❌ Spec Implementation Failed: ${result.error}`,
          metadata: {} as any,
        }
      }

      return {
        title: "Evolution",
        output: "Unknown mode",
        metadata: {} as any,
      }
    },
  }
})

export const EvolutionConfigTool = Tool.define("evolution-config", async () => {
  return {
    description: "Configure self-evolution direction keywords",
    parameters: z.object({
      action: z.enum(["get", "set", "add", "remove"]).describe("Action to perform"),
      directions: z.array(z.string()).optional().describe("Evolution direction keywords (for set/add)"),
      sources: z
        .array(z.enum(["search", "arxiv", "github", "blogs", "pypi"]))
        .optional()
        .describe("Data sources to collect from"),
    }),
    async execute(args: any, ctx: any) {
      const cfg = await Config.get()
      const evolution = cfg.evolution ?? {} as NonNullable<typeof cfg.evolution>
      const currentDirections = evolution.directions ?? defaultLearningConfig.topics
      const currentSources = evolution.sources ?? defaultLearningConfig.sources

      if (args.action === "get") {
        return {
          title: "Evolution Config",
          output: `📋 Evolution Directions:\n${currentDirections.map((d: string) => `  - ${d}`).join("\n")}\n\n🔍 Sources: ${currentSources.join(", ")}\n\n🟢 Enabled: ${evolution.enabled ?? true}`,
          metadata: {} as any,
        }
      }

      if (args.action === "set") {
        const newDirections = args.directions ?? currentDirections
        const newSources = args.sources ?? currentSources
        const configPath = path.join(Instance.directory, "opencode.jsonc")

        let configText = await Bun.file(configPath)
          .text()
          .catch(() => "{}")
        const config = JSON.parse(configText.replace(/^\/\/.*$/gm, "").replace(/\/\/.*$/gm, ""))

        config.evolution = {
          ...config.evolution,
          directions: newDirections,
          sources: newSources,
        }

        await Bun.write(configPath, JSON.stringify(config, null, 2))

        return {
          title: "Evolution Config Updated",
          output: `✅ Updated evolution directions:\n${newDirections.map((d: string) => `  - ${d}`).join("\n")}\n\nSources: ${newSources.join(", ")}`,
          metadata: {} as any,
        }
      }

      if (args.action === "add") {
        const toAdd = args.directions ?? []
        const newDirections = [...new Set([...currentDirections, ...toAdd])]
        const configPath = path.join(Instance.directory, "opencode.jsonc")

        let configText = await Bun.file(configPath)
          .text()
          .catch(() => "{}")
        const config = JSON.parse(configText.replace(/^\/\/.*$/gm, "").replace(/\/\/.*$/gm, ""))

        config.evolution = {
          ...config.evolution,
          directions: newDirections,
        }

        await Bun.write(configPath, JSON.stringify(config, null, 2))

        return {
          title: "Evolution Directions Added",
          output: `✅ Added directions:\n${toAdd.map((d: string) => `  + ${d}`).join("\n")}\n\nTotal directions: ${newDirections.length}`,
          metadata: {} as any,
        }
      }

      if (args.action === "remove") {
        const toRemove = args.directions ?? []
        const newDirections = currentDirections.filter((d: string) => !toRemove.includes(d))
        const configPath = path.join(Instance.directory, "opencode.jsonc")

        let configText = await Bun.file(configPath)
          .text()
          .catch(() => "{}")
        const config = JSON.parse(configText.replace(/^\/\/.*$/gm, "").replace(/\/\/.*$/gm, ""))

        config.evolution = {
          ...config.evolution,
          directions: newDirections,
        }

        await Bun.write(configPath, JSON.stringify(config, null, 2))

        return {
          title: "Evolution Directions Removed",
          output: `✅ Removed directions:\n${toRemove.map((d: string) => `  - ${d}`).join("\n")}\n\nRemaining: ${newDirections.length}`,
          metadata: {} as any,
        }
      }

      return {
        title: "Evolution Config",
        output: "Unknown action",
        metadata: {} as any,
      }
    },
  }
})
