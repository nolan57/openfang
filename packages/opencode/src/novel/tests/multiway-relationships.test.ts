import { describe, test, expect, beforeEach } from "bun:test"
import { RelationshipViewService, AsyncGroupManagementService, type GraphReader } from "../multiway-relationships"
import type { GraphNode, GraphEdge } from "../story-knowledge-graph"

describe("RelationshipViewService", () => {
  let service: RelationshipViewService

  const mockGraphReader: GraphReader = {
    getCharacterNames: async () => [],
    getCharacterIdByName: async () => null,
    getRelationshipsForCharacters: async () => [],
    getEdgeCountForChapter: async () => 0,
    getAllCharacters: async () => [],
    getActiveCharacters: async () => [],
    findNodeByName: async () => null,
    addGroup: async () => ({ id: "", name: "", type: "group", firstAppearance: 0, status: "active" } as GraphNode),
    addMemberToGroup: async () => ({ id: "", source: "", target: "", type: "memberOf", strength: 0, chapter: 0 } as GraphEdge),
    getGroupMembers: async () => [],
    getAllGroups: async () => [],
  }

  beforeEach(() => {
    service = new RelationshipViewService(mockGraphReader)
  })

  test("getSceneTensionLevel returns 0 for empty characters", () => {
    expect(service.getSceneTensionLevel([], 1)).toBe(0)
  })

  test("getSceneTensionLevel returns default for single character", () => {
    expect(service.getSceneTensionLevel(["Alice"], 1)).toBe(0)
  })

  test("analyzeGroupDynamics returns empty result for < 2 characters", async () => {
    const result = await service.analyzeGroupDynamics(["Alice"], 1)
    expect(result.cohesion).toBe(0)
    expect(result.fractureRisks).toEqual([])
  })

  test("detectTriads returns empty for < 3 characters", async () => {
    const triads = await service.detectTriads(["Alice", "Bob"], 1)
    expect(triads).toEqual([])
  })

  test("discoverActiveGroups returns empty for no characters", async () => {
    const groups = await service.discoverActiveGroups(30, 1)
    expect(groups).toEqual([])
  })
})

describe("AsyncGroupManagementService", () => {
  let service: AsyncGroupManagementService

  const createdGroups: Array<{ id: string; name: string; chapter: number }> = []
  const createdMemberships: Array<{ groupId: string; characterId: string; role: string }> = []

  const mockGraphReader: GraphReader = {
    getCharacterNames: async () => ["Alice", "Bob"],
    getCharacterIdByName: async (name: string) => name === "Alice" || name === "Bob" ? name : null,
    getRelationshipsForCharacters: async () => [],
    getEdgeCountForChapter: async () => 0,
    getAllCharacters: async () => [],
    getActiveCharacters: async () => [],
    findNodeByName: async () => null,
    addGroup: async (name: string, chapter: number) => {
      const id = `group_${Date.now()}`
      createdGroups.push({ id, name, chapter })
      return { id, name, type: "group", firstAppearance: chapter, status: "active" } as GraphNode
    },
    addMemberToGroup: async (groupId: string, characterId: string, role: string) => {
      createdMemberships.push({ groupId, characterId, role })
      return { id: `edge_${Date.now()}`, source: characterId, target: groupId, type: "memberOf", strength: 70, chapter: 1 } as GraphEdge
    },
    getAllGroups: async () => createdGroups.map((g) => ({ id: g.id, name: g.name, type: "group", firstAppearance: g.chapter, status: "active" } as GraphNode)),
    getGroupMembers: async () => [],
  }

  beforeEach(() => {
    createdGroups.length = 0
    createdMemberships.length = 0
    service = new AsyncGroupManagementService(mockGraphReader)
  })

  test("createGroupConcept creates group and memberships", async () => {
    const groupId = await service.createGroupConcept("Test Alliance", ["Alice", "Bob"], "A test group", 1)

    expect(groupId).toBeDefined()
    expect(createdGroups.length).toBe(1)
    expect(createdGroups[0].name).toBe("Test Alliance")
    expect(createdMemberships.length).toBe(2)
    expect(createdMemberships.map((m) => m.characterId).sort()).toEqual(["Alice", "Bob"])
  })

  test("refineGroupWithLLM does not throw", () => {
    expect(() => {
      service.refineGroupWithLLM("test-group", "Test description", 1)
    }).not.toThrow()
    // LLM runs asynchronously via queueMicrotask, so we just verify it doesn't throw
  })
})
