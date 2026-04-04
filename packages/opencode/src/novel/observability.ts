import { Log } from "../util/log"
import { BranchManager } from "./branch-manager"
import { EnhancedPatternMiner } from "./pattern-miner-enhanced"
import { MotifTracker } from "./motif-tracker"
import { StoryKnowledgeGraph } from "./story-knowledge-graph"
import { StoryWorldMemory } from "./story-world-memory"

const log = Log.create({ service: "novel-observability" })

export interface NovelMetrics {
  // Branch metrics
  totalBranches: number
  activeBranches: number
  prunedBranches: number
  avgBranchScore: number
  branchHealthScore: number

  // Pattern metrics
  totalPatterns: number
  activePatterns: number
  patternDiscoveryRate: number // patterns per chapter
  avgPatternStrength: number

  // Character metrics
  totalCharacters: number
  activeCharacters: number
  characterDevelopmentScore: number

  // Relationship metrics
  totalRelationships: number
  factionCount: number
  relationshipStabilityScore: number

  // Motif metrics
  totalMotifs: number
  motifEvolutionCount: number
  thematicConsistencyScore: number

  // Memory metrics
  totalMemories: number
  memoryDistribution: {
    sentence: number
    scene: number
    chapter: number
    arc: number
    story: number
  }

  // Knowledge graph metrics
  totalNodes: number
  totalEdges: number
  graphDensity: number
  inconsistencyCount: number

  // Performance metrics
  avgGenerationTime: number
  avgExtractionTime: number
  errorRate: number
}

export interface NovelHealthReport {
  overall: "healthy" | "warning" | "critical"
  score: number
  issues: Array<{
    category: string
    severity: "low" | "medium" | "high"
    description: string
    recommendation: string
  }>
  metrics: NovelMetrics
  timestamp: number
}

export interface TraceEvent {
  id: string
  type:
    | "branch_generation"
    | "state_extraction"
    | "pattern_mining"
    | "faction_detection"
    | "memory_store"
    | "graph_update"
  startTime: number
  endTime: number
  duration: number
  status: "success" | "error" | "warning"
  metadata: Record<string, unknown>
  error?: string
}

export class NovelObservability {
  private traceEvents: Map<string, TraceEvent> = new Map()
  private metricsHistory: Array<{ timestamp: number; metrics: NovelMetrics }> = []
  private errorCounts: Map<string, number> = new Map()
  private generationTimes: number[] = []
  private extractionTimes: number[] = []

  private static readonly MAX_TRACE_EVENTS = 1000
  private static readonly MAX_METRICS_HISTORY = 100

  /**
   * Record a state extraction duration for performance tracking.
   */
  recordExtractionTime(durationMs: number): void {
    this.extractionTimes.push(durationMs)
    if (this.extractionTimes.length > 100) {
      this.extractionTimes.shift()
    }
  }

