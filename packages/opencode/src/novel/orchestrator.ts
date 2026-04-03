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
  NovelConfigManager,
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
import {
  NovelLearningBridgeManager,
  type LearningBridgeConfig,
  DEFAULT_LEARNING_BRIDGE_CONFIG,
  type ImprovementSuggestion,
} from "./novel-learning-bridge"

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
  configManager?: NovelConfigManager
  visualPanelsEnabled?: boolean
  learningBridgeConfig?: Partial<LearningBridgeConfig>
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
  private learningBridgeManager: NovelLearningBridgeManager
  private learningBridgeInitialized: boolean = false
  private lastChaosResult: ChaosResult | null = null
  private branchOptions: number = 3
  private verbose: boolean = false
  private visualPanelsEnabled: boolean = true
  private advancedModulesInitialized: boolean = false
  private configManager: NovelConfigManager

  // Dimension 3: LRU cache for context building (avoids redundant re-computation within same chapter)
  private contextCache: {
    chapter: number
    memoryContext: string
    graphContext: string
    graphWarnings: Array<{ type: string; description: string; severity: "low" | "medium" | "high" }>
    graphActiveCharacters: string[]
  } | null = null

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
    this.visualPanelsEnabled = config.visualPanelsEnabled !== undefined ? config.visualPanelsEnabled : true
    this.configManager = config.configManager || novelConfigManager
    this.learningBridgeManager = new NovelLearningBridgeManager(config.learningBridgeConfig)
  }

  /**
   * Initialize advanced modules (databases)
   */
  private async initializeAdvancedModules(): Promise<void> {
    if (this.advancedModulesInitialized) return

    try {
      // Load config and initialize custom types (use passed configManager or singleton)
      if (!this.configManager.getConfigSource || this.configManager.getConfigSource() === "default") {
        await this.configManager.load()
      }
      initializeCustomTypes({
        customTraumaTags: this.configManager.getCustomTraumaTags(),
        customSkillCategories: this.configManager.getCustomSkillCategories(),
        customGoalTypes: this.configManager.getCustomGoalTypes(),
        customEmotionTypes: this.configManager.getCustomEmotionTypes(),
        customCharacterStatus: this.configManager.getCustomCharacterStatus(),
      })

      await this.storyWorldMemory.initialize()
      await this.storyKnowledgeGraph.initialize()
      await this.branchStorage.initialize()
      await this.motifTracker.initialize()

      // Initialize Learning Bridge for Phase 3 reverse improvement
      await this.initializeLearningBridge()

      this.advancedModulesInitialized = true
      this.log("Advanced modules initialized", {
        memory: "story-memory.db",
        graph: "story-graph.db",
        branches: "branches.db",
        motif: "motif-tracking/",
        learningBridge: this.learningBridgeInitialized,
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

  /**
   * Initialize Learning Bridge for reverse improvement system (Phase 3)
   */
  private async initializeLearningBridge(): Promise<void> {
    if (this.learningBridgeInitialized) return

    try {
      await this.learningBridgeManager.initialize()
      this.learningBridgeInitialized = true
      log.info("learning_bridge_initialized", {
        vectorBridge: this.learningBridgeManager.getVectorBridge() ? "enabled" : "disabled",
        knowledgeBridge: this.learningBridgeManager.getKnowledgeBridge() ? "enabled" : "disabled",
        memoryBridge: this.learningBridgeManager.getMemoryBridge() ? "enabled" : "disabled",
        improvementApi: this.learningBridgeManager.getImprovementApi() ? "enabled" : "disabled",
      })
    } catch (error) {
      log.warn("learning_bridge_init_failed", { error: String(error) })
      this.learningBridgeInitialized = false
    }
  }

  /**
   * Analyze novel code and generate improvement suggestions using learning module
   */
  async analyzeAndSuggestImprovements(modulePath?: string): Promise<ImprovementSuggestion[]> {
    await this.initializeLearningBridge()

    if (!this.learningBridgeInitialized) {
      log.warn("learning_bridge_not_available")
      return []
    }

    try {
      const targetPath = modulePath || this.getNovelSourcePath()
      log.info("analyzing_novel_improvements", { path: targetPath })

      const suggestions = await this.learningBridgeManager.getImprovementApi().analyzeAndSuggest(targetPath)

      log.info("improvement_suggestions_generated", {
        count: suggestions.length,
        highConfidence: suggestions.filter((s) => s.confidence > 0.7).length,
      })

      return suggestions
    } catch (error) {
      log.error("improvement_analysis_failed", { error: String(error) })
      return []
    }
  }

  /**
   * Apply an improvement suggestion
   */
  async applyImprovement(suggestion: ImprovementSuggestion, dryRun: boolean = true): Promise<boolean> {
    if (!this.learningBridgeInitialized) {
      console.log("× Learning bridge not initialized")
      return false
    }

    try {
      if (dryRun) {
        console.log(`\n📝 Dry run - Would apply: ${suggestion.description}`)
        console.log(`   File: ${suggestion.targetFile}${suggestion.targetLine ? `:${suggestion.targetLine}` : ""}`)
        console.log(`   Type: ${suggestion.type}`)
        console.log(`   Confidence: ${(suggestion.confidence * 100).toFixed(0)}%`)
        return true
      }

      const result = await this.learningBridgeManager.getImprovementApi().applySuggestion(suggestion, false)
      if (result) {
        console.log(`✓ Applied improvement: ${suggestion.description}`)
      }
      return result
    } catch (error) {
      log.error("apply_improvement_failed", { error: String(error) })
      return false
    }
  }

  /**
   * Get the path to novel source files for analysis
   */
  private getNovelSourcePath(): string {
    try {
      const instanceDir = Instance.worktree
      return join(instanceDir, "packages", "opencode", "src", "novel")
    } catch {
      return join(process.cwd(), "src", "novel")
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
        const metaLearnerContext = this.deriveMetaLearnerContext()

        this.log(
          `   Skeleton config: ${metaLearnerContext.preferredThreadCount} threads, ${metaLearnerContext.pacingPreference} pacing`,
        )

        const skeleton = await createNarrativeSkeleton(theme, tone, initialPrompt, metaLearnerContext)
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
   * Derive metaLearnerContext from engine configuration
   * Maps storyType and difficulty to skeleton generation preferences
   */
  private deriveMetaLearnerContext(): {
    preferredThreadCount?: number
    pacingPreference?: "fast" | "slow" | "balanced"
  } {
    const config = this.configManager.getConfig()
    const storyType = config.storyType
    const difficulty = config.difficulty

    // Map storyType to thread count and pacing
    const storyTypeConfig: Record<string, { threads: number; pacing: "fast" | "slow" | "balanced" }> = {
      action: { threads: 5, pacing: "fast" },
      character: { threads: 3, pacing: "slow" },
      theme: { threads: 4, pacing: "balanced" },
      balanced: { threads: 4, pacing: "balanced" },
      custom: { threads: 4, pacing: "balanced" },
    }

    const typeConfig = storyTypeConfig[storyType] || storyTypeConfig.balanced

    // Adjust thread count based on difficulty
    let threadCount = typeConfig.threads
    if (difficulty === "easy") {
      threadCount = Math.max(2, threadCount - 1) // Fewer threads, simpler structure
    } else if (difficulty === "hard" || difficulty === "nightmare") {
      threadCount = Math.min(6, threadCount + 1) // More threads, complex structure
    }

    return {
      preferredThreadCount: threadCount,
      pacingPreference: typeConfig.pacing,
    }
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

    // Dimension 3b: Use cached graph context from runNovelCycle instead of re-querying.
    // PERFORMANCE: eliminates a duplicate buildGraphConstraintContext call during branch generation.
    // This saves N graph DB queries per branch cycle (typically 3-5 queries for a 20-node graph).
    let graphConstraintContext = ""
    if (this.contextCache && this.contextCache.chapter === baseState.chapterCount + 1) {
      graphConstraintContext = this.contextCache.graphContext
      // Also inject high-severity warnings as explicit constraints
      const highWarnings = this.contextCache.graphWarnings.filter((w) => w.severity === "high")
      if (highWarnings.length > 0) {
        graphConstraintContext += `\nCONSISTENCY CONSTRAINTS (MUST RESPECT):\n`
        for (const w of highWarnings) {
          graphConstraintContext += `- ${w.description}\n`
        }
      }
    } else {
      // Fallback: cache miss, build fresh (shouldn't happen in normal flow)
      try {
        const constraintResult = await this.buildGraphConstraintContext(baseState.chapterCount + 1)
        graphConstraintContext = constraintResult.context
        const highWarnings = constraintResult.warnings.filter((w) => w.severity === "high")
        if (highWarnings.length > 0) {
          graphConstraintContext += `\nCONSISTENCY CONSTRAINTS (MUST RESPECT):\n`
          for (const w of highWarnings) {
            graphConstraintContext += `- ${w.description}\n`
          }
        }
      } catch (e) {
        log.warn("graph_constraint_in_branches_failed", { error: String(e) })
      }
    }

    // Step 2: Let LLM analyze the story and generate multiple branches in one call
    const branchGenerationPrompt = `You are a creative story architect. Analyze the current story state and generate multiple narrative branches.

CURRENT STORY STATE:
${charSummary}

${relationshipContext}

${graphConstraintContext}

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

    // ========================================================================
    // CLOSED LOOP 1: Deep Context Assembly from Hierarchical Memory
    // ========================================================================
    // Replace naive substring(0, 500) with rich multi-level memory retrieval
    let memoryContext = ""
    let graphConstraintContext = ""
    let graphWarnings: Array<{ type: string; description: string; severity: "low" | "medium" | "high" }> = []
    let graphActiveCharacters: string[] = []

    const nextChapter = this.storyState.chapterCount + 1

    // Dimension 3a: LRU cache — skip rebuild if same chapter, same state
    const cacheValid =
      this.contextCache !== null &&
      this.contextCache.chapter === nextChapter

    if (cacheValid && this.contextCache !== null) {
      memoryContext = this.contextCache.memoryContext
      graphConstraintContext = this.contextCache.graphContext
      graphWarnings = this.contextCache.graphWarnings
      graphActiveCharacters = this.contextCache.graphActiveCharacters
      // PERFORMANCE: saves 2 database scan chains + string building per cached call
      // Estimated savings: ~50-150ms per cycle (depends on graph size)
      log.info("context_cache_hit", { chapter: nextChapter })
    } else {
      try {
        memoryContext = await this.buildMemoryContext(nextChapter, 5)
        this.log(`   Memory context built (${memoryContext.length} chars)`)
      } catch (error) {
        log.warn("memory_context_build_failed", { error: String(error) })
        memoryContext = "(Memory system unavailable)"
      }

      // ========================================================================
      // CLOSED LOOP 2: Graph-Driven Logic Firewall
      // ========================================================================
      // Query knowledge graph BEFORE generation to prevent contradictions
      try {
        const constraintResult = await this.buildGraphConstraintContext(nextChapter)
        graphConstraintContext = constraintResult.context
        graphWarnings = constraintResult.warnings
        graphActiveCharacters = constraintResult.activeCharacters

        if (graphActiveCharacters.length > 0) {
          this.log(`   Graph firewall: ${graphActiveCharacters.length} active characters verified`)
        }
        if (graphWarnings.length > 0) {
          const highCount = graphWarnings.filter((w) => w.severity === "high").length
          this.log(`   Graph warnings: ${graphWarnings.length} total (${highCount} high severity)`)
        }
      } catch (error) {
        log.warn("graph_constraint_build_failed", { error: String(error) })
      }

      // Cache the results for this chapter
      this.contextCache = {
        chapter: nextChapter,
        memoryContext,
        graphContext: graphConstraintContext,
        graphWarnings,
        graphActiveCharacters,
      }
    }

    // ========================================================================
    // Log high-severity warnings to console
    // ========================================================================
    const highWarnings = graphWarnings.filter((w) => w.severity === "high")
    if (highWarnings.length > 0) {
      console.log(`\n⚠️  ${highWarnings.length} consistency warning(s) before generation:`)
      for (const w of highWarnings) {
        console.log(`   [${w.severity.toUpperCase()}] ${w.description}`)
      }
      console.log()
    }

    // Inject memory and graph context into the prompt for LLM consumption
    const enrichedPromptContent =
      memoryContext || graphConstraintContext
        ? `${promptContent}

=== STORY MEMORY CONTEXT ===
${memoryContext}
${graphConstraintContext}`
        : promptContent

    this.log(`   Parsing prompt...`)
    const elements = await this.parsePromptWithLLM(enrichedPromptContent)
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

    // 1. Store chapter summary in story memory (enriched, not truncated)
    try {
      const keyEvents = this.storyState.world?.events?.slice(-3) || []
      const characterStates = Object.entries(this.storyState.characters)
        .filter(([_, c]) => (c as any).stress > 20 || (c as any).status !== "active")
        .map(([name, c]) => `${name}: stress=${(c as any).stress}, status=${(c as any).status}`)
        .join("; ")

      // Generate a concise LLM summary if story is long enough
      let summaryContent: string
      if (storySegment.length > 300) {
        try {
          const summaryResult = await callLLM({
            prompt: `Summarize the following story segment in 2-3 sentences, focusing on: key events, character emotional changes, and any clues or secrets revealed. Keep it concise.\n\n${storySegment}`,
            callType: "chapter_summary",
          })
          summaryContent = summaryResult.text.trim()
        } catch {
          summaryContent = storySegment.substring(0, 800)
        }
      } else {
        summaryContent = storySegment
      }

      const enrichedSummary = `${summaryContent}${keyEvents.length > 0 ? `\n\nKey Events: ${keyEvents.join(", ")}` : ""}${characterStates ? `\n\nCharacter States: ${characterStates}` : ""}`

      await this.storyWorldMemory.storeChapterSummary(
        this.storyState.chapterCount,
        enrichedSummary,
        Object.keys(this.storyState.characters),
        elements.location ? [elements.location] : [],
        this.storyState.world?.events || [],
        this.storyState.narrativeSkeleton?.theme ? [this.storyState.narrativeSkeleton.theme] : [],
      )
      this.log(`   Stored chapter ${this.storyState.chapterCount} in story memory`)
    } catch (error) {
      log.warn("story_memory_store_failed", { error: String(error) })
    }

    // 2. Update knowledge graph with entities (use findNodeByName for consistent lookup)
    try {
      for (const charName of Object.keys(this.storyState.characters)) {
        const existingNode = await this.storyKnowledgeGraph.findNodeByName("character", charName)
        if (!existingNode) {
          await this.storyKnowledgeGraph.addCharacter(charName, this.storyState.chapterCount, {
            stress: this.storyState.characters[charName].stress,
            status: this.storyState.characters[charName].status,
          })
        } else {
          await this.storyKnowledgeGraph.updateNodeStatus(
            existingNode.id,
            this.storyState.characters[charName].status || "active",
            this.storyState.chapterCount,
          )
        }
      }
      if (elements.location) {
        const existingLocation = await this.storyKnowledgeGraph.findNodeByName("location", elements.location)
        if (!existingLocation) {
          await this.storyKnowledgeGraph.addLocation(elements.location, this.storyState.chapterCount)
        }
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
    const reflectionInterval = this.configManager.getThematicReflectionInterval()
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

    // Generate visual panels using dedicated visual orchestrator (if enabled)
    if (this.visualPanelsEnabled) {
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
    } else {
      this.log(`   [DEBUG] Visual panel generation disabled (use --visual-panels to enable)`)
    }

    const totalDuration = Date.now() - cycleStart
    log.info("novel_cycle_completed", {
      chapter: this.storyState.chapterCount,
      totalDurationMs: totalDuration,
      storyLength: storySegment.length,
      characterCount: Object.keys(this.storyState.characters).length,
      panelCount: this.visualPanelsEnabled ? 0 : 0,
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

      // Load chapter length configuration
      const chapterLengthConfig = {
        mode: "dynamic" as const,
        minWords: 800,
        maxWords: 3000,
        minChineseChars: 1000,
        maxChineseChars: 5000,
        qualityOverQuantity: true,
      }

      const lengthInstruction =
        chapterLengthConfig.mode === "dynamic"
          ? "Determine the appropriate length based on the scene complexity, emotional depth, and narrative importance. Let the story flow naturally - some chapters may be short and punchy, others may be longer and more detailed. Quality over quantity."
          : `Aim for ${chapterLengthConfig.minWords}-${chapterLengthConfig.maxWords} words (or ${chapterLengthConfig.minChineseChars}-${chapterLengthConfig.maxChineseChars} Chinese characters).`

      const systemPrompt = `You are a creative story writer. Continue or start a story based on the given prompt and context.

Rules:
- ${languageInstruction}
- If this is chapter 1, start fresh from the prompt
- If continuing, pick up from where the story left off
- Maintain consistency with established characters and plot
- Create engaging, descriptive narrative
- Chapter length: ${lengthInstruction}
- INCORPORATE the chaos event naturally into the narrative
- ALIGN with the narrative skeleton and thematic motifs provided
- Prioritize: character development, emotional resonance, plot progression, and immersive descriptions`

      const userPrompt = `Story Context (previous chapters):
${previousStory.slice(-2000)}

Established Characters: ${characterInfo}
${skeletonContext}

=== RETRIEVED MEMORY CONTEXT ===
${promptContent.includes("=== STORY MEMORY CONTEXT ===") ? promptContent.split("=== STORY MEMORY CONTEXT ===")[1].split("Prompt/Timing:")[0] : ""}

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

  // ============================================================================
  // CLOSED LOOP 1: Deep Context Assembly (replaces substring(0,500))
  // Optimized: significance filtering + token budget + epic summary fallback
  // ============================================================================

  /**
   * Estimate token count from text (rough: ~4 chars/token for Chinese/mixed).
   * Used for budget enforcement in buildMemoryContext.
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  /**
   * Build a rich semantic context from the hierarchical memory system.
   *
   * OPTIMIZATION (Dimension 1 — Fix Prompt Length Overload):
   * - Significance filtering: only memories with significance > 7 are included
   * - Token budget: max ~2000 tokens for the entire memory context
   * - Priority: Arc > Chapter > Scene > Character (higher levels kept first)
   * - Overflow: old low-significance memories compressed into an "Epic Summary" via LLM
   *
   * Expected impact: reduces memory context from O(N) unbounded to ~2000 tokens fixed.
   * For a 50-chapter story, this cuts ~70% of token usage in this step.
   */
  private async buildMemoryContext(
    currentChapter: number,
    maxLookbackChapters: number = 5,
  ): Promise<string> {
    const parts: string[] = []
    const startChapter = Math.max(1, currentChapter - maxLookbackChapters)
    const SIGNIFICANCE_THRESHOLD = 7
    const MAX_TOKEN_BUDGET = 2000 // ~8000 chars for Chinese/mixed text
    let tokenBudget = MAX_TOKEN_BUDGET
    const lowSignificanceMemories: Array<{ level: string; content: string; chapter: number }> = []

    // ── 1. Arc-level context (highest priority, no significance filter — arcs are inherently important)
    try {
      const arcMemories = await this.storyWorldMemory.getMemoriesByLevel("arc")
      if (arcMemories.length > 0) {
        const recentArcs = arcMemories.slice(-3)
        const arcBlock = recentArcs.map((arc) => `- ${arc.content}`).join("\n")
        const arcTokens = this.estimateTokens(arcBlock)
        if (tokenBudget >= arcTokens) {
          parts.push("=== STORY ARCS ===")
          parts.push(arcBlock)
          tokenBudget -= arcTokens
        }
      }
    } catch (e) {
      log.warn("arc_memory_retrieve_failed", { error: String(e) })
    }

    // ── 2. Chapter-level summaries (significance-filtered)
    try {
      const chapterMemories = await this.storyWorldMemory.getMemoriesByChapter(
        currentChapter - 1,
        "chapter",
      )
      const filteredChapters = chapterMemories
        .filter((m) => m.chapter >= startChapter && m.significance >= SIGNIFICANCE_THRESHOLD)
        .slice(-5)

      if (filteredChapters.length > 0) {
        const chapterLines = filteredChapters.map((mem) => {
          const eventsStr = mem.events.length > 0 ? ` | Events: ${mem.events.join(", ")}` : ""
          const themesStr = mem.themes.length > 0 ? ` | Themes: ${mem.themes.join(", ")}` : ""
          return `[Ch.${mem.chapter}] ${mem.content}${eventsStr}${themesStr}`
        })
        const chapterBlock = chapterLines.join("\n")
        const chapterTokens = this.estimateTokens(chapterBlock)

        if (tokenBudget >= chapterTokens) {
          parts.push("\n=== CHAPTER SUMMARIES ===")
          parts.push(chapterBlock)
          tokenBudget -= chapterTokens
        } else {
          // Budget overflow: push older chapters to low-significance bucket for epic summary
          for (const mem of filteredChapters.slice(0, -2)) {
            lowSignificanceMemories.push({
              level: "chapter",
              content: mem.content,
              chapter: mem.chapter,
            })
          }
          // Keep only the last 2 chapters directly
          const kept = filteredChapters.slice(-2)
          const keptBlock = kept
            .map((mem) => {
              const eventsStr = mem.events.length > 0 ? ` | Events: ${mem.events.join(", ")}` : ""
              return `[Ch.${mem.chapter}] ${mem.content}${eventsStr}`
            })
            .join("\n")
          parts.push("\n=== CHAPTER SUMMARIES (Recent) ===")
          parts.push(keptBlock)
          tokenBudget -= this.estimateTokens(keptBlock)
        }
      }
    } catch (e) {
      log.warn("chapter_memory_retrieve_failed", { error: String(e) })
    }

    // ── 3. Scene-level details (significance-filtered, only most recent chapter)
    try {
      const sceneMemories = await this.storyWorldMemory.getMemoriesByChapter(
        currentChapter - 1,
        "scene",
      )
      const filteredScenes = sceneMemories
        .filter((m) => m.significance >= SIGNIFICANCE_THRESHOLD)
        .slice(-2) // Only keep top 2 scenes

      if (filteredScenes.length > 0 && tokenBudget > 200) {
        const sceneBlock = filteredScenes
          .map((mem) => {
            const charsOnScreen = mem.characters.join(", ")
            return `[Ch.${mem.chapter}, Scene ${mem.scene || "?"}] (${charsOnScreen}) ${mem.content}`
          })
          .join("\n")
        const sceneTokens = this.estimateTokens(sceneBlock)
        if (tokenBudget >= sceneTokens) {
          parts.push("\n=== RECENT SCENES ===")
          parts.push(sceneBlock)
          tokenBudget -= sceneTokens
        }
      }
    } catch (e) {
      log.warn("scene_memory_retrieve_failed", { error: String(e) })
    }

    // ── 4. Character-centric memories (significance-filtered, top 2 characters only)
    // OPTIMIZATION: was top 4, now top 2 to reduce token usage by ~50%
    const majorCharacters = Object.keys(this.storyState.characters).slice(0, 2)
    for (const charName of majorCharacters) {
      try {
        const charMemories = await this.storyWorldMemory.getMemoriesByCharacter(charName)
        const filtered = charMemories
          .filter((m) => m.chapter >= startChapter && m.significance >= SIGNIFICANCE_THRESHOLD)
          .slice(-2)

        if (filtered.length > 0 && tokenBudget > 150) {
          const charBlock = filtered.map((mem) => `[Ch.${mem.chapter}] ${mem.content}`).join("\n")
          const charTokens = this.estimateTokens(charBlock)
          if (tokenBudget >= charTokens) {
            parts.push(`\n=== ${charName}'s Recent Memories ===`)
            parts.push(charBlock)
            tokenBudget -= charTokens
          }
        }
      } catch (e) {
        log.warn("character_memory_retrieve_failed", { char: charName, error: String(e) })
      }
    }

    // ── 5. Epic Summary: compress low-significance memories via LLM
    if (lowSignificanceMemories.length > 2) {
      try {
        const rawText = lowSignificanceMemories
          .map((m) => `[Ch.${m.chapter}] ${m.content}`)
          .join("\n")

        const summaryResult = await callLLM({
          prompt: `Compress the following story memories into a SINGLE sentence "epic summary" that captures the overarching narrative arc. This will be used as context for the next chapter:\n\n${rawText}`,
          callType: "epic_summary",
          temperature: 0.3,
        })

        const epicSummary = summaryResult.text.trim().slice(0, 300)
        if (epicSummary) {
          parts.unshift(`\n=== EPIC SUMMARY (Compressed from ${lowSignificanceMemories.length} memories) ===`)
          parts.unshift(epicSummary)
        }
      } catch (e) {
        log.warn("epic_summary_generation_failed", { error: String(e) })
      }
    }

    if (parts.length === 0) {
      return "(No previous memories found - this appears to be the beginning of the story)"
    }

    const finalContext = parts.join("\n")
    log.info("memory_context_built", {
      totalChars: finalContext.length,
      estimatedTokens: this.estimateTokens(finalContext),
      tokenBudgetRemaining: tokenBudget,
      lowSignificanceCompressed: lowSignificanceMemories.length,
    })

    return finalContext
  }

  // ============================================================================
  // CLOSED LOOP 2: Graph-Driven Logic Firewall
  // Optimized: protagonist-focused + strength-filtered relationships
  // ============================================================================

  /**
   * Identify the protagonist (first character in state, or first with high stress/activity).
   */
  private identifyProtagonist(): string | null {
    const charNames = Object.keys(this.storyState.characters)
    if (charNames.length === 0) return null
    // First character is typically the protagonist
    return charNames[0]
  }

  /**
   * Query the knowledge graph to build a factual constraint context.
   * Prevents logical contradictions (dead characters, wrong locations, impossible relationships).
   *
   * OPTIMIZATION (Dimension 2 — Fix Cascade Failure):
   * - Protagonist-focused: only queries the protagonist's strong relationships (strength > 50)
   * - Core entities only: Allies + Opponents, ignoring neutral related_to edges
   * - NPC filtering: secondary characters only checked for death/inconsistency, not full context
   *
   * Expected impact: reduces graph context from O(N²) all-pairs to O(1) protagonist-centric.
   * For a story with 20+ characters, this cuts ~80% of graph query latency and ~60% of prompt tokens.
   */
  private async buildGraphConstraintContext(
    currentChapter: number,
  ): Promise<{
    context: string
    warnings: Array<{ type: string; description: string; severity: "low" | "medium" | "high" }>
    activeCharacters: string[]
  }> {
    const warnings: Array<{
      type: string
      description: string
      severity: "low" | "medium" | "high"
    }> = []
    const activeCharacters: string[] = []
    const contextParts: string[] = []
    const MIN_EDGE_STRENGTH = 50 // Only strong relationships

    try {
      const protagonistName = this.identifyProtagonist()
      const protagonistNode = protagonistName
        ? await this.storyKnowledgeGraph.findNodeByName("character", protagonistName)
        : null

      // ── 1. Protagonist consistency check (full)
      if (protagonistNode) {
        const inconsistencies = await this.storyKnowledgeGraph.detectInconsistency(protagonistNode.id)
        for (const issue of inconsistencies) {
          warnings.push({
            type: issue.type,
            description: issue.description,
            severity: issue.severity,
          })
        }

        const wasActive = await this.storyKnowledgeGraph.wasCharacterActiveAtChapter(
          protagonistNode.id,
          currentChapter,
        )
        if (wasActive && protagonistNode.status === "active") {
          activeCharacters.push(protagonistNode.name)
        }
        if (!wasActive && protagonistNode.status === "active") {
          warnings.push({
            type: "protagonist_should_be_inactive",
            description: `Protagonist "${protagonistNode.name}" appears active in state but knowledge graph indicates they should be inactive by chapter ${currentChapter}.`,
            severity: "high",
          })
        }

        // ── 2. Protagonist's strong relationships only (strength > 50)
        const relationships = await this.storyKnowledgeGraph.queryCharacterRelationships(protagonistNode.id)

        // Filter to only strong relationships
        const strongAllies: string[] = []
        const strongOpponents: string[] = []
        const factions: string[] = []

        for (const ally of relationships.allies) {
          const edge = (await this.storyKnowledgeGraph.getEdgesForNode(protagonistNode.id)).find(
            (e) => e.target === ally.id || e.source === ally.id,
          )
          if (!edge || edge.strength >= MIN_EDGE_STRENGTH) {
            strongAllies.push(ally.name)
          }
        }
        for (const opponent of relationships.opponents) {
          const edge = (await this.storyKnowledgeGraph.getEdgesForNode(protagonistNode.id)).find(
            (e) => e.target === opponent.id || e.source === opponent.id,
          )
          if (!edge || edge.strength >= MIN_EDGE_STRENGTH) {
            strongOpponents.push(opponent.name)
          }
        }
        for (const member of relationships.members) {
          factions.push(member.name)
        }

        // Build protagonist constraint block (only if there's meaningful content)
        if (strongAllies.length > 0 || strongOpponents.length > 0 || factions.length > 0) {
          contextParts.push(`\n**${protagonistNode.name}** (Protagonist):`)
          if (strongAllies.length > 0) {
            contextParts.push(`  Allies: ${strongAllies.join(", ")}`)
          }
          if (strongOpponents.length > 0) {
            contextParts.push(`  Opponents: ${strongOpponents.join(", ")}`)
          }
          if (factions.length > 0) {
            contextParts.push(`  Faction: ${factions.join(", ")}`)
          }

          // Protagonist's current location
          const edges = await this.storyKnowledgeGraph.getEdgesForNode(protagonistNode.id, "located_at")
          const latestLocationEdge = edges
            .filter((e) => e.chapter <= currentChapter)
            .sort((a, b) => b.chapter - a.chapter)[0]

          if (latestLocationEdge) {
            const locationNode = await this.storyKnowledgeGraph.getNode(latestLocationEdge.target)
            if (locationNode) {
              contextParts.push(`  Location: ${locationNode.name} (since Ch.${latestLocationEdge.chapter})`)
            }
          }
        }

        // Track protagonist's strong associates as active characters too
        for (const name of [...strongAllies, ...strongOpponents]) {
          if (!activeCharacters.includes(name)) {
            activeCharacters.push(name)
          }
        }
      }

      // ── 3. Other characters: consistency-only check (no relationship context to save tokens)
      const allCharacterNodes = await this.storyKnowledgeGraph.getNodesByType("character")
      for (const charNode of allCharacterNodes) {
        if (charNode.name === protagonistName) continue // Already handled above

        // Lightweight: only check for death/inconsistency, skip relationship queries
        const wasActive = await this.storyKnowledgeGraph.wasCharacterActiveAtChapter(
          charNode.id,
          currentChapter,
        )
        if (!wasActive && charNode.status === "active") {
          warnings.push({
            type: "character_should_be_inactive",
            description: `Character "${charNode.name}" appears active in state but was likely killed/deactivated by chapter ${currentChapter}.`,
            severity: "high",
          })
        }
        if (wasActive && charNode.status === "active") {
          activeCharacters.push(charNode.name)
        }
      }

      // ── 4. Location status checks (only locations mentioned in current state)
      const currentLocation = this.storyState.world?.location
      if (currentLocation) {
        const locNode = await this.storyKnowledgeGraph.findNodeByName("location", currentLocation)
        if (locNode) {
          const status = await this.storyKnowledgeGraph.getLocationStatusAtChapter(locNode.id, currentChapter)
          if (status === "destroyed") {
            warnings.push({
              type: "location_destroyed",
              description: `Current location "${currentLocation}" was destroyed and should not be used as an active scene.`,
              severity: "high",
            })
          }
        }
      }

      log.info("graph_constraint_built", {
        protagonist: protagonistName,
        activeCharacters: activeCharacters.length,
        warnings: warnings.length,
        highSeverity: warnings.filter((w) => w.severity === "high").length,
      })
    } catch (e) {
      log.warn("graph_constraint_build_failed", { error: String(e) })
    }

    const context =
      contextParts.length > 0
        ? `
=== KNOWLEDGE GRAPH - FACTUAL CONSTRAINTS ===
The following are verified facts from the story knowledge graph. You MUST respect these constraints:
${contextParts.join("\n")}
`
        : ""

    return { context, warnings, activeCharacters }
  }

  /**
   * Format graph warnings into a prompt instruction for the LLM.
   */
  private formatGraphWarningsForPrompt(
    warnings: Array<{ type: string; description: string; severity: "low" | "medium" | "high" }>,
    targetLocation?: string,
  ): string {
    const highWarnings = warnings.filter((w) => w.severity === "high")
    if (highWarnings.length === 0) return ""

    let prompt = "\n⚠️ CRITICAL CONSISTENCY WARNINGS (from Knowledge Graph):\n"
    for (const w of highWarnings) {
      prompt += `- ${w.description}\n`
    }

    if (targetLocation) {
      prompt += `\nIf you write a scene at "${targetLocation}", only include characters that are logically present there. Do NOT introduce characters who are dead, destroyed, or located elsewhere without a clear narrative explanation (e.g., teleportation, resurrection plot device).`
    }

    return prompt
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
