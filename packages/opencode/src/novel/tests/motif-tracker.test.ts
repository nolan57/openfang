import { describe, test, expect, beforeEach } from "bun:test"
import { MotifTracker } from "../motif-tracker"
import type { MotifEvolution, MotifCharacterCorrelation } from "../motif-tracker"

describe("MotifTracker", () => {
  let tracker: MotifTracker

  beforeEach(() => {
    tracker = new MotifTracker()
  })

  const createEvolution = (motifId: string, chapter: number): MotifEvolution => ({
    motifId,
    motifName: "Test Motif",
    fromState: "initial",
    toState: "evolved",
    triggerEvent: "Test event",
    triggerChapter: chapter,
    thematicSignificance: 7,
    timestamp: Date.now(),
  })

  const createCorrelation = (motifId: string, character: string): MotifCharacterCorrelation => ({
    motifId,
    characterName: character,
    correlationStrength: 75,
    arcPhase: "exploration",
    impactType: "positive",
    description: "Test correlation",
    chapters: [1],
  })

  test("recordEvolution stores evolution", () => {
    const evolution = createEvolution("motif_1", 1)
    tracker.recordEvolution(evolution)

    const evolutions = tracker.getMotifEvolutions("motif_1")
    expect(evolutions.length).toBe(1)
    expect(evolutions[0].motifName).toBe("Test Motif")
  })

  test("updateCorrelation stores correlation", () => {
    const correlation = createCorrelation("motif_1", "Alice")
    tracker.updateCorrelation(correlation)

    const correlations = tracker.getCharacterCorrelations("Alice")
    expect(correlations.length).toBe(1)
    expect(correlations[0].correlationStrength).toBe(75)
  })

  test("getMotifCorrelations returns correlations for motif", () => {
    tracker.updateCorrelation(createCorrelation("motif_1", "Alice"))
    tracker.updateCorrelation(createCorrelation("motif_1", "Bob"))

    const correlations = tracker.getMotifCorrelations("motif_1")
    expect(correlations.length).toBe(2)
  })

  test("getMotifEvolutions returns empty array for unknown motif", () => {
    const evolutions = tracker.getMotifEvolutions("unknown")
    expect(evolutions).toEqual([])
  })

  test("getCharacterCorrelations returns empty array for unknown character", () => {
    const correlations = tracker.getCharacterCorrelations("unknown")
    expect(correlations).toEqual([])
  })

  test("exportToKnowledgeGraph returns nodes and edges", () => {
    tracker.recordEvolution(createEvolution("motif_1", 1))
    tracker.updateCorrelation(createCorrelation("motif_1", "Alice"))

    const graph = tracker.exportToKnowledgeGraph()

    expect(graph.nodes.length).toBeGreaterThan(0)
    expect(graph.edges.length).toBeGreaterThan(0)
  })

  test("getMotifEvolutionReport generates report", () => {
    tracker.recordEvolution(createEvolution("motif_1", 1))

    const report = tracker.getMotifEvolutionReport()
    expect(report).toContain("Motif Evolution Report")
    expect(report).toContain("Test Motif")
  })

  test("clear removes all data", () => {
    tracker.recordEvolution(createEvolution("motif_1", 1))
    tracker.updateCorrelation(createCorrelation("motif_1", "Alice"))

    tracker.clear()

    expect(tracker.getMotifEvolutions("motif_1")).toEqual([])
    expect(tracker.getCharacterCorrelations("Alice")).toEqual([])
  })
})
