import { Log } from "../util/log"
import { readFile, writeFile } from "fs/promises"
import { resolve, dirname, join } from "path"
import { generateText } from "ai"
import { Provider } from "../provider/provider"
import { Skill } from "../skill/skill"
import { StateExtractor } from "./state-extractor"
import { EvolutionRulesEngine } from "./evolution-rules"
import { RelationshipAnalyzer } from "./relationship-analyzer"
import { CharacterDeepener } from "./character-deepener"
import { mkdir } from "fs/promises"
import { getNovelLanguageModel } from "./model"
import { Instance } from "../project/instance"
import { stateAuditor } from "../middleware/state-auditor"

const log = Log.create({ service: "novel-orchestrator" })

function getStoryBiblePath() {
  return join(Instance.directory, ".opencode/novel/state/story_bible.json")
}

function getDynamicPatternsPath() {
  return join(Instance.directory, ".opencode/novel/patterns/dynamic-patterns.json")
}

function getSkillsPath() {
  return join(Instance.directory, ".opencode/novel/skills")
}

function getSummariesPath() {
  return join(Instance.directory, ".opencode/novel/summaries")
}

interface ChaosResult {
  roll: number
  event: string
  narrativePrompt: string
  category: string
}

interface StoryBranch {
  id: string
  storySegment: string
  branchPoint: string      // 分支点描述
  choiceMade: string       // 选择的行动
  choiceRationale: string  // 选择的原因分析
  stateAfter: StoryState
  evaluation: {
    narrativeQuality: number
    tensionLevel: number
    characterDevelopment: number
    plotProgression: number
    characterGrowth: number  // 角色成长潜力
    riskReward: number        // 风险/回报比
    thematicRelevance: number  // 主题相关性
  }
  selected: boolean
}

interface StoryState {
  characters: Record<string, any>
  world: Record<string, any>
  relationships: Record<string, any>
  currentChapter: string
  chapterCount: number
  timestamps: Record<string, number>
  fullStory: string
  branchHistory: StoryBranch[]
  currentBranchId: string | null
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

export class EvolutionOrchestrator {
  private storyState: StoryState
  private patterns: any[]
  private stateExtractor: StateExtractor
  private relationshipAnalyzer: RelationshipAnalyzer
  private characterDeepener: CharacterDeepener
  private lastChaosResult: ChaosResult | null = null
  private branchOptions: number = 3 // Number of branches to generate

  constructor() {
    this.storyState = {
      characters: {},
      world: {},
      relationships: {},
      currentChapter: "",
      chapterCount: 0,
      timestamps: {},
      fullStory: "",
      branchHistory: [],
      currentBranchId: null,
    }
    this.patterns = []
    this.stateExtractor = new StateExtractor()
    this.relationshipAnalyzer = new RelationshipAnalyzer()
    this.characterDeepener = new CharacterDeepener()
  }

