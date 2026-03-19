import { Log } from "../util/log"
import { readFile, writeFile, readdir } from "fs/promises"
import { resolve, dirname, join } from "path"
import { Skill } from "../skill/skill"
import { StateExtractor } from "./state-extractor"
import { EvolutionRulesEngine, type ChaosEvent } from "./evolution-rules"
import { RelationshipAnalyzer } from "./relationship-analyzer"
import { CharacterDeepener } from "./character-deepener"
import { mkdir } from "fs/promises"
import { Instance } from "../project/instance"
import { stateAuditor } from "../middleware/state-auditor"
import {
  novelConfigManager,
  getStoryBiblePath,
  getDynamicPatternsPath,
  getSkillsPath,
  getSummariesPath,
} from "./novel-config"
import {
  createNarrativeSkeleton,
  loadNarrativeSkeleton,
  saveNarrativeSkeleton,
  getNextKeyBeat,
  getActiveStoryLines,
  getThematicMotifString,
  type NarrativeSkeleton,
} from "./narrative-skeleton"
import { runThematicReflection, getLatestReflectionTurn } from "./thematic-analyst"
import { generateAndSaveVisualPanels, type VisualGenerationInput } from "./visual-orchestrator"
import { callLLM, callLLMJson, type LLMCallOptions } from "./llm-wrapper"
import { BranchManager, type Branch } from "./branch-manager"
import { novelObservability } from "./observability"
import { StoryWorldMemory, storyWorldMemory } from "./story-world-memory"
import { StoryKnowledgeGraph, storyKnowledgeGraph } from "./story-knowledge-graph"
import { BranchStorage, branchStorage } from "./branch-storage"
import { MotifTracker, motifTracker } from "./motif-tracker"
import { CharacterLifecycleManager, characterLifecycleManager } from "./character-lifecycle"
import { EndGameDetector, endGameDetector } from "./end-game-detection"
import { FactionDetector, factionDetector } from "./faction-detector"
import { RelationshipInertiaManager, relationshipInertiaManager } from "./relationship-inertia"
import { initializeCustomTypes } from "./types"

const log = Log.create({ service: "novel-orchestrator" })

interface ChaosResult {
  roll: number
  event: string
  narrativePrompt: string
  category: string
}

interface StoryBranch {
  id: string
  storySegment: string
  branchPoint: string
  choiceMade: string
  choiceRationale: string
  stateAfter: StoryState
  evaluation: {
    narrativeQuality: number
    tensionLevel: number
    characterDevelopment: number
    plotProgression: number
    characterGrowth: number
    riskReward: number
    thematicRelevance: number
  }
  selected: boolean
  events?: Array<{ id: string; type: string; description: string }>
  structuredState?: Record<string, any>
}

interface CurrentChapter {
  title: string
  content: string
}

interface StoryState {
  characters: Record<string, any>
  world: Record<string, any>
  relationships: Record<string, any>
  currentChapter: CurrentChapter | null
  chapterCount: number
  timestamps: Record<string, number>
  fullStory: string
  branchHistory: StoryBranch[]
  currentBranchId: string | null
  narrativeSkeleton?: NarrativeSkeleton
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

/**
 * Load skill definitions from patterns and skill files
 */
export async function loadSkillDefinitions(): Promise<Record<string, string>> {
  const definitions: Record<string, string> = {}

  try {
    // Load from dynamic patterns
    const patterns = await loadDynamicPatterns()
    for (const pattern of patterns) {
      if (pattern.type === "skill" && pattern.name && pattern.description) {
        definitions[pattern.name] = pattern.description
      }
    }

    // Try loading from skills directory if it exists
    const skillsDir = resolve(dirname(getStoryBiblePath()), "skills")
    if (await fileExists(skillsDir)) {
      const files = await readdir(skillsDir)
      for (const file of files) {
        if (file.endsWith(".md")) {
          const content = await readFile(resolve(skillsDir, file), "utf-8")
          const name = file.replace(".md", "")
          definitions[name] = content.substring(0, 200)
        }
      }
    }
  } catch (error) {
    log.warn("failed_to_load_skill_definitions", { error: String(error) })
  }

  return definitions
}

/**
 * Load trauma definitions from patterns
 */
export async function loadTraumaDefinitions(): Promise<Record<string, string>> {
  const definitions: Record<string, string> = {}

  try {
    const patterns = await loadDynamicPatterns()
    for (const pattern of patterns) {
      if (pattern.type === "trauma" && pattern.name && pattern.description) {
        definitions[pattern.name] = pattern.description
      }
    }
  } catch (error) {
    log.warn("failed_to_load_trauma_definitions", { error: String(error) })
  }

  return definitions
}

export interface OrchestratorConfig {
  branchOptions?: number
  verbose?: boolean
}

export class EvolutionOrchestrator {
  private storyState: StoryState
  private patterns: any[]
  private stateExtractor: StateExtractor
  private relationshipAnalyzer: RelationshipAnalyzer
  private characterDeepener: CharacterDeepener
  private branchManager: BranchManager
  private storyWorldMemory: StoryWorldMemory
  private storyKnowledgeGraph: StoryKnowledgeGraph
  private branchStorage: BranchStorage
  private motifTracker: MotifTracker
  private characterLifecycleManager: CharacterLifecycleManager
  private endGameDetector: EndGameDetector
  private factionDetector: FactionDetector
  private relationshipInertiaManager: RelationshipInertiaManager
  private lastChaosResult: ChaosResult | null = null
  private branchOptions: number = 3
  private verbose: boolean = false
  private advancedModulesInitialized: boolean = false

