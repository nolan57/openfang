import type { CommandModule } from "yargs"
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

export const EvolveCommand: CommandModule = {
  command: "evolve",
  describe: "Manage self-evolving agent system",
  builder: (yargs) =>
    yargs
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
      .demandCommand(),
  handler: () => {},
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

export default EvolveCommand
