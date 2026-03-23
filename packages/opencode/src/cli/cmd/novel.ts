import type { CommandModule } from "yargs"
import { EvolutionOrchestrator, analyzeAndEvolve, loadDynamicPatterns, PatternMiner } from "@/novel"
import { readFile, writeFile } from "fs/promises"
import { resolve } from "path"
import { Skill } from "@/skill/skill"
import { bootstrap } from "../bootstrap"
import { loadLayeredConfig, extractConfigFromPrompt } from "@/novel/novel-config"
import process from "process"

let orchestrator: EvolutionOrchestrator | null = null
let orchestratorArgs: any = null

async function getOrchestrator(args?: any): Promise<EvolutionOrchestrator> {
  if (!orchestrator || orchestratorArgs !== args) {
    const visualPanelsEnabled = args?.visualPanels !== false
    orchestrator = new EvolutionOrchestrator({ visualPanelsEnabled })
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
    console.log(` Visual panels: ${visualPanelsEnabled ? "enabled" : "disabled"}`)
    console.log(` Running ${loops} self-evolution loop(s)...\n`)

    // Create engine with visual panels setting
    orchestrator = new EvolutionOrchestrator({
      configManager,
      visualPanelsEnabled,
    })
    orchestratorArgs = args
    await orchestrator.loadState()

    try {
      for (let i = 0; i < loops; i++) {
        if (i > 0) {
          console.log(`\n--- Loop ${i + 1}/${loops} ---`)
          await analyzeAndEvolve(promptContent, await loadDynamicPatterns())
        }
        const result = await orchestrator.runNovelCycle(promptContent)
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
    console.log(` Visual panels: ${visualPanelsEnabled ? "enabled" : "disabled"}`)

    orchestrator = new EvolutionOrchestrator({ visualPanelsEnabled })
    orchestratorArgs = args
    await orchestrator.loadState()

    const state = orchestrator.getState()
    console.log(`Continuing from Chapter ${state.chapterCount}: ${state.currentChapter || "Untitled"}`)
    try {
      const result = await orchestrator.runNovelCycle("Continue the story from the current state.")
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

    await analyzeAndEvolve(content, await loadDynamicPatterns())
    console.log(" ✓ Context injected and patterns updated!")
  })
}

async function handleEvolve() {
  await bootstrap(process.cwd(), async () => {
    console.log(" Triggering PatternMiner evolution...")
    const patterns = await loadDynamicPatterns()
    const engine = await getOrchestrator()
    const state = engine.getState()
    try {
      await analyzeAndEvolve(state.fullStory || "", patterns)
      console.log(" ✓ Evolution complete!")
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
      .demandCommand(1, "")
  },
  handler: async () => {
    // Parent handler not used - subcommands have their own handlers
  },
}

export default NovelCommand
