import type { CommandModule } from "yargs"
import { NovelEngine } from "@/skill/novel-engine"
import { ConfigInterpreter } from "@/skill/interpreter"

let interpreter: ConfigInterpreter | null = null

async function getInterpreter(): Promise<ConfigInterpreter> {
  if (!interpreter) {
    interpreter = new ConfigInterpreter()
    await interpreter.load()
    await interpreter.startHotReload()
  }
  return interpreter
}

export const NovelCommand: CommandModule = {
  command: "novel",
  describe: "Novel writing engine with self-evolving capabilities",
  builder: (yargs) =>
    yargs
      .command("start [prompt]", "Initialize a new story session", (yargs) =>
        yargs
          .positional("prompt", {
            type: "string",
            describe: "Path to initial prompt file",
          })
          .option("loops", {
            type: "number",
            default: 1,
            describe: "Number of self-evolution loops to run",
            alias: "l",
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
      .command("cmd [name]", "Execute config-driven commands", (yargs) =>
        yargs
          .positional("name", {
            type: "string",
            describe: "Command name to execute",
          })
          .option("list", {
            type: "boolean",
            describe: "List available commands",
            alias: "l",
          }),
      )
      .command("primitives", "List available primitive actions")
      .demandCommand(1, ""),
  handler: async (args) => {
    if (args._[0] !== "novel") return

    const engine = new NovelEngine()

    switch (args._[1]) {
      case "start":
        await engine.start(args.prompt as string | undefined, args.loops as number)
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
      case "cmd": {
        const interp = await getInterpreter()
        if (args.list) {
          const commands = interp.listCommands()
          console.log("Available commands:")
          for (const cmd of commands) {
            const detail = interp.getCommand(cmd)
            console.log(`  - ${cmd}: ${detail?.description || "No description"}`)
          }
        } else if (args.name) {
          const result = await interp.executeCommand(args.name as string)
          console.log("Result:", result)
        } else {
          console.log("Use --list to list commands or provide a command name")
        }
        break
      }
      case "primitives": {
        const interp = await getInterpreter()
        const primitives = interp.getAvailablePrimitives()
        console.log("Available primitives:")
        for (const p of primitives) {
          console.log(`  - ${p}`)
        }
        break
      }
      default:
        console.log("Unknown novel command")
    }
  },
}

export default NovelCommand
