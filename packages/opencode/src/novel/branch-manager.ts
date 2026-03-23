import { z } from "zod"
import { Log } from "../util/log"
import { novelConfigManager } from "./novel-config"

const log = Log.create({ service: "branch-manager" })

export const BranchSchema = z.object({
  id: z.string(),
  storySegment: z.string(),
  branchPoint: z.string(),
  choiceMade: z.string(),
  choiceRationale: z.string(),
  stateAfter: z.record(z.string(), z.unknown()),
  evaluation: z.object({
    narrativeQuality: z.number().min(1).max(10),
    tensionLevel: z.number().min(1).max(10),
    characterDevelopment: z.number().min(1).max(10),
    plotProgression: z.number().min(1).max(10),
    characterGrowth: z.number().min(1).max(10),
    riskReward: z.number().min(1).max(10),
    thematicRelevance: z.number().min(1).max(10),
  }),
  selected: z.boolean(),
  createdAt: z.number().optional(),
  chapter: z.number().optional(),
  parentId: z.string().optional(),
  mergedInto: z.string().optional(),
  pruned: z.boolean().optional(),
  pruneReason: z.string().optional(),
  events: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        description: z.string(),
      }),
    )
    .default([]),
  structuredState: z.record(z.string(), z.any()).default({}),
})

export type Branch = z.infer<typeof BranchSchema>

export interface BranchPruningConfig {
  maxBranches: number
  minQualityThreshold: number
  keepSelectedBranches: boolean
  pruneAfterChapters: number
}

export interface BranchMergeResult {
  merged: boolean
  targetBranchId?: string
  reason?: string
  similarity?: number
}

export interface LearnedConfigPatch {
  storyTypeWeights?: {
    narrativeQuality?: number
    tensionLevel?: number
    characterDevelopment?: number
    plotProgression?: number
    characterGrowth?: number
    riskReward?: number
    thematicRelevance?: number
  }
}

const DEFAULT_PRUNING_CONFIG: BranchPruningConfig = {
  maxBranches: 20,
  minQualityThreshold: 3,
  keepSelectedBranches: true,
  pruneAfterChapters: 5,
}

export class BranchManager {
  private branches: Map<string, Branch> = new Map()
  private config: BranchPruningConfig

  constructor(config: Partial<BranchPruningConfig> = {}) {
    this.config = { ...DEFAULT_PRUNING_CONFIG, ...config }
  }

  addBranch(branch: Branch): void {
    const validated = BranchSchema.parse({
      ...branch,
      createdAt: Date.now(),
      pruned: false,
    })
    this.branches.set(validated.id, validated)
    log.info("branch_added", { id: validated.id, choice: validated.choiceMade })
  }

  getBranch(id: string): Branch | undefined {
    return this.branches.get(id)
  }

  getAllBranches(): Branch[] {
    return Array.from(this.branches.values()).filter((b) => !b.pruned)
  }

  getBranchesByChapter(chapter: number): Branch[] {
    return this.getAllBranches().filter((b) => b.chapter === chapter)
  }

  getSelectedBranches(): Branch[] {
    return this.getAllBranches().filter((b) => b.selected)
  }

  calculateBranchScore(branch: Branch, overrideWeights?: Partial<LearnedConfigPatch["storyTypeWeights"]>): number {
    const baseWeights = novelConfigManager.getStoryTypeWeights()
    const weights = overrideWeights ? { ...baseWeights, ...overrideWeights } : baseWeights

    return (
      branch.evaluation.narrativeQuality * weights.narrativeQuality +
      branch.evaluation.tensionLevel * weights.tensionLevel +
      branch.evaluation.characterDevelopment * weights.characterDevelopment +
      branch.evaluation.plotProgression * weights.plotProgression +
      branch.evaluation.characterGrowth * weights.characterGrowth +
      branch.evaluation.riskReward * weights.riskReward +
      branch.evaluation.thematicRelevance * weights.thematicRelevance
    )
  }

  pruneBranches(currentChapter: number, metaWeights?: Partial<LearnedConfigPatch["storyTypeWeights"]>): Branch[] {
    const allBranches = this.getAllBranches()
    const prunedBranches: Branch[] = []

    if (allBranches.length <= this.config.maxBranches) {
      return prunedBranches
    }

    const branchesToPrune = allBranches.length - this.config.maxBranches
    const candidates = allBranches
      .filter((b) => {
        if (this.config.keepSelectedBranches && b.selected) return false
        if (b.chapter && currentChapter - b.chapter < this.config.pruneAfterChapters) return false
        return true
      })
      .map((b) => ({
        branch: b,
        score: this.calculateBranchScore(b, metaWeights),
      }))
      .sort((a, b) => a.score - b.score)

    for (let i = 0; i < Math.min(branchesToPrune, candidates.length); i++) {
      const candidate = candidates[i]
      if (candidate.score < this.config.minQualityThreshold) {
        candidate.branch.pruned = true
        candidate.branch.pruneReason = `Low score: ${candidate.score.toFixed(2)}`
        this.branches.set(candidate.branch.id, candidate.branch)
        prunedBranches.push(candidate.branch)
        log.info("branch_pruned", {
          id: candidate.branch.id,
          score: candidate.score.toFixed(2),
          reason: candidate.branch.pruneReason,
        })
      }
    }

    log.info("pruning_complete", {
      total: allBranches.length,
      pruned: prunedBranches.length,
      remaining: this.getAllBranches().length,
    })

    return prunedBranches
  }

