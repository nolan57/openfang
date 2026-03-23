#!/usr/bin/env bun

/**
 * ZeroClaw Self-Evolution Initialization Script
 * 
 * This script initializes the self-evolution foundation by:
 * 1. Generating project overview (ZeroClaw #1)
 * 2. Generating module summaries (ZeroClaw #2)
 * 3. Building vector index
 * 
 * Usage: bun run script/zeroclaw-init.ts
 */

import { glob } from "glob"
import { readFile, writeFile, mkdir, access } from "fs/promises"
import { resolve, dirname, relative } from "path"
import { ZeroClawClient } from "../packages/opencode/src/zeroclaw/client"
import { VectorStore } from "../packages/opencode/src/learning/vector-store"
import { Database } from "../packages/opencode/src/storage/db"
import * as sqliteVec from "sqlite-vec"

const PROJECT_DIR = resolve(__dirname, "..")
const SUMMARY_DIR = resolve(PROJECT_DIR, ".opencode/memory/summaries")
const OVERVIEW_FILE = resolve(PROJECT_DIR, ".opencode/memory/project-overview.json")

const ZEROCLAW_URL = process.env.ZEROCLAW_URL || "http://localhost:45000"
const ZEROCLAW_TOKEN = process.env.ZEROCLAW_TOKEN || "default"
const MAX_PARALLEL = 4

// Module directories to process
const MODULE_DIRS = [
  "packages/opencode/src/session",
  "packages/opencode/src/tool",
  "packages/opencode/src/learning",
  "packages/opencode/src/storage",
  "packages/opencode/src/evolution",
  "packages/opencode/src/provider",
  "packages/opencode/src/agent",
  "packages/opencode/src/cli",
  "packages/app/src",
]

const PROJECT_OVERVIEW_PROMPT = `You are ZeroClaw Instance #1. Your task is to analyze the project at ${PROJECT_DIR}.

Read all package.json files to understand the monorepo structure.
Identify tech stack: languages, frameworks, key libraries.
Understand architecture: how do packages relate to each other?
List key capabilities and known gaps.

Output ONLY valid JSON with this structure:
{
  "project_name": "opencode",
  "language": "typescript",
  "framework": ["framework1", "framework2"],
  "architecture": "description of overall architecture",
  "key_modules": ["module1", "module2", "module3"],
  "capabilities": ["capability1", "capability2"],
  "dependencies": {
    "runtime": ["bun"],
    "ai": ["openai", "anthropic"],
    "storage": ["sqlite", "drizzle-orm"]
  },
  "known_gaps": ["gap1", "gap2"],
  "recent_changes": ["change1", "change2"]
}`

const MODULE_SUMMARY_PROMPT = `You are ZeroClaw Instance #2. Your task is to generate summaries for all TypeScript files in the directory.

For each .ts file in the directory, generate a JSON entry with:
{
  "file": "relative/path/to/file.ts",
  "module": "module name",
  "purpose": "1-2 sentence description",
  "key_functions": [{"name": "functionName", "purpose": "one line purpose"}],
  "dependencies": ["import1", "import2"],
  "public_api": ["export1", "export2"],
  "complexity": "low|medium|high"
}

Output ONLY a JSON array of these entries.`

console.log("🚀 Starting ZeroClaw Self-Evolution Initialization\n")

// Initialize ZeroClaw client
const client = new ZeroClawClient({
  url: ZEROCLAW_URL,
  token: ZEROCLAW_TOKEN,
  timeout: 120000,
  autoStart: true,
})

// Initialize VectorStore
let vectorStore: VectorStore

async function init() {
  try {
    // Check ZeroClaw health
    console.log("📡 Checking ZeroClaw connection...")
    const health = await client.health()
    console.log(`   ✓ ZeroClaw connected (v${health.version})\n`)

    // Ensure directories exist
    await mkdir(dirname(OVERVIEW_FILE), { recursive: true })
    await mkdir(SUMMARY_DIR, { recursive: true })

    // Initialize database and load sqlite-vec extension
    console.log("🗄️  Initializing database with sqlite-vec...")
    try {
      const db = Database.Client()
      sqliteVec.load(db)
      console.log("   ✓ sqlite-vec extension loaded\n")
    } catch (error) {
      console.log("   ⚠ Failed to load sqlite-vec:", String(error).slice(0, 50))
    }

    // Initialize vector store
    console.log("🗄️  Initializing vector store...")
    try {
      vectorStore = new VectorStore()
      await vectorStore.init()
      console.log("   ✓ Vector store initialized\n")
    } catch (error) {
      console.log("   ⚠ Vector store unavailable:", String(error).slice(0, 50), "\n")
      vectorStore = null
    }

    // Phase 1: Project Overview
    await generateProjectOverview()

    // Phase 2: Module Summaries
    await generateModuleSummaries()

    // Phase 3: Build Vector Index
    await buildVectorIndex()

    console.log("\n✅ Self-evolution initialization complete!")
    console.log(`   - Project overview: ${OVERVIEW_FILE}`)
    console.log(`   - Module summaries: ${SUMMARY_DIR}`)
    console.log(`   - Vector index: sqlite-vec`)

  } catch (error) {
    console.error("\n❌ Initialization failed:", error)
    process.exit(1)
  }
}

