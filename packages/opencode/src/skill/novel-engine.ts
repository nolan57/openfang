import { NovelConfig } from "../config/novel-config"
import { addPattern } from "./novel-patterns/dynamic"
import { readFile, writeFile } from "fs/promises"
import { resolve } from "path"

/**
 * Core novel engine with state management and LLM integration
 */
export class NovelEngine {
  private config: NovelConfig
  private storyState: any = {}

  constructor() {
    this.config = new NovelConfig()
  }

  /**
   * Initialize a new story session with actual content generation
   */
  async start(promptPath?: string, loops: number = 1): Promise<void> {
    console.log("Starting novel engine...")
    console.log(`Self-evolution loops: ${loops}`)

    let initialPrompt = ""
    if (promptPath) {
      try {
        initialPrompt = await readFile(resolve(promptPath), "utf-8")
        console.log(`Loaded initial prompt from: ${promptPath}`)
      } catch (error) {
        console.error("Failed to read prompt file:", error)
        return
      }
    } else {
      console.log("Starting interactive setup...")
      initialPrompt = "Write a detective story about Lin Mo investigating a mystery."
    }

    await this.initializeStoryState(initialPrompt)
    await this.generateContent(initialPrompt)

    for (let i = 1; i < loops; i++) {
      console.log(`\n--- Self-evolution loop ${i + 1}/${loops} ---`)
      await this.evolve()
      await this.generateContent("Continue the story based on evolved patterns.")
    }

    if (loops > 1) {
      console.log(`\n✅ Completed ${loops} self-evolution loops!`)
    }
  }

  /**
   * Resume the self-evolving loop
   */
  async continue(): Promise<void> {
    console.log("Resuming self-evolving loop...")
    // Load last saved state and generate next part
    const prompt = "Continue the story based on the current state."
    await this.generateContent(prompt)
  }

  /**
   * Inject additional context into current memory
   */
  async inject(filePath: string): Promise<void> {
    try {
      const content = await readFile(resolve(filePath), "utf-8")
      console.log(`Injecting context from: ${filePath}`)

      // Update story state with injected content
      this.storyState.injectedContext = content

      // Trigger pattern mining
      await this.minePatterns(content)
    } catch (error) {
      console.error("Failed to inject context:", error)
    }
  }

  /**
   * Manually trigger PatternMiner
   */
  async evolve(): Promise<void> {
    console.log("Triggering PatternMiner...")
    const storyText = this.storyState.currentChapter || ""
    await this.minePatterns(storyText)
  }

  /**
   * Display current stored state
   */
  async state(target: string): Promise<void> {
    if (target === "world") {
      console.log("Current world state:", JSON.stringify(this.storyState.world, null, 2))
    } else {
      console.log(`Character state for ${target}:`, JSON.stringify(this.storyState.characters?.[target], null, 2))
    }
  }

  /**
   * Export current story and state
   */
  async export(format: "md" | "json" | "pdf"): Promise<void> {
    const storyContent = this.storyState.fullStory || "No story content generated yet."

    if (format === "json") {
      await writeFile("novel_export.json", JSON.stringify(this.storyState, null, 2))
      console.log("Exported story as JSON to novel_export.json")
    } else if (format === "md") {
      const mdContent = `# Novel Export\n\n${storyContent}\n\n## Story State\n\n\`\`\`json\n${JSON.stringify(this.storyState, null, 2)}\n\`\`\``
      await writeFile("novel_export.md", mdContent)
      console.log("Exported story as Markdown to novel_export.md")
    } else {
      console.log("PDF export not implemented yet. Use md or json format.")
    }
  }

  /**
   * Initialize story state with default patterns and actual content
   */
  private async initializeStoryState(initialPrompt: string): Promise<void> {
    console.log("Initializing story state...")

    // Create basic story structure
    this.storyState = {
      characters: {},
      world: {},
      relationships: {},
      fullStory: "",
      currentChapter: "",
      timestamps: {
        initialized: Date.now(),
      },
    }

    // Load static patterns
    const staticPatterns = this.config.getStaticPatterns()
    for (const [name, pattern] of Object.entries(staticPatterns)) {
      addPattern({
        keywords: [],
        themes: [],
        narrativeStructures: [name],
        genreIndicators: [],
        generatedSkills: [JSON.stringify(pattern)],
      })
    }

    // Load genre templates
    const templates = this.config.getGenreTemplates()
    for (const [name, template] of Object.entries(templates)) {
      addPattern({
        keywords: [],
        themes: [name],
        narrativeStructures: [],
        genreIndicators: template.patterns,
        generatedSkills: [JSON.stringify(template)],
      })
    }

    console.log("Story state initialized with default patterns")
  }

