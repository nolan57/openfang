import { Log } from "../util/log"
import { readFile, writeFile } from "fs/promises"
import { resolve, dirname } from "path"
import { generateText } from "ai"
import { Provider } from "../provider/provider"
import { Skill } from "../skill/skill"
import { StateExtractor } from "./state-extractor"
import { EvolutionRulesEngine } from "./evolution-rules"
import { mkdir } from "fs/promises"

const log = Log.create({ service: "novel-orchestrator" })

const StoryBiblePath = ".opencode/novel/state/story_bible.json"
const DynamicPatternsPath = ".opencode/novel/patterns/dynamic-patterns.json"
const SkillsPath = ".opencode/novel/skills"
const SummariesPath = ".opencode/novel/summaries"

interface ChaosResult {
  roll: number
  event: string
  narrativePrompt: string
  category: string
}

interface StoryState {
  characters: Record<string, any>
  world: Record<string, any>
  relationships: Record<string, any>
  currentChapter: string
  chapterCount: number
  timestamps: Record<string, number>
  fullStory: string
  [key: string]: any
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

export class EvolutionOrchestrator {
  private storyState: StoryState
  private patterns: any[]
  private stateExtractor: StateExtractor
  private lastChaosResult: ChaosResult | null = null

  constructor() {
    this.storyState = {
      characters: {},
      world: {},
      relationships: {},
      currentChapter: "",
      chapterCount: 0,
      timestamps: {},
      fullStory: "",
    }
    this.patterns = []
    this.stateExtractor = new StateExtractor()
  }

  async loadState(): Promise<void> {
    try {
      const path = resolve(StoryBiblePath)
      if (await fileExists(path)) {
        const content = await readFile(path, "utf-8")
        this.storyState = { ...this.storyState, ...JSON.parse(content) }
        log.info("state_loaded", { chapter: this.storyState.chapterCount })
      }
      this.patterns = await loadDynamicPatterns()
    } catch {
      log.info("no_existing_state")
    }
  }

  async saveState(): Promise<void> {
    const path = resolve(StoryBiblePath)
    await writeFile(path, JSON.stringify(this.storyState, null, 2))
    log.info("state_saved", { chapter: this.storyState.chapterCount })
  }

  async runNovelCycle(promptContent: string): Promise<string> {
    log.info("cycle_started", { chapter: this.storyState.chapterCount + 1 })

    this.patterns = await loadDynamicPatterns()

    const chaosEvent = EvolutionRulesEngine.rollChaos()
    const chaosResult: ChaosResult = {
      roll: chaosEvent.roll,
      event: chaosEvent.description,
      narrativePrompt: chaosEvent.narrativePrompt,
      category: chaosEvent.category,
    }
    this.lastChaosResult = chaosResult

    const elements = await this.parsePromptWithLLM(promptContent)
    log.info("prompt_parsed", elements)

    const storySegment = await this.generateWithLLM(promptContent, elements, chaosResult)

    log.info("extracting_state_changes")
    const stateUpdates = await this.stateExtractor.extract(storySegment, this.storyState)

    const skillAwards = EvolutionRulesEngine.checkSkillUnlocks({
      chapterCount: this.storyState.chapterCount + 1,
      characters: this.storyState.characters,
      worldEvents: this.storyState.world?.events || [],
      storySegment,
    })

    const traumaAwards = EvolutionRulesEngine.checkTraumaTriggers({
      chapterCount: this.storyState.chapterCount + 1,
      characters: this.storyState.characters,
      worldEvents: this.storyState.world?.events || [],
      storySegment,
    })

    for (const award of skillAwards) {
      if (!stateUpdates.characters) stateUpdates.characters = {}
      if (!stateUpdates.characters[award.characterName]) {
        stateUpdates.characters[award.characterName] = {}
      }
      if (!stateUpdates.characters[award.characterName].newSkill) {
        stateUpdates.characters[award.characterName].newSkill = award.skill
      }
    }

    for (const award of traumaAwards) {
      if (!stateUpdates.characters) stateUpdates.characters = {}
      if (!stateUpdates.characters[award.characterName]) {
        stateUpdates.characters[award.characterName] = {}
      }
      if (!stateUpdates.characters[award.characterName].newTrauma) {
        stateUpdates.characters[award.characterName].newTrauma = award.trauma
      }
    }

    this.storyState = this.stateExtractor.applyUpdates(this.storyState, stateUpdates)
    log.info("state_changes_applied", {
      characters: Object.keys(this.storyState.characters).length,
      relationships: Object.keys(this.storyState.relationships || {}).length,
    })

    for (const [charName, char] of Object.entries(this.storyState.characters)) {
      const stressResult = EvolutionRulesEngine.enforceStressLimits(char)
      if (stressResult.breakdown) {
        log.warn("character_breakdown", { character: charName, stress: char.stress })
      }
    }

    this.storyState.chapterCount++
    this.storyState.currentChapter = `第${this.storyState.chapterCount}章`
    this.storyState.fullStory = (this.storyState.fullStory || "") + "\n\n" + storySegment
    this.storyState.timestamps.lastGeneration = Date.now()

    if (elements.characters) {
      for (const char of elements.characters) {
        if (!this.storyState.characters[char]) {
          this.storyState.characters[char] = {
            traits: [],
            stress: 0,
            status: "active",
            trauma: [],
            skills: [],
            secrets: [],
            clues: [],
            notes: "",
          }
        }
      }
    }

    await this.saveState()
    await this.saveTurnSummary(stateUpdates, chaosResult)

    return storySegment
  }