  constructor(config: OrchestratorConfig = {}) {
    this.storyState = {
      characters: {},
      world: {},
      relationships: {},
      currentChapter: null,
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
    this.branchManager = new BranchManager()
    this.storyWorldMemory = storyWorldMemory
    this.storyKnowledgeGraph = storyKnowledgeGraph
    this.branchStorage = branchStorage
    this.motifTracker = motifTracker
    this.characterLifecycleManager = characterLifecycleManager
    this.endGameDetector = endGameDetector
    this.factionDetector = factionDetector
    this.relationshipInertiaManager = relationshipInertiaManager
    this.branchOptions = config.branchOptions || 3
    this.verbose = config.verbose || false
  }

  /**
   * Initialize advanced modules (databases)
   */
  private async initializeAdvancedModules(): Promise<void> {
    if (this.advancedModulesInitialized) return

    try {
      // Load config and initialize custom types
      await novelConfigManager.load()
      initializeCustomTypes({
        customTraumaTags: novelConfigManager.getCustomTraumaTags(),
        customSkillCategories: novelConfigManager.getCustomSkillCategories(),
        customGoalTypes: novelConfigManager.getCustomGoalTypes(),
        customEmotionTypes: novelConfigManager.getCustomEmotionTypes(),
        customCharacterStatus: novelConfigManager.getCustomCharacterStatus(),
      })

      await this.storyWorldMemory.initialize()
      await this.storyKnowledgeGraph.initialize()
      await this.branchStorage.initialize()
      await this.motifTracker.initialize()

      this.advancedModulesInitialized = true
      this.log("Advanced modules initialized", {
        memory: "story-memory.db",
        graph: "story-graph.db",
        branches: "branches.db",
        motif: "motif-tracking/",
      })
    } catch (error) {
      log.error("advanced_modules_init_failed", { error: String(error) })

      const initStatus = {
        storyWorldMemory: (this.storyWorldMemory as any).initialized,
        storyKnowledgeGraph: (this.storyKnowledgeGraph as any).initialized,
        branchStorage: (this.branchStorage as any).initialized,
        motifTracker: (this.motifTracker as any).initialized,
      }
      log.error("advanced_modules_init_status", initStatus)

      throw new Error(`Advanced modules initialization failed: ${String(error)}`)
    }
  }

  /**
   * Initialize character deepener with world knowledge from patterns
   */
  private async initializeCharacterDeepener(): Promise<void> {
    try {
      const skillDefs = await loadSkillDefinitions()
      const traumaDefs = await loadTraumaDefinitions()

      this.characterDeepener.updateConfig({
        skillDefinitions: skillDefs,
        traumaDefinitions: traumaDefs,
      })

      this.log("Initialized character deepener with world knowledge", {
        skills: Object.keys(skillDefs).length,
        traumas: Object.keys(traumaDefs).length,
      })
    } catch (error) {
      log.warn("failed_to_initialize_character_deepener", { error: String(error) })
    }
  }

  private log(message: string, ...args: any[]): void {
    if (this.verbose) {
      console.log(message, ...args)
    }
  }

  private async ensureNarrativeSkeleton(initialPrompt: string): Promise<void> {
    try {
      const existingSkeleton = await loadNarrativeSkeleton()

      if (existingSkeleton) {
        this.storyState.narrativeSkeleton = existingSkeleton
        this.log(`   Loaded existing narrative skeleton with ${existingSkeleton.storyLines.length} story lines`)
      } else {
        this.log(`   Creating new narrative skeleton...`)
        const theme = this.extractThemeFromPrompt(initialPrompt)
        const tone = this.extractToneFromPrompt(initialPrompt)

        const skeleton = await createNarrativeSkeleton(theme, tone, initialPrompt)
        this.storyState.narrativeSkeleton = skeleton
        this.log(
          `   Created skeleton with ${skeleton.storyLines.length} story lines, ${Object.keys(skeleton.thematicMotifs).length} motifs`,
        )
      }
    } catch (error) {
      log.error("narrative_skeleton_initialization_failed", { error: String(error) })
    }
  }

  private extractThemeFromPrompt(prompt: string): string {
    const match = prompt.match(/theme[:：]\s*([^,\n.]+)/i)
    if (match) return match[1].trim()
    return prompt.substring(0, 100)
  }

  private extractToneFromPrompt(prompt: string): string {
    const match = prompt.match(/tone[:：]\s*([^,\n.]+)/i)
    if (match) return match[1].trim()
    return "epic narrative"
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
    numBranches: number = 3,
  ): Promise<{ selectedBranch: StoryBranch; allBranches: StoryBranch[] }> {
    log.info("generating_branches_llm_driven", {
      numBranches,
      chapter: baseState.chapterCount + 1,
    })

    const charSummary = this.stateExtractor.generateContextString(baseState)

    // Step 1: Analyze relationships to inform branch generation
    let relationshipContext = ""
    try {
      const relationshipAnalysis = await this.relationshipAnalyzer.analyzeAllRelationships(baseState.characters)
      relationshipContext = `
RELATIONSHIP ANALYSIS:
${Object.entries(relationshipAnalysis.relationships || {})
  .map(
    ([pair, rel]: [string, any]) =>
      `${pair}: ${rel.dynamicType} (${rel.tension}), Power: ${rel.powerBalance}, Stage: ${rel.stage}`,
  )
  .join("\n")}

NARRATIVE SUGGESTIONS:
- Focus on: ${relationshipAnalysis.narrativeSuggestions?.relationshipFocus || "any relationship"}
- Suggested event: ${relationshipAnalysis.narrativeSuggestions?.suggestedEvent || "any"}
`
      log.info("relationship_context_generated", {
        pairs: Object.keys(relationshipAnalysis.relationships || {}).length,
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
      const result = await callLLM({
        prompt: branchGenerationPrompt,
        callType: "branch_generation",
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
      branchData = [
        {
          branchPoint: "Continue forward",
          choice: "Proceed with original plan",
          rationale: "The most direct path forward",
          storySegment: "continue forward, proceed with original plan, the most direct path forward",
        },
      ]
    }

    // Step 2: Evaluate each branch
    const branches: StoryBranch[] = []

    for (let i = 0; i < branchData.length; i++) {
      const data = branchData[i]
      log.info("evaluating_branch", { branch: i + 1, choice: data.choice })

      const evaluation = await this.evaluateBranch(data.storySegment, baseState, chaosResult, data.rationale)

      branches.push({
        id: `branch_${baseState.chapterCount}_${i}`,
        storySegment: data.storySegment,
        branchPoint: data.branchPoint,
        choiceMade: data.choice,
        choiceRationale: data.rationale,
        stateAfter: { ...baseState },
        evaluation,
        selected: false,
        events: [],
        structuredState: {},
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
      quality: selectedBranch.evaluation.narrativeQuality,
    })

    return { selectedBranch, allBranches: branches }
  }

  /**
   * Let LLM select the best branch with full context awareness
   */
  private async selectBestBranchLLM(
    branches: StoryBranch[],
    baseState: StoryState,
    chaosResult: ChaosResult,
  ): Promise<StoryBranch> {
    const branchesSummary = branches
      .map(
        (b, i) =>
          `[Branch ${i + 1}] Choice: ${b.choiceMade}\nRationale: ${b.choiceRationale}\nPreview: ${b.storySegment.slice(0, 200)}...`,
      )
      .join("\n\n")

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
      const result = await callLLM({ prompt, callType: "branch_selection" })
      const match = result.text.match(/\{[\s\S]*\}/)
      if (match) {
        const selection = JSON.parse(match[0])
        const selected = branches[selection.selectedIndex]

        // Update evaluation with LLM's assessment
        if (selected && selection.evaluation) {
          selected.evaluation = {
            ...selected.evaluation,
            ...selection.evaluation,
          }
          selected.choiceRationale = selection.reasoning
        }

        log.info("llm_branch_selection", {
          index: selection.selectedIndex,
          reasoning: selection.reasoning?.slice(0, 100),
        })

        return selected
      }
    } catch (e) {
      log.warn("llm_selection_failed", { error: String(e) })
    }

    // Fallback: select highest scoring branch
    return branches.reduce(
      (best, b) => (b.evaluation.narrativeQuality > best.evaluation.narrativeQuality ? b : best),
      branches[0],
    )
  }

  private async generateBranchStory(
    promptContent: string,
    baseState: StoryState,
    chaosResult: ChaosResult,
    branchPoint: string,
    choice: string,
  ): Promise<string> {
    const previousStory = baseState.fullStory || "(这是故事的开始)"
    const characterInfo = Object.keys(baseState.characters).join(", ") || "主角"

    // Detect language from prompt [LANGUAGE: ...] tag
    const languageMatch = promptContent.match(/\[LANGUAGE:\s*([^\]]+)\]/i)
    const specifiedLanguage = languageMatch ? languageMatch[1].trim() : "Chinese"
    const languageInstruction = `IMPORTANT: Write all story content in ${specifiedLanguage}.`

    const systemPrompt = `You are a creative story writer. Continue the story with a SPECIFIC choice.

Rules:
- ${languageInstruction}
- The protagonist makes a clear choice: "${choice}"
- This choice should stem from: "${branchPoint}"
- Maintain consistency with established characters
- Create engaging, descriptive narrative
- Chapter length: 300-500 words (or 500-800 Chinese characters)
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

    const result = await callLLM({
      prompt: userPrompt,
      system: systemPrompt,
      callType: "branch_story_generation",
    })

    return result.text.trim()
  }

  private async evaluateBranch(
    storySegment: string,
    baseState: StoryState,
    chaosResult: ChaosResult,
    rationale?: string,
  ): Promise<StoryBranch["evaluation"]> {
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
      const result = await callLLM({
        prompt: evalPrompt,
        callType: "branch_evaluation",
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
    const weights = {
      narrativeQuality: 0.3,
      tensionLevel: 0.25,
      characterDevelopment: 0.25,
      plotProgression: 0.2,
    }

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
    const branch = this.storyState.branchHistory.find((b) => b.id === branchId)
    if (!branch) {
      log.error("branch_not_found", { branchId })
      return false
    }

    // Save current state before switching
    const currentBranch = this.storyState.branchHistory.find((b) => b.id === this.storyState.currentBranchId)
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
    return this.storyState.branchHistory.filter((b) => b.id.startsWith(`branch_${this.storyState.chapterCount}`))
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
      await this.initializeCharacterDeepener()
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
    const cycleStart = Date.now()
    log.info("novel_cycle_start", {
      chapter: this.storyState.chapterCount + 1,
      useBranches,
      timestamp: new Date().toISOString(),
    })
    this.log(`\nStarting Chapter ${this.storyState.chapterCount + 1}...`)

    // Initialize advanced modules (databases)
    this.log(`   [DEBUG] Initializing advanced modules...`)
    const initStart = Date.now()
    await this.initializeAdvancedModules()
    this.log(`   [DEBUG] Advanced modules initialized in ${Date.now() - initStart}ms`)

    await this.ensureNarrativeSkeleton(promptContent)

    this.patterns = await loadDynamicPatterns()
    await this.initializeCharacterDeepener()
    this.log(`   Loaded ${this.patterns.length} patterns`)

    const chaosEvent = EvolutionRulesEngine.rollChaos()

    // 动态生成具体事件
    this.log(`   [DEBUG] Generating chaos event with LLM...`)
    const chaosStart = Date.now()
    const chaosEventWithDetail = await EvolutionRulesEngine.generateChaosEventWithLLM(chaosEvent, {
      currentStory: promptContent,
      characters: Object.keys(this.storyState.characters || {}),
      recentEvents: this.storyState.world?.events || [],
    })
    this.log(`   [DEBUG] Chaos event generated in ${Date.now() - chaosStart}ms`)

    const chaosResult: ChaosResult = {
      roll: chaosEventWithDetail.rollImpact,
      event: chaosEventWithDetail.generatedEvent || chaosEventWithDetail.narrativeDirection,
      narrativePrompt: chaosEventWithDetail.narrativeDirection,
      category: `${chaosEventWithDetail.impact}-${chaosEventWithDetail.magnitude}` as any,
    }
    this.lastChaosResult = chaosResult
    this.log(`   Chaos: ${chaosEventWithDetail.impact.toUpperCase()} impact, ${chaosEventWithDetail.magnitude} change`)

    this.log(`   Parsing prompt...`)
    const elements = await this.parsePromptWithLLM(promptContent)
    log.info("prompt_parsed", elements)

    let storySegment: string
    let stateUpdates: any = {}

    if (useBranches) {
      // Generate multiple branches and select the best one
      this.log(`   Generating story branches...`)
      const { selectedBranch, allBranches } = await this.generateBranches(
        promptContent,
        this.storyState,
        chaosResult,
        this.branchOptions,
      )
      storySegment = selectedBranch.storySegment

      // Log branch options
      this.log(`   Branch options:`)
      allBranches.forEach((b, i) => {
        this.log(`      ${i + 1}. ${b.choiceMade} (quality: ${b.evaluation.narrativeQuality}/10)`)
      })
      this.log(`   Selected: ${selectedBranch.choiceMade}`)

      // Store branches in branch storage
      try {
        for (const branch of allBranches) {
          await this.branchStorage.saveBranch({
            id: branch.id || `branch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            storySegment: branch.storySegment,
            branchPoint: branch.branchPoint,
            choiceMade: branch.choiceMade,
            choiceRationale: branch.choiceRationale,
            stateAfter: branch.stateAfter,
            evaluation: branch.evaluation,
            selected: branch === selectedBranch,
            createdAt: Date.now(),
            chapter: this.storyState.chapterCount + 1,
            events: branch.events || [],
            structuredState: branch.structuredState || {},
          })
        }
        this.log(`   Stored ${allBranches.length} branches`)
      } catch (error) {
        log.warn("branch_storage_failed", { error: String(error) })
      }

      // Update state from selected branch
      this.storyState = selectedBranch.stateAfter
    } else {
      // Original single-story generation
      this.log(`   [DEBUG] Generating story with LLM...`)
      const storyStart = Date.now()
      storySegment = await this.generateWithLLM(promptContent, elements, chaosResult)
      this.log(`   [DEBUG] Story generated in ${Date.now() - storyStart}ms`, {
        length: storySegment.length,
      })
      this.log(`   Generated ${storySegment.length} chars`)

      this.log(`   [DEBUG] Extracting state changes...`)
      const extractStart = Date.now()
      const stateUpdates = await this.stateExtractor.extract(storySegment, this.storyState)
      this.log(`   [DEBUG] State extracted in ${Date.now() - extractStart}ms`, {
        charactersUpdated: Object.keys(stateUpdates.characters || {}).length,
      })

      this.storyState = this.stateExtractor.applyUpdates(this.storyState, stateUpdates)
      log.info("state_changes_applied", {
        characters: Object.keys(this.storyState.characters).length,
        relationships: Object.keys(this.storyState.relationships || {}).length,
      })

      const majorCharacters = Object.keys(this.storyState.characters).slice(0, 5)
      if (majorCharacters.length > 0) {
        this.log(`   Extracting mind models for ${majorCharacters.length} characters...`)
        const mindModels = await this.stateExtractor.extractMindModelsForCharacters(
          majorCharacters,
          storySegment,
          this.storyState,
        )
        for (const [charName, mindModel] of Object.entries(mindModels)) {
          if (this.storyState.characters[charName]) {
            this.storyState.characters[charName].mindModel = mindModel
          }
        }
        this.log(`   Extracted ${Object.keys(mindModels).length} mind models`)
      }
    }

