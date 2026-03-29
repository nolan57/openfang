import { Tool } from "./tool"
import { glob } from "glob"
import { readFile } from "fs/promises"
import { resolve, join } from "path"
import { Database } from "../storage/db"
import z from "zod"
import { embedWithDimensions } from "../learning/embed-utils"

function extractExports(content: string): string[] {
  const exports: string[] = []

  const namedExportRegex = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g
  let match
  while ((match = namedExportRegex.exec(content)) !== null) {
    exports.push(match[1])
  }

  const defaultExportRegex = /export\s+default\s+(?:function\s+(\w+)|class\s+(\w+)|(\w+))/g
  while ((match = defaultExportRegex.exec(content)) !== null) {
    exports.push(match[1] || match[2] || match[3])
  }

  return exports
}

function extractPurpose(content: string): string {
  const lines = content.split("\n")

  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const line = lines[i].trim()
    if (line.startsWith("/**") || line.startsWith("*") || line.startsWith("/*")) {
      const commentLines: string[] = []
      let j = i
      while (j < lines.length) {
        const l = lines[j]
          .trim()
          .replace(/^\* ?/, "")
          .replace(/^\/\*\*?/, "")
        if (l === "" || l === "*/") break
        commentLines.push(l)
        j++
      }
      if (commentLines.length > 0) {
        return commentLines.join(" ").slice(0, 200)
      }
    }
  }

  const classMatch = content.match(/class\s+(\w+)/)
  if (classMatch) return `Class ${classMatch[1]}`

  const functionMatch = content.match(/(?:function|const|let|var)\s+(\w+)\s*=/)
  if (functionMatch) return `Function ${functionMatch[1]}`

  return "Module file"
}

export const BuildCodeIndexTool: Tool.Info<typeof params> = {
  id: "build_code_index",
  init: async () => ({
    description:
      "Build multi-level vector index for a codebase enabling semantic search across module architecture. Supports generating JSON files or writing directly to database.",
    parameters: params,
    async execute(args, ctx) {
      const baseDir = args.sourceDir ? join(args.packagePath, args.sourceDir) : resolve(args.packagePath, "src")
      const sourceDir = resolve(baseDir)
      const packageName = args.packagePath.split("/").pop() || "unknown"

      const files = await glob(`${sourceDir}/**/*.ts`, {
        ignore: ["**/*.test.ts", "**/*.d.ts", "**/node_modules/**", "**/gen/**"],
      })

      const entries: Array<{
        node_id: string
        entity_title: string
        node_type: string
        vector_type: string
        content_text: string
        metadata: Record<string, unknown>
      }> = []

      for (const file of files) {
        try {
          const content = await readFile(file, "utf-8")
          const relativePath = file.replace(sourceDir + "/", "")
          const exports = extractExports(content)
          const purpose = extractPurpose(content)

          const isIndex = relativePath === "index.ts"
          const moduleName = isIndex
            ? `mod_${packageName}`
            : `file_${relativePath.replace(".ts", "").replace(/\//g, "_")}`

          entries.push({
            node_id: moduleName,
            entity_title: relativePath,
            node_type: isIndex ? "module" : "file",
            vector_type: "code",
            content_text: `${relativePath}: ${purpose}. Exports: ${exports.join(", ")}`,
            metadata: {
              file: relativePath,
              fullPath: file,
              exports: exports.slice(0, 20),
              purpose,
              lineCount: content.split("\n").length,
            },
          })
        } catch {}
      }

      if (args.outputMode === "json") {
        const jsonPath = resolve(args.packagePath, "code-index-vector-entries.json")
        const jsonContent = JSON.stringify(
          {
            format_version: "1.0",
            package: packageName,
            vector_entries: entries,
          },
          null,
          2,
        )

        await Bun.write(jsonPath, jsonContent)

        return {
          title: "Code Index Built",
          metadata: { package: packageName, entries: entries.length, output: jsonPath },
          output: `Built vector index for ${packageName} with ${entries.length} entries. Output: ${jsonPath}`,
        }
      }

      // Write directly to database using raw SQLite
      const sqlite = Database.raw()
      const now = Date.now()
      let added = 0

      // Use DashScope (Alibaba Cloud) embedding with 1536 dimensions
      const dashscopeModel = "text-embedding-v4"
      const embeddingDimensions = 1536

      // 统一配置加载：按优先级读取 explicit > env > dotenv > config-file > default
      const { getEmbeddingApiKey } = await import("../learning/embedding-config-loader")
      const apiKey = await getEmbeddingApiKey()

      if (!apiKey) {
        return {
          title: "Code Index Failed",
          metadata: { error: "DASHSCOPE_API_KEY not set" },
          output: "Error: DASHSCOPE_API_KEY environment variable is required for embedding generation",
        }
      }

      const checkStmt = sqlite.prepare("SELECT 1 FROM vector_memory WHERE id = ?")
      const insertStmt = sqlite.prepare(`
        INSERT INTO vector_memory (id, node_type, node_id, entity_title, vector_type, embedding, model, dimensions, metadata, time_created, time_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      for (const entry of entries) {
        try {
          // Skip if already exists
          const existing = checkStmt.get(entry.node_id)
          if (existing) continue

          const vector = await embedWithDimensions({
            model: dashscopeModel,
            value: entry.content_text,
            dimensions: embeddingDimensions,
            apiKey: apiKey,
          })
          const embedding = Array.from(vector)
          const embeddingJson = JSON.stringify(embedding)
          const metadataJson = JSON.stringify(entry.metadata)

          insertStmt.run(
            entry.node_id,
            entry.node_type,
            entry.node_id,
            entry.entity_title,
            "code",
            embeddingJson,
            `dashscope/${dashscopeModel}`,
            embeddingDimensions,
            metadataJson,
            now,
            now,
          )
          added++
        } catch (error) {
          console.error(`Failed to process ${entry.entity_title}:`, error)
        }
      }

      const totalStmt = sqlite.prepare("SELECT COUNT(*) as cnt FROM vector_memory")
      const newCount = totalStmt.get() as { cnt: number }

      return {
        title: "Code Index Built",
        metadata: { package: packageName, entries: entries.length, added: added, total: newCount.cnt },
        output: `Built vector index for ${packageName}. Added ${added} entries. Total code vectors: ${newCount.cnt}`,
      }
    },
  }),
}

export const params = z.object({
  packagePath: z.string().describe("Path to the package to index (e.g., packages/opencode or packages/plugin-qqbot)"),
  sourceDir: z
    .string()
    .optional()
    .describe("Source directory relative to packagePath (default: 'src', e.g., 'js/src' for SDK)"),
  outputMode: z
    .enum(["json", "database"])
    .optional()
    .default("json")
    .describe("Output mode: 'json' for intermediate file, 'database' for direct write"),
})
