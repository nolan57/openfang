import type { CommandModule } from "yargs"
import { EvolutionOrchestrator, analyzeAndEvolve, loadDynamicPatterns, PatternMiner } from "@/novel"
import { readFile, writeFile } from "fs/promises"
import { resolve } from "path"
import { Skill } from "@/skill/skill"

let orchestrator: EvolutionOrchestrator | null = null

async function getOrchestrator(): Promise<EvolutionOrchestrator> {
  if (!orchestrator) {
    orchestrator = new EvolutionOrchestrator()
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

export const NovelCommand: CommandModule = {
  command: "novel",
  describe: "Self-evolving novel writing engine with PatternMiner",
  builder: (yargs) =>
    yargs
      .command("start [prompt]", "Initialize a new story session", (yargs) =>
        yargs.positional("prompt", {
          type: "string",
          describe: "Path to initial prompt file",
        }),
      )
      .command("continue", "Resume the self-evolving loop from last saved state")
      .command("inject <file>", "Inject additional context into current memory", (yargs) =>
        yargs.positional("file", {
          type: "string",
          demandOption: true,
          describe: "Path to context file to inject",
        }),
      )
      .command("evolve", "Manually trigger PatternMiner and Consistency Evaluator")
      .command("state [target]", "Display current stored state", (yargs) =>
        yargs.positional("target", {
          type: "string",
          default: "world",
          describe: "Character name or 'world' to display state for",
        }),
      )
      .command("export <format>", "Export current story and state", (yargs) =>
        yargs.positional("format", {
          type: "string",
          choices: ["md", "json", "pdf"],
          demandOption: true,
          describe: "Export format",
        }),
      )
      .command("patterns", "Display discovered narrative patterns")
      .command("reset", "Reset story state and start fresh")
      .demandCommand(1, ""),
  handler: async (args) => {
    if (args._[0] !== "novel") return

    const engine = await getOrchestrator()

    switch (args._[1]) {
      case "start": {
        let promptContent = "Starting new creative session..."
        if (args.prompt) {
          const path = resolve(args.prompt as string)
          if (await fileExists(path)) {
            promptContent = await readFile(path, "utf-8")
            console.log(`📄 Loaded prompt from: ${args.prompt}`)
          }
        }
        // Run novel cycle with the prompt
        const result = await engine.runNovelCycle(promptContent)
        console.log("\n✅ Chapter generated!")
        console.log("Preview:", result.substring(0, 150) + "...")
        break
      }

      case "continue": {
        const state = engine.getState()
        console.log(`Continuing from Chapter ${state.chapterCount}: ${state.currentChapter || "Untitled"}`)
        const result = await engine.runNovelCycle("Continue the story from the current state.")
        console.log("\n✅ Next chapter generated!")
        console.log("Preview:", result.substring(0, 150) + "...")
        break
      }

      case "inject": {
        const filePath = resolve(args.file as string)
        const content = await readFile(filePath, "utf-8")
        console.log(`💉 Injecting context from: ${args.file}`)

        // Trigger immediate pattern analysis
        await analyzeAndEvolve(content, await loadDynamicPatterns())
        console.log("✅ Context injected and patterns updated!")
        break
      }

      case "evolve": {
        console.log("🔄 Triggering PatternMiner evolution...")
        const patterns = await loadDynamicPatterns()
        const state = engine.getState()
        await analyzeAndEvolve(state.fullStory || "", patterns)
        console.log("✅ Evolution complete!")
        break
      }

      case "state": {
        const target = args.target as string
        const state = engine.getState()

        if (target === "world") {
          console.log("📊 World State:")
          console.log(
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
          console.log(`📊 State for ${target}:`, JSON.stringify(state.characters?.[target], null, 2))
        }
        break
      }

      case "export": {
        const format = args.format as "md" | "json" | "pdf"
        const state = engine.getState()

        if (format === "json") {
          await writeFile("novel_export.json", JSON.stringify(state, null, 2))
          console.log("✅ Exported to novel_export.json")
        } else if (format === "md") {
          const md = `# Novel Export\n\nChapter: ${state.currentChapter}\n\n${state.fullStory || "No content yet."}`
          await writeFile("novel_export.md", md)
          console.log("✅ Exported to novel_export.md")
        } else {
          console.log("PDF export not implemented yet")
        }
        break
      }

      case "patterns": {
        const patterns = await loadDynamicPatterns()
        console.log("📚 Discovered Patterns:")
        if (patterns.length === 0) {
          console.log("  (No patterns discovered yet)")
        } else {
          for (const p of patterns) {
            console.log(`  - ${p.keyword} (${p.category}): ${p.description}`)
          }
        }
        break
      }

      case "reset": {
        await engine.reset()
        console.log("✅ Story state reset!")
        break
      }

      default:
        console.log("Unknown novel command")
    }
  },
}

export default NovelCommand
