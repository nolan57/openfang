import { z } from "zod"
import { readFile, writeFile } from "fs/promises"
import { resolve } from "path"
import { Skill } from "../skill/skill"
import { Log } from "../util/log"
import { generateText } from "ai"
import { Provider } from "../provider/provider"
import { getNovelLanguageModel } from "./model"

const log = Log.create({ service: "pattern-miner" })

const PatternSchema = z.object({
  keyword: z.string(),
  category: z.enum(["character_trait", "plot_device", "world_rule", "tone"]),
  description: z.string(),
  trigger_condition: z.string(),
})

const DynamicPatternsPath = ".opencode/novel/patterns/dynamic-patterns.json"
const SkillsPath = ".opencode/novel/skills"

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

export async function loadDynamicPatterns(): Promise<any[]> {
  try {
    const path = resolve(DynamicPatternsPath)
    if (await fileExists(path)) {
      const content = await readFile(path, "utf-8")
      const data = JSON.parse(content)
      return data.patterns || []
    }
  } catch (error) {
    log.error("failed_to_load_patterns", { error: String(error) })
  }
  return []
}

export async function analyzeAndEvolve(context: string, currentPatterns: any[] = []): Promise<void> {
  log.info("pattern_analysis_started", { contextLength: context.length, patternCount: currentPatterns.length })

  try {
    const languageModel = await getNovelLanguageModel()

    const prompt = `You are an expert novel editor and system architect.
Analyze the following story fragment and context. Extract unique narrative patterns, character traits, or world rules NOT yet recorded by the system.

Current Known Patterns (Reference only): ${JSON.stringify(currentPatterns.slice(-5))}
Story Context: ${context.substring(0, 2000)}

Output a JSON list of NEW patterns to add. Return an empty array if none found.`

    const result = await generateText({
      model: languageModel,
      prompt: prompt,
    })

    const text = result.text

    // Parse JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      log.info("no_patterns_extracted")
      return
    }

    const newPatterns = JSON.parse(jsonMatch[0])

    if (newPatterns.length > 0) {
      // Update Dynamic Patterns File
      const dynamicPath = resolve(DynamicPatternsPath)
      const existing = (await fileExists(dynamicPath))
        ? JSON.parse(await readFile(dynamicPath, "utf-8"))
        : { patterns: [], version: "1.0" }

      const merged = {
        ...existing,
        patterns: [...(existing.patterns || []), ...newPatterns],
        lastUpdated: Date.now(),
      }

      await writeFile(dynamicPath, JSON.stringify(merged, null, 2))
      log.info("patterns_discovered", { count: newPatterns.length })
    }

    // Check if new Skills are needed
    await checkAndGenerateSkills(context)
  } catch (error) {
    log.error("pattern_analysis_failed", { error: String(error) })
  }
}

async function checkAndGenerateSkills(context: string): Promise<void> {
  try {
    // Simple heuristic check - in production would use LLM
    const complexPatterns = ["时间循环", "非线性叙事", "多重人格", "梦境", "幻觉"]
    const needsSkill = complexPatterns.some((p) => context.includes(p))

    if (needsSkill) {
      const skillContent = generateSkillContent(context)
      const fileName = `${SkillsPath}/auto-${Date.now()}.md`
      await writeFile(resolve(fileName), skillContent)

      // Trigger Hot Reload
      await Skill.reload()
      log.info("skill_generated_and_loaded", { fileName })
    }
  } catch (error) {
    log.error("skill_generation_failed", { error: String(error) })
  }
}

function generateSkillContent(context: string): string {
  return `# Auto-Generated Narrative Skill

Generated: ${new Date().toISOString()}

## Trigger Conditions
Detected in context: ${context.substring(0, 200)}

## System Prompt
You are writing a story with complex narrative elements. Maintain consistency with previously established patterns.

## Narrative Guidelines
- Track character behavior patterns
- Maintain world rules consistency
- Honor established relationship dynamics

## Examples
- When character faces similar situation, reference their past behavior
- When introducing world rule, ensure it's followed consistently
`
}

export class PatternMiner {
  private turnCount: number = 0

  async onTurn(turnData: { storySegment: string; significantShift?: boolean }): Promise<void> {
    this.turnCount++

    // Trigger evolution every 5 turns or on significant shifts
    if (this.turnCount % 5 === 0 || turnData.significantShift) {
      const patterns = await loadDynamicPatterns()
      await analyzeAndEvolve(turnData.storySegment, patterns)
    }
  }

  reset(): void {
    this.turnCount = 0
  }
}