  /**
   * LLM-based prompt parsing - extracts story elements intelligently
   */
  private async parsePromptWithLLM(promptContent: string): Promise<any> {
    try {
      const model = await Provider.defaultModel()
      const modelInfo = await Provider.getModel(model.providerID, model.modelID)
      const languageModel = await Provider.getLanguage(modelInfo)

      const systemPrompt = `You are a story element extractor. Analyze the following prompt and extract story elements in JSON format.

Extract ONLY these fields:
{
  "time": "time and date if mentioned",
  "location": "place/location if mentioned", 
  "characters": ["list of character names mentioned"],
  "event": "main event or conflict",
  "tone": "mood/atmosphere (dark, suspenseful, etc)",
  "genre": "genre if detectable (detective, sci-fi, fantasy, etc)"
}

If a field is not mentioned, use empty string or empty array.`

      const result = await generateText({
        model: languageModel,
        system: systemPrompt,
        prompt: promptContent.substring(0, 3000),
      })

      const text = result.text.trim()
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          time: parsed.time || "",
          location: parsed.location || "",
          characters: parsed.characters || [],
          event: parsed.event || "",
          tone: parsed.tone || "",
          genre: parsed.genre || "",
        }
      }
    } catch (error) {
      log.error("llm_parse_failed", { error: String(error) })
    }

    // Fallback to simple extraction
    return this.parsePromptSimple(promptContent)
  }

  /**
   * Simple fallback parsing
   */
  private parsePromptSimple(promptContent: string): any {
    const elements = { time: "", location: "", characters: [] as string[], event: "", tone: "", genre: "" }

    const timeMatch = promptContent.match(/\d{4}年\d{1,2}月\d{1,2}日.*?\d{1,2}:\d{2}/)
    if (timeMatch) elements.time = timeMatch[0]

    const charPattern = /(林墨|陈雨薇|周远舟|李明|王雪|张伟|赵敏)/g
    const charMatches = promptContent.match(charPattern)
    if (charMatches) elements.characters = [...new Set(charMatches)]

    const eventMatch = promptContent.match(/(案|事件|调查|谋杀|失踪)/)
    if (eventMatch) elements.event = eventMatch[0]

    return elements
  }

  /**
   * LLM-based story generation with full context
   */
  private async generateWithLLM(promptContent: string, elements: any, chaosResult: ChaosResult): Promise<string> {
    try {
      const model = await Provider.defaultModel()
      const modelInfo = await Provider.getModel(model.providerID, model.modelID)
      const languageModel = await Provider.getLanguage(modelInfo)

      const previousStory = this.storyState.fullStory || "(这是故事的开始)"
      const characterInfo = Object.keys(this.storyState.characters).join(", ") || "主角"

      const systemPrompt = `You are a creative story writer. Continue or start a story based on the given prompt and context.

Rules:
- Write in Chinese
- If this is chapter 1, start fresh from the prompt
- If continuing, pick up from where the story left off
- Maintain consistency with established characters and plot
- Create engaging, descriptive narrative
- Chapter length: 300-500 Chinese characters
- INCORPORATE the chaos event naturally into the narrative`

      const userPrompt = `Story Context (previous chapters):
${previousStory.substring(-2000)}

Established Characters: ${characterInfo}

Prompt/Timing: ${elements.time || "某个时刻"} ${elements.location || "某个地方"}
Main Event: ${elements.event || "待揭示"}
Tone: ${elements.tone || "悬疑"}

🎲 Chaos Event (Roll: ${chaosResult.roll}/6 - ${chaosResult.category.toUpperCase()}):
${chaosResult.event}
${chaosResult.narrativePrompt}

Force the narrative to address this chaos event naturally.

Write Chapter ${this.storyState.chapterCount + 1}:`

      const result = await generateText({
        model: languageModel,
        system: systemPrompt,
        prompt: userPrompt,
      })

      return result.text.trim()
    } catch (error) {
      log.error("llm_generate_failed", { error: String(error) })
    }

    // Fallback
    return this.generateFallback(elements)
  }

  /**
   * Fallback generation when LLM fails
   */
  private generateFallback(elements: any): string {
    const time = elements.time || "某个时刻"
    const location = elements.location || "某个地方"
    const characters = elements.characters?.join("、") || "主角"
    const event = elements.event || "神秘事件"

    return `${time}，${location}。

${characters}站在昏暗的灯光下，空气中弥漫着紧张的气息。${event}的调查陷入了僵局，每一个线索都指向更深层的谜团。

"我们必须找到真相，"其中一人低声说道，"不管代价是什么。"

他们知道，这只是开始...`
  }

  getState(): StoryState {
    return this.storyState
  }

  async reset(): Promise<void> {
    this.storyState = {
      characters: {},
      world: {},
      relationships: {},
      currentChapter: "",
      chapterCount: 0,
      timestamps: {},
      fullStory: "",
    }
    await this.saveState()
    log.info("state_reset")
  }

  private async saveTurnSummary(stateUpdates: any, chaosResult: ChaosResult): Promise<void> {
    try {
      const summaryDir = resolve(SummariesPath)
      await mkdir(summaryDir, { recursive: true })

      const chaosEvent = {
        roll: chaosResult.roll,
        category: chaosResult.category as any,
        description: chaosResult.event,
        narrativePrompt: chaosResult.narrativePrompt,
      }

      const summary = EvolutionRulesEngine.generateTurnSummary(
        {
          chapterCount: this.storyState.chapterCount,
          characters: this.storyState.characters,
          worldEvents: this.storyState.world?.events || [],
          storySegment: this.storyState.fullStory.split("\n\n").slice(-1)[0] || "",
        },
        stateUpdates,
        chaosEvent,
      )

      const fileName = `turn_${this.storyState.chapterCount.toString().padStart(3, "0")}_summary.md`
      const filePath = resolve(summaryDir, fileName)
      await writeFile(filePath, summary)
      log.info("summary_saved", { fileName })
    } catch (error) {
      log.error("summary_save_failed", { error: String(error) })
    }
  }
}