async function generateProjectOverview() {
  console.log("📋 Phase 1: Generating Project Overview...")

  try {
    // Read key files for context
    const packageJson = await readFile(resolve(PROJECT_DIR, "package.json"), "utf-8").catch(() => "{}")
    const readme = await readFile(resolve(PROJECT_DIR, "README.md"), "utf-8").catch(() => "").then((r) => r.slice(0, 2000))

    const response = await client.chat({
      message: PROJECT_OVERVIEW_PROMPT,
      context: [
        `package.json:\n${packageJson.slice(0, 3000)}`,
        `README:\n${readme}`,
      ],
    })

    let overview
    try {
      overview = JSON.parse(response.reply)
    } catch {
      // Try to extract JSON from response
      const match = response.reply.match(/\{[\s\S]*\}/)
      if (match) {
        overview = JSON.parse(match[0])
      } else {
        throw new Error("Could not parse overview JSON")
      }
    }

    await writeFile(OVERVIEW_FILE, JSON.stringify(overview, null, 2))
    console.log(`   ✓ Project overview generated`)
    console.log(`   - Project: ${overview.project_name}`)
    console.log(`   - Modules: ${overview.key_modules?.join(", ") || "N/A"}`)

  } catch (error) {
    console.error("   ✗ Failed to generate project overview:", error)
    // Create a basic overview as fallback
    const fallback = {
      project_name: "opencode",
      language: "typescript",
      framework: ["hono", "solid-js", "drizzle"],
      architecture: "Monorepo with multiple packages",
      key_modules: ["session", "tool", "learning", "storage"],
      capabilities: ["code editing", "LLM integration", "self-evolution"],
      known_gaps: [],
      recent_changes: [],
    }
    await writeFile(OVERVIEW_FILE, JSON.stringify(fallback, null, 2))
  }
}

async function generateModuleSummaries() {
  console.log("\n📋 Phase 2: Generating Module Summaries...")

  for (const dir of MODULE_DIRS) {
    const dirPath = resolve(PROJECT_DIR, dir)
    
    try {
      await access(dirPath)
    } catch {
      console.log(`   ⚠ Skipping ${dir} (not found)`)
      continue
    }

    console.log(`   Processing: ${dir}...`)

    // Get all TypeScript files in this directory
    const files = await glob(`${dir}/**/*.ts`, {
      cwd: PROJECT_DIR,
      ignore: ["**/node_modules/**", "**/dist/**", "**/*.test.ts"],
    })

    if (files.length === 0) {
      console.log(`   - No TypeScript files found`)
      continue
    }

    console.log(`   - Found ${files.length} files`)

    // Process files in chunks
    const chunks = chunkArray(files, Math.ceil(files.length / MAX_PARALLEL))
    
    const allSummaries: any[] = []

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      console.log(`     Processing chunk ${i + 1}/${chunks.length}...`)

      const chunkSummaries = await processFileChunk(chunk, dir)
      allSummaries.push(...chunkSummaries)
    }

    // Save summaries for this module
    const outputFile = resolve(SUMMARY_DIR, `${dir.replace(/\//g, "-")}.json`)
    await writeFile(outputFile, JSON.stringify(allSummaries, null, 2))
    console.log(`   ✓ Saved ${allSummaries.length} summaries to ${relative(PROJECT_DIR, outputFile)}`)
  }
}

async function processFileChunk(files: string[], moduleDir: string): Promise<any[]> {
  const summaries: any[] = []

  for (const file of files) {
    try {
      const filePath = resolve(PROJECT_DIR, file)
      const content = await readFile(filePath, "utf-8")

      // Truncate content if too large
      const truncatedContent = content.slice(0, 8000)

      const response = await client.chat({
        message: `${MODULE_SUMMARY_PROMPT}\n\nFile: ${file}\n\nContent:\n${truncatedContent}`,
      })

      // Try to parse the response
      let parsed
      try {
        parsed = JSON.parse(response.reply)
      } catch {
        const match = response.reply.match(/\[[\s\S]*\]/)
        if (match) {
          parsed = JSON.parse(match[0])
        }
      }

      if (Array.isArray(parsed)) {
        summaries.push(...parsed.map((p: any) => ({ ...p, file, module: moduleDir })))
      } else if (parsed && typeof parsed === "object") {
        summaries.push({ ...parsed, file, module: moduleDir })
      }

    } catch (error) {
      console.warn(`     ⚠ Failed to process ${file}:`, String(error).slice(0, 50))
    }
  }

  return summaries
}

async function buildVectorIndex() {
  console.log("\n📋 Phase 3: Building Vector Index...")

  try {
    // Read all summary files
    const summaryFiles = await glob(`${SUMMARY_DIR}/*.json`)

    let totalIndexed = 0

    for (const summaryFile of summaryFiles) {
      const content = await readFile(summaryFile, "utf-8")
      const summaries = JSON.parse(content)

      for (const summary of summaries) {
        try {
          const title = `${summary.file}: ${summary.purpose || summary.module || ""}`
          await vectorStore.embedAndStore({
            node_type: "module_summary",
            node_id: summary.file,
            entity_title: title,
            vector_type: "code",
            metadata: summary,
          })
          totalIndexed++
        } catch (error) {
          // Ignore individual indexing errors
        }
      }
    }

    console.log(`   ✓ Indexed ${totalIndexed} module summaries into vector store`)

  } catch (error) {
    console.error("   ✗ Failed to build vector index:", error)
  }
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

// Run the initialization
init()