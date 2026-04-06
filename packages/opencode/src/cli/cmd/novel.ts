import type { CommandModule } from "yargs"
import { EvolutionOrchestrator, loadDynamicPatterns } from "@/novel"
import { enhancedPatternMiner } from "@/novel/pattern-miner-enhanced"
import { readFile, writeFile } from "fs/promises"
import { resolve } from "path"
import { Skill } from "@/skill/skill"
import { bootstrap } from "../bootstrap"
import { loadLayeredConfig, extractConfigFromPrompt } from "@/novel/novel-config"
import process from "process"
import type { MultiThreadConfig } from "@/novel"

let orchestrator: EvolutionOrchestrator | null = null
let orchestratorArgs: any = null

async function getOrchestrator(args?: any): Promise<EvolutionOrchestrator> {
  if (!orchestrator || orchestratorArgs !== args) {
    const visualPanelsEnabled = args?.visualPanels !== false
    const multiThreadEnabled = args?.multiThread === true
    const multiThreadConfig: Partial<MultiThreadConfig> | undefined = args?.multiThreadMaxThreads
      ? { maxActiveThreads: args.multiThreadMaxThreads }
      : undefined
    orchestrator = new EvolutionOrchestrator({
      visualPanelsEnabled,
      multiThreadEnabled,
      multiThreadConfig,
    })
    orchestratorArgs = args
    await orchestrator.loadState()
  }
  return orchestrator
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

async function handleStart(args: any) {
  await bootstrap(process.cwd(), async () => {
    let promptContent = "Starting new creative session..."
    if (args.prompt) {
      const path = resolve(args.prompt as string)
      if (await fileExists(path)) {
        promptContent = await readFile(path, "utf-8")
        console.log(` Loaded prompt from: ${args.prompt}`)

        // Extract config from prompt front matter
        const { config: embeddedConfig, promptContent: extractedPrompt } = extractConfigFromPrompt(promptContent)
        if (embeddedConfig) {
          console.log(` Found embedded config in prompt`)
        }
        promptContent = extractedPrompt
      } else {
        console.error(`× Prompt file not found: ${path}`)
        return
      }
    }

    // Load layered config
    const configManager = await loadLayeredConfig({
      explicitConfigPath: args.config,
      promptContent,
      enableInference: args.infer,
    })
    console.log(` Config source: ${configManager.getConfigSource()}`)

    const loops = (args.loops as number) || 1
    const visualPanelsEnabled = !args.noVisualPanels && args.visualPanels !== false
    const branchesEnabled = args.branches !== false && !args.noBranches
    const branchCount = (args.branchCount as number) || 3
    console.log(` Visual panels: ${visualPanelsEnabled ? "enabled" : "disabled"}`)
    console.log(` Multi-branch generation: ${branchesEnabled ? `enabled (${branchCount} branches)` : "disabled"}`)
    console.log(` Running ${loops} self-evolution loop(s)...\n`)

    // Create engine with branch settings
    orchestrator = new EvolutionOrchestrator({
      configManager,
      visualPanelsEnabled,
      branchOptions: branchCount,
    })
    orchestratorArgs = args
    await orchestrator.loadState()

    try {
      for (let i = 0; i < loops; i++) {
        if (i > 0) {
          console.log(`\n--- Loop ${i + 1}/${loops} ---`)
          await enhancedPatternMiner.onTurn({ storySegment: promptContent, characters: {}, chapter: 1, fullStory: promptContent })
        }
        const result = await orchestrator.runNovelCycle(promptContent, branchesEnabled)
        console.log(`\n ✓ Loop ${i + 1} complete!`)
        console.log("Preview:", result.substring(0, 150) + "...")
      }

      if (loops > 1) {
        console.log(`\n🎉 Completed ${loops} self-evolution loops!`)
      }
    } catch (error) {
      console.error("× Error during novel cycle:", error)
      if (error instanceof Error) {
        console.error("Stack:", error.stack)
      }
    } finally {
      // Clean up database connections to prevent process hanging
      await orchestrator.dispose()
    }
  })
}

async function handleContinue(args?: any) {
  await bootstrap(process.cwd(), async () => {
    const visualPanelsEnabled = !args?.noVisualPanels && args?.visualPanels !== false
    const branchesEnabled = args?.branches !== false && !args?.noBranches
    const branchCount = args?.branchCount || 3
    console.log(` Visual panels: ${visualPanelsEnabled ? "enabled" : "disabled"}`)
    console.log(` Multi-branch generation: ${branchesEnabled ? `enabled (${branchCount} branches)` : "disabled"}`)

    orchestrator = new EvolutionOrchestrator({
      visualPanelsEnabled,
      branchOptions: branchCount,
    })
    orchestratorArgs = args
    await orchestrator.loadState()

    const state = orchestrator.getState()
    console.log(`Continuing from Chapter ${state.chapterCount}: ${state.currentChapter || "Untitled"}`)
    try {
      const result = await orchestrator.runNovelCycle("Continue the story from the current state.", branchesEnabled)
      console.log("\n ✓ Next chapter generated!")
      console.log("Preview:", result.substring(0, 150) + "...")
    } finally {
      await orchestrator.dispose()
    }
  })
}

async function handleInject(args: any) {
  await bootstrap(process.cwd(), async () => {
    const filePath = resolve(args.file as string)
    const content = await readFile(filePath, "utf-8")
    console.log(`💉 Injecting context from: ${args.file}`)

    await enhancedPatternMiner.onTurn({ storySegment: content, characters: {}, chapter: 1, fullStory: content })
    console.log(" ✓ Context injected and patterns updated!")
  })
}

async function handleEvolve() {
  await bootstrap(process.cwd(), async () => {
    console.log("🔍 Triggering Enhanced Pattern Miner evolution...")
    await enhancedPatternMiner.initialize()
    const engine = await getOrchestrator()
    const state = engine.getState()
    try {
      await enhancedPatternMiner.onTurn({
        storySegment: state.fullStory || "",
        characters: state.characters || {},
        chapter: state.chapterCount || 1,
        fullStory: state.fullStory || "",
      })
      const stats = enhancedPatternMiner.getStats()
      console.log("✓ Evolution complete!")
      console.log(`  Patterns: ${stats.patterns}, Archetypes: ${stats.archetypes}, Templates: ${stats.templates}, Motifs: ${stats.motifs}`)
    } finally {
      await engine.dispose()
    }
  })
}

async function handleState(args: any) {
  await bootstrap(process.cwd(), async () => {
    const target = args.target as string
    const engine = await getOrchestrator()
    const state = engine.getState()

    try {
      if (target === "world") {
        console.log(
          " World State:",
          JSON.stringify(
            {
              chapter: state.currentChapter,
              chapterCount: state.chapterCount,
              characters: Object.keys(state.characters || {}),
              timestamps: state.timestamps,
            },
            null,
            2,
          ),
        )
      } else {
        console.log(` State for ${target}:`, JSON.stringify(state.characters?.[target], null, 2))
      }
    } finally {
      await engine.dispose()
    }
  })
}

async function handleExport(args: any) {
  await bootstrap(process.cwd(), async () => {
    const format = args.format as "md" | "json" | "pdf"
    const engine = await getOrchestrator()
    const state = engine.getState()

    try {
      if (format === "json") {
        await writeFile("novel_export.json", JSON.stringify(state, null, 2))
        console.log(" ✓ Exported to novel_export.json")
      } else if (format === "md") {
        const md = `# Novel Export\n\nChapter: ${state.currentChapter}\n\n${state.fullStory || "No content yet."}`
        await writeFile("novel_export.md", md)
        console.log(" ✓ Exported to novel_export.md")
      } else {
        console.log("PDF export not implemented yet")
      }
    } finally {
      await engine.dispose()
    }
  })
}

async function handlePatterns() {
  await bootstrap(process.cwd(), async () => {
    const patterns = await loadDynamicPatterns()
    console.log("  Discovered Patterns:")
    if (patterns.length === 0) {
      console.log("  (No patterns discovered yet)")
    } else {
      for (const p of patterns) {
        console.log(`  - ${p.keyword} (${p.category}): ${p.description}`)
      }
    }
  })
}

async function handleBranches() {
  await bootstrap(process.cwd(), async () => {
    const engine = await getOrchestrator()
    try {
      const branches = engine.getAvailableBranches()
      const tree = engine.getBranchTree()

      if (branches.length === 0) {
        console.log("  (No branches available yet — run with --branches to enable multi-branch generation)")
        return
      }

      console.log(`\n  Story Branches (${branches.length} available):\n`)
      console.log("  ─" .repeat(60))

      for (const branch of branches) {
        const selected = branch.selected ? " ✓" : ""
        const status = branch.pruned ? " [pruned]" : ""
        console.log(`\n  ${branch.id}${selected}${status}`)
        console.log(`    Choice: ${branch.choiceMade}`)
        console.log(`    Branch point: ${branch.branchPoint}`)
        console.log(`    Quality: ${branch.evaluation?.narrativeQuality?.toFixed(1) || 'N/A'}/10`)
        if (branch.evaluation) {
          const e = branch.evaluation
          console.log(`    Tension: ${e.tensionLevel?.toFixed(1)}/10 | Character: ${e.characterDevelopment?.toFixed(1)}/10 | Plot: ${e.plotProgression?.toFixed(1)}/10`)
        }
      }

      // Show tree structure
      const treeKeys = Object.keys(tree)
      if (treeKeys.length > 0) {
        console.log(`\n\n  Branch Tree:\n`)
        for (const parentId of treeKeys) {
          const children = tree[parentId]
          console.log(`  Parent: ${parentId}`)
          for (const child of children) {
            const marker = child.selected ? " ← current" : ""
            console.log(`    └─ ${child.id}: ${child.choiceMade.slice(0, 60)}...${marker}`)
          }
        }
      }
    } finally {
      await engine.dispose()
    }
  })
}

async function handleSwitchBranch(args: any) {
  await bootstrap(process.cwd(), async () => {
    const engine = await getOrchestrator()
    try {
      const branchId = args.branchId as string
      const success = await engine.switchBranch(branchId)

      if (success) {
        const state = engine.getState()
        console.log(` ✓ Switched to branch: ${branchId}`)
        console.log(`   Chapter: ${state.chapterCount}`)
        console.log(`   Characters: ${Object.keys(state.characters || {}).join(", ") || "none"}`)
      } else {
        console.error(` × Branch not found: ${branchId}`)
        console.log("  Available branches:")
        const branches = engine.getAvailableBranches()
        for (const b of branches) {
          console.log(`    ${b.id}: ${b.choiceMade.slice(0, 60)}...`)
        }
      }
    } finally {
      await engine.dispose()
    }
  })
}

async function handleBranchStats() {
  await bootstrap(process.cwd(), async () => {
    const engine = await getOrchestrator()
    try {
      const stats = engine.getBranchStats()
      const state = engine.getState()

      console.log("\n  Branch Statistics:\n")
      console.log(`  Total branches:     ${stats.total}`)
      console.log(`  Active branches:    ${stats.active}`)
      console.log(`  Pruned branches:    ${stats.pruned}`)
      console.log(`  Merged branches:    ${stats.merged}`)
      console.log(`  Selected branches:  ${stats.selected}`)
      console.log(`  Average score:      ${stats.avgScore?.toFixed(1) || 'N/A'}/10`)
      console.log(`  Current chapter:    ${state.chapterCount}`)
      console.log(`  Current branch:     ${state.currentBranchId || "none"}`)

      // Show branch history
      const history = state.branchHistory || []
      if (history.length > 0) {
        console.log(`\n  Branch History (${history.length} entries):\n`)
        for (const entry of history.slice(-10)) {
          const marker = entry.id === state.currentBranchId ? " ← current" : ""
          console.log(`  ${entry.id}: ${entry.choiceMade?.slice(0, 50) || 'unknown'}${marker}`)
        }
      }
    } finally {
      await engine.dispose()
    }
  })
}

async function handleReset() {
  await bootstrap(process.cwd(), async () => {
    const engine = await getOrchestrator()
    try {
      await engine.reset()
      console.log(" ✓ Story state reset!")
    } finally {
      await engine.dispose()
    }
  })
}

export const NovelCommand: CommandModule = {
  command: "novel",
  describe: "Self-evolving novel writing engine with PatternMiner",
  builder: (yargs) => {
    return yargs
      .command(
        "start [prompt]",
        "Initialize a new story session",
        (yargs) =>
          yargs
            .positional("prompt", {
              type: "string",
              describe: "Path to initial prompt file",
            })
            .option("loops", {
              type: "number",
              default: 1,
              alias: "l",
              describe: "Number of self-evolution loops to run",
            })
            .option("config", {
              type: "string",
              describe: "Path to novel config file",
            })
            .option("visual-panels", {
              type: "boolean",
              default: true,
              describe: "Enable visual panel generation",
            })
            .option("no-visual-panels", {
              type: "boolean",
              describe: "Disable visual panel generation",
            })
            .option("infer", {
              type: "boolean",
              default: false,
              describe: "Enable LLM config inference",
            })
            .option("multi-thread", {
              type: "boolean",
              default: false,
              describe: "Enable multi-thread narrative generation (parallel POV storylines)",
            })
            .option("multi-thread-max-threads", {
              type: "number",
              default: 5,
              describe: "Maximum number of active threads for multi-thread narrative",
            })
            .option("branches", {
              type: "boolean",
              default: true,
              describe: "Enable multi-branch story generation (LLM generates multiple paths, selects best)",
            })
            .option("no-branches", {
              type: "boolean",
              describe: "Disable multi-branch story generation (single linear path)",
            })
            .option("branch-count", {
              type: "number",
              default: 3,
              describe: "Number of branches to generate per chapter (default: 3)",
            }),
        handleStart,
      )
      .command(
        "continue",
        "Resume the self-evolving loop from last saved state",
        (yargs) =>
          yargs
            .option("visual-panels", {
              type: "boolean",
              default: true,
              describe: "Enable visual panel generation",
            })
            .option("no-visual-panels", {
              type: "boolean",
              describe: "Disable visual panel generation",
            })
            .option("multi-thread", {
              type: "boolean",
              default: false,
              describe: "Enable multi-thread narrative generation (parallel POV storylines)",
            })
            .option("multi-thread-max-threads", {
              type: "number",
              default: 5,
              describe: "Maximum number of active threads for multi-thread narrative",
            })
            .option("branches", {
              type: "boolean",
              default: true,
              describe: "Enable multi-branch story generation (LLM generates multiple paths, selects best)",
            })
            .option("no-branches", {
              type: "boolean",
              describe: "Disable multi-branch story generation (single linear path)",
            })
            .option("branch-count", {
              type: "number",
              default: 3,
              describe: "Number of branches to generate per chapter (default: 3)",
            }),
        handleContinue,
      )
      .command(
        "inject <file>",
        "Inject additional context into current memory",
        (yargs) =>
          yargs.positional("file", {
            type: "string",
            demandOption: true,
            describe: "Path to context file to inject",
          }),
        handleInject,
      )
      .command("evolve", "Manually trigger PatternMiner and Consistency Evaluator", handleEvolve)
      .command(
        "state [target]",
        "Display current stored state",
        (yargs) =>
          yargs.positional("target", {
            type: "string",
            default: "world",
            describe: "Character name or 'world' to display state for",
          }),
        handleState,
      )
      .command(
        "export <format>",
        "Export current story and state",
        (yargs) =>
          yargs.positional("format", {
            type: "string",
            choices: ["md", "json", "pdf"],
            demandOption: true,
            describe: "Export format",
          }),
        handleExport,
      )
      .command("patterns", "Display discovered narrative patterns", handlePatterns)
      .command("reset", "Reset story state and start fresh", handleReset)
      .command("branches", "List all story branches and their tree structure", handleBranches)
      .command(
        "switch <branchId>",
        "Switch to a different branch (time travel / alternate timeline)",
        (yargs) =>
          yargs.positional("branchId", {
            type: "string",
            demandOption: true,
            describe: "Branch ID to switch to",
          }),
        handleSwitchBranch,
      )
      .command("branch-stats", "Display branch statistics and health", handleBranchStats)
      .demandCommand(1, "")
  },
  handler: async () => {
    // Parent handler not used - subcommands have their own handlers
  },
}

export default NovelCommand