/**
 * Standalone function to analyze and evolve patterns
 */
export async function analyzeAndEvolve(context: string, currentPatterns: any[] = []): Promise<void> {
  log.info("pattern_analysis_started", { contextLength: context.length, patternCount: currentPatterns.length })

  try {
    const model = await Provider.defaultModel()
    const modelInfo = await Provider.getModel(model.providerID, model.modelID)
    const languageModel = await Provider.getLanguage(modelInfo)

    const prompt = `You are a narrative pattern analyst.
Analyze this story segment and extract unique patterns NOT in the existing list.

Existing Patterns: ${JSON.stringify(currentPatterns.slice(-5))}
Story Segment: ${context.substring(0, 1500)}

Output JSON array of new patterns. Each pattern:
{ "keyword": "pattern name", "category": "character_trait|plot_device|world_rule|tone", "description": "what this pattern does" }`

    const result = await generateText({
      model: languageModel,
      prompt: prompt,
    })

    const text = result.text
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      log.info("no_patterns_extracted")
      return
    }

    const newPatterns = JSON.parse(jsonMatch[0])
    if (newPatterns.length > 0) {
      const dynamicPath = resolve(DynamicPatternsPath)
      const existing = (await fileExists(dynamicPath))
        ? JSON.parse(await readFile(dynamicPath, "utf-8"))
        : { patterns: [], version: "1.0", lastUpdated: null }

      const merged = {
        ...existing,
        patterns: [...(existing.patterns || []), ...newPatterns],
        lastUpdated: Date.now(),
      }

      await writeFile(dynamicPath, JSON.stringify(merged, null, 2))
      log.info("patterns_discovered", { count: newPatterns.length })

      // Generate skill if complex structure detected
      await checkAndGenerateSkills(context)
    }
  } catch (error) {
    log.error("pattern_analysis_failed", { error: String(error) })
  }
}

async function checkAndGenerateSkills(context: string): Promise<void> {
  try {
    const complexPatterns = ["时间循环", "非线性", "多重人格", "梦境", "幻觉", "逆转", "悬疑"]
    const needsSkill = complexPatterns.some((p) => context.includes(p))

    if (needsSkill) {
      const skillContent = `# Auto-Generated Narrative Skill

Generated: ${new Date().toISOString()}

## Trigger
Detected complex narrative structure in story

## Guidelines
- Maintain consistency with established plot twists
- Track character psychology accurately
- Honor the established mystery elements

## Examples
- Use dramatic irony for suspense
- Plant subtle clues for later revelation
`
      const fileName = `${SkillsPath}/auto-${Date.now()}.md`
      await writeFile(resolve(fileName), skillContent)
      await Skill.reload()
      log.info("skill_generated", { fileName })
    }
  } catch (error) {
    log.error("skill_generation_failed", { error: String(error) })
  }
}