  /**
   * LLM-driven branch generation: Let the model decide everything
   * - Analyzes current state to find natural story branches
   * - Generates multiple story continuations
   * - Evaluates and selects the best one
   */
  async generateBranches(
    promptContent: string,
    baseState: StoryState,
    chaosResult: ChaosResult,
    numBranches: number = 3
  ): Promise<{ selectedBranch: StoryBranch; allBranches: StoryBranch[] }> {
    log.info("generating_branches_llm_driven", { numBranches, chapter: baseState.chapterCount + 1 })

    const languageModel = await getNovelLanguageModel()
    const charSummary = this.stateExtractor.generateContextString(baseState)

    // Step 1: Analyze relationships to inform branch generation
    let relationshipContext = ""
    try {
      const relationshipAnalysis = await this.relationshipAnalyzer.analyzeAllRelationships(baseState.characters)
      relationshipContext = `
RELATIONSHIP ANALYSIS:
${Object.entries(relationshipAnalysis.relationships || {}).map(([pair, rel]: [string, any]) => 
  `${pair}: ${rel.dynamicType} (${rel.tension}), Power: ${rel.powerBalance}, Stage: ${rel.stage}`
).join("\n")}

NARRATIVE SUGGESTIONS:
- Focus on: ${relationshipAnalysis.narrativeSuggestions?.relationshipFocus || "any relationship"}
- Suggested event: ${relationshipAnalysis.narrativeSuggestions?.suggestedEvent || "any"}
`
      log.info("relationship_context_generated", { 
        pairs: Object.keys(relationshipAnalysis.relationships || {}).length 
      })
    } catch (e) {
      log.warn("relationship_analysis_failed", { error: String(e) })
    }

    // Step 2: Let LLM analyze the story and generate multiple branches in one call
    const branchGenerationPrompt = `You are a creative story architect. Analyze the current story state and generate multiple narrative branches.

CURRENT STORY STATE:
${charSummary}

${relationshipContext}

RECENT NARRATIVE:
${baseState.fullStory.slice(-2000)}

CHAOS EVENT:
Roll: ${chaosResult.roll}/6 - ${chaosResult.category}
Event: ${chaosResult.event}
${chaosResult.narrativePrompt}

YOUR TASK:
Generate ${numBranches} different story continuations. Each should be a distinct narrative path that naturally follows from the current state.

For each branch, output:
1. branchPoint: The key decision or turning point
2. choice: The specific action/decision the protagonist takes
3. rationale: Why this choice makes sense given the character's state AND relationships
4. storySegment: The actual story text (300-500 Chinese characters)

IMPORTANT:
- Each branch should be DISTINCT and MEANINGFUL
- Consider character stress, relationships, available clues, and story goals
- Consider the relationship dynamics - some branches should explore relationship tension
- Some branches should be risky, others conservative - let your analysis decide
- The branches should explore different possibilities, not just "win" or "lose"

Output JSON array:
[
  {
    "branchPoint": "...",
    "choice": "...",
    "rationale": "...",
    "storySegment": "..."
  },
  ...
]`

    let branchData: any[] = []

    try {
      const result = await generateText({
        model: languageModel,
        prompt: branchGenerationPrompt,
      })

      const match = result.text.match(/\[[\s\S]*\]/)
      if (match) {
        branchData = JSON.parse(match[0])
        log.info("branches_generated", { count: branchData.length })
      }
    } catch (e) {
      log.error("branch_generation_failed", { error: String(e) })
    }

    // Fallback if generation failed
    if (branchData.length === 0) {
      branchData = [{
        branchPoint: "继续前进",
        choice: "按照原计划行动",
        rationale: "最直接的方式",
        storySegment: "林墨深吸一口气，继续向前。命运已经将他推到了这一步，无论前方是什么，他都必须面对。"
      }]
    }

    // Step 2: Evaluate each branch
    const branches: StoryBranch[] = []
    
    for (let i = 0; i < branchData.length; i++) {
      const data = branchData[i]
      log.info("evaluating_branch", { branch: i + 1, choice: data.choice })

      const evaluation = await this.evaluateBranch(
        data.storySegment, 
        baseState, 
        chaosResult,
        data.rationale
      )

      branches.push({
        id: `branch_${baseState.chapterCount}_${i}`,
        storySegment: data.storySegment,
        branchPoint: data.branchPoint,
        choiceMade: data.choice,
        choiceRationale: data.rationale,
        stateAfter: { ...baseState },
        evaluation,
        selected: false,
      })
    }

    // Step 3: Let LLM select the best branch with reasoning
    const selectedBranch = await this.selectBestBranchLLM(branches, baseState, chaosResult)

    // Extract state from selected branch
    const stateUpdates = await this.stateExtractor.extract(selectedBranch.storySegment, baseState)
    selectedBranch.stateAfter = this.stateExtractor.applyUpdates(baseState, stateUpdates)

    // Store branch history
    this.storyState.branchHistory.push(...branches)
    this.storyState.currentBranchId = selectedBranch.id

    log.info("branch_selected", {
      branchId: selectedBranch.id,
      choice: selectedBranch.choiceMade,
      quality: selectedBranch.evaluation.narrativeQuality
    })

    return { selectedBranch, allBranches: branches }
  }

