import { describe, test, expect, beforeEach } from "bun:test"
import { StoryKnowledgeGraph } from "../story-knowledge-graph"

describe("StoryKnowledgeGraph", () => {
  let graph: StoryKnowledgeGraph

  beforeEach(async () => {
    graph = new StoryKnowledgeGraph()
    await graph.initialize()
    await graph.clear()
  })

  test("initializes database", async () => {
    const stats = await graph.getStats()
    expect(stats).toBeDefined()
    expect(typeof stats.totalNodes).toBe("number")
  })

  test("addNode adds character node", async () => {
    const node = await graph.addNode({
      type: "character",
      name: "Alice",
      description: "The protagonist",
      firstAppearance: 1,
      status: "active",
    })

    expect(node.id).toBeDefined()
    expect(node.name).toBe("Alice")
    expect(node.type).toBe("character")
  })

  test("addCharacter creates character node", async () => {
    const node = await graph.addCharacter("Bob", 1)

    expect(node.type).toBe("character")
    expect(node.name).toBe("Bob")
  })

  test("addLocation creates location node", async () => {
    const node = await graph.addLocation("Tavern", 1, "A cozy tavern")

    expect(node.type).toBe("location")
    expect(node.name).toBe("Tavern")
  })

  test("addItem creates item node", async () => {
    const node = await graph.addItem("Sword", 1, "A magical sword")

    expect(node.type).toBe("item")
    expect(node.name).toBe("Sword")
  })

  test("addEvent creates event node", async () => {
    const node = await graph.addEvent("Battle", 1, "The great battle")

    expect(node.type).toBe("event")
    expect(node.name).toBe("Battle")
  })

  test("addEdge creates relationship", async () => {
    const char1 = await graph.addCharacter("Alice", 1)
    const char2 = await graph.addCharacter("Bob", 1)

    const edge = await graph.addEdge({
      source: char1.id,
      target: char2.id,
      type: "knows",
      strength: 70,
      chapter: 1,
    })

    expect(edge.id).toBeDefined()
    expect(edge.source).toBe(char1.id)
    expect(edge.target).toBe(char2.id)
  })

  test("connectCharacterToLocation creates location_at edge", async () => {
    const character = await graph.addCharacter("Alice", 1)
    const location = await graph.addLocation("Tavern", 1)

    const edge = await graph.connectCharacterToLocation(character.id, location.id, 1)

    expect(edge.type).toBe("located_at")
  })

  test("connectCharacterToFaction creates memberOf edge", async () => {
    const character = await graph.addCharacter("Alice", 1)
    const faction = await graph.addNode({
      type: "faction",
      name: "Guild",
      firstAppearance: 1,
      status: "active",
    })

    const edge = await graph.connectCharacterToFaction(character.id, faction.id, "member", 1)

    expect(edge.type).toBe("memberOf")
  })

  test("getNode retrieves node", async () => {
    const node = await graph.addCharacter("Alice", 1)
    const retrieved = await graph.getNode(node.id)

    expect(retrieved).toBeDefined()
    expect(retrieved?.name).toBe("Alice")
  })

  test("getNodesByType returns nodes of type", async () => {
    await graph.addCharacter("Alice", 1)
    await graph.addCharacter("Bob", 1)

    const characters = await graph.getNodesByType("character")
    expect(characters.length).toBe(2)
  })

  test("getActiveCharacters returns active characters", async () => {
    await graph.addCharacter("Alice", 1)
    const bob = await graph.addCharacter("Bob", 1)
    await graph.updateNodeStatus(bob.id, "inactive", 2)

    const active = await graph.getActiveCharacters()
    expect(active.length).toBe(1)
    expect(active[0].name).toBe("Alice")
  })

  test("getEdgesForNode returns edges", async () => {
    const char1 = await graph.addCharacter("Alice", 1)
    const char2 = await graph.addCharacter("Bob", 1)

    await graph.addEdge({
      source: char1.id,
      target: char2.id,
      type: "knows",
      strength: 70,
      chapter: 1,
    })

    const edges = await graph.getEdgesForNode(char1.id)
    expect(edges.length).toBeGreaterThan(0)
  })

  test("getNeighbors returns connected nodes", async () => {
    const char1 = await graph.addCharacter("Alice", 1)
    const char2 = await graph.addCharacter("Bob", 1)

    await graph.addEdge({
      source: char1.id,
      target: char2.id,
      type: "knows",
      strength: 70,
      chapter: 1,
    })

    const neighbors = await graph.getNeighbors(char1.id)
    expect(neighbors.nodes.length).toBeGreaterThan(0)
    expect(neighbors.edges.length).toBeGreaterThan(0)
  })

  test("queryCharactersAtLocation returns characters", async () => {
    const char1 = await graph.addCharacter("Alice", 1)
    const location = await graph.addLocation("Tavern", 1)

    await graph.connectCharacterToLocation(char1.id, location.id, 1)

    const characters = await graph.queryCharactersAtLocation(location.id)
    expect(characters.length).toBeGreaterThan(0)
  })

  test("queryCharacterRelationships returns relationships", async () => {
    const alice = await graph.addCharacter("Alice", 1)
    const bob = await graph.addCharacter("Bob", 1)

    await graph.connectCharacters(alice.id, bob.id, "allied_with", 80, 1)

    const relationships = await graph.queryCharacterRelationships(alice.id)
    expect(relationships.allies.length).toBeGreaterThan(0)
  })

  test("detectInconsistency finds issues", async () => {
    const node = await graph.addCharacter("Alice", 1)
    await graph.updateNodeStatus(node.id, "destroyed", 2)

    await graph.addEdge({
      source: node.id,
      target: node.id,
      type: "knows",
      strength: 50,
      chapter: 3,
    })

    const inconsistencies = await graph.detectInconsistency(node.id)
    expect(inconsistencies.length).toBeGreaterThan(0)
  })

  test("updateNodeStatus updates status", async () => {
    const node = await graph.addCharacter("Alice", 1)

    const updated = await graph.updateNodeStatus(node.id, "inactive", 2)
    expect(updated).toBe(true)

    const retrieved = await graph.getNode(node.id)
    expect(retrieved?.status).toBe("inactive")
  })

  test("strengthenEdge updates edge strength", async () => {
    const char1 = await graph.addCharacter("Alice", 1)
    const char2 = await graph.addCharacter("Bob", 1)

    const edge = await graph.addEdge({
      source: char1.id,
      target: char2.id,
      type: "knows",
      strength: 50,
      chapter: 1,
    })

    const strengthened = await graph.strengthenEdge(edge.id, 20)
    expect(strengthened).toBe(true)
  })

  test("getStats returns statistics", async () => {
    await graph.addCharacter("Alice", 1)
    await graph.addCharacter("Bob", 1)

    const stats = await graph.getStats()
    expect(stats.totalNodes).toBe(2)
  })

  test("exportToJson and importFromJson", async () => {
    await graph.addCharacter("Alice", 1)
    await graph.addCharacter("Bob", 1)

    const exported = await graph.exportToJson()
    expect(exported.nodes.length).toBe(2)

    await graph.clear()
    const imported = await graph.importFromJson(exported)
    expect(imported.nodes).toBe(2)
  })
})