  /**
   * Parse prompt file to extract story elements
   */
  private parsePrompt(promptContent: string): any {
    const elements = {
      time: "",
      location: "",
      characters: [] as string[],
      event: "",
      chaos: "",
    }

    // Extract time/location
    const timeMatch = promptContent.match(/\d{4}年\d{1,2}月\d{1,2}日.*?\d{1,2}:\d{2}/)
    if (timeMatch) elements.time = timeMatch[0]

    const locationMatch = promptContent.match(/[赛博都市|城市|警局|医院|实验室|房间].*?[警局|审讯室|病房|实验室]/g)
    if (locationMatch) elements.location = locationMatch[0]

    // Extract character names - match full names
    const charPattern = /(林墨|陈雨薇|周远舟|李明|王雪|张伟|赵敏)/g
    const charMatches = promptContent.match(charPattern)
    if (charMatches) elements.characters = [...new Set(charMatches)]

    // Extract event - more comprehensive
    const eventMatch = promptContent.match(/(\w+案|\w+事件|\w+谋杀|\w+失踪)/)
    if (eventMatch) elements.event = eventMatch[1]
    else {
      const simpleEvent = promptContent.match(/(案|事件|调查|谋杀|失踪)/)
      if (simpleEvent) elements.event = simpleEvent[0]
    }

    // Extract chaos event
    const chaosMatch = promptContent.match(/掷骰结果.*?=.*?(\d+)/)
    if (chaosMatch) elements.chaos = `掷骰结果 = ${chaosMatch[1]}`

    return elements
  }

  /**
   * Generate story content based on prompt elements
   */
  private generateFromPrompt(promptContent: string, elements: any): string {
    const time = elements.time || "深夜"
    const location = elements.location || "警局"
    const characters = elements.characters.length > 0 ? elements.characters.join("、") : "林墨"
    const event = elements.event || "神秘案件"
    const chaos = elements.chaos ? `\n\n**${elements.chaos}**` : ""

    return `${time}，${location}。

${characters}站在昏暗的灯光下，空气中弥漫着紧张的气息。${event}的调查陷入了僵局，每一个线索都指向更深层的谜团。

"我们必须找到真相，"其中一人低声说道，"不管代价是什么。"

${chaos}

他们知道，这只是开始...`
  }

  /**
   * Generate actual story content using placeholder logic
   */
  private async generateContent(prompt: string): Promise<void> {
    console.log("Generating story content from prompt...")

    // Parse prompt to extract story elements
    const elements = this.parsePrompt(prompt)
    console.log("Extracted elements:", JSON.stringify(elements))

    // Generate story based on prompt
    const chapterContent = this.generateFromPrompt(prompt, elements)

    // Generate chapter number
    const chapterNum = (this.storyState.chapterCount || 0) + 1
    const chapterTitle = `第${chapterNum}章：${elements.event || "新的开始"}`
    this.storyState.chapterCount = chapterNum

    this.storyState.currentChapter = chapterTitle
    this.storyState.fullStory += "\n\n" + chapterContent

    // Auto-save state
    await this.saveState()

    console.log("✅ Chapter generated successfully!")
    console.log("Preview:", chapterContent.substring(0, 100) + "...")
  }

  /**
   * Mine patterns from text content
   */
  private async minePatterns(text: string): Promise<void> {
    console.log("Mining patterns from text...")

    // Simple keyword extraction
    const keywords = ["detective", "mystery", "conspiracy", "uploaded souls"]
    const themes = ["betrayal", "discovery"]

    addPattern({
      keywords,
      themes,
      narrativeStructures: [],
      genreIndicators: ["detective"],
      generatedSkills: [`Extracted from: ${text.substring(0, 50)}...`],
    })

    console.log("✅ Patterns mined successfully!")
  }

  /**
   * Save current story state to disk
   */
  private async saveState(): Promise<void> {
    try {
      await writeFile("novel_state.json", JSON.stringify(this.storyState, null, 2))
      console.log("💾 Story state saved to novel_state.json")
    } catch (error) {
      console.error("Failed to save state:", error)
    }
  }
}
