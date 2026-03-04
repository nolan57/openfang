import { Tool } from "./tool"
import { runLearning } from "../learning/command"
import { defaultLearningConfig } from "../learning/config"
import { EvolutionTrigger } from "../learning/evolution-trigger"
import { EvolutionExecutor } from "../learning/evolution-executor"
import { ConsistencyChecker } from "../learning/consistency-checker"
import { KnowledgeGraph } from "../learning/knowledge-graph"
import { Safety } from "../learning/safety"
import z from "zod"

export const LearningTool = Tool.define("learning", async () => {
  return {
    description: "Trigger AI self-learning to collect, analyze, and generate insights from web sources.",
    parameters: z.object({
      topics: z
        .array(z.string())
        .optional()
        .describe("Custom topics to learn about (default: AI, code generation, agent systems)"),
      sources: z
        .array(z.enum(["search", "arxiv", "github"]))
        .optional()
        .describe("Sources to collect from (default: search, arxiv, github)"),
      max_items: z.number().optional().describe("Maximum items to collect per run (default: 10)"),
    }),
    async execute(args: any, ctx: any) {
      const config = {
        topics: args.topics ?? defaultLearningConfig.topics,
        sources: args.sources ?? defaultLearningConfig.sources,
        max_items_per_run: args.max_items ?? defaultLearningConfig.max_items_per_run,
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
        .enum(["full", "execute", "status", "check", "trigger", "monitor"])
        .optional()
        .default("full")
        .describe("Evolution mode"),
      topics: z.array(z.string()).optional().describe("Custom topics"),
    }),
    async execute(args: any, ctx: any) {
      const mode = args.mode ?? "full"
      const graph = new KnowledgeGraph()
      const safety = new Safety()

      if (mode === "status") {
        const stats = await graph.getStats()
        const safetyCheck = await safety.checkCooldown()
        const trigger = new EvolutionTrigger()
        const status = await trigger.getStatus()

        return {
          title: "Evolution Status",
          output: `📊 Knowledge Graph: ${stats.nodes} nodes, ${stats.edges} edges\n\n🛡️ Safety: ${safetyCheck.allowed ? "Ready" : "Cooldown active"}\n\n⏱️ Last check: ${status.last_check ? new Date(status.last_check).toLocaleString() : "Never"}\n\n📋 Pending tasks: ${status.pending_tasks}`,
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
        await ctx.ask({
          permission: "evolve",
          patterns: args.topics ?? defaultLearningConfig.topics,
          always: [],
          metadata: { mode },
        })

        const trigger = new EvolutionTrigger()
        const result = await trigger.checkAndTrigger()

        return {
          title: "Evolution Trigger",
          output: `🔄 Evolution Complete\n\nTasks created: ${result.tasks_created}\nTasks pending: ${result.tasks_pending}`,
          metadata: {} as any,
        }
      }

      if (mode === "execute") {
        const executor = new EvolutionExecutor()
        const results = await executor.executeAll()

        const success = results.filter((r) => r.success).length
        const failed = results.filter((r) => !r.success).length

        return {
          title: "Evolution Execute",
          output: `⚡ Execution Complete\n\nTotal: ${results.length}\n✅ Success: ${success}\n❌ Failed: ${failed}`,
          metadata: {} as any,
        }
      }

      if (mode === "monitor") {
        const trigger = new EvolutionTrigger()
        trigger.startMonitoring(60000)

        return {
          title: "Evolution Monitor",
          output: `📡 Monitor started (checking every 60s)\n\nUse /evolve --status to check progress`,
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