  /**
   * Let LLM select the best branch with full context awareness
   */
  private async selectBestBranchLLM(
    branches: StoryBranch[],
    baseState: StoryState,
    chaosResult: ChaosResult
  ): Promise<StoryBranch> {
    const languageModel = await getNovelLanguageModel()

    const branchesSummary = branches.map((b, i) => 
      `[Branch ${i + 1}] Choice: ${b.choiceMade}\nRationale: ${b.choiceRationale}\nPreview: ${b.storySegment.slice(0, 200)}...`
    ).join("\n\n")

    const charSummary = this.stateExtractor.generateContextString(baseState)

    const prompt = `You are a story director. Select the best branch for continuing this story.

CURRENT STATE:
${charSummary}

AVAILABLE BRANCHES:
${branchesSummary}

CHAOS EVENT:
${chaosResult.event} (${chaosResult.category})

SELECTION CRITERIA:
1. Narrative quality - engaging, vivid writing
2. Character development - shows growth or meaningful change
3. Plot progression - advances the story meaningfully
4. Thematic relevance - connects to story themes
5. Tension - maintains or increases dramatic tension
6. Logical consistency - choice makes sense given character state

OUTPUT JSON:
{
  "selectedIndex": 0-${branches.length - 1},
  "reasoning": "Why this branch is the best choice",
  "evaluation": {
    "narrativeQuality": 1-10,
    "tensionLevel": 1-10,
    "characterDevelopment": 1-10,
    "plotProgression": 1-10,
    "characterGrowth": 1-10,
    "riskReward": 1-10,
    "thematicRelevance": 1-10
  }
}`

    try {
      const result = await generateText({ model: languageModel, prompt })
      const match = result.text.match(/\{[\s\S]*\}/)
      if (match) {
        const selection = JSON.parse(match[0])
        const selected = branches[selection.selectedIndex]
        
        // Update evaluation with LLM's assessment
        if (selected && selection.evaluation) {
          selected.evaluation = {
            ...selected.evaluation,
            ...selection.evaluation
          }
          selected.choiceRationale = selection.reasoning
        }
        
        log.info("llm_branch_selection", { 
          index: selection.selectedIndex, 
          reasoning: selection.reasoning?.slice(0, 100) 
        })
        
        return selected
      }
    } catch (e) {
      log.warn("llm_selection_failed", { error: String(e) })
    }

    // Fallback: select highest scoring branch
    return branches.reduce((best, b) => 
      (b.evaluation.narrativeQuality > best.evaluation.narrativeQuality) ? b : best
    , branches[0])
  }

  private async generateBranchStory(
    promptContent: string,
    baseState: StoryState,
    chaosResult: ChaosResult,
    branchPoint: string,
    choice: string
  ): Promise<string> {
    const languageModel = await getNovelLanguageModel()

    const previousStory = baseState.fullStory || "(这是故事的开始)"
    const characterInfo = Object.keys(baseState.characters).join(", ") || "主角"

    const systemPrompt = `You are a creative story writer. Continue the story with a SPECIFIC choice.

Rules:
- Write in Chinese
- The protagonist makes a clear choice: "${choice}"
- This choice should stem from: "${branchPoint}"
- Maintain consistency with established characters
- Create engaging, descriptive narrative
- Chapter length: 300-500 Chinese characters
- INCORPORATE the chaos event naturally`

    const userPrompt = `Story Context (previous chapters):
${previousStory.slice(-2000)}

Established Characters: ${characterInfo}

🎲 Chaos Event (Roll: ${chaosResult.roll}/6 - ${chaosResult.category.toUpperCase()}):
${chaosResult.event}
${chaosResult.narrativePrompt}

🔀 Branch Point: ${branchPoint}
✅ Choice Made: ${choice}

Write Chapter ${baseState.chapterCount + 1}:`

    const result = await generateText({
      model: languageModel,
      system: systemPrompt,
      prompt: userPrompt,
    })

    return result.text.trim()
  }

