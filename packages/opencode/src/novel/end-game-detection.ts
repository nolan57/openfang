import { z } from "zod"
import { Log } from "../util/log"

const log = Log.create({ service: "end-game-detection" })

export interface MetaLearner {
  getCurrentConfigPatch(): Promise<LearnedConfigPatch>
}

export interface LearnedConfigPatch {
  completionWeights?: {
    major_arc_resolved?: number
    thematic_saturation?: number
    character_arcs_complete?: number
    user_satisfaction?: number
    chapter_count?: number
    all_conflicts_resolved?: number
  }
  thresholds?: {
    minCompletionScore?: number
    userSatisfaction?: number
    thematicCoverage?: number
  }
}

export const CompletionCriterionSchema = z.object({
  id: z.string(),
  type: z.enum([
    "major_arc_resolved",
    "thematic_saturation",
    "character_arcs_complete",
    "user_satisfaction",
    "chapter_count",
    "all_conflicts_resolved",
  ]),
  description: z.string(),
  threshold: z.number(),
  current: z.number().default(0),
  met: z.boolean().default(false),
})

export type CompletionCriterion = z.infer<typeof CompletionCriterionSchema>

export type StoryMetricsType = {
  totalChapters: number
  resolvedArcs: number
  totalArcs: number
  thematicCoverage: number
  userRatings: number[]
  resolvedConflicts: number
  totalConflicts: number
}

export interface EndGameReport {
  isComplete: boolean
  completionScore: number
  metCriteria: CompletionCriterion[]
  unmetCriteria: CompletionCriterion[]
  finalMetrics: {
    [criterionType in CompletionCriterion["type"]]?: number
  }
  recommendations: string[]
  epiloguePrompt?: string
  sequelHooks?: string[]
}

export interface EndGameConfig {
  minCompletionScore: number
  requiredCriteria: CompletionCriterion["type"][]
  enableSequelHooks: boolean
  enableEpilogue: boolean
  criterionWeights: {
    [criterionType in CompletionCriterion["type"]]?: number
  }
}

const DEFAULT_CONFIG: EndGameConfig = {
  minCompletionScore: 70,
  requiredCriteria: ["major_arc_resolved", "character_arcs_complete"],
  enableSequelHooks: true,
  enableEpilogue: true,
  criterionWeights: {
    major_arc_resolved: 2,
    thematic_saturation: 1,
    character_arcs_complete: 2,
    user_satisfaction: 1.5,
    chapter_count: 0.5,
    all_conflicts_resolved: 1.5,
  },
}

export class EndGameDetector {
  private criteria: Map<string, CompletionCriterion> = new Map()
  private config: EndGameConfig
  private storyMetrics: StoryMetricsType
  private metaLearner?: MetaLearner

