import { Tool } from "../tool/tool"
import { Memory } from "../memory/service"
import z from "zod"

export const MemorySearchTool: Tool.Info<typeof params> = {
  id: "memory_search",
  init: async () => ({
    description: "Search permanent memories from past sessions for relevant learnings and patterns",
    parameters: params,
    async execute(args, ctx) {
      const limit = args.maxResults ?? 5
      const results = await Memory.getRelevantMemories(args.query, { limit })

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