  private async evaluateBranch(
    storySegment: string,
    baseState: StoryState,
    chaosResult: ChaosResult,
    rationale?: string
  ): Promise<StoryBranch["evaluation"]> {
    const languageModel = await getNovelLanguageModel()

    const charSummary = this.stateExtractor.generateContextString(baseState)

    const evalPrompt = `Evaluate this story branch on a scale of 1-10:

1. narrativeQuality: Is the writing engaging, vivid, and well-paced?
2. tensionLevel: Does it maintain or increase dramatic tension?
3. characterDevelopment: Does it reveal or develop character traits/skills/traumas?
4. plotProgression: Does it advance the main plot or introduce interesting subplots?
5. characterGrowth: Does the choice lead to meaningful character growth or change?
6. riskReward: Is there a good balance between risk and potential reward?
7. thematicRelevance: Does this branch connect to the story's themes?

CHARACTER STATE:
${charSummary}

RATIONALE (why this choice was made):
${rationale || "Not provided"}

STORY SEGMENT:
${storySegment.slice(0, 1500)}

Output JSON:
{
  "narrativeQuality": 1-10,
  "tensionLevel": 1-10,
  "characterDevelopment": 1-10,
  "plotProgression": 1-10,
  "characterGrowth": 1-10,
  "riskReward": 1-10,
  "thematicRelevance": 1-10
}`

    try {
      const result = await generateText({
        model: languageModel,
        prompt: evalPrompt,
      })

      const match = result.text.match(/\{[\s\S]*\}/)
      if (match) {
        return JSON.parse(match[0])
      }
    } catch (e) {
      log.warn("branch_evaluation_failed", { error: String(e) })
    }

    // Default evaluation if parsing fails
    return {
      narrativeQuality: 5,
      tensionLevel: 5,
      characterDevelopment: 5,
      plotProgression: 5,
      characterGrowth: 5,
      riskReward: 5,
      thematicRelevance: 5,
    }
  }

  private selectBestBranch(branches: StoryBranch[]): StoryBranch {
    // Weighted scoring: narrative quality 30%, tension 25%, character dev 25%, plot 20%
    const weights = { narrativeQuality: 0.3, tensionLevel: 0.25, characterDevelopment: 0.25, plotProgression: 0.2 }

    let bestBranch = branches[0]
    let bestScore = -1

    for (const branch of branches) {
      const score = 
        branch.evaluation.narrativeQuality * weights.narrativeQuality +
        branch.evaluation.tensionLevel * weights.tensionLevel +
        branch.evaluation.characterDevelopment * weights.characterDevelopment +
        branch.evaluation.plotProgression * weights.plotProgression

      if (score > bestScore) {
        bestScore = score
        bestBranch = branch
      }
    }

    log.info("branch_scored", { bestScore: bestScore.toFixed(2) })
    return bestBranch
  }

  /**
   * Switch to a different branch (time travel / alternate timeline)
   */
  async switchBranch(branchId: string): Promise<boolean> {
    const branch = this.storyState.branchHistory.find(b => b.id === branchId)
    if (!branch) {
      log.error("branch_not_found", { branchId })
      return false
    }

    // Save current state before switching
    const currentBranch = this.storyState.branchHistory.find(b => b.id === this.storyState.currentBranchId)
    if (currentBranch) {
      currentBranch.stateAfter = { ...this.storyState }
    }

    // Switch to selected branch state
    this.storyState = branch.stateAfter
    this.storyState.currentBranchId = branchId

    log.info("branch_switched", { branchId, choice: branch.choiceMade })
    return true
  }

  /**
   * Get available branches for current chapter
   */
  getAvailableBranches(): StoryBranch[] {
    return this.storyState.branchHistory.filter(b => 
      b.id.startsWith(`branch_${this.storyState.chapterCount}`)
    )
  }

  async loadState(): Promise<void> {
    try {
      const path = resolve(getStoryBiblePath())
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
    const path = resolve(getStoryBiblePath())
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(this.storyState, null, 2))
    log.info("state_saved", { chapter: this.storyState.chapterCount })
  }

