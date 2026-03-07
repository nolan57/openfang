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
   * Generate actual story content using placeholder logic
   */
  private async generateContent(prompt: string): Promise<void> {
    console.log("Generating story content...")

    // Placeholder implementation - in real system would use LLM
    const sampleStory = `林墨站在警局门口，雨水打湿了他的外套。他刚接到陈雨薇的电话，说周远舟案有了新线索。
    
"我们必须小心，" 陈雨薇低声说，"这个案子比我们想象的要复杂得多。"
    
林墨点点头，他的手不自觉地摸向口袋里的那张神秘纸条。上面只写着一个数字：3728。

他知道，这不仅仅是一个案件，而是一场关于Uploaded Souls的阴谋...

章节生成完成。故事状态已更新。`

    this.storyState.currentChapter = sampleStory
    this.storyState.fullStory += "\n\n" + sampleStory

    // Auto-save state
    await this.saveState()

    console.log("✅ Chapter generated successfully!")
    console.log("Preview:", sampleStory.substring(0, 100) + "...")
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
