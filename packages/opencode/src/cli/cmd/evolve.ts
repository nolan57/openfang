import type { CommandModule } from "yargs"
import * as path from "path"
import { cmd } from "./cmd"
import { getSkillEvolutions, getPromptEvolutions, getMemories } from "../../evolution/store"
import { approveSkill, rejectSkill, getPendingSkills } from "../../evolution/skill"
import { Skill } from "../../skill/skill"
import { createSelfEvolutionScheduler, defaultSelfEvolutionConfig } from "../../learning/self-evolution-scheduler"
import { createHierarchicalMemory } from "../../learning/hierarchical-memory"
import { EvolutionTrigger } from "../../learning/evolution-trigger"
import { KnowledgeGraph } from "../../learning/knowledge-graph"
import { Safety } from "../../learning/safety"
import { Config } from "../../config/config"
import { defaultLearningConfig } from "../../learning/config"
import { runLearning } from "../../learning/command"
import { Instance } from "../../project/instance"
import { Deployer } from "../../learning/deployer"
import { EvolutionExecutor } from "../../learning/evolution-executor"
import { Memory } from "../../memory"

export const EvolveCommand: CommandModule = {
  command: "evolve",
  describe: "Manage self-evolving agent system",
  builder: (yargs) =>
    yargs
      .option("mode", {
        type: "string",
        choices: ["full", "execute", "status", "check", "trigger", "monitor", "spec", "tasks"],
        default: "full",
        describe: "Evolution mode",
      })
      .option("spec-file", {
        type: "string",
        describe: "Path to specification document (markdown/json) to implement",
      })
      .command("list", "List evolution artifacts", {}, listArtifacts)
      .command("reload", "Reload skills cache", {}, reloadSkills)
      .command(
        "approve <skillID>",
        "Approve and create a skill",
        (yargs) => yargs.positional("skillID", { type: "string", demandOption: true }),
        (args) => approveSkillCmd(args.skillID as string),
      )
      .command(
        "reject <skillID>",
        "Reject a skill proposal",
        (yargs) => yargs.positional("skillID", { type: "string", demandOption: true }),
        (args) => rejectSkillCmd(args.skillID as string),
      )
      .command("memories", "List learned memories", {}, listMemories)
      .command("pending", "List pending skill approvals", {}, listPending)
      .command("status", "Show evolution system status", {}, showStatus)
      .command(
        "migrate [path]",
        "Migrate vector_memory to knowledge graph with full code analysis",
        (yargs) =>
          yargs
            .positional("path", { type: "string", default: ".", describe: "Directory to analyze" })
            .option("ext", {
              type: "array",
              default: [".ts", ".tsx", ".js", ".jsx"],
              describe: "File extensions to analyze",
            }),
        (args) => migrateKnowledgeGraph({ path: args.path as string, ext: args.ext as string[] }),
      )
      .command("tasks", "List pending deployment tasks", {}, listTasks)
      // New self-evolution commands
      .command("scan", "Scan and report code issues", {}, scanCode)
      .command("fix", "Auto-fix code issues", {}, fixCode)
      .command("stats", "Show code statistics", {}, codeStats)
      .command("summaries build", "Build module summaries", {}, buildSummaries)
      .command(
        "summaries search <query>",
        "Search module summaries",
        (yargs) => yargs.positional("query", { type: "string", demandOption: true }),
        (args) => searchSummaries(args.query as string),
      )
      .command("overview", "Generate project overview", {}, generateOverview)
      .command(
        "index [path]",
        "Index project files into knowledge graph",
        (yargs) =>
          yargs
            .positional("path", { type: "string", default: ".", describe: "Directory to index" })
            .option("clear", { type: "boolean", default: false, describe: "Clear existing data before indexing" })
            .option("ext", {
              type: "array",
              default: ["ts", "tsx", "js", "jsx"],
              describe: "File extensions to index",
            }),
        (args) => indexProjectFiles(args as any),
      )
      .demandCommand(0, ""),
  handler: async (args: any) => {
    if (args.mode === "spec") {
      if (!args.specFile) {
        console.error("Error: --spec-file is required for spec mode")
        process.exit(1)
      }
      const result = await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          return await runLearning({ spec_file: args.specFile as string })
        },
      })
      if (result.success) {
        console.log(`✅ Spec Implementation Complete\n\nFiles created: ${result.suggestions}`)
      } else {
        console.error(`❌ Spec Implementation Failed: ${result.error}`)
        process.exit(1)
      }
    } else if (args.mode === "execute") {
      const executor = new EvolutionExecutor({ tasksDir: "docs/learning/tasks" })
      const results = await executor.executeAll()
      const success = results.filter((r: any) => r.success).length
      const failed = results.filter((r: any) => !r.success).length
      console.log(`⚡ Execution Complete\n\nTotal: ${results.length}\n✅ Success: ${success}\n❌ Failed: ${failed}`)
    }
  },
}

