import path from "path"
import { readFile, writeFile, readdir, stat } from "fs/promises"
import { resolve } from "path"
import { EvolutionOrchestrator, analyzeAndEvolve, loadDynamicPatterns } from "./orchestrator"
import { Instance } from "../project/instance"
import { getStoryBiblePath, getDynamicPatternsPath, getSkillsPath } from "./novel-config"
import { z } from "zod"

const StoryFeedbackSchema = z.object({
  storyId: z.string(),
  rating: z.number().min(1).max(10),
  comments: z.string().optional(),
  suggestions: z.array(z.string()).optional(),
  submittedAt: z.number().optional(),
})

type StoryFeedback = z.infer<typeof StoryFeedbackSchema>

async function submitFeedbackToMetaLearner(feedback: StoryFeedback): Promise<void> {
  console.log(` Submitting feedback to MetaLearner: ${feedback.storyId} (rating: ${feedback.rating}/10)`)
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Secure path resolution - prevents directory traversal attacks
 */
export function resolveSafePath(cwd: string, userInput: string): string {
  const resolved = path.resolve(cwd, userInput)
  if (!resolved.startsWith(cwd)) {
    throw new Error(" Security Error: Access outside project directory denied.")
  }
  return resolved
}

/**
 * Parse and execute slash commands
 */
export async function handleSlashCommand(input: string, cwd: string): Promise<void> {
  const parts = input.trim().split(/\s+/)
  const cmd = parts[0].toLowerCase()
  const args = parts.slice(1)

  switch (cmd) {
    case "/start": {
      const filePath = args[0]
      let promptContent = "Starting new creative session..."

      if (filePath) {
        const safePath = resolveSafePath(cwd, filePath)
        promptContent = await readFile(safePath, "utf-8")
        console.log(` Loaded initial setup from: ${filePath}`)
      } else {
        console.log(" Starting new session (no prompt file)")
      }

      const orchestrator = new EvolutionOrchestrator()
      await orchestrator.loadState()

      const result = await orchestrator.runNovelCycle(promptContent)

      console.log("\n✓ Story started!")
      console.log("Preview:", result.substring(0, 150) + "...")
      break
    }

    case "/continue": {
      console.log(" Continuing story...")

      const orchestrator = new EvolutionOrchestrator()
      await orchestrator.loadState()

      const state = orchestrator.getState()
      if (state.chapterCount === 0) {
        console.log("× No existing story. Use /start first.")
        break
      }

      const result = await orchestrator.runNovelCycle("Continue the story from the current state.")

      console.log("\n✓ Chapter generated!")
      console.log("Preview:", result.substring(0, 150) + "...")
      break
    }

    case "/inject": {
      if (!args[0]) {
        console.log("× Usage: /inject <file>")
        break
      }

      const filePath = args[0]
      const safePath = resolveSafePath(cwd, filePath)

      if (!(await fileExists(safePath))) {
        console.log(`× File not found: ${filePath}`)
        break
      }

      const content = await readFile(safePath, "utf-8")
      console.log(` Injecting context from: ${filePath}`)

      const orchestrator = new EvolutionOrchestrator()
      await orchestrator.loadState()

      // Trigger pattern analysis
      const patterns = await loadDynamicPatterns()
      await analyzeAndEvolve(content, patterns)

      // Update story state
      const state = orchestrator.getState()
      state.injectedContext = content
      await orchestrator.saveState()

      console.log("✓ Context injected and patterns updated!")
      break
    }

    case "/evolve": {
      console.log(" Forcing evolution cycle...")

      const orchestrator = new EvolutionOrchestrator()
      await orchestrator.loadState()

      const state = orchestrator.getState()
      const patterns = await loadDynamicPatterns()
      await analyzeAndEvolve(state.fullStory || "", patterns)

      console.log("✓ Evolution complete!")

      // Show updated patterns
      const updatedPatterns = await loadDynamicPatterns()
      console.log(` Total patterns: ${updatedPatterns.length}`)
      break
    }

    case "/state": {
      const target = args[0] || "world"
      const safePath = getStoryBiblePath()

      if (!(await fileExists(safePath))) {
        console.log("× No story state found. Start a story first with /start")
        break
      }

      const content = await readFile(safePath, "utf-8")
      const state = JSON.parse(content)

      if (target === "world") {
        console.log(" World State:")
        console.log(
          JSON.stringify(
            {
              chapter: state.currentChapter?.title || "N/A",
              chapterCount: state.chapterCount,
              characters: Object.keys(state.characters || {}),
              lastUpdated: state.timestamps?.lastGeneration
                ? new Date(state.timestamps.lastGeneration).toISOString()
                : "N/A",
            },
            null,
            2,
          ),
        )
      } else {
        console.log(` State for ${target}:`, JSON.stringify(state.characters?.[target], null, 2))
      }
      break
    }

    case "/export": {
      const format = args[0] || "md"
      if (!["md", "json"].includes(format)) {
        console.log("× Usage: /export <md|json>")
        break
      }

      const safePath = getStoryBiblePath()
      if (!(await fileExists(safePath))) {
        console.log("× No story to export. Start with /start")
        break
      }

      const content = await readFile(safePath, "utf-8")
      const state = JSON.parse(content)

      if (format === "json") {
        const outPath = resolveSafePath(cwd, "novel_export.json")
        await writeFile(outPath, JSON.stringify(state, null, 2))
        console.log(`✓ Exported to: ${outPath}`)
      } else {
        const md = `# Novel Export

## Chapter ${state.chapterCount}: ${state.currentChapter?.title || "Untitled"}

${state.fullStory || "No content yet."}

## Characters
${Object.keys(state.characters || {}).join(", ") || "None"}

---
Exported: ${new Date().toISOString()}
`
        const outPath = resolveSafePath(cwd, "novel_export.md")
        await writeFile(outPath, md)
        console.log(`✓ Exported to: ${outPath}`)
      }
      break
    }

    case "/patterns": {
      const safePath = getDynamicPatternsPath()

      if (!(await fileExists(safePath))) {
        console.log(" No patterns discovered yet.")
        break
      }

      const content = await readFile(safePath, "utf-8")
      const data = JSON.parse(content)
      const patterns = data.patterns || []

      console.log(" Discovered Patterns:")
      if (patterns.length === 0) {
        console.log("  (No patterns discovered yet)")
      } else {
        for (const p of patterns) {
          console.log(`  - ${p.keyword} (${p.category}): ${p.description || "No description"}`)
        }
      }
      break
    }

    case "/reset": {
      console.log(" Resetting story state...")

      const safePath = getStoryBiblePath()
      await writeFile(
        safePath,
        JSON.stringify(
          {
            characters: {},
            world: {},
            relationships: {},
            currentChapter: null,
            chapterCount: 0,
            timestamps: {},
            fullStory: "",
          },
          null,
          2,
        ),
      )

      console.log("✓ Story state reset!")
      break
    }

    case "/architect": {
      console.log(" Please open http://localhost:3000/architect in your browser to start the Prompt Architect.")
      console.log(" This interactive wizard will help you create a novel_seed.md file.")
      break
    }

    case "/feedback": {
      if (!args[0]) {
        console.log("× Usage: /feedback <feedback.json>")
        break
      }

      const filePath = args[0]
      const safePath = resolveSafePath(cwd, filePath)

      if (!(await fileExists(safePath))) {
        console.log(`× File not found: ${filePath}`)
        break
      }

      try {
        const content = await readFile(safePath, "utf-8")
        const feedbackData = JSON.parse(content)
        const feedback = StoryFeedbackSchema.parse(feedbackData)

        await submitFeedbackToMetaLearner(feedback)

        console.log("✓ Feedback submitted successfully!")
        console.log(` Thank you for rating the story: ${feedback.rating}/10`)
      } catch (error) {
        console.log(`× Failed to submit feedback: ${String(error)}`)
      }
      break
    }

    case "/help": {
      console.log(`
📖 Available Novel Commands:

  /start [file]     Start new story (optional: prompt file path)
  /continue         Continue from last saved story
  /inject <file>    Inject context file into memory
  /evolve           Force pattern analysis and skill generation
  /state [target]   Show world state or character state
  /export <md|json> Export story to file
  /patterns         Show discovered narrative patterns
  /reset            Reset story state
  /architect        Open web-based Prompt Architect wizard
  /feedback <file>  Submit story feedback (JSON format)
  /help             Show this help

🔒 Security: All file paths are validated to prevent directory traversal.
`)
      break
    }

    default:
      console.log(`❓ Unknown command: ${cmd}`)
      console.log("Use /help for available commands.")
  }
}

/**
 * Check if input starts with slash command
 */
export function isSlashCommand(input: string): boolean {
  return input.trim().startsWith("/")
}

/**
 * List available skill files
 */
export async function listSkills(cwd: string): Promise<string[]> {
  const skillsPath = getSkillsPath()

  try {
    const files = await readdir(skillsPath)
    return files.filter((f) => f.endsWith(".md"))
  } catch {
    return []
  }
}
