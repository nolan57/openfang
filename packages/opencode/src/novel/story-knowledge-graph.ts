import { z } from "zod"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { resolve, dirname } from "path"
import { mkdir } from "fs/promises"
import { getStoryGraphDbPath } from "./novel-config"

const log = Log.create({ service: "story-knowledge-graph" })

// Lazy-initialized database path
let GRAPH_DB_PATH: string | null = null

function getDbPath(): string {
  if (!GRAPH_DB_PATH) {
    GRAPH_DB_PATH = getStoryGraphDbPath()
  }
  return GRAPH_DB_PATH
}

export const NodeTypeSchema = z.enum(["character", "location", "item", "event", "faction", "concept", "theme"])

export const EdgeTypeSchema = z.enum([
  "knows",
  "located_at",
  "owns",
  "uses",
  "participated_in",
  "created",
  "destroyed",
  "related_to",
  "opposes",
  "allied_with",
  "memberOf",
  "leads",
  "visits",
  "influenced_by",
  "believes_in",
])

export const GraphNodeSchema = z.object({
  id: z.string(),
  type: NodeTypeSchema,
  name: z.string(),
  description: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  firstAppearance: z.number(),
  lastAppearance: z.number().optional(),
  status: z.enum(["active", "inactive", "destroyed", "unknown"]),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const GraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: EdgeTypeSchema,
  strength: z.number().min(0).max(100).default(50),
  description: z.string().optional(),
  chapter: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type NodeType = z.infer<typeof NodeTypeSchema>
export type EdgeType = z.infer<typeof EdgeTypeSchema>
export type GraphNode = z.infer<typeof GraphNodeSchema>
export type GraphEdge = z.infer<typeof GraphEdgeSchema>

export interface KnowledgeGraphConfig {
  autoInferEdges: boolean
  minEdgeStrength: number
  maxEdgesPerNode: number
}

const DEFAULT_CONFIG: KnowledgeGraphConfig = {
  autoInferEdges: true,
  minEdgeStrength: 10,
  maxEdgesPerNode: 100,
}

export class StoryKnowledgeGraph {
  private db: any = null
  private config: KnowledgeGraphConfig
  private initialized: boolean = false

  constructor(config: Partial<KnowledgeGraphConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    const dbPath = getDbPath()
    try {
      await mkdir(dirname(dbPath), { recursive: true })

      const { Database } = await import("bun:sqlite")
      this.db = new Database(dbPath)

      this.db.run(`
        CREATE TABLE IF NOT EXISTS nodes (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          properties TEXT,
          first_appearance INTEGER NOT NULL,
          last_appearance INTEGER,
          status TEXT NOT NULL DEFAULT 'active',
          metadata TEXT
        )
      `)

      this.db.run(`
        CREATE TABLE IF NOT EXISTS edges (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          target TEXT NOT NULL,
          type TEXT NOT NULL,
          strength REAL NOT NULL DEFAULT 50,
          description TEXT,
          chapter INTEGER NOT NULL,
          metadata TEXT,
          FOREIGN KEY (source) REFERENCES nodes(id),
          FOREIGN KEY (target) REFERENCES nodes(id)
        )
      `)

      this.db.run(`CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)`)
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name)`)
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source)`)
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target)`)
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type)`)

      this.initialized = true
      log.info("story_knowledge_graph_initialized", { path: dbPath })
    } catch (error) {
      log.error("story_knowledge_graph_init_failed", { error: String(error) })
      throw error
    }
  }

  async addNode(node: Omit<GraphNode, "id">): Promise<GraphNode> {
    if (!this.initialized) await this.initialize()

    const id = `node_${node.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    const stmt = this.db.prepare(`
      INSERT INTO nodes (id, type, name, description, properties, first_appearance, last_appearance, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      id,
      node.type,
      node.name,
      node.description || null,
      node.properties ? JSON.stringify(node.properties) : null,
      node.firstAppearance,
      node.lastAppearance || null,
      node.status,
      node.metadata ? JSON.stringify(node.metadata) : null,
    )

    if (this.config.autoInferEdges) {
      await this.inferEdges(id, node)
    }

    log.info("node_added", { id, type: node.type, name: node.name })
    return { ...node, id }
  }

  async addCharacter(name: string, chapter: number, properties?: Record<string, unknown>): Promise<GraphNode> {
    return this.addNode({
      type: "character",
      name,
      description: `Character: ${name}`,
      properties,
      firstAppearance: chapter,
      status: "active",
      metadata: { autoCreated: false },
    })
  }

  async addLocation(name: string, chapter: number, description?: string): Promise<GraphNode> {
    return this.addNode({
      type: "location",
      name,
      description: description || `Location: ${name}`,
      firstAppearance: chapter,
      status: "active",
    })
  }

  async addItem(name: string, chapter: number, description?: string): Promise<GraphNode> {
    return this.addNode({
      type: "item",
      name,
      description: description || `Item: ${name}`,
      firstAppearance: chapter,
      status: "active",
    })
  }

  async addEvent(name: string, chapter: number, description?: string): Promise<GraphNode> {
    return this.addNode({
      type: "event",
      name,
      description: description || `Event: ${name}`,
      firstAppearance: chapter,
      status: "active",
    })
  }

  async addEdge(edge: Omit<GraphEdge, "id">): Promise<GraphEdge> {
    if (!this.initialized) await this.initialize()

    const id = `edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    const stmt = this.db.prepare(`
      INSERT INTO edges (id, source, target, type, strength, description, chapter, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      id,
      edge.source,
      edge.target,
      edge.type,
      edge.strength,
      edge.description || null,
      edge.chapter,
      edge.metadata ? JSON.stringify(edge.metadata) : null,
    )

    log.info("edge_added", { id, source: edge.source, target: edge.target, type: edge.type })
    return { ...edge, id }
  }

  async connectCharacterToLocation(characterId: string, locationId: string, chapter: number): Promise<GraphEdge> {
    return this.addEdge({
      source: characterId,
      target: locationId,
      type: "located_at",
      strength: 80,
      chapter,
    })
  }

  async connectCharacterToFaction(
    characterId: string,
    factionId: string,
    role: string,
    chapter: number,
  ): Promise<GraphEdge> {
    return this.addEdge({
      source: characterId,
      target: factionId,
      type: "memberOf",
      strength: 70,
      description: role,
      chapter,
    })
  }

  async connectCharacters(
    charA: string,
    charB: string,
    relationship: EdgeType,
    strength: number,
    chapter: number,
  ): Promise<GraphEdge> {
    return this.addEdge({
      source: charA,
      target: charB,
      type: relationship,
      strength,
      chapter,
    })
  }

  async getNode(id: string): Promise<GraphNode | null> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`SELECT * FROM nodes WHERE id = ?`)
    const row = stmt.get(id) as any

    return row ? this.rowToNode(row) : null
  }

  async getNodesByType(type: NodeType): Promise<GraphNode[]> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`SELECT * FROM nodes WHERE type = ? ORDER BY name`)
    const rows = stmt.all(type) as any[]

    return rows.map((r) => this.rowToNode(r))
  }

  async getActiveCharacters(): Promise<GraphNode[]> {
    return this.getNodesByType("character").then((nodes) => nodes.filter((n) => n.status === "active"))
  }

  async getEdgesForNode(nodeId: string, type?: EdgeType): Promise<GraphEdge[]> {
    if (!this.initialized) await this.initialize()

    const sql = type
      ? `SELECT * FROM edges WHERE (source = ? OR target = ?) AND type = ? ORDER BY strength DESC`
      : `SELECT * FROM edges WHERE (source = ? OR target = ?) ORDER BY strength DESC`

    const stmt = this.db.prepare(sql)
    const rows = type ? stmt.all(nodeId, nodeId, type) : stmt.all(nodeId, nodeId)

    return rows.map((r: any) => this.rowToEdge(r))
  }

  async getNeighbors(
    nodeId: string,
    maxDepth: number = 1,
  ): Promise<{
    nodes: GraphNode[]
    edges: GraphEdge[]
  }> {
    if (!this.initialized) await this.initialize()

    const edges = await this.getEdgesForNode(nodeId)
    const neighborIds = new Set<string>()

    for (const edge of edges) {
      neighborIds.add(edge.source === nodeId ? edge.target : edge.source)
    }

    const nodes: GraphNode[] = []
    for (const id of neighborIds) {
      const node = await this.getNode(id)
      if (node) nodes.push(node)
    }

    return { nodes, edges }
  }

  async queryCharactersAtLocation(locationId: string, chapter?: number): Promise<GraphNode[]> {
    if (!this.initialized) await this.initialize()

    const sql = chapter
      ? `SELECT n.* FROM nodes n JOIN edges e ON n.id = e.source 
         WHERE e.target = ? AND e.type = 'located_at' AND e.chapter <= ?
         AND n.status = 'active'`
      : `SELECT n.* FROM nodes n JOIN edges e ON n.id = e.source 
         WHERE e.target = ? AND e.type = 'located_at' AND n.status = 'active'`

    const stmt = this.db.prepare(sql)
    const rows = chapter ? stmt.all(locationId, chapter) : stmt.all(locationId)

    return rows.map((r: any) => this.rowToNode(r))
  }

  async queryCharacterRelationships(characterId: string): Promise<{
    allies: GraphNode[]
    opponents: GraphNode[]
    members: GraphNode[]
  }> {
    const edges = await this.getEdgesForNode(characterId)

    const allies: GraphNode[] = []
    const opponents: GraphNode[] = []
    const members: GraphNode[] = []

    for (const edge of edges) {
      const otherId = edge.source === characterId ? edge.target : edge.source
      const other = await this.getNode(otherId)
      if (!other) continue

      if (edge.type === "allied_with" || edge.type === "knows") {
        allies.push(other)
      } else if (edge.type === "opposes") {
        opponents.push(other)
      } else if (edge.type === "memberOf") {
        members.push(other)
      }
    }

    return { allies, opponents, members }
  }

  async detectInconsistency(characterId: string): Promise<
    Array<{
      type: string
      description: string
      severity: "low" | "medium" | "high"
    }>
  > {
    const warnings: Array<{ type: string; description: string; severity: "low" | "medium" | "high" }> = []

    const node = await this.getNode(characterId)
    if (!node) return warnings

    if (node.type !== "character") {
      warnings.push({
        type: "wrong_type",
        description: `Node ${characterId} is not a character`,
        severity: "high",
      })
      return warnings
    }

    if (node.status === "destroyed" || node.status === "inactive") {
      const recentEdges = await this.getEdgesForNode(characterId)
      const activeEdges = recentEdges.filter((e) => e.chapter > (node.lastAppearance || 0))

      if (activeEdges.length > 0) {
        warnings.push({
          type: "dead_character_active",
          description: `Character ${node.name} is ${node.status} but has ${activeEdges.length} recent interactions`,
          severity: "high",
        })
      }
    }

    return warnings
  }

  async updateNodeStatus(id: string, status: GraphNode["status"], chapter: number): Promise<boolean> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`
      UPDATE nodes SET status = ?, last_appearance = ? WHERE id = ?
    `)
    const result = stmt.run(status, chapter, id)

    return result.changes > 0
  }

  async strengthenEdge(edgeId: string, delta: number): Promise<boolean> {
    if (!this.initialized) await this.initialize()

    const getStmt = this.db.prepare(`SELECT strength FROM edges WHERE id = ?`)
    const current = (getStmt.get(edgeId) as any)?.strength || 50

    const newStrength = Math.min(100, Math.max(0, current + delta))

    const stmt = this.db.prepare(`UPDATE edges SET strength = ? WHERE id = ?`)
    const result = stmt.run(newStrength, edgeId)

    return result.changes > 0
  }

  async getStats(): Promise<{
    totalNodes: number
    totalEdges: number
    byType: Record<NodeType, number>
    avgEdgeStrength: number
  }> {
    if (!this.initialized) await this.initialize()

    const nodeStmt = this.db.prepare(`SELECT COUNT(*) as count FROM nodes`)
    const totalNodes = (nodeStmt.get() as any).count

    const edgeStmt = this.db.prepare(`SELECT COUNT(*) as count FROM edges`)
    const totalEdges = (edgeStmt.get() as any).count

    const typeStmt = this.db.prepare(`
      SELECT type, COUNT(*) as count FROM nodes GROUP BY type
    `)
    const typeRows = typeStmt.all() as Array<{ type: string; count: number }>

    const byType: any = {}
    for (const row of typeRows) {
      byType[row.type] = row.count
    }

    const avgStmt = this.db.prepare(`SELECT AVG(strength) as avg FROM edges`)
    const avgEdgeStrength = (avgStmt.get() as any).avg || 0

    return {
      totalNodes,
      totalEdges,
      byType: byType as Record<NodeType, number>,
      avgEdgeStrength,
    }
  }

  async exportToJson(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    if (!this.initialized) await this.initialize()

    const nodeStmt = this.db.prepare(`SELECT * FROM nodes`)
    const edgeStmt = this.db.prepare(`SELECT * FROM edges`)

    const nodes = (nodeStmt.all() as any[]).map((r) => this.rowToNode(r))
    const edges = (edgeStmt.all() as any[]).map((r) => this.rowToEdge(r))

    return { nodes, edges }
  }

  async importFromJson(data: { nodes: GraphNode[]; edges: GraphEdge[] }): Promise<{
    nodes: number
    edges: number
  }> {
    if (!this.initialized) await this.initialize()

    let nodesImported = 0
    let edgesImported = 0

    for (const node of data.nodes) {
      try {
        await this.addNode(node)
        nodesImported++
      } catch (error) {
        log.warn("node_import_failed", { id: node.id, error: String(error) })
      }
    }

    for (const edge of data.edges) {
      try {
        await this.addEdge(edge)
        edgesImported++
      } catch (error) {
        log.warn("edge_import_failed", { id: edge.id, error: String(error) })
      }
    }

    log.info("graph_imported", { nodes: nodesImported, edges: edgesImported })
    return { nodes: nodesImported, edges: edgesImported }
  }

  private async inferEdges(nodeId: string, node: Omit<GraphNode, "id">): Promise<void> {
    if (!this.config.autoInferEdges) return

    if (node.type === "character" && node.properties) {
      const factions = node.properties.factions as string[] | undefined
      if (factions) {
        for (const factionName of factions) {
          const factionNode = await this.findNodeByName("faction", factionName)
          if (factionNode) {
            await this.connectCharacterToFaction(nodeId, factionNode.id, "member", node.firstAppearance)
          }
        }
      }
    }
  }

  private async findNodeByName(type: NodeType, name: string): Promise<GraphNode | null> {
    if (!this.initialized) await this.initialize()

    const stmt = this.db.prepare(`SELECT * FROM nodes WHERE type = ? AND name = ?`)
    const row = stmt.get(type, name) as any

    return row ? this.rowToNode(row) : null
  }

  private rowToNode(row: any): GraphNode {
    return {
      id: row.id,
      type: row.type as NodeType,
      name: row.name,
      description: row.description,
      properties: row.properties ? JSON.parse(row.properties) : {},
      firstAppearance: row.first_appearance,
      lastAppearance: row.last_appearance,
      status: row.status as GraphNode["status"],
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    }
  }

  private rowToEdge(row: any): GraphEdge {
    return {
      id: row.id,
      source: row.source,
      target: row.target,
      type: row.type as EdgeType,
      strength: row.strength,
      description: row.description,
      chapter: row.chapter,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    }
  }

  async clear(): Promise<void> {
    if (!this.initialized) await this.initialize()

    const edgeStmt = this.db.prepare(`DELETE FROM edges`)
    const nodeStmt = this.db.prepare(`DELETE FROM nodes`)

    edgeStmt.run()
    nodeStmt.run()

    log.info("story_knowledge_graph_cleared")
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      this.initialized = false
      log.info("story_knowledge_graph_closed")
    }
  }
}

export const storyKnowledgeGraph = new StoryKnowledgeGraph()