  async runNovelCycle(promptContent: string, useBranches: boolean = false): Promise<string> {
    log.info("cycle_started", { chapter: this.storyState.chapterCount + 1, useBranches })
    console.log(`\n📝 Starting Chapter ${this.storyState.chapterCount + 1}...`)

    this.patterns = await loadDynamicPatterns()
    console.log(`   Loaded ${this.patterns.length} patterns`)

    const chaosEvent = EvolutionRulesEngine.rollChaos()
    const chaosResult: ChaosResult = {
      roll: chaosEvent.roll,
      event: chaosEvent.description,
      narrativePrompt: chaosEvent.narrativePrompt,
      category: chaosEvent.category,
    }
    this.lastChaosResult = chaosResult
    console.log(`   🎲 Chaos Roll: ${chaosEvent.roll}/6 - ${chaosEvent.category.toUpperCase()}`)

    console.log(`   📖 Parsing prompt...`)
    const elements = await this.parsePromptWithLLM(promptContent)
    log.info("prompt_parsed", elements)

    let storySegment: string
    let stateUpdates: any = {}

    if (useBranches) {
      // Generate multiple branches and select the best one
      console.log(`   🌿 Generating story branches...`)
      const { selectedBranch, allBranches } = await this.generateBranches(
        promptContent,
        this.storyState,
        chaosResult,
        this.branchOptions
      )
      storySegment = selectedBranch.storySegment
      
      // Log branch options
      console.log(`   📋 Branch options:`)
      allBranches.forEach((b, i) => {
        console.log(`      ${i + 1}. ${b.choiceMade} (quality: ${b.evaluation.narrativeQuality}/10)`)
      })
      console.log(`   ✅ Selected: ${selectedBranch.choiceMade}`)
      
      // Update state from selected branch
      this.storyState = selectedBranch.stateAfter
    } else {
      // Original single-story generation
      console.log(`   ✍️  Generating story...`)
      storySegment = await this.generateWithLLM(promptContent, elements, chaosResult)
      console.log(`   Generated ${storySegment.length} chars`)

      console.log(`   🔍 Extracting state changes...`)
      log.info("extracting_state_changes")
      const stateUpdates = await this.stateExtractor.extract(storySegment, this.storyState)
      console.log(`   Extracted: ${Object.keys(stateUpdates.characters || {}).length} characters updated`)

      this.storyState = this.stateExtractor.applyUpdates(this.storyState, stateUpdates)
      log.info("state_changes_applied", {
        characters: Object.keys(this.storyState.characters).length,
        relationships: Object.keys(this.storyState.relationships || {}).length,
      })
    }

    // 审计与分析
    const beforeState = { ...this.storyState } // 保存更新前的快照用于对比分析
    const stats = stateAuditor.analyzeTurn({ ...this.storyState, turnCount: this.storyState.turnCount || 0 } as any, this.storyState as any, this.storyState.turnCount || 0)
    const specialEvents = stateAuditor.detectSpecialEvents(this.storyState as any, stats)
    const consistencyWarnings = stateAuditor.checkConsistency(this.storyState as any)

    if (stats.skillsAwarded > 0 || stats.traumasInflicted > 0 || specialEvents.length > 0) {
      console.log(stateAuditor.generateReport(stats, specialEvents))
    }

    if (consistencyWarnings.length > 0) {
      log.warn("consistency_warnings", { warnings: consistencyWarnings })
    }

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
      const languageModel = await getNovelLanguageModel()

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
      const languageModel = await getNovelLanguageModel()

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
      branchHistory: [],
      currentBranchId: null,
    }
    await this.saveState()
    log.info("state_reset")
  }

  private async saveTurnSummary(stateUpdates: any, chaosResult: ChaosResult): Promise<void> {
    try {
      const summaryDir = resolve(getSummariesPath())
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
    const languageModel = await getNovelLanguageModel()

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
      const dynamicPath = resolve(getDynamicPatternsPath())
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
      const fileName = `${getSkillsPath()}/auto-${Date.now()}.md`
      await writeFile(resolve(fileName), skillContent)
      await Skill.reload()
      log.info("skill_generated", { fileName })
    }
  } catch (error) {
    log.error("skill_generation_failed", { error: String(error) })
  }
}