async function listArtifacts() {
  const dir = process.cwd()
  const [prompts, skills, memories] = await Promise.all([
    getPromptEvolutions(dir),
    getSkillEvolutions(dir),
    getMemories(dir),
  ])

  console.log("\n=== Prompt Optimizations ===")
  console.log(prompts.length, "optimizations")
  for (const p of prompts) {
    console.log(`  - ${p.originalPrompt.slice(0, 40)}... -> ${p.optimizedPrompt.slice(0, 40)}...`)
  }

  console.log("\n=== Generated Skills ===")
  for (const s of skills) {
    console.log(`[${s.status}] ${s.name}: ${s.description}`)
  }

  console.log("\n=== Memories ===")
  console.log(memories.length, "memories")
}

async function reloadSkills() {
  await Skill.reload()
  const skills = await Skill.all()
  console.log(`Reloaded ${skills.length} skills`)
}

async function approveSkillCmd(skillID: string) {
  const dir = process.cwd()
  const skillDir = await approveSkill(dir, skillID)
  if (skillDir) {
    console.log(`Skill created at: ${skillDir}`)
  } else {
    console.log("Skill not found")
  }
}

async function rejectSkillCmd(skillID: string) {
  const dir = process.cwd()
  await rejectSkill(dir, skillID)
  console.log("Skill rejected")
}

async function listMemories() {
  const dir = process.cwd()
  const memories = await getMemories(dir)
  for (const m of memories) {
    console.log(`\n[${m.key}]`)
    console.log(`  ${m.value}`)
    console.log(`  Used ${m.usageCount} times`)
  }
}

async function listPending() {
  const dir = process.cwd()
  const skills = await getPendingSkills(dir)
  console.log("\n=== Pending Skills ===")
  for (const s of skills) {
    console.log(`${s.id}: ${s.name} - ${s.description}`)
  }
}

async function showStatus() {
  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      const cfg = await Config.get()
      const evolution = cfg.evolution ?? {}
      const directions = evolution.directions ?? defaultLearningConfig.topics
      const sources = evolution.sources ?? defaultLearningConfig.sources

      const graph = new KnowledgeGraph()
      const safety = new Safety()
      const trigger = new EvolutionTrigger()

      const [stats, safetyCheck, triggerStatus] = await Promise.all([
        graph.getStats(),
        safety.checkCooldown(),
        trigger.getStatus(),
      ])

      console.log("\n=== Evolution Status ===\n")
      console.log("📋 Directions:")
      for (const d of directions) {
        console.log(`   - ${d}`)
      }
      console.log(`\n🔍 Sources: ${sources.join(", ")}`)
      console.log(`\n🟢 Enabled: ${evolution.enabled ?? true}`)
      console.log("\n--- System ---")
      console.log(`📊 Knowledge Graph: ${stats.nodes} nodes, ${stats.edges} edges`)
      console.log(`🛡️ Safety: ${safetyCheck.allowed ? "Ready" : "Cooldown active"}`)
      if (safetyCheck.cooldown_remaining_ms) {
        console.log(`   Cooldown remaining: ${Math.round(safetyCheck.cooldown_remaining_ms / 1000 / 60)} min`)
      }
      console.log(
        `⏱️ Last check: ${triggerStatus.last_check ? new Date(triggerStatus.last_check).toLocaleString() : "Never"}`,
      )
      console.log(`📋 Pending tasks: ${triggerStatus.pending_tasks}`)
    },
  })
}

async function listTasks() {
  const dir = process.cwd()
  const tasksDir = path.resolve(dir, "docs/learning/tasks")
  const deployer = new Deployer(tasksDir)
  const tasks = await deployer.getPendingTasks()

  console.log("\n=== Pending Deployment Tasks ===\n")

  if (tasks.length === 0) {
    console.log("No pending tasks")
    return
  }

  for (const task of tasks) {
    console.log(`[${task.id}] ${task.title}`)
    console.log(`  Status: ${task.status}`)
    console.log(`  Type: ${task.type}`)
    if (task.description) {
      console.log(`  Description: ${task.description}`)
    }
    if ((task as any).source) {
      console.log(`  Source: ${(task as any).source}`)
    }
    if ((task as any).priority) {
      console.log(`  Priority: ${(task as any).priority}`)
    }
    if (task.changes?.files) {
      console.log(`  Files: ${task.changes.files.join(", ")}`)
    }
    if (task.commands) {
      console.log(`  Commands: ${task.commands.join(" && ")}`)
    }
    console.log("")
  }

  console.log(`Total: ${tasks.length} pending task(s)`)
}