    // 【新增】如果仍然没有角色，从故事文本中提取
    if (Object.keys(this.storyState.characters).length === 0) {
      this.log(`   [DEBUG] No characters found, extracting from story...`)
      const charExtractStart = Date.now()
      const extractedCharacters = await this.extractCharactersFromStory(storySegment)
      this.log(`   [DEBUG] Character extraction completed in ${Date.now() - charExtractStart}ms`, {
        count: extractedCharacters.length,
        names: extractedCharacters.slice(0, 5),
      })
      for (const charName of extractedCharacters) {
        if (!this.storyState.characters[charName]) {
          this.storyState.characters[charName] = {
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
      this.log(`   Extracted ${extractedCharacters.length} characters from story text`)
    }

    // Extract title from generated content
    const extractedTitle = await this.extractChapterTitle(storySegment)

    // Audit and analysis
    const beforeState = { ...this.storyState }
    const stats = stateAuditor.analyzeTurn(
      { ...this.storyState, turnCount: this.storyState.turnCount || 0 } as any,
      this.storyState as any,
      this.storyState.turnCount || 0,
    )
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
        log.warn("character_breakdown", {
          character: charName,
          stress: char.stress,
        })
      }
    }

    this.storyState.chapterCount++
    this.storyState.currentChapter = {
      title: extractedTitle || `${this.storyState.chapterCount}`,
      content: storySegment,
    }
    this.storyState.fullStory = (this.storyState.fullStory || "") + "\n\n" + storySegment
    this.storyState.timestamps.lastGeneration = Date.now()

    // Ensure characters is an array before iterating
    const characters = Array.isArray(elements.characters) ? elements.characters : []
    for (const char of characters) {
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

    // Analyze and evolve patterns/skills
    await analyzeAndEvolve(storySegment, this.patterns)

    // === ADVANCED MODULES INTEGRATION ===

    // 1. Store chapter summary in story memory
    try {
      await this.storyWorldMemory.storeChapterSummary(
        this.storyState.chapterCount,
        storySegment.substring(0, 500),
        Object.keys(this.storyState.characters),
        elements.location ? [elements.location] : [],
        this.storyState.world?.events || [],
        this.storyState.narrativeSkeleton?.theme ? [this.storyState.narrativeSkeleton.theme] : [],
      )
      this.log(`   Stored chapter ${this.storyState.chapterCount} in story memory`)
    } catch (error) {
      log.warn("story_memory_store_failed", { error: String(error) })
    }

    // 2. Update knowledge graph with entities
    try {
      for (const charName of Object.keys(this.storyState.characters)) {
        const existingNode = await this.storyKnowledgeGraph.getNode(`character_${charName}`)
        if (!existingNode) {
          await this.storyKnowledgeGraph.addCharacter(charName, this.storyState.chapterCount, {
            stress: this.storyState.characters[charName].stress,
            status: this.storyState.characters[charName].status,
          })
        } else {
          await this.storyKnowledgeGraph.updateNodeStatus(
            `character_${charName}`,
            this.storyState.characters[charName].status || "active",
            this.storyState.chapterCount,
          )
        }
      }
      if (elements.location) {
        await this.storyKnowledgeGraph.addLocation(elements.location, this.storyState.chapterCount)
      }
      this.log(`   Updated knowledge graph`)
    } catch (error) {
      log.warn("knowledge_graph_update_failed", { error: String(error) })
    }

    // 3. Update character lifecycle
    try {
      this.characterLifecycleManager.setCurrentChapter(this.storyState.chapterCount)
      for (const [charName, char] of Object.entries(this.storyState.characters)) {
        const lifecycle = this.characterLifecycleManager.getLifecycle(charName)
        if (!lifecycle) {
          this.characterLifecycleManager.registerCharacter(charName, this.storyState.chapterCount, 25)
        }
        if (char.status === "deceased" || char.status === "dead") {
          this.characterLifecycleManager.recordDeath(charName, "story event")
        }
      }
    } catch (error) {
      log.warn("lifecycle_update_failed", { error: String(error) })
    }

    // 4. Update relationship inertia
    try {
      for (const [relKey, rel] of Object.entries(this.storyState.relationships || {})) {
        const [charA, charB] = relKey.split("-")
        if (charA && charB) {
          const inertia = this.relationshipInertiaManager.getInertia(charA, charB)
          if (!inertia) {
            this.relationshipInertiaManager.initializeRelationship(charA, charB, (rel as any).trust || 50)
          }
        }
      }
      // Generate plot hooks based on relationships
      if (this.storyState.chapterCount % 3 === 0) {
        await this.relationshipInertiaManager.generatePlotHooks(
          this.storyState.relationships,
          this.storyState.characters,
          this.storyState.chapterCount,
        )
      }
    } catch (error) {
      log.warn("relationship_inertia_update_failed", { error: String(error) })
    }

    // 5. Detect factions (every 5 chapters)
    if (this.storyState.chapterCount % 5 === 0) {
      try {
        const factionResult = this.factionDetector.detectFactions(
          this.storyState.characters,
          this.storyState.relationships,
          this.storyState.chapterCount,
        )
        if (factionResult.factions.length > 0) {
          this.log(`   Detected ${factionResult.factions.length} factions`)
        }
      } catch (error) {
        log.warn("faction_detection_failed", { error: String(error) })
      }
    }

    // 6. Check end game conditions (every 10 chapters)
    if (this.storyState.chapterCount % 10 === 0) {
      try {
        this.endGameDetector.updateStoryMetrics({
          totalChapters: this.storyState.chapterCount,
          resolvedArcs:
            this.storyState.narrativeSkeleton?.storyLines?.filter((s: any) => s.status === "completed").length || 0,
          totalArcs: this.storyState.narrativeSkeleton?.storyLines?.length || 1,
          thematicCoverage: 70,
          resolvedConflicts: 0,
          totalConflicts: Object.keys(this.storyState.relationships || {}).length,
        })
        const endGameReport = await this.endGameDetector.checkCompletion()
        if (endGameReport.isComplete) {
          this.log(`   *** Story completion detected! Score: ${endGameReport.completionScore.toFixed(1)}% ***`)
        }
      } catch (error) {
        log.warn("end_game_check_failed", { error: String(error) })
      }
    }

    // 7. Analyze motifs (using motif-tracker)
    if (this.storyState.chapterCount % 3 === 0 && this.patterns.length > 0) {
      try {
        await this.motifTracker.analyzeMotifEvolution(
          this.patterns,
          storySegment,
          this.storyState.characters,
          this.storyState.chapterCount,
        )
      } catch (error) {
        log.warn("motif_analysis_failed", { error: String(error) })
      }
    }

    // === END ADVANCED MODULES INTEGRATION ===

    const currentTurn = this.storyState.turnCount || 0
    const reflectionInterval = novelConfigManager.getThematicReflectionInterval()
    if (currentTurn > 0 && currentTurn % reflectionInterval === 0) {
      this.log(`   Running thematic reflection (turn ${currentTurn})...`)
      try {
        const theme = this.storyState.narrativeSkeleton?.theme || "Story themes"
        await runThematicReflection(currentTurn, theme)
        this.log(`   Thematic reflection completed`)
      } catch (error) {
        log.error("thematic_reflection_failed", { error: String(error) })
      }
    }

    this.log(`   [DEBUG] Saving story state...`)
    const saveStart = Date.now()
    await this.saveState()
    this.log(`   [DEBUG] Story state saved in ${Date.now() - saveStart}ms`)

    this.log(`   [DEBUG] Saving turn summary...`)
    const summaryStart = Date.now()
    await this.saveTurnSummary(stateUpdates, chaosResult)
    this.log(`   [DEBUG] Turn summary saved in ${Date.now() - summaryStart}ms`)

    // Generate visual panels using dedicated visual orchestrator
    // Write debug log to file (guaranteed to work even if console is suppressed)
    const debugLogPath = "/tmp/novel_visual_debug.log"
    const timestamp = new Date().toISOString()
    await import("fs/promises").then(({ appendFile }) =>
      appendFile(
        debugLogPath,
        `[${timestamp}] Chapter ${this.storyState.chapterCount}: Starting visual panels, chars=${Object.keys(this.storyState.characters).length}\n`,
      ),
    )

    console.log(`\n[VISUAL PANEL DEBUG] Starting visual panel generation for chapter ${this.storyState.chapterCount}`)
    console.log(`[VISUAL PANEL DEBUG] Character count: ${Object.keys(this.storyState.characters).length}`)
    console.log(`[VISUAL PANEL DEBUG] Story segment length: ${storySegment.length}`)

    this.log(`   [DEBUG] Preparing visual panel generation...`)
    const visualInput: VisualGenerationInput = {
      storySegment,
      characters: this.storyState.characters,
      narrativeSkeleton: this.storyState.narrativeSkeleton,
      chapterCount: this.storyState.chapterCount,
      currentChapterTitle: this.storyState.currentChapter?.title,
    }

    this.log(`   [DEBUG] Character count for visual: ${Object.keys(this.storyState.characters).length}`)
    this.log(`   [DEBUG] Story segment length: ${storySegment.length}`)

    console.log(`[VISUAL PANEL DEBUG] Calling generateAndSaveVisualPanels...`)
    const visualStart = Date.now()
    const { panels, savedPath } = await generateAndSaveVisualPanels(visualInput, {
      maxPanels: 4,
      defaultStyle: "realistic",
      verbose: this.verbose,
    })
    const visualDuration = Date.now() - visualStart
    console.log(`[VISUAL PANEL DEBUG] Visual panels completed in ${visualDuration}ms`)
    console.log(`[VISUAL PANEL DEBUG] Panel count: ${panels.length}`)
    console.log(`[VISUAL PANEL DEBUG] Saved path: ${savedPath}\n`)

    this.log(`   [DEBUG] Visual panels completed in ${visualDuration}ms`, {
      panelCount: panels.length,
      savedPath,
      hasCharacters: Object.keys(this.storyState.characters).length > 0,
    })

    if (panels.length > 0) {
      this.log(
        `   Generated ${panels.length} visual panels in ${visualDuration}ms${savedPath ? ` -> ${savedPath}` : ""}`,
      )
    } else {
      this.log(`   [WARN] No visual panels generated (duration: ${visualDuration}ms)`)
    }

    const totalDuration = Date.now() - cycleStart
    log.info("novel_cycle_completed", {
      chapter: this.storyState.chapterCount,
      totalDurationMs: totalDuration,
      storyLength: storySegment.length,
      characterCount: Object.keys(this.storyState.characters).length,
      panelCount: panels?.length || 0,
    })
    this.log(`   [DEBUG] Chapter ${this.storyState.chapterCount} completed in ${totalDuration}ms`)

    return storySegment
  }

  /**
   * LLM-based prompt parsing - extracts story elements intelligently
   * Uses retry logic to prevent infinite recursion
   */
  private async parsePromptWithLLM(promptContent: string, retries: number = 0): Promise<any> {
    const maxRetries = 2

    if (retries > maxRetries) {
      log.warn("parse_prompt_max_retries_exceeded")
      return {
        time: "",
        location: "",
        characters: [],
        event: "unspecified event",
        tone: "",
        genre: "",
      }
    }

    try {
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

      const result = await callLLM({
        prompt: promptContent.substring(0, 3000),
        system: systemPrompt,
        callType: "prompt_parsing",
      })

      const text = result.text.trim()
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          time: parsed.time || "",
          location: parsed.location || "",
          characters: Array.isArray(parsed.characters) ? parsed.characters : [],
          event: parsed.event || "",
          tone: parsed.tone || "",
          genre: parsed.genre || "",
        }
      }
    } catch (error) {
      log.error("llm_parse_failed", { error: String(error), retry: retries })
    }

