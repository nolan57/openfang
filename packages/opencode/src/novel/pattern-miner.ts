import { z } from "zod"
import { readFile, writeFile } from "fs/promises"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { Skill } from "../skill/skill"
import { Log } from "../util/log"
import { generateText } from "ai"
import { Provider } from "../provider/provider"
import { getNovelLanguageModel } from "./model"
import { Instance } from "../project/instance"

const log = Log.create({ service: "pattern-miner" })

const PatternSchema = z.object({
  keyword: z.string(),
  category: z.enum(["character_trait", "plot_device", "world_rule", "tone"]),
  description: z.string(),
  trigger_condition: z.string(),
})

// Get the project directory from Instance
function getProjectDirectory(): string {
  try {
    return Instance.directory
  } catch {
    // Fallback: go up from packages/opencode to project root
    return resolve(process.cwd(), "..")
  }
}

const DynamicPatternsPath = resolve(getProjectDirectory(), ".opencode/novel/patterns/dynamic-patterns.json")
const SkillsPath = resolve(getProjectDirectory(), ".opencode/novel/skills")

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
    // Use LLM to determine if skill generation is needed
    const languageModel = await getNovelLanguageModel()

    const prompt = `Analyze this story context. Determine if a new narrative skill should be generated.

Story context (last 1000 chars):
${context.slice(-1000)}

Output JSON:
{
  "needsSkill": true/false,
  "reason": "why skill is/isn't needed",
  "skillType": "character_development|plot_twist|world_rule|combat|investigation" (if needsSkill)
}`

    const result = await generateText({
      model: languageModel,
      prompt,
    })

    const match = result.text.match(/\{[\s\S]*\}/)
    let needsSkill = false

    if (match) {
      const analysis = JSON.parse(match[0])
      needsSkill = analysis.needsSkill
    }

    // Also check simple patterns as fallback
    if (!needsSkill) {
      const complexPatterns = ["时间循环", "非线性叙事", "多重人格", "梦境", "幻觉"]
      needsSkill = complexPatterns.some((p) => context.includes(p))
    }

    if (needsSkill) {
      const skillContent = await generateSkillContent(context)
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

async function generateSkillContent(context: string): Promise<string> {
  const languageModel = await getNovelLanguageModel()

  const prompt = `Based on this story context, generate a specific, actionable narrative skill instruction.

Story Context (last 1500 chars):
${context.slice(-1500)}

Generate a JSON object for a narrative skill:
{
  "name": "Skill name in Chinese",
  "trigger": "When to trigger this skill",
  "instructions": [
    "Specific narrative instruction 1",
    "Specific narrative instruction 2"
  ],
  "examples": [
    "Example of how to use this in narrative"
  ]
}

The skill should be specific to the story's themes, not generic.`

  try {
    const result = await generateText({
      model: languageModel,
      prompt,
    })

    const match = result.text.match(/\{[\s\S]*\}/)
    if (match) {
      const skill = JSON.parse(match[0])
      return `# Narrative Skill: ${skill.name}

Generated: ${new Date().toISOString()}

## Trigger
${skill.trigger}

## Instructions
${skill.instructions.map((i: string, idx: number) => `${idx + 1}. ${i}`).join("\n")}

## Examples
${skill.examples.map((e: string) => `- ${e}`).join("\n")}

## Integration
This skill should be applied when generating story segments that match the trigger condition.
The narrative must follow these instructions to maintain consistency and depth.
`
    }
  } catch (e) {
    log.warn("llm_skill_generation_failed", { error: String(e) })
  }

  // Fallback
  return `# Auto-Generated Narrative Skill

Generated: ${new Date().toISOString()}

## Trigger
Complex narrative structure detected in story context.

## Instructions
1. Maintain consistency with established character psychology
2. Honor the stress/trauma state when writing
3. Reference previous events appropriately

## Examples
- When stress > 80, use fragmented, chaotic prose
- When trauma is triggered, include sensory flashbacks
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