  constructor(config: Partial<EndGameConfig> = {}, metaLearner?: MetaLearner) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.storyMetrics = {
      totalChapters: 0,
      resolvedArcs: 0,
      totalArcs: 0,
      thematicCoverage: 0,
      userRatings: [],
      resolvedConflicts: 0,
      totalConflicts: 0,
    }
    this.metaLearner = metaLearner
  }

  addCriterion(criterion: Omit<CompletionCriterion, "id" | "met" | "current">): CompletionCriterion {
    const id = `criterion_${criterion.type}_${Date.now()}`
    const newCriterion: CompletionCriterion = {
      ...criterion,
      id,
      current: 0,
      met: false,
    }

    this.criteria.set(id, newCriterion)
    log.info("completion_criterion_added", { id, type: criterion.type })

    return newCriterion
  }

  updateCriterion(criterionId: string, currentValue: number, threshold?: number): CompletionCriterion | null {
    const criterion = this.criteria.get(criterionId)
    if (!criterion) return null

    criterion.current = currentValue
    if (threshold !== undefined) {
      criterion.threshold = threshold
    }
    criterion.met = currentValue >= criterion.threshold

    this.criteria.set(criterionId, criterion)
    log.info("criterion_updated", { criterionId, current: currentValue, met: criterion.met })

    return criterion
  }

  updateStoryMetrics(metrics: Partial<StoryMetricsType>): void {
    this.storyMetrics = { ...this.storyMetrics, ...metrics }

    // Update related criteria
    if (metrics.resolvedArcs !== undefined || metrics.totalArcs !== undefined) {
      for (const [id, criterion] of this.criteria) {
        if (criterion.type === "major_arc_resolved") {
          const value =
            this.storyMetrics.totalArcs > 0 ? (this.storyMetrics.resolvedArcs / this.storyMetrics.totalArcs) * 100 : 0
          this.updateCriterion(id, value)
        }
      }
    }

    if (metrics.userRatings && metrics.userRatings.length > 0) {
      for (const [id, criterion] of this.criteria) {
        if (criterion.type === "user_satisfaction") {
          const avgRating = metrics.userRatings.reduce((a, b) => a + b, 0) / metrics.userRatings.length
          const normalizedScore = (avgRating / 10) * 100 // Assuming 1-10 scale
          this.updateCriterion(id, normalizedScore)
        }
      }
    }
  }

  async checkCompletion(): Promise<EndGameReport> {
    let effectiveConfig = { ...this.config }

    if (this.metaLearner) {
      const patch = await this.metaLearner.getCurrentConfigPatch()
      if (patch.completionWeights) {
        effectiveConfig.criterionWeights = { ...effectiveConfig.criterionWeights, ...patch.completionWeights }
      }
      if (patch.thresholds?.minCompletionScore !== undefined) {
        effectiveConfig.minCompletionScore = patch.thresholds.minCompletionScore
      }
    }

    const allCriteria = Array.from(this.criteria.values())
    const metCriteria = allCriteria.filter((c) => c.met)
    const unmetCriteria = allCriteria.filter((c) => !c.met)

    const finalMetrics: { [criterionType in CompletionCriterion["type"]]?: number } = {}
    for (const criterion of allCriteria) {
      finalMetrics[criterion.type] = criterion.current
    }

    let totalWeight = 0
    let weightedScore = 0

    for (const criterion of allCriteria) {
      const weight = effectiveConfig.criterionWeights[criterion.type] || 1
      totalWeight += weight
      weightedScore += weight * ((criterion.current / criterion.threshold) * 100)
    }

    const completionScore = totalWeight > 0 ? weightedScore / totalWeight : 0

    const requiredMet = effectiveConfig.requiredCriteria.every((type) => metCriteria.some((c) => c.type === type))

    const isComplete = completionScore >= effectiveConfig.minCompletionScore && requiredMet

    const recommendations: string[] = []

    if (!isComplete) {
      for (const criterion of unmetCriteria) {
        const progress = ((criterion.current / criterion.threshold) * 100).toFixed(0)
        recommendations.push(`${criterion.description} (${progress}% complete, need ${criterion.threshold})`)
      }
    }

    let epiloguePrompt: string | undefined
    if (isComplete && this.config.enableEpilogue) {
      epiloguePrompt = this.generateEpiloguePrompt()
    }

    const sequelHooks: string[] = []
    if (isComplete && this.config.enableSequelHooks) {
      sequelHooks.push(...this.generateSequelHooks())
    }

    const report: EndGameReport = {
      isComplete,
      completionScore,
      metCriteria,
      unmetCriteria,
      finalMetrics,
      recommendations,
      epiloguePrompt,
      sequelHooks,
    }

    log.info("completion_check", {
      isComplete,
      completionScore: completionScore.toFixed(1),
      metCount: metCriteria.length,
      unmetCount: unmetCriteria.length,
    })

    return report
  }

  private generateEpiloguePrompt(): string {
    const resolvedArcs = this.storyMetrics.resolvedArcs
    const totalChapters = this.storyMetrics.totalChapters

    return `Generate an epilogue chapter that:

1. **Ties Up Loose Ends**: Address any remaining minor plot threads
2. **Shows Character Futures**: Brief glimpse of main characters' lives after the story
3. **Reflects on Themes**: Echo the core themes one final time
4. **Provides Closure**: Give readers emotional satisfaction after ${totalChapters} chapters
5. **Honors the Journey**: Reference key moments from the ${resolvedArcs} resolved story arcs

Tone: Bittersweet, hopeful, reflective
Length: 2000-3000 words
Focus: Character resolution over new conflicts`
  }

  private generateSequelHooks(): string[] {
    const hooks: string[] = []

    // Hook 1: Unresolved external threat
    hooks.push("A distant power takes notice of the protagonists' victory, setting new plans in motion...")

    // Hook 2: Mysterious artifact/discovery
    hooks.push("Among the spoils of victory, a strange artifact pulses with unknown energy...")

    // Hook 3: Character departure
    hooks.push("One of the companions announces they must leave to fulfill a destiny hinted at long ago...")

    // Hook 4: New mystery
    hooks.push("A letter arrives with a seal none recognize, bearing a message that changes everything...")

    // Hook 5: Cycle continues
    hooks.push("As one story ends, another begins. In the shadows, a figure watches and waits...")

    return hooks.slice(0, 3) // Return 2-3 hooks
  }

  generateDenouementStructure(): Array<{
    chapter: number
    focus: string
    characters: string[]
    tone: string
  }> {
    return [
      {
        chapter: 1,
        focus: "Immediate Aftermath",
        characters: ["protagonist", "key_allies"],
        tone: "reflective",
      },
      {
        chapter: 2,
        focus: "Resolution of Subplots",
        characters: ["supporting_cast"],
        tone: "satisfying",
      },
      {
        chapter: 3,
        focus: "Character Futures",
        characters: ["all_main_characters"],
        tone: "hopeful",
      },
      {
        chapter: 4,
        focus: "Thematic Echo & Final Image",
        characters: ["protagonist"],
        tone: "poetic",
      },
    ]
  }

  getCriterionProgress(): Array<{
    type: string
    description: string
    current: number
    threshold: number
    percentage: number
    met: boolean
  }> {
    return Array.from(this.criteria.values()).map((c) => ({
      type: c.type,
      description: c.description,
      current: c.current,
      threshold: c.threshold,
      percentage: (c.current / c.threshold) * 100,
      met: c.met,
    }))
  }

  exportToJson(): {
    config: EndGameConfig
    criteria: CompletionCriterion[]
    storyMetrics: StoryMetricsType
  } {
    const metricsCopy: StoryMetricsType = { ...this.storyMetrics }
    return {
      config: this.config,
      criteria: Array.from(this.criteria.values()),
      storyMetrics: metricsCopy,
    }
  }

  importFromJson(data: {
    config: EndGameConfig
    criteria: CompletionCriterion[]
    storyMetrics: StoryMetricsType
  }): void {
    this.config = { ...this.config, ...data.config }
    this.storyMetrics = { ...this.storyMetrics, ...data.storyMetrics }
    for (const criterion of data.criteria) {
      this.criteria.set(criterion.id, criterion)
    }
    log.info("end_game_detector_imported", { criterionCount: data.criteria.length })
  }

  getMetaLearner(): MetaLearner | undefined {
    return this.metaLearner
  }

  setMetaLearner(metaLearner: MetaLearner): void {
    this.metaLearner = metaLearner
    log.info("meta_learner_set_for_end_game_detector")
  }

  clear(): void {
    this.criteria.clear()
    this.storyMetrics = {
      totalChapters: 0,
      resolvedArcs: 0,
      totalArcs: 0,
      thematicCoverage: 0,
      userRatings: [],
      resolvedConflicts: 0,
      totalConflicts: 0,
    }
    log.info("end_game_detector_cleared")
  }
}

export const endGameDetector = new EndGameDetector()

export function createEndGameDetector(config?: Partial<EndGameConfig>, metaLearner?: MetaLearner): EndGameDetector {
  return new EndGameDetector(config, metaLearner)
}
