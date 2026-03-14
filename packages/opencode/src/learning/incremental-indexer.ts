import { Bus } from "@/bus"
import { FileWatcher } from "@/file/watcher"
import { vector_memory } from "./learning.sql"
import { Database } from "../storage/db"
import { eq } from "drizzle-orm"
import { Log } from "../util/log"
import { readFile } from "fs/promises"
import { resolve, dirname } from "path"
import { glob } from "glob"
import { embedWithDimensions } from "./embed-utils"

const log = Log.create({ service: "incremental-indexer" })

const EMBEDDING_MODEL = "text-embedding-v4"
const EMBEDDING_DIMENSIONS = 1536

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

function generateNodeId(relativePath: string, packageName: string): string {
  const isIndex = relativePath === "index.ts"
  return isIndex ? `mod_${packageName}` : `file_${relativePath.replace(".ts", "").replace(/\//g, "_")}`
}

export class IncrementalIndexer {
  private pending = new Map<string, "add" | "change" | "delete">()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private debounceMs = 5000
  private srcDir: string = ""
  private packageName: string = ""
  private subscribed = false

  configure(srcDir: string, packageName: string) {
    this.srcDir = srcDir
    this.packageName = packageName
    log.info("configured", { srcDir, packageName })
  }

  start() {
    if (this.subscribed) {
      log.warn("already_started")
      return
    }

    Bus.subscribe(
      FileWatcher.Event.Updated,
      (event: { type: string; properties: { file: string; event: "add" | "change" | "unlink" } }) => {
        this.handleFileEvent(event.properties)
      },
    )

    this.subscribed = true
    log.info("started")
  }

  stop() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.pending.clear()
    this.subscribed = false
    log.info("stopped")
  }

  private handleFileEvent(event: { file: string; event: "add" | "change" | "unlink" }) {
    if (!this.isCodeFile(event.file)) return
    if (!this.isInSrcDir(event.file)) return

    const dbEvent = event.event === "unlink" ? "delete" : event.event
    this.pending.set(event.file, dbEvent as "add" | "change" | "delete")
    this.scheduleFlush()

    log.debug("file_event_queued", { file: event.file, event: dbEvent })
  }

  private isCodeFile(filePath: string): boolean {
    return filePath.endsWith(".ts") && !filePath.includes(".test.") && !filePath.includes(".d.ts")
  }

  private isInSrcDir(filePath: string): boolean {
    if (!this.srcDir) return true
    return filePath.startsWith(this.srcDir)
  }

  private scheduleFlush() {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => this.flush(), this.debounceMs)
  }

  async flush() {
    this.flushTimer = null
    if (this.pending.size === 0) return

    const changes = new Map(this.pending)
    this.pending.clear()

    log.info("flushing_changes", { count: changes.size })

    let added = 0
    let updated = 0
    let deleted = 0

    for (const [file, event] of changes) {
      try {
        if (event === "delete") {
          await this.removeFromIndex(file)
          deleted++
        } else {
          const exists = await this.existsInIndex(file)
          if (event === "add" || !exists) {
            await this.addToIndex(file)
            added++
          } else {
            await this.updateInIndex(file)
            updated++
          }
        }
      } catch (error) {
        log.error("failed_to_process_file", { file, event, error: String(error) })
      }
    }

    log.info("flush_complete", { added, updated, deleted })
  }

  private async existsInIndex(filePath: string): Promise<boolean> {
    const relativePath = filePath.replace(this.srcDir + "/", "")
    const nodeId = generateNodeId(relativePath, this.packageName)

    const sqlite = Database.raw()
    const result = sqlite.query(`SELECT id FROM vector_memory WHERE node_id = ?`).get(nodeId)

    return !!result
  }

  private async addToIndex(filePath: string) {
    const content = await readFile(filePath, "utf-8")
    const relativePath = filePath.replace(this.srcDir + "/", "")
    const nodeId = generateNodeId(relativePath, this.packageName)

    const exports = extractExports(content)
    const purpose = extractPurpose(content)
    const contentText = `${relativePath}: ${purpose}. Exports: ${exports.join(", ")}`

    const vector = await embedWithDimensions({
      model: EMBEDDING_MODEL,
      value: contentText,
      dimensions: EMBEDDING_DIMENSIONS,
    })
    const embedding = Array.from(vector)
    const now = Date.now()

    const metadata = JSON.stringify({
      file: relativePath,
      fullPath: filePath,
      exports: exports.slice(0, 20),
      purpose,
      lineCount: content.split("\n").length,
    })

    const sqlite = Database.raw()
    sqlite.run(
      `INSERT OR REPLACE INTO vector_memory (id, node_type, node_id, entity_title, vector_type, embedding, model, dimensions, metadata, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nodeId,
        "file",
        nodeId,
        relativePath,
        "code",
        JSON.stringify(embedding),
        `dashscope/${EMBEDDING_MODEL}`,
        EMBEDDING_DIMENSIONS,
        metadata,
        now,
        now,
      ],
    )

    log.debug("indexed_file", { file: relativePath, nodeId })
  }

  private async updateInIndex(filePath: string) {
    const content = await readFile(filePath, "utf-8")
    const relativePath = filePath.replace(this.srcDir + "/", "")
    const nodeId = generateNodeId(relativePath, this.packageName)
    const exports = extractExports(content)
    const purpose = extractPurpose(content)
    const contentText = `${relativePath}: ${purpose}. Exports: ${exports.join(", ")}`

    const vector = await embedWithDimensions({
      model: EMBEDDING_MODEL,
      value: contentText,
      dimensions: EMBEDDING_DIMENSIONS,
    })
    const embedding = Array.from(vector)
    const now = Date.now()

    const metadata = JSON.stringify({
      file: relativePath,
      fullPath: filePath,
      exports: exports.slice(0, 20),
      purpose,
      lineCount: content.split("\n").length,
    })

    const sqlite = Database.raw()
    sqlite.run(
      `UPDATE vector_memory SET embedding = ?, model = ?, dimensions = ?, metadata = ?, time_updated = ? WHERE node_id = ?`,
      [JSON.stringify(embedding), `dashscope/${EMBEDDING_MODEL}`, EMBEDDING_DIMENSIONS, metadata, now, nodeId],
    )

    log.debug("updated_file_index", { file: relativePath, nodeId })
  }

  private async removeFromIndex(filePath: string) {
    const relativePath = filePath.replace(this.srcDir + "/", "")
    const nodeId = generateNodeId(relativePath, this.packageName)

    const sqlite = Database.raw()
    sqlite.run(`DELETE FROM vector_memory WHERE node_id = ?`, [nodeId])

    log.debug("removed_file_index", { file: relativePath, nodeId })
  }

  async rebuildFullIndex() {
    if (!this.srcDir) {
      log.error("src_dir_not_configured")
      return { indexed: 0 }
    }

    const files = await glob(`${this.srcDir}/**/*.ts`, {
      ignore: ["**/*.test.ts", "**/*.d.ts", "**/node_modules/**"],
    })

    log.info("full_rebuild_started", { fileCount: files.length })

    for (const file of files) {
      try {
        const exists = await this.existsInIndex(file)
        if (exists) {
          await this.updateInIndex(file)
        } else {
          await this.addToIndex(file)
        }
      } catch (error) {
        log.error("rebuild_file_error", { file, error: String(error) })
      }
    }

    log.info("full_rebuild_complete", { indexed: files.length })
    return { indexed: files.length }
  }
}

export const incrementalIndexer = new IncrementalIndexer()
