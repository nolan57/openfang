import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { KnowledgeGraph } from "../../src/learning/knowledge-graph"
import { Database } from "../../src/storage/db"

describe("KnowledgeGraph", () => {
  let kg: KnowledgeGraph
  const sqlite = Database.raw()

  beforeEach(async () => {
    kg = new KnowledgeGraph()
    sqlite.run("DELETE FROM knowledge_node")
    sqlite.run("DELETE FROM knowledge_edge")
  })

  afterEach(() => {
    sqlite.run("DELETE FROM knowledge_node")
    sqlite.run("DELETE FROM knowledge_edge")
  })

  describe("addNode", () => {
    test("returns valid UUID", async () => {
      const id = await kg.addNode({
        type: "file",
        entity_type: "code_file",
        entity_id: "src/test.ts",
        title: "Test File",
        content: "test content",
      })

      expect(id).toBeDefined()
      expect(typeof id).toBe("string")
      expect(id).toMatch(/^[a-f0-9-]{36}$/)
    })

    test("persists node to database", async () => {
      const id = await kg.addNode({
        type: "file",
        entity_type: "code_file",
        entity_id: "src/test.ts",
        title: "Test File",
        content: "test content",
      })

      const node = sqlite.prepare("SELECT * FROM knowledge_node WHERE id = ?").get(id) as any
      expect(node).toBeDefined()
      expect(node.title).toBe("Test File")
      expect(node.entity_id).toBe("src/test.ts")
      expect(node.type).toBe("file")
    })

    test("sets timestamps", async () => {
      const before = Date.now()
      const id = await kg.addNode({
        type: "file",
        entity_type: "code_file",
        entity_id: "src/test.ts",
        title: "Test",
        content: "",
      })
      const after = Date.now()

      const node = sqlite.prepare("SELECT * FROM knowledge_node WHERE id = ?").get(id) as any
      expect(node.time_created).toBeGreaterThanOrEqual(before)
      expect(node.time_created).toBeLessThanOrEqual(after)
      expect(node.time_updated).toBe(node.time_created)
    })

    test("stores optional fields", async () => {
      const id = await kg.addNode({
        type: "code_entity",
        entity_type: "function",
        entity_id: "src/test.ts#myFunc",
        title: "myFunc",
        content: "function documentation",
        embedding: [0.1, 0.2, 0.3],
        metadata: { line: 10, exported: true },
        memory_type: "project",
      })

      const node = sqlite.prepare("SELECT * FROM knowledge_node WHERE id = ?").get(id) as any
      expect(node.embedding).toBe(JSON.stringify([0.1, 0.2, 0.3]))
      expect(node.metadata).toBe(JSON.stringify({ line: 10, exported: true }))
      expect(node.memory_type).toBe("project")
    })
  })

  describe("addEdge", () => {
    test("creates edge between nodes", async () => {
      const id1 = await kg.addNode({
        type: "file",
        entity_type: "code_file",
        entity_id: "file1.ts",
        title: "File 1",
        content: "",
      })
      const id2 = await kg.addNode({
        type: "file",
        entity_type: "code_file",
        entity_id: "file2.ts",
        title: "File 2",
        content: "",
      })

      const edgeId = await kg.addEdge({
        source_id: id1,
        target_id: id2,
        relation: "imports",
        weight: 1,
      })

      expect(edgeId).toBeDefined()
      expect(typeof edgeId).toBe("string")
    })

    test("persists edge to database", async () => {
      const id1 = await kg.addNode({ type: "file", entity_type: "file", entity_id: "f1", title: "F1", content: "" })
      const id2 = await kg.addNode({ type: "file", entity_type: "file", entity_id: "f2", title: "F2", content: "" })

      await kg.addEdge({
        source_id: id1,
        target_id: id2,
        relation: "calls",
        weight: 2,
      })

      const edge = sqlite
        .prepare("SELECT * FROM knowledge_edge WHERE source_id = ? AND target_id = ?")
        .get(id1, id2) as any
      expect(edge).toBeDefined()
      expect(edge.relation).toBe("calls")
      expect(edge.weight).toBe(2)
    })
  })

  describe("getStats", () => {
    test("returns zero for empty graph", async () => {
      const stats = await kg.getStats()
      expect(stats.nodes).toBe(0)
      expect(stats.edges).toBe(0)
    })

    test("counts nodes correctly", async () => {
      await kg.addNode({ type: "file", entity_type: "file", entity_id: "f1", title: "F1", content: "" })
      await kg.addNode({ type: "file", entity_type: "file", entity_id: "f2", title: "F2", content: "" })
      await kg.addNode({
        type: "code_entity",
        entity_type: "function",
        entity_id: "f1#func",
        title: "func",
        content: "",
      })

      const stats = await kg.getStats()
      expect(stats.nodes).toBe(3)
    })

    test("counts edges correctly", async () => {
      const id1 = await kg.addNode({ type: "file", entity_type: "file", entity_id: "f1", title: "F1", content: "" })
      const id2 = await kg.addNode({ type: "file", entity_type: "file", entity_id: "f2", title: "F2", content: "" })
      const id3 = await kg.addNode({ type: "file", entity_type: "file", entity_id: "f3", title: "F3", content: "" })

      await kg.addEdge({ source_id: id1, target_id: id2, relation: "imports", weight: 1 })
      await kg.addEdge({ source_id: id2, target_id: id3, relation: "calls", weight: 1 })

      const stats = await kg.getStats()
      expect(stats.edges).toBe(2)
    })

    test("groups by type", async () => {
      await kg.addNode({ type: "file", entity_type: "file", entity_id: "f1", title: "F1", content: "" })
      await kg.addNode({ type: "file", entity_type: "file", entity_id: "f2", title: "F2", content: "" })
      await kg.addNode({
        type: "code_entity",
        entity_type: "function",
        entity_id: "f1#func",
        title: "func",
        content: "",
      })

      const stats = await kg.getStats()
      expect(stats.byType["file"]).toBe(2)
      expect(stats.byType["code_entity"]).toBe(1)
    })
  })

  describe("getRelatedNodes", () => {
    test("finds related nodes", async () => {
      const id1 = await kg.addNode({ type: "file", entity_type: "file", entity_id: "f1", title: "F1", content: "" })
      const id2 = await kg.addNode({ type: "file", entity_type: "file", entity_id: "f2", title: "F2", content: "" })
      const id3 = await kg.addNode({ type: "file", entity_type: "file", entity_id: "f3", title: "F3", content: "" })

      await kg.addEdge({ source_id: id1, target_id: id2, relation: "imports", weight: 1 })
      await kg.addEdge({ source_id: id1, target_id: id3, relation: "calls", weight: 1 })

      const related = await kg.getRelatedNodes(id1)
      expect(related.length).toBe(2)
    })
  })
})