// Self-evolution: scan code for issues
async function scanCode() {
  const dir = process.cwd()
  const scheduler = createSelfEvolutionScheduler(dir, {
    ...defaultSelfEvolutionConfig,
    enabled: true,
    requireHumanReview: true,
  })

  console.log("Scanning for code issues...")
  const result = await scheduler.trigger()

  console.log("\n=== Scan Results ===")
  console.log(`Issues found: ${result.issues_scanned}`)
  console.log(`Auto-fixable: ${result.auto_fixed}`)
  console.log(`Human review required: ${result.human_review_required}`)

  if (result.errors.length > 0) {
    console.log("\nErrors:")
    for (const e of result.errors) {
      console.log(`  - ${e}`)
    }
  }
}

// Self-evolution: fix code issues
async function fixCode() {
  const dir = process.cwd()
  const scheduler = createSelfEvolutionScheduler(dir, {
    ...defaultSelfEvolutionConfig,
    enabled: true,
    requireHumanReview: false,
  })

  console.log("Scanning and fixing code issues...")
  const result = await scheduler.trigger()

  console.log("\n=== Fix Results ===")
  console.log(`Issues found: ${result.issues_scanned}`)
  console.log(`Auto-fixed: ${result.auto_fixed}`)
  console.log(`PR created: ${result.pr_created}`)

  if (result.pr_url) {
    console.log(`PR URL: ${result.pr_url}`)
  }
}

// Self-evolution: show code stats
async function codeStats() {
  const dir = process.cwd()
  const scheduler = createSelfEvolutionScheduler(dir)

  console.log("Computing code statistics...")
  const stats = await scheduler.getStats()

  console.log("\n=== Code Statistics ===")
  console.log(`Total files: ${stats.total_files}`)
  console.log(`Total lines: ${stats.total_lines}`)
  console.log("\nIssues by severity:")
  console.log(`  Low: ${stats.issues_by_severity.low}`)
  console.log(`  Medium: ${stats.issues_by_severity.medium}`)
  console.log(`  High: ${stats.issues_by_severity.high}`)
  console.log("\nIssues by type:")
  for (const [type, count] of Object.entries(stats.issues_by_type)) {
    console.log(`  ${type}: ${count}`)
  }
}

// Build module summaries
async function buildSummaries() {
  const dir = process.cwd()
  const memory = createHierarchicalMemory(dir)

  console.log("Building module summaries...")
  const count = await memory.buildAllSummaries()

  console.log(`\nBuilt ${count} module summaries`)
}

// Search module summaries
async function searchSummaries(query: string) {
  const dir = process.cwd()
  const memory = createHierarchicalMemory(dir)

  console.log(`Searching for: "${query}"`)
  const results = await memory.searchSummaries(query)

  console.log(`\n=== Found ${results.length} matching modules ===`)
  for (const summary of results) {
    console.log(`\n## ${summary.module}`)
    console.log(`  Purpose: ${summary.purpose}`)
    console.log(`  File: ${summary.file}`)
    if (summary.keyFunctions.length > 0) {
      console.log("  Key functions:")
      for (const fn of summary.keyFunctions.slice(0, 3)) {
        console.log(`    - ${fn.name}: ${fn.purpose}`)
      }
    }
  }
}

// Generate project overview
async function generateOverview() {
  const dir = process.cwd()
  const memory = createHierarchicalMemory(dir)

  console.log("Generating project overview...")
  const overview = await memory.generateProjectOverview()

  if (overview) {
    console.log("\n=== Project Overview ===")
    console.log("\nTech Stack:")
    for (const tech of overview.techStack) {
      console.log(`  - ${tech}`)
    }
    console.log("\nKey Capabilities:")
    for (const cap of overview.keyCapabilities) {
      console.log(`  - ${cap}`)
    }
    if (overview.knownGaps.length > 0) {
      console.log("\nKnown Gaps:")
      for (const gap of overview.knownGaps) {
        console.log(`  - ${gap}`)
      }
    }
  } else {
    console.log("Failed to generate overview")
  }
}

