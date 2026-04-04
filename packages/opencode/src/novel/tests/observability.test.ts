import { describe, test, expect, beforeEach } from "bun:test"
import { NovelObservability } from "../observability"
import { BranchManager } from "../branch-manager"
import { EnhancedPatternMiner } from "../pattern-miner-enhanced"
import { MotifTracker } from "../motif-tracker"
import { StoryKnowledgeGraph } from "../story-knowledge-graph"
import { StoryWorldMemory } from "../story-world-memory"

describe("NovelObservability", () => {
  let observability: NovelObservability
  let branchManager: BranchManager
  let patternMiner: EnhancedPatternMiner
  let motifTracker: MotifTracker
  let knowledgeGraph: StoryKnowledgeGraph
  let storyWorldMemory: StoryWorldMemory

  beforeEach(() => {
    observability = new NovelObservability()
    branchManager = new BranchManager()
    patternMiner = new EnhancedPatternMiner()
    motifTracker = new MotifTracker()
    knowledgeGraph = new StoryKnowledgeGraph()
    storyWorldMemory = new StoryWorldMemory()
  })

  test("startTrace creates trace event", () => {
    const traceId = observability.startTrace("branch_generation")

    expect(traceId).toBeDefined()
    expect(traceId.startsWith("trace_branch_generation_")).toBe(true)
  })

  test("endTrace completes trace event", async () => {
    const traceId = observability.startTrace("state_extraction")

    await new Promise((r) => setTimeout(r, 1))
    observability.endTrace(traceId, "success")

    const events = observability.getTraceEvents()
    const event = events.find((e) => e.id === traceId)

    expect(event).toBeDefined()
    expect(event?.status).toBe("success")
    expect(event?.duration).toBeGreaterThanOrEqual(0)
  })

  test("endTrace with error tracks error count", () => {
    const traceId = observability.startTrace("pattern_mining")

    observability.endTrace(traceId, "error", "Test error")

    const errorSummary = observability.getErrorSummary()
    expect(errorSummary["pattern_mining_error"]).toBeGreaterThan(0)
  })

  test("collectMetrics gathers all metrics", async () => {
    branchManager.addBranch({
      id: "test_branch",
      storySegment: "Test",
      branchPoint: "Test",
      choiceMade: "Test",
      choiceRationale: "Test",
      stateAfter: {},
      evaluation: {
        narrativeQuality: 7,
        tensionLevel: 5,
        characterDevelopment: 6,
        plotProgression: 5,
        characterGrowth: 6,
        riskReward: 5,
        thematicRelevance: 6,
      },
      selected: false,
      events: [],
      structuredState: {},
    })

    const metrics = await observability.collectMetrics(
      branchManager,
      patternMiner,
      motifTracker,
      knowledgeGraph,
      storyWorldMemory,
      { alice: { status: "active", stress: 50 } },
      { "alice-bob": { trust: 50 } },
    )

    expect(metrics.totalBranches).toBe(1)
    expect(metrics.activeBranches).toBe(1)
    expect(metrics.totalCharacters).toBe(1)
  })

  test("generateHealthReport returns health status", async () => {
    const metrics = await observability.collectMetrics(
      branchManager,
      patternMiner,
      motifTracker,
      knowledgeGraph,
      storyWorldMemory,
      {},
      {},
    )

    const report = await observability.generateHealthReport(metrics)

    expect(report.overall).toBeDefined()
    expect(["healthy", "warning", "critical"]).toContain(report.overall)
    expect(report.score).toBeGreaterThanOrEqual(0)
    expect(report.score).toBeLessThanOrEqual(100)
    expect(Array.isArray(report.issues)).toBe(true)
  })

  test("generateHealthReport detects issues with low branch health", async () => {
    for (let i = 0; i < 20; i++) {
      branchManager.addBranch({
        id: `low_score_branch_${i}`,
        storySegment: "Test",
        branchPoint: "Test",
        choiceMade: "Test",
        choiceRationale: "Test",
        stateAfter: {},
        evaluation: {
          narrativeQuality: 1,
          tensionLevel: 1,
          characterDevelopment: 1,
          plotProgression: 1,
          characterGrowth: 1,
          riskReward: 1,
          thematicRelevance: 1,
        },
        selected: false,
        events: [],
        structuredState: {},
      })
    }

    const metrics = await observability.collectMetrics(
      branchManager,
      patternMiner,
      motifTracker,
      knowledgeGraph,
      storyWorldMemory,
      {},
      {},
    )

    const report = await observability.generateHealthReport(metrics)

    expect(report.score).toBeLessThan(100)
    expect(report.issues.length).toBeGreaterThan(0)
  })

  test("exportTraceData exports all trace data", () => {
    const traceId = observability.startTrace("branch_generation")
    observability.endTrace(traceId, "success")

    const exported = observability.exportTraceData()

    const data = JSON.parse(exported)
    expect(data.events).toBeDefined()
    expect(data.metricsHistory).toBeDefined()
    expect(data.errorCounts).toBeDefined()
    expect(data.exportedAt).toBeDefined()
  })

  test("getMetricsHistory returns history", async () => {
    await observability.collectMetrics(branchManager, patternMiner, motifTracker, knowledgeGraph, storyWorldMemory, {}, {})

    const history = observability.getMetricsHistory()

    expect(history.length).toBeGreaterThan(0)
    expect(history[0].metrics).toBeDefined()
    expect(history[0].timestamp).toBeDefined()
  })
})
