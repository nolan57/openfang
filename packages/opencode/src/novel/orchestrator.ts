import { Log } from "../util/log"
import { readFile, writeFile } from "fs/promises"
import { resolve } from "path"
import { analyzeAndEvolve, loadDynamicPatterns, PatternMiner } from "./pattern-miner"
import { NovelConfig } from "../config/novel-config"

const log = Log.create({ service: "evolution-orchestrator" })

const StoryBiblePath = ".opencode/novel/state/story_bible.json"

interface StoryState {
  characters: Record<string, any>
  world: Record<string, any>
  relationships: Record<string, any>
  currentChapter: string
  chapterCount: number
  timestamps: Record<string, number>
  [key: string]: any
}

export class EvolutionOrchestrator {
  private patternMiner: PatternMiner
  private storyState: StoryState
  private config: NovelConfig

  constructor() {
    this.patternMiner = new PatternMiner()
    this.config = new NovelConfig()
    this.storyState = {
      characters: {},
      world: {},
      relationships: {},
      currentChapter: "",
      chapterCount: 0,
      timestamps: {},
    }
  }

  async loadState(): Promise<void> {
    try {
      const path = resolve(StoryBiblePath)
      const content = await readFile(path, "utf-8")
      this.storyState = JSON.parse(content)
      log.info("state_loaded", { chapter: this.storyState.chapterCount })
    } catch {
      log.info("no_existing_state")
    }
  }

  async saveState(): Promise<void> {
    const path = resolve(StoryBiblePath)
    await writeFile(path, JSON.stringify(this.storyState, null, 2))
    log.info("state_saved", { chapter: this.storyState.chapterCount })
  }

  async runNovelCycle(input: string): Promise<string> {
    // 1. Load merged patterns (Static + Dynamic)
    const allPatterns = await loadDynamicPatterns()

    // 2. Execute generation with patterns
    const storySegment = await this.generateStory(input, allPatterns)

    // 3. Update state
    this.storyState.chapterCount++
    this.storyState.currentChapter = `第${this.storyState.chapterCount}章`
    this.storyState.fullStory = (this.storyState.fullStory || "") + "\n\n" + storySegment
    this.storyState.timestamps.lastGeneration = Date.now()

    // 4. Trigger evolution (PatternMiner)
    await this.patternMiner.onTurn({ storySegment, significantShift: false })

    // 5. Save updated state
    await this.saveState()

    return storySegment
  }

  private async generateStory(input: string, patterns: any[]): Promise<string> {
    // Parse prompt to extract story elements
    const elements = this.parsePrompt(input)

    // Build context from state
    const context = this.buildContext(elements, patterns)

    // Generate story content (placeholder - in production would use LLM)
    const chapterContent = this.generateFromContext(context, elements)

    return chapterContent
  }

  private parsePrompt(promptContent: string): any {
    const elements = {
      time: "",
      location: "",
      characters: [] as string[],
      event: "",
      chaos: "",
    }

    const timeMatch = promptContent.match(/\d{4}年\d{1,2}月\d{1,2}日.*?\d{1,2}:\d{2}/)
    if (timeMatch) elements.time = timeMatch[0]

    const charPattern = /(林墨|陈雨薇|周远舟|李明|王雪|张伟|赵敏)/g
    const charMatches = promptContent.match(charPattern)
    if (charMatches) elements.characters = [...new Set(charMatches)]

    const eventMatch = promptContent.match(/(\w+案|\w+事件|\w+谋杀)/)
    if (eventMatch) elements.event = eventMatch[1]
    else {
      const simpleEvent = promptContent.match(/(案|事件|调查|谋杀|失踪)/)
      if (simpleEvent) elements.event = simpleEvent[0]
    }

    const chaosMatch = promptContent.match(/掷骰结果.*?=.*?(\d+)/)
    if (chaosMatch) elements.chaos = `掷骰结果 = ${chaosMatch[1]}`

    return elements
  }

  private buildContext(elements: any, patterns: any[]): string {
    let context = ""

    if (this.storyState.characters) {
      context += `Characters: ${JSON.stringify(this.storyState.characters)}\n`
    }

    if (patterns.length > 0) {
      context += `Known Patterns: ${JSON.stringify(patterns.slice(-3))}\n`
    }

    if (elements.characters?.length > 0) {
      context += `Current Characters: ${elements.characters.join(", ")}\n`
    }

    return context
  }

  private generateFromContext(context: string, elements: any): string {
    const time = elements.time || "某个时刻"
    const location = elements.location || "某个地方"
    const characters = elements.characters.length > 0 ? elements.characters.join("、") : "主角"
    const event = elements.event || "神秘事件"
    const chaos = elements.chaos ? `\n\n**${elements.chaos}**` : ""

    return `${time}，${location}。

${characters}站在昏暗的灯光下，空气中弥漫着紧张的气息。${event}的调查陷入了僵局，每一个线索都指向更深层的谜团。

"我们必须找到真相，"其中一人低声说道，"不管代价是什么。"

${chaos}

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
    }
    this.patternMiner.reset()
    await this.saveState()
    log.info("state_reset")
  }
}
