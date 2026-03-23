import { Tool } from "../tool/tool"
import { Memory } from "../memory/service"
import { Instance } from "../project/instance"
import z from "zod"

export const MemorySearchTool: Tool.Info<typeof params> = {
  id: "memory_search",
  init: async () => ({
    description: "Search permanent memories from past sessions for relevant learnings and patterns",
    parameters: params,
    async execute(args, ctx) {
      const limit = args.maxResults ?? 5

      // [ENH] Target 1: Context-aware filtering
      const projectDir = args.filters?.project_dir ?? Instance.directory
      const memoryTypes = args.filters?.memory_types

      const results = await Memory.getRelevantMemories(args.query, {
        projectDir,
        limit,
        types: memoryTypes,
      })

      // Track which memory IDs were used for potential feedback
      const usedMemoryIds = results.map((m) => `${projectDir}:${m.key}`)

      const output =
        results.length > 0
          ? results.map((m, i) => `${i + 1}. **${m.key}**: ${m.value} (relevance: ${m.relevance.toFixed(2)})`).join("\n")
          : "No relevant memories found."

      return {
        title: "Memory Search",
        metadata: {
          query: args.query,
          count: results.length,
          filters: args.filters,
          usedMemoryIds,
        },
        output,
      }
    },
  }),
}

const params = z.object({
  query: z.string().describe("Search query to find relevant memories"),
  maxResults: z.number().optional().describe("Maximum number of results to return (default: 5)"),
  filters: z
    .object({
      session_id: z.string().optional().describe("Filter by session ID for session-scoped memories"),
      project_dir: z.string().optional().describe("Project directory to search within"),
      memory_types: z
        .array(z.enum(["session", "evolution", "project"]))
        .optional()
        .describe("Filter by memory types"),
    })
    .optional()
    .describe("Optional filters for context-aware memory search"),
})
