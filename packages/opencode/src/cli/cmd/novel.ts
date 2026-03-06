import type { CommandModule } from "yargs"
import { NovelEngine } from "@/skill/novel-engine"

export const NovelCommand: CommandModule = {
  command: "novel",
  describe: "Novel writing engine with self-evolving capabilities",
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
      .demandCommand(1, ""),
  handler: async (args) => {
    if (args._[0] !== "novel") return

    const engine = new NovelEngine()

    switch (args._[1]) {
      case "start":
        await engine.start(args.prompt as string | undefined)
        break
      case "continue":
        await engine.continue()
        break
      case "inject":
        await engine.inject(args.file as string)
        break
      case "evolve":
        await engine.evolve()
        break
      case "state":
        await engine.state(args.target as string)
        break
      case "export":
        await engine.export(args.format as "md" | "json" | "pdf")
        break
      default:
        console.log("Unknown novel command")
    }
  },
}

export default NovelCommand