  startTrace(type: TraceEvent["type"], metadata: Record<string, unknown> = {}): string {
    const id = `trace_${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    const event: TraceEvent = {
      id,
      type,
      startTime: Date.now(),
      endTime: 0,
      duration: 0,
      status: "success",
      metadata,
    }

    this.traceEvents.set(id, event)

    // Cleanup old events
    if (this.traceEvents.size > NovelObservability.MAX_TRACE_EVENTS) {
      const oldestId = Array.from(this.traceEvents.keys())[0]
      this.traceEvents.delete(oldestId)
    }

    return id
  }

  endTrace(id: string, status: TraceEvent["status"] = "success", error?: string): void {
    const event = this.traceEvents.get(id)
    if (!event) return

    event.endTime = Date.now()
    event.duration = event.endTime - event.startTime
    event.status = status
    if (error) {
      event.error = error
    }

    // Track errors
    if (status === "error") {
      const key = `${event.type}_error`
      this.errorCounts.set(key, (this.errorCounts.get(key) || 0) + 1)
    }

    // Track generation times
    if (event.type === "branch_generation") {
      this.generationTimes.push(event.duration)
      if (this.generationTimes.length > 100) {
        this.generationTimes.shift()
      }
    }

    this.traceEvents.set(id, event)
  }

  async collectMetrics(
    branchManager: BranchManager,
    patternMiner: EnhancedPatternMiner,
    motifTracker: MotifTracker,
    knowledgeGraph: StoryKnowledgeGraph,
    storyWorldMemory: StoryWorldMemory,
    characters: Record<string, any>,
    relationships: Record<string, any>,
    chapterCount: number = 1,
  ): Promise<NovelMetrics> {
    const branchStats = branchManager.getStats()
    const patternStats = patternMiner.getStats()
    const graphStats = await knowledgeGraph.getStats()
    const memoryStats = await storyWorldMemory.getStats()

    const activeCharacters = Object.values(characters).filter((c: any) => c.status === "active").length

    const motifStats = motifTracker.getStats()

    // Faction count from knowledge graph groups
    let factionCount = 0
    try {
      const groups = await knowledgeGraph.getAllGroups()
      factionCount = groups.length
    } catch {
      factionCount = 0
    }

    // Inconsistency count from knowledge graph detection
    let inconsistencyCount = 0
    try {
      for (const charId of Object.keys(characters)) {
        const issues = await knowledgeGraph.detectInconsistency(charId)
        inconsistencyCount += issues.length
      }
    } catch {
      inconsistencyCount = 0
    }

    // Memory distribution by level
    const memoryDistribution = {
      sentence: memoryStats.byLevel?.sentence ?? 0,
      scene: memoryStats.byLevel?.scene ?? 0,
      chapter: memoryStats.byLevel?.chapter ?? 0,
      arc: memoryStats.byLevel?.arc ?? 0,
      story: memoryStats.byLevel?.story ?? 0,
    }

    const metrics: NovelMetrics = {
      // Branch metrics
      totalBranches: branchStats.total,
      activeBranches: branchStats.active,
      prunedBranches: branchStats.pruned,
      avgBranchScore: branchStats.avgScore,
      branchHealthScore: this.calculateBranchHealth(branchStats),

      // Pattern metrics
      totalPatterns: patternStats.patterns + patternStats.archetypes + patternStats.motifs,
      activePatterns: patternStats.avgStrength > 50 ? patternStats.patterns : 0,
      patternDiscoveryRate: patternStats.patterns / Math.max(1, chapterCount),
      avgPatternStrength: patternStats.avgStrength,

      // Character metrics
      totalCharacters: Object.keys(characters).length,
      activeCharacters,
      characterDevelopmentScore: this.calculateCharacterDevelopment(characters),

      // Relationship metrics
      totalRelationships: Object.keys(relationships).length,
      factionCount,
      relationshipStabilityScore: this.calculateRelationshipStability(relationships),

      // Motif metrics
      totalMotifs: motifStats.motifs,
      motifEvolutionCount: motifStats.evolutions || 0,
      thematicConsistencyScore: motifStats.avgStrength || 50,

      // Memory metrics
      totalMemories: memoryStats.total,
      memoryDistribution,

      // Knowledge graph metrics
      totalNodes: graphStats.totalNodes,
      totalEdges: graphStats.totalEdges,
      graphDensity: graphStats.totalEdges / Math.max(1, (graphStats.totalNodes * (graphStats.totalNodes - 1)) / 2),
      inconsistencyCount,

      // Performance metrics
      avgGenerationTime:
        this.generationTimes.length > 0
          ? this.generationTimes.reduce((a, b) => a + b, 0) / this.generationTimes.length
          : 0,
      avgExtractionTime: this.extractionTimes.length > 0
        ? this.extractionTimes.reduce((a, b) => a + b, 0) / this.extractionTimes.length
        : 0,
      errorRate: this.calculateErrorRate(),
    }

    // Store in history
    this.metricsHistory.push({ timestamp: Date.now(), metrics })
    if (this.metricsHistory.length > NovelObservability.MAX_METRICS_HISTORY) {
      this.metricsHistory.shift()
    }

    return metrics
  }

  async generateHealthReport(metrics: NovelMetrics): Promise<NovelHealthReport> {
    const issues: NovelHealthReport["issues"] = []
    let totalScore = 100

    // Check branch health
    if (metrics.branchHealthScore < 50) {
      issues.push({
        category: "branches",
        severity: metrics.branchHealthScore < 30 ? "high" : "medium",
        description: `Branch health is low (${metrics.branchHealthScore.toFixed(1)}%)`,
        recommendation: "Consider pruning more aggressively or improving branch quality",
      })
      totalScore -= 20
    }

    // Check pattern discovery
    if (metrics.patternDiscoveryRate < 0.5) {
      issues.push({
        category: "patterns",
        severity: "low",
        description: "Low pattern discovery rate",
        recommendation: "Enable more aggressive pattern mining",
      })
      totalScore -= 10
    }

    // Check character development
    if (metrics.characterDevelopmentScore < 50) {
      issues.push({
        category: "characters",
        severity: "medium",
        description: `Character development is stagnant (${metrics.characterDevelopmentScore.toFixed(1)}%)`,
        recommendation: "Focus on character arcs and growth",
      })
      totalScore -= 15
    }

    // Check relationship stability
    if (metrics.relationshipStabilityScore < 40) {
      issues.push({
        category: "relationships",
        severity: "medium",
        description: "Relationship dynamics are unstable",
        recommendation: "Enable relationship inertia to prevent unrealistic shifts",
      })
      totalScore -= 15
    }

    // Check error rate
    if (metrics.errorRate > 0.1) {
      issues.push({
        category: "performance",
        severity: metrics.errorRate > 0.2 ? "high" : "medium",
        description: `High error rate (${(metrics.errorRate * 100).toFixed(1)}%)`,
        recommendation: "Review error logs and fix underlying issues",
      })
      totalScore -= 25
    }

    // Check graph inconsistencies
    if (metrics.inconsistencyCount > 0) {
      issues.push({
        category: "consistency",
        severity: "high",
        description: `${metrics.inconsistencyCount} story inconsistencies detected`,
        recommendation: "Review and fix inconsistencies in the knowledge graph",
      })
      totalScore -= 30
    }

    const overall = totalScore >= 80 ? "healthy" : totalScore >= 50 ? "warning" : "critical"

    return {
      overall,
      score: Math.max(0, totalScore),
      issues,
      metrics,
      timestamp: Date.now(),
    }
  }

  getTraceEvents(limit: number = 100): TraceEvent[] {
    return Array.from(this.traceEvents.values())
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, limit)
  }

  getMetricsHistory(): Array<{ timestamp: number; metrics: NovelMetrics }> {
    return this.metricsHistory
  }

  exportTraceData(): string {
    return JSON.stringify(
      {
        events: Array.from(this.traceEvents.values()),
        metricsHistory: this.metricsHistory,
        errorCounts: Object.fromEntries(this.errorCounts),
        exportedAt: Date.now(),
      },
      null,
      2,
    )
  }

  getErrorSummary(): Record<string, number> {
    return Object.fromEntries(this.errorCounts)
  }

  private calculateBranchHealth(stats: any): number {
    const activeRatio = stats.active / Math.max(1, stats.total)
    const qualityScore = stats.avgScore / 10
    return activeRatio * 50 + qualityScore * 50
  }

  private calculateCharacterDevelopment(characters: Record<string, any>): number {
    let totalScore = 0
    let count = 0

    for (const char of Object.values(characters)) {
      const c = char as any
      const hasArc = c.goals?.length > 0 || c.trauma?.length > 0 || c.skills?.length > 0
      const hasGrowth = c.stress !== undefined && c.stress > 0
      const hasRelationships = c.relationships && Object.keys(c.relationships).length > 0

      if (hasArc) totalScore += 40
      if (hasGrowth) totalScore += 30
      if (hasRelationships) totalScore += 30
      count++
    }

    return count > 0 ? totalScore / count : 0
  }

  private calculateRelationshipStability(relationships: Record<string, any>): number {
    let totalStability = 0
    let count = 0

    for (const rel of Object.values(relationships)) {
      const r = rel as any
      const trust = Math.abs(r.trust || 0)
      const hostility = Math.abs(r.hostility || 0)

      // Stable if trust is high or hostility is consistently high
      if (trust > 50 || hostility > 70) {
        totalStability += 80
      } else if (trust > 20 || hostility > 30) {
        totalStability += 50
      } else {
        totalStability += 20
      }
      count++
    }

    return count > 0 ? totalStability / count : 50
  }

  private calculateErrorRate(): number {
    const totalErrors = Array.from(this.errorCounts.values()).reduce((a, b) => a + b, 0)
    const totalEvents = this.traceEvents.size

    return totalEvents > 0 ? totalErrors / totalEvents : 0
  }
}

export const novelObservability = new NovelObservability()