    // Retry with exponential backoff
    return this.parsePromptWithLLM(promptContent, retries + 1)
  }

  /**
   * Simple fallback parsing - removed. Relies entirely on LLM.
   */
  private parsePromptSimple(promptContent: string): any {
    return this.parsePromptWithLLM(promptContent)
  }

  /**
   * LLM-based story generation with full context
   */
  private async generateWithLLM(promptContent: string, elements: any, chaosResult: ChaosResult): Promise<string> {
    try {
      const previousStory = this.storyState.fullStory || "(This is where the story begins)"
      const characterInfo = Object.keys(this.storyState.characters).join(", ") || "The protagonist"
      const currentChapter = this.storyState.chapterCount + 1

      const skeletonContext = this.buildSkeletonContextForChapter(currentChapter)

      // Detect language from prompt [LANGUAGE: ...] tag
      const languageMatch = promptContent.match(/\[LANGUAGE:\s*([^\]]+)\]/i)
      const specifiedLanguage = languageMatch ? languageMatch[1].trim() : null
      const languageInstruction = specifiedLanguage
        ? `IMPORTANT: Write all story content, dialogue, and narration in ${specifiedLanguage}. This is a strict requirement.`
        : "Write in the same language as the prompt"

      const systemPrompt = `You are a creative story writer. Continue or start a story based on the given prompt and context.

Rules:
- ${languageInstruction}
- If this is chapter 1, start fresh from the prompt
- If continuing, pick up from where the story left off
- Maintain consistency with established characters and plot
- Create engaging, descriptive narrative
- Chapter length: 300-500 words (or 500-800 Chinese characters)
- INCORPORATE the chaos event naturally into the narrative
- ALIGN with the narrative skeleton and thematic motifs provided`

      const userPrompt = `Story Context (previous chapters):
${previousStory.substring(-2000)}

Established Characters: ${characterInfo}
${skeletonContext}
Prompt/Timing: ${elements.time || "some time"} ${elements.location || "some location"}
Main Event: ${elements.event || "unfolding events"}
Tone: ${elements.tone || "neutral"}

Chaos Event (Roll: ${chaosResult.roll}/6 - ${chaosResult.category.toUpperCase()}):
${chaosResult.event}
${chaosResult.narrativePrompt}

Force the narrative to address this chaos event naturally while advancing the story lines and reinforcing thematic motifs.

Write Chapter ${currentChapter}:`

      const result = await callLLM({
        prompt: userPrompt,
        system: systemPrompt,
        callType: "story_generation",
      })

      return result.text.trim()
    } catch (error) {
      log.error("llm_generate_failed", { error: String(error) })
    }

