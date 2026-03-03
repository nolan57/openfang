import { Tool } from "./tool"
import { runLearning } from "../learning/command"
import { defaultLearningConfig } from "../learning/config"
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
        patterns: config.topics,
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
        metadata: {
          collected: result.collected,
          notes: result.notes,
          installs: result.installs,
          suggestions: result.suggestions,
        },
      }
    },
  }
})