  detectSimilarBranches(threshold: number = 0.8): Array<[Branch, Branch, number]> {
    const branches = this.getAllBranches()
    const similarities: Array<[Branch, Branch, number]> = []

    for (let i = 0; i < branches.length; i++) {
      for (let j = i + 1; j < branches.length; j++) {
        const similarity = this.calculateSimilarity(branches[i], branches[j])
        if (similarity >= threshold) {
          similarities.push([branches[i], branches[j], similarity])
        }
      }
    }

    return similarities.sort((a, b) => b[2] - a[2])
  }

  private calculateSimilarity(a: Branch, b: Branch): number {
    const textSimilarity = this.textJaccardSimilarity(a.storySegment.toLowerCase(), b.storySegment.toLowerCase())

    const choiceSimilarity = a.choiceMade.toLowerCase() === b.choiceMade.toLowerCase() ? 1 : 0

    const evalSimilarity = this.evaluationSimilarity(a.evaluation, b.evaluation)

    return textSimilarity * 0.5 + choiceSimilarity * 0.3 + evalSimilarity * 0.2
  }

  private textJaccardSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/).filter((w) => w.length > 3))
    const wordsB = new Set(b.split(/\s+/).filter((w) => w.length > 3))

    if (wordsA.size === 0 && wordsB.size === 0) return 1
    if (wordsA.size === 0 || wordsB.size === 0) return 0

    const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)))
    const union = new Set([...wordsA, ...wordsB])

    return intersection.size / union.size
  }

  private evaluationSimilarity(a: Branch["evaluation"], b: Branch["evaluation"]): number {
    const keys: Array<keyof typeof a> = [
      "narrativeQuality",
      "tensionLevel",
      "characterDevelopment",
      "plotProgression",
      "characterGrowth",
      "riskReward",
      "thematicRelevance",
    ]

    let totalDiff = 0
    for (const key of keys) {
      totalDiff += Math.abs(a[key] - b[key])
    }

    const maxDiff = keys.length * 9
    return 1 - totalDiff / maxDiff
  }

  mergeBranches(sourceId: string, targetId: string): BranchMergeResult {
    const source = this.branches.get(sourceId)
    const target = this.branches.get(targetId)

    if (!source || !target) {
      return { merged: false, reason: "Branch not found" }
    }

    if (source.selected) {
      return { merged: false, reason: "Cannot merge selected branch" }
    }

    source.mergedInto = targetId
    source.pruned = true
    source.pruneReason = `Merged into ${targetId}`
    this.branches.set(sourceId, source)

    log.info("branches_merged", {
      source: sourceId,
      target: targetId,
    })

    return {
      merged: true,
      targetBranchId: targetId,
      reason: `Merged into branch with higher score`,
    }
  }

  autoMergeSimilarBranches(
    threshold: number = 0.85,
    metaWeights?: Partial<LearnedConfigPatch["storyTypeWeights"]>,
  ): BranchMergeResult[] {
    const similarities = this.detectSimilarBranches(threshold)
    const results: BranchMergeResult[] = []

    for (const [a, b, similarity] of similarities) {
      if (a.pruned || b.pruned) continue

      const scoreA = this.calculateBranchScore(a, metaWeights)
      const scoreB = this.calculateBranchScore(b, metaWeights)

      const [source, target] = scoreA >= scoreB ? [b, a] : [a, b]

      if (source.selected) continue

      const result = this.mergeBranches(source.id, target.id)
      results.push({
        ...result,
        similarity,
      })
    }

    log.info("auto_merge_complete", {
      attempted: similarities.length,
      merged: results.filter((r) => r.merged).length,
    })

    return results
  }

  getBranchTree(): Map<string | undefined, Branch[]> {
    const tree = new Map<string | undefined, Branch[]>()

    for (const branch of this.getAllBranches()) {
      const parentKey = branch.parentId
      if (!tree.has(parentKey)) {
        tree.set(parentKey, [])
      }
      tree.get(parentKey)!.push(branch)
    }

    return tree
  }

  getBranchPath(branchId: string): Branch[] {
    const path: Branch[] = []
    let current = this.branches.get(branchId)

    while (current) {
      path.unshift(current)
      current = current.parentId ? this.branches.get(current.parentId) : undefined
    }

    return path
  }

  getEventsByBranchId(branchId: string): Branch["events"] {
    const branch = this.branches.get(branchId)
    return branch?.events || []
  }

  getStats(metaWeights?: Partial<LearnedConfigPatch["storyTypeWeights"]>): {
    total: number
    active: number
    pruned: number
    merged: number
    selected: number
    avgScore: number
  } {
    const all = Array.from(this.branches.values())
    const active = all.filter((b) => !b.pruned)
    const scores = active.map((b) => this.calculateBranchScore(b, metaWeights))

    return {
      total: all.length,
      active: active.length,
      pruned: all.filter((b) => b.pruned && !b.mergedInto).length,
      merged: all.filter((b) => !!b.mergedInto).length,
      selected: active.filter((b) => b.selected).length,
      avgScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    }
  }

  clear(): void {
    this.branches.clear()
    log.info("branches_cleared")
  }
}

export const branchManager = new BranchManager()