// Index project files into knowledge graph
async function indexProjectFiles(args: { path: string; clear: boolean; ext: string[] }) {
  const dir = path.resolve(process.cwd(), args.path)
  const extensions = args.ext.map((e) => (e.startsWith(".") ? e : `.${e}`))

  console.log(`Indexing project files from: ${dir}`)
  console.log(`Extensions: ${extensions.join(", ")}`)
  console.log(`Clear existing: ${args.clear}`)

  await Instance.provide({
    directory: dir,
    fn: async () => {
      // Scan for source files
      const { glob } = await import("glob")
      const { readFile } = await import("fs/promises")

      const patterns = extensions.map((ext) => `**/*${ext}`)
      const files: Array<{ path: string; content: string; type: string }> = []

      for (const pattern of patterns) {
        const matches = await glob(pattern, {
          cwd: dir,
          ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/build/**"],
          absolute: true,
        })

        for (const filePath of matches) {
          try {
            const content = await readFile(filePath, "utf-8")
            const relativePath = path.relative(dir, filePath)
            const ext = path.extname(filePath)
            let type = "file"
            if (ext === ".ts" || ext === ".tsx") type = "typescript"
            else if (ext === ".js" || ext === ".jsx") type = "javascript"

            files.push({ path: relativePath, content, type })
          } catch (error) {
            console.warn(`Failed to read: ${filePath}`)
          }
        }
      }

      if (files.length === 0) {
        console.log("No files found to index")
        return
      }

      console.log(`Found ${files.length} files to index`)

      // Initialize memory and index files
      await Memory.init()
      const result = await Memory.indexProject({
        files,
        clearExisting: args.clear,
      })

      console.log("\n=== Indexing Complete ===")
      console.log(`Entities added: ${result.entitiesAdded}`)
      console.log(`Relations added: ${result.relationsAdded}`)
    },
  })
}

// Migrate vector_memory to knowledge graph
async function migrateKnowledgeGraph(args: { path?: string; ext?: string[] }) {
  const dir = args.path ? path.resolve(process.cwd(), args.path) : process.cwd()
  const extensions = args.ext ?? [".ts", ".tsx", ".js", ".jsx"]

  console.log("Migrating vector_memory to knowledge graph...")
  console.log(`Source directory: ${dir}`)
  console.log(`Extensions: ${extensions.join(", ")}`)

  await Instance.provide({
    directory: dir,
    fn: async () => {
      // Step 1: Migrate existing vector_memory nodes to knowledge_node
      const { getSharedVectorStore } = await import("../../learning/vector-store")
      const vectorStore = await getSharedVectorStore()

      if (vectorStore.migrateToKnowledgeGraph) {
        const migrateResult = await vectorStore.migrateToKnowledgeGraph()
        console.log(`\n📦 Nodes migrated: ${migrateResult.nodesMigrated}`)
        if (migrateResult.errors.length > 0) {
          console.log("Errors during node migration:")
          for (const error of migrateResult.errors) {
            console.log(`  - ${error}`)
          }
        }
      }

      // Step 2: Run Memory.indexProject() for complete code analysis (generates edges)
      console.log("\n🔍 Running code analysis for edges...")

      const { glob } = await import("glob")
      const { readFile } = await import("fs/promises")

      const patterns = extensions.map((ext) => `**/*${ext}`)
      const files: Array<{ path: string; content: string; type: string }> = []

      for (const pattern of patterns) {
        const matches = await glob(pattern, {
          cwd: dir,
          ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/build/**"],
          absolute: true,
        })

        for (const filePath of matches) {
          try {
            const content = await readFile(filePath, "utf-8")
            const relativePath = path.relative(dir, filePath)
            const ext = path.extname(filePath)
            let type = "file"
            if (ext === ".ts" || ext === ".tsx") type = "typescript"
            else if (ext === ".js" || ext === ".jsx") type = "javascript"

            files.push({ path: relativePath, content, type })
          } catch (error) {
            // Skip files that can't be read
          }
        }
      }

      if (files.length === 0) {
        console.log("No files found to analyze")
        return
      }

      console.log(`Found ${files.length} files to analyze`)

      await Memory.init()
      const indexResult = await Memory.indexProject({
        files,
        clearExisting: false, // Don't clear, we already migrated nodes
      })

      console.log("\n=== Migration Complete ===")
      console.log(`Entities added: ${indexResult.entitiesAdded}`)
      console.log(`Relations (edges) added: ${indexResult.relationsAdded}`)

      // Show final stats
      const graph = new KnowledgeGraph()
      const stats = await graph.getStats()
      console.log(`\n📊 Knowledge Graph: ${stats.nodes} nodes, ${stats.edges} edges`)
    },
  })
}

export default EvolveCommand
