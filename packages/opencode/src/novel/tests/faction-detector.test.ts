import { describe, test, expect, beforeEach } from "bun:test"
import { FactionDetector, type RelationshipData } from "../faction-detector"

describe("FactionDetector", () => {
  let detector: FactionDetector

  beforeEach(() => {
    detector = new FactionDetector()
  })

  const createCharacters = (names: string[]): Record<string, any> => {
    const chars: Record<string, any> = {}
    for (const name of names) {
      chars[name] = { name, stress: 0, status: "active" }
    }
    return chars
  }

  const createRelationships = (
    pairs: Array<[string, string, Partial<RelationshipData>]>,
  ): Record<string, RelationshipData> => {
    const rels: Record<string, RelationshipData> = {}
    for (const [a, b, data] of pairs) {
      rels[`${a}-${b}`] = {
        trust: data.trust ?? 50,
        hostility: data.hostility ?? 0,
        dominance: data.dominance ?? 0,
        friendliness: data.friendliness ?? 50,
        ...data,
      }
    }
    return rels
  }

  test("detectFactions identifies alliance", () => {
    const characters = createCharacters(["Alice", "Bob", "Charlie"])
    const relationships = createRelationships([
      ["Alice", "Bob", { trust: 80, hostility: 10 }],
      ["Bob", "Charlie", { trust: 70, hostility: 5 }],
      ["Alice", "Charlie", { trust: 75, hostility: 10 }],
    ])

    const result = detector.detectFactions(characters, relationships, 1)

    expect(result.factions.length).toBeGreaterThan(0)
    expect(result.factions[0].type).toBe("alliance")
    expect(result.factions[0].members.length).toBe(3)
  })

  test("detectFactions identifies opposition", () => {
    const characters = createCharacters(["Hero", "Villain", "Minion"])
    const relationships = createRelationships([
      ["Hero", "Villain", { trust: -50, hostility: 90 }],
      ["Villain", "Minion", { trust: 60, hostility: 20 }],
      ["Hero", "Minion", { trust: -30, hostility: 70 }],
    ])

    const result = detector.detectFactions(characters, relationships, 1)

    expect(result.factions.length).toBeGreaterThan(0)
    expect(result.factions.some((f) => f.type === "opposition")).toBe(true)
  })

  test("detectFactions returns unaligned characters", () => {
    const characters = createCharacters(["Alice", "Bob", "LoneWolf"])
    const relationships = createRelationships([["Alice", "Bob", { trust: 80, hostility: 10 }]])

    const result = detector.detectFactions(characters, relationships, 1)

    expect(result.unalignedCharacters).toContain("LoneWolf")
  })

  test("getCharacterFactions returns factions for character", () => {
    const characters = createCharacters(["Alice", "Bob"])
    const relationships = createRelationships([["Alice", "Bob", { trust: 70, hostility: 10 }]])

    detector.detectFactions(characters, relationships, 1)

    const aliceFactions = detector.getCharacterFactions("Alice")

    expect(aliceFactions.length).toBeGreaterThan(0)
    expect(aliceFactions[0].members.some((m) => m.characterName === "Alice")).toBe(true)
  })

  test("updateFactionRelationships sets stance between factions", () => {
    const characters = createCharacters(["A1", "A2", "B1", "B2"])
    const relationships = createRelationships([
      ["A1", "A2", { trust: 80, hostility: 10 }],
      ["B1", "B2", { trust: 80, hostility: 10 }],
    ])

    const result = detector.detectFactions(characters, relationships, 1)

    if (result.factions.length >= 2) {
      const updated = detector.updateFactionRelationships(result.factions[0].id, result.factions[1].id, "enemy")

      expect(updated).toBe(true)

      const faction1 = detector.getFaction(result.factions[0].id)
      expect(faction1?.relationships[result.factions[1].id]).toBe("enemy")
    }
  })

  test("getFactionRelationsReport generates report", () => {
    const characters = createCharacters(["Alice", "Bob"])
    const relationships = createRelationships([["Alice", "Bob", { trust: 70, hostility: 10 }]])

    detector.detectFactions(characters, relationships, 1)

    const report = detector.getFactionRelationsReport()

    expect(report).toContain("Faction Relations Report")
    expect(report.length).toBeGreaterThan(50)
  })

  test("cohesion calculation affects faction detection", () => {
    const characters = createCharacters(["A", "B", "C"])
    const highCohesionRelationships = createRelationships([
      ["A", "B", { trust: 80, hostility: 5 }],
      ["B", "C", { trust: 85, hostility: 3 }],
      ["A", "C", { trust: 82, hostility: 4 }],
    ])

    const highCohesionResult = detector.detectFactions(characters, highCohesionRelationships, 1)

    const lowCohesionDetector = new FactionDetector({ cohesionThreshold: 90 })
    const lowCohesionRelationships = createRelationships([
      ["A", "B", { trust: 30, hostility: 40 }],
      ["B", "C", { trust: 25, hostility: 45 }],
      ["A", "C", { trust: 35, hostility: 35 }],
    ])

    const lowCohesionResult = lowCohesionDetector.detectFactions(characters, lowCohesionRelationships, 1)

    expect(highCohesionResult.factions.length).toBeGreaterThanOrEqual(lowCohesionResult.factions.length)
  })
})
