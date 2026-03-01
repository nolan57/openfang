import { Tool } from "../tool/tool"
import { Instance } from "../project/instance"
import { getRelevantMemories } from "../evolution/memory"
import { getMemories, incrementMemoryUsage } from "../evolution/store"
import z from "zod"

export const MemorySearchTool: Tool.Info<typeof params> = {
  id: "memory_search",
  init: async () => ({
    description: "Search permanent memories from past sessions for relevant learnings and patterns",
    parameters: params,
    async execute(args, ctx) {
      const memories = await getRelevantMemories(Instance.directory, args.query)
      const limit = args.maxResults ?? 5
      const results = memories.slice(0, limit)

      if (results.length > 0) {
        const allMemories = await getMemories(Instance.directory)
        for (const m of results) {
          const entry = allMemories.find((e) => e.key === m.key)
          if (entry) await incrementMemoryUsage(Instance.directory, entry.id)
        }
      }

      const output =
        results.length > 0
          ? results.map((m, i) => `${i + 1}. **${m.key}**: ${m.value} (relevance: ${m.relevance})`).join("\n")
          : "No relevant memories found."

      return {
        title: "Memory Search",
        metadata: { query: args.query, count: results.length },
        output,
      }
    },
  }),
}

const params = z.object({
  query: z.string().describe("Search query to find relevant memories"),
  maxResults: z.number().optional().describe("Maximum number of results to return (default: 5)"),
})
