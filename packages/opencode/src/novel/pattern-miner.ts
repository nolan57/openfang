/**
 * @deprecated This module is deprecated and will be removed in a future version.
 * Please use pattern-miner-enhanced.ts instead, which provides:
 * - Generic repository pattern for type safety
 * - Robust JSON parsing with Markdown support
 * - Immutable update patterns
 * - Startup calibration to prevent instant decay
 * - Zod validation for all data operations
 *
 * @see {@link pattern-miner-enhanced.ts} - The enhanced pattern miner
 */
import { z } from "zod"
import { readFile, writeFile, access } from "fs/promises"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { Skill } from "../skill/skill"
import { Log } from "../util/log"
import { generateText } from "ai"
import { Provider } from "../provider/provider"
import { getNovelLanguageModel } from "./model"
import { Instance } from "../project/instance"
import { getDynamicPatternsPath, getSkillsPath } from "./novel-config"

const log = Log.create({ service: "pattern-miner" })

// Emit deprecation warning on module load
log.warn("deprecated_module_loaded", {
  module: "pattern-miner.ts",
  replacement: "pattern-miner-enhanced.ts",
  message: "This module is deprecated. Please migrate to pattern-miner-enhanced.ts",
})

// Structured Pattern Types
const CharacterTraitPatternSchema = z.object({
  type: z.literal("character_trait"),
  name: z.string(),
  description: z.string(),
  associated_skills: z.array(z.string()).optional(),
})

const WorldRulePatternSchema = z.object({
  type: z.literal("world_rule"),
  name: z.string(),
  description: z.string(),
  condition: z.string(),
  effect: z.string(),
})

const SkillPatternSchema = z.object({
  type: z.literal("skill"),
  name: z.string(),
  category: z.string(),
  description: z.string(),
  trigger: z.string().optional(),
})

const PlotDevicePatternSchema = z.object({
  type: z.literal("plot_device"),
  name: z.string(),
  description: z.string(),
  narrative_function: z.string().optional(),
})

const TonePatternSchema = z.object({
  type: z.literal("tone"),
  name: z.string(),
  description: z.string(),
  emotional_impact: z.string().optional(),
})

const PatternSchema = z.discriminatedUnion("type", [
  CharacterTraitPatternSchema,
  WorldRulePatternSchema,
  SkillPatternSchema,
  PlotDevicePatternSchema,
  TonePatternSchema,
])

type Pattern = z.infer<typeof PatternSchema>

// Improved project root detection
async function findProjectRoot(startDir: string): Promise<string> {
  let currentDir = startDir
  const rootMarkerFiles = ["package.json", ".git", "pnpm-workspace.yaml", "bun.lock"]

  while (currentDir !== dirname(currentDir)) {
    for (const marker of rootMarkerFiles) {
      try {
        await access(resolve(currentDir, marker))
        return currentDir
      } catch {
        // Marker not found, continue searching
      }
    }
    currentDir = dirname(currentDir)
  }

  throw new Error("Could not find project root")
}

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
    const path = resolve(getDynamicPatternsPath())
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
      const dynamicPath = resolve(getDynamicPatternsPath())
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
    const languageModel = await getNovelLanguageModel()

    const prompt = `Analyze this story context. Determine if a NEW narrative skill should be generated.

A skill is warranted when:
- A character performs a complex, specialized action that requires expertise
- A significant plot development requires specific narrative treatment
- A unique world rule or ability is demonstrated

Story context (last 1500 chars):
${context.slice(-1500)}

Output JSON:
{
  "needsSkill": true/false,
  "reason": "Detailed explanation of why skill is or isn't needed",
  "skillName": "Proposed skill name if needsSkill is true",
  "skillCategory": "Technical|Combat|Social|Mental|World|Plot",
  "triggerCondition": "When should this skill be applied"
}

Be conservative - only recommend a skill if the story demonstrates something genuinely novel and actionable.`

    const result = await generateText({
      model: languageModel,
      prompt,
    })

    const match = result.text.match(/\{[\s\S]*\}/)
    let needsSkill = false
    let skillInfo = { name: "", category: "Mental", trigger: "" }

    if (match) {
      const analysis = JSON.parse(match[0])
      needsSkill = analysis.needsSkill === true
      skillInfo = {
        name: analysis.skillName || "",
        category: analysis.skillCategory || "Mental",
        trigger: analysis.triggerCondition || "",
      }
    }

    if (needsSkill && skillInfo.name) {
      const skillContent = await generateSkillContent(context, skillInfo)
      const fileName = `${getSkillsPath()}/auto-${Date.now()}.md`
      await writeFile(resolve(fileName), skillContent)

      await Skill.reload()
      log.info("skill_generated_and_loaded", { fileName, skillName: skillInfo.name })
    }
  } catch (error) {
    log.error("skill_generation_failed", { error: String(error) })
  }
}

async function generateSkillContent(
  context: string,
  skillInfo: { name: string; category: string; trigger: string } = { name: "", category: "Mental", trigger: "" },
): Promise<string> {
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
