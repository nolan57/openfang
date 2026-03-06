import { Tool } from "./tool"
import { glob } from "glob"
import { readFile } from "fs/promises"
import { resolve } from "path"
import { Database } from "../storage/db"
import { vector_memory } from "../learning/learning.sql"
import { eq } from "drizzle-orm"
import z from "zod"

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash)
}

function simpleEmbedding(text: string, dimensions: number = 384): number[] {
  const words = text.toLowerCase().split(/\W+/)
  const wordFreq: Record<string, number> = {}

  for (const word of words) {
    if (word.length > 2) {
      wordFreq[word] = (wordFreq[word] || 0) + 1
    }
  }

  const hash1 = hashString(text)
  const hash2 = hashString(text.split("").reverse().join(""))

  const embedding: number[] = []
  for (let i = 0; i < dimensions; i++) {
    const posHash = hashString(text + i)
    const freqSum = Object.values(wordFreq).reduce((a, b) => a + b, 0)

    const value =
      Math.sin(hash1 * (i + 1) * 0.1) * 0.3 +
      Math.cos(hash2 * (i + 1) * 0.1) * 0.3 +
      (freqSum > 0
        ? (Object.entries(wordFreq).reduce((sum, [w, f]) => sum + Math.sin(hashString(w) * (i + 1) * 0.01) * f, 0) /
            freqSum) *
          0.4
        : 0)

    embedding.push(Math.tanh(value))
  }

  const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0))
  if (magnitude === 0) return embedding
  return embedding.map((v) => v / magnitude)
}

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
      const srcDir = resolve(args.packagePath, "src")
      const packageName = args.packagePath.split("/").pop() || "unknown"

      const files = await glob(`${srcDir}/**/*.ts`, {
        ignore: ["**/*.test.ts", "**/*.d.ts", "**/node_modules/**"],
      })

      const entries: Array<{
        node_id: string
        entity_title: string
        node_type: string
        content_text: string
        metadata: Record<string, unknown>
      }> = []

      for (const file of files) {
        try {
          const content = await readFile(file, "utf-8")
          const relativePath = file.replace(srcDir + "/", "")
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

      Database.Client

      const existingCount = Database.use((db) =>
        db.select({ count: vector_memory.id }).from(vector_memory).where(eq(vector_memory.vector_type, "code")).all(),
      ).length

      const now = Date.now()
      let added = 0

      for (const entry of entries) {
        const embedding = simpleEmbedding(entry.content_text)

        try {
          Database.use((db) => {
            db.insert(vector_memory).values({
              id: entry.node_id,
              node_type: entry.node_type,
              node_id: entry.node_id,
              entity_title: entry.entity_title,
              vector_type: "code",
              embedding: JSON.stringify(embedding),
              model: "simple",
              dimensions: embedding.length,
              metadata: JSON.stringify(entry.metadata),
              time_created: now,
              time_updated: now,
            })
          })
          added++
        } catch {}
      }

      const newCount = Database.use((db) =>
        db.select({ count: vector_memory.id }).from(vector_memory).where(eq(vector_memory.vector_type, "code")).all(),
      ).length

      return {
        title: "Code Index Built",
        metadata: { package: packageName, entries: entries.length, added: added, total: newCount },
        output: `Built vector index for ${packageName}. Added ${added} entries. Total code vectors: ${newCount}`,
      }
    },
  }),
}

const params = z.object({
  packagePath: z.string().describe("Path to the package to index (e.g., packages/opencode or packages/plugin-qqbot)"),
  outputMode: z
    .enum(["json", "database"])
    .optional()
    .default("json")
    .describe("Output mode: 'json' for intermediate file, 'database' for direct write"),
})
