import { describe, test, expect, beforeEach } from "bun:test"
import { RelationshipInertiaManager } from "../relationship-inertia"

describe("RelationshipInertiaManager", () => {
  let manager: RelationshipInertiaManager

  beforeEach(() => {
    manager = new RelationshipInertiaManager()
  })

  test("initializeRelationship creates inertia entry", () => {
    manager.initializeRelationship("Alice", "Bob", 50)

    const inertia = manager.getInertia("Alice", "Bob")
    expect(inertia).toBeDefined()
    expect(inertia?.trustInertia).toBe(50)
    expect(inertia?.resistanceToChange).toBe(50)
  })

  test("getInertia returns same result regardless of order", () => {
    manager.initializeRelationship("Alice", "Bob", 30)

    const inertia1 = manager.getInertia("Alice", "Bob")
    const inertia2 = manager.getInertia("Bob", "Alice")

    expect(inertia1).toEqual(inertia2)
  })

  test("calculateAllowedShift limits non-dramatic shifts", () => {
    manager.initializeRelationship("Alice", "Bob", 0)

    const result = manager.calculateAllowedShift("Alice", "Bob", 50, false, 1)

    expect(result.allowed).toBe(false)
    expect(Math.abs(result.actualShift)).toBeLessThan(50)
  })

  test("calculateAllowedShift allows dramatic events to override", () => {
    manager.initializeRelationship("Alice", "Bob", 0)

    const result = manager.calculateAllowedShift("Alice", "Bob", 80, true, 1)

    expect(result.allowed).toBe(true)
    expect(result.actualShift).toBe(80)
  })

  test("applyShift updates trust inertia", () => {
    manager.initializeRelationship("Alice", "Bob", 0)
    manager.applyShift("Alice", "Bob", 20, "Test event", false, 1)

    const inertia = manager.getInertia("Alice", "Bob")
    expect(inertia?.trustInertia).toBeGreaterThan(0)
    expect(inertia?.shiftHistory?.length).toBe(1)
  })

  test("applyShift with dramatic event increases resistance", () => {
    manager.initializeRelationship("Alice", "Bob", 0)
    const initialResistance = manager.getInertia("Alice", "Bob")?.resistanceToChange || 0

    manager.applyShift("Alice", "Bob", 50, "Major betrayal", true, 1)

    const inertia = manager.getInertia("Alice", "Bob")
    expect(inertia?.resistanceToChange).toBeGreaterThan(initialResistance)
  })

  test("decayResistance reduces resistance over time", () => {
    manager.initializeRelationship("Alice", "Bob", 0)
    manager.applyShift("Alice", "Bob", 50, "Event", true, 1)

    const beforeDecay = manager.getInertia("Alice", "Bob")?.resistanceToChange || 0
    manager.decayResistance()
    const afterDecay = manager.getInertia("Alice", "Bob")?.resistanceToChange || 0

    expect(afterDecay).toBeLessThan(beforeDecay)
  })

  test("getAllInertias returns all relationships", () => {
    manager.initializeRelationship("Alice", "Bob", 50)
    manager.initializeRelationship("Charlie", "Dave", 30)

    const inertias = manager.getAllInertias()

    expect(inertias.length).toBe(2)
  })

  test("getActiveHooks returns empty array initially", () => {
    const hooks = manager.getActiveHooks()
    expect(hooks).toEqual([])
  })

  test("getPlotHooksReport generates report", () => {
    manager.initializeRelationship("Alice", "Bob", 50)

    const report = manager.getPlotHooksReport()
    expect(report).toContain("Relationship Plot Hooks Report")
    expect(report).toContain("Alice & Bob")
  })

  test("clear removes all data", () => {
    manager.initializeRelationship("Alice", "Bob", 50)
    manager.clear()

    expect(manager.getAllInertias()).toEqual([])
    expect(manager.getActiveHooks()).toEqual([])
  })
})