    // Fallback
    return this.generateFallback(elements)
  }

  private buildSkeletonContextForChapter(chapter: number): string {
    const skeleton = this.storyState.narrativeSkeleton
    if (!skeleton) return ""

    const parts: string[] = []

    const nextBeats = getNextKeyBeat(skeleton, chapter)
    if (nextBeats.length > 0) {
      parts.push("\n=== Narrative Skeleton - Current Story Lines ===")
      for (const { storyLine, beat } of nextBeats) {
        const chars = beat.characters?.join(", ") || "Various characters"
        parts.push(`\n${storyLine}:`)
        parts.push(`  Chapter ${beat.chapter}: ${beat.description}`)
        parts.push(`  Characters: ${chars}`)
        if (beat.thematicRelevance) {
          parts.push(`  Theme: ${beat.thematicRelevance}`)
        }
      }
    }

    const motifs = getThematicMotifString(skeleton)
    if (motifs) {
      parts.push("\n=== Thematic Motifs ===")
      parts.push(motifs)
    }

    return parts.length > 0 ? parts.join("\n") + "\n" : ""
  }

  /**
   * Fallback generation when LLM fails - generic neutral content
   */
  private generateFallback(elements: any): string {
    const time = elements.time || "At an uncertain time"
    const location = elements.location || "in an unfamiliar place"
    const characters = elements.characters?.join(", ") || "The protagonist"
    const event = elements.event || "an unfolding situation"

    return `${characters} found themselves ${location} ${time}. The nature of ${event} was unclear, but a sense of anticipation hung in the air. What would happen next?`
  }

  /**
   * Extract a concise title from the generated chapter content using LLM
   */
  private async extractChapterTitle(content: string): Promise<string> {
    try {
      const systemPrompt = `You are a story title generator. Extract a concise, evocative title (max 12 characters in Chinese or 50 characters in English) that captures the main theme or event of the chapter.`

      const userPrompt = `Analyze this chapter and generate a title:

${content.substring(0, 2000)}

Generate only the title, nothing else:`

      const result = await callLLM({
        prompt: userPrompt,
        system: systemPrompt,
        callType: "chapter_title_extraction",
      })

      return result.text.trim()
    } catch (error) {
      log.error("extract_title_failed", { error: String(error) })
    }

    return `第${this.storyState.chapterCount}章`
  }

  /**
   * Extract character names from story text using LLM
   */
  private async extractCharactersFromStory(content: string): Promise<string[]> {
    try {
      const prompt = `Analyze this story segment and extract ALL character names (both proper names and role descriptions like "the detective", "the old man", etc):

${content.substring(0, 2000)}

Output JSON array of character names: ["name1", "name2", ...]

If no clear characters are found, return an empty array [].`

      const result = await callLLM({
        prompt,
        callType: "character_extraction",
      })

      const match = result.text.match(/\[[\s\S]*\]/)
      if (match) {
        const names = JSON.parse(match[0])
        return Array.isArray(names) ? names : []
      }
    } catch (error) {
      log.warn("character_extraction_failed", { error: String(error) })
    }
    return []
  }

  getState(): StoryState {
    return this.storyState
  }

  async reset(): Promise<void> {
    this.storyState = {
      characters: {},
      world: {},
      relationships: {},
      currentChapter: null,
      chapterCount: 0,
      timestamps: {},
      fullStory: "",
      branchHistory: [],
      currentBranchId: null,
    }
    await this.saveState()
    log.info("state_reset")
  }

  /**
   * Dispose all resources (database connections)
   * Must be called before process exit to prevent hanging
   */
  async dispose(): Promise<void> {
    try {
      if (this.advancedModulesInitialized) {
        this.storyWorldMemory.close()
        this.storyKnowledgeGraph.close()
        this.branchStorage.close()
        this.advancedModulesInitialized = false
        log.info("orchestrator_disposed")
      }
    } catch (error) {
      log.warn("dispose_error", { error: String(error) })
    }
  }

  private async saveTurnSummary(stateUpdates: any, chaosResult: ChaosResult): Promise<void> {
    try {
      const summaryDir = resolve(getSummariesPath())
      await mkdir(summaryDir, { recursive: true })

      const [impact, magnitude] = (chaosResult.category as string).split("-") as [
        ChaosEvent["impact"],
        ChaosEvent["magnitude"],
      ]

      const chaosEventForSummary: ChaosEvent = {
        rollImpact: chaosResult.roll,
        rollMagnitude: chaosResult.roll,
        impact: impact || "neutral",
        magnitude: magnitude || "minor",
        narrativeDirection: chaosResult.narrativePrompt,
        generatedEvent: chaosResult.event,
      }

      const summary = EvolutionRulesEngine.generateTurnSummary(
        {
          chapterCount: this.storyState.chapterCount,
          characters: this.storyState.characters,
          worldEvents: this.storyState.world?.events || [],
          storySegment: this.storyState.fullStory.split("\n\n").slice(-1)[0] || "",
        },
        stateUpdates,
        chaosEventForSummary,
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
  log.info("pattern_analysis_started", {
    contextLength: context.length,
    patternCount: currentPatterns.length,
  })

  try {
    const prompt = `You are a narrative pattern analyst.
Analyze this story segment and extract unique patterns NOT in the existing list.

Existing Patterns: ${JSON.stringify(currentPatterns.slice(-5))}
Story Segment: ${context.substring(0, 1500)}

Output JSON array of new patterns. Each pattern:
{ "keyword": "pattern name", "category": "character_trait|plot_device|world_rule|tone", "description": "what this pattern does" }`

    const result = await callLLM({
      prompt: prompt,
      callType: "pattern_analysis",
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
      await mkdir(dirname(dynamicPath), { recursive: true })
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
    const prompt = `Analyze this story segment and determine if a narrative skill should be generated.

Story Segment (last 500 chars):
${context.slice(-500)}

Output JSON:
{
  "shouldGenerate": true/false,
  "trigger": "brief reason if true",
  "skillName": "camelCase skill name if true",
  "guidelines": ["guideline 1", "guideline 2", "guideline 3"],
  "examples": ["example 1", "example 2"]
}`

    const result = await callLLM({
      prompt: prompt,
      callType: "skill_generation_check",
    })

    const match = result.text.match(/\{[\s\S]*\}/)
    if (!match) return

    const decision = JSON.parse(match[0])
    if (!decision.shouldGenerate) return

    const skillContent = `# Auto-Generated Narrative Skill

Generated: ${new Date().toISOString()}

## Trigger
${decision.trigger}

## Guidelines
${(decision.guidelines || []).map((g: string) => `- ${g}`).join("\n")}

## Examples
${(decision.examples || []).map((e: string) => `- ${e}`).join("\n")}
`
    const skillsDir = resolve(getSkillsPath())
    await mkdir(skillsDir, { recursive: true })
    const fileName = `${skillsDir}/${decision.skillName || "auto"}-${Date.now()}.md`
    await writeFile(fileName, skillContent)
    await Skill.reload()
    log.info("skill_generated", { fileName })
  } catch (error) {
    log.error("skill_generation_failed", { error: String(error) })
  }
}
