import { z } from "zod"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { resolve, dirname } from "path"
import { mkdir } from "fs/promises"
import { getStoryGraphDbPath } from "./novel-config"
import type { MemoryEntry } from "./story-world-memory"

const log = Log.create({ service: "story-knowledge-graph" })

// Lazy-initialized database path
let GRAPH_DB_PATH: string | null = null

function getDbPath(): string {
  if (!GRAPH_DB_PATH) {
    GRAPH_DB_PATH = getStoryGraphDbPath()
  }
  return GRAPH_DB_PATH
}

export const NodeTypeSchema = z.enum(["character", "location", "item", "event", "faction", "concept", "theme", "group"])

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
  "kills",
  "hasRole",
  "hasRelationship",
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
  /** Edge change counter per chapter — for event-driven relationship instability detection */
  private edgeChangeCountByChapter: Map<number, number> = new Map()

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

    // Record high-impact world events
    if (edge.type === "kills" || edge.type === "destroyed") {
      log.info("high_impact_world_event", {
        type: edge.type,
        source: edge.source,
        target: edge.target,
        chapter: edge.chapter,
      })
    }

    // Increment edge change counter for event-driven instability detection
    const currentCount = this.edgeChangeCountByChapter.get(edge.chapter) || 0
    this.edgeChangeCountByChapter.set(edge.chapter, currentCount + 1)

    log.info("edge_added", { id, source: edge.source, target: edge.target, type: edge.type })
    return { ...edge, id }
  }

  /**
   * Get the number of edge changes for a given chapter.
   * Used for event-driven relationship instability detection.
   */
  async getEdgeCountForChapter(chapter: number): Promise<number> {
    return this.edgeChangeCountByChapter.get(chapter) || 0
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

  async addGroup(
    name: string,
    chapter: number,
    metadata?: Record<string, unknown>,
  ): Promise<GraphNode> {
    return this.addNode({
      type: "group",
      name,
      description: `Group: ${name}`,
      firstAppearance: chapter,
      status: "active",
      metadata: metadata || {},
    })
  }

  async addMemberToGroup(groupId: string, characterId: string, role: string, chapter: number): Promise<GraphEdge> {
    return this.addEdge({
      source: characterId,
      target: groupId,
      type: "memberOf",
      strength: 70,
      description: role,
      chapter,
    })
  }

  async getGroupMembers(groupId: string): Promise<GraphNode[]> {
    const edges = await this.getEdgesForNode(groupId, "memberOf")
    const members: GraphNode[] = []
    for (const edge of edges) {
      const memberNode = await this.getNode(edge.source)
      if (memberNode) members.push(memberNode)
    }
    return members
  }

  async getGroupsForCharacter(characterId: string): Promise<GraphNode[]> {
    const edges = await this.getEdgesForNode(characterId, "memberOf")
    const groups: GraphNode[] = []
    for (const edge of edges) {
      const groupNode = await this.getNode(edge.target)
      if (groupNode) groups.push(groupNode)
    }
    return groups
  }

  async getAllGroups(): Promise<GraphNode[]> {
    return this.getNodesByType("group").then((nodes) => nodes.filter((n) => n.status === "active"))
  }

  /**
   * Get relationship edges between specific characters.
   * Used by RelationshipViewService for tension/dynamics calculation.
   */
  async getRelationshipsForCharacters(characterIds: string[]): Promise<GraphEdge[]> {
    const allEdges: GraphEdge[] = []
    const socialEdges = await this.getEdgesForNode(characterIds[0] || "", "knows")
    // We query by checking edges that connect character nodes
    // For efficiency, we return all edges and filter client-side
    for (let i = 0; i < characterIds.length; i++) {
      for (let j = i + 1; j < characterIds.length; j++) {
        const nodeA = await this.findNodeByName("character", characterIds[i])
        const nodeB = await this.findNodeByName("character", characterIds[j])
        if (nodeA && nodeB) {
          const edgesA = await this.getEdgesForNode(nodeA.id)
          for (const edge of edgesA) {
            if (edge.target === nodeB.id || edge.source === nodeB.id) {
              allEdges.push(edge)
            }
          }
        }
      }
    }
    return allEdges
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

  /**
   * Check if a character was active at a specific chapter
   * Returns true if character was alive/active at end of target chapter
   */
  async wasCharacterActiveAtChapter(characterId: string, targetChapter: number): Promise<boolean> {
    if (!this.initialized) await this.initialize()

    const node = await this.getNode(characterId)
    if (!node || node.type !== "character") return false

    // Character was never active after target chapter
    if (node.lastAppearance && node.lastAppearance < targetChapter) {
      return false
    }

    // Check if character was killed/deactivated before or at target chapter
    const killEdges = await this.getEdgesForNode(characterId, "kills")
    for (const edge of killEdges) {
      if (edge.target === characterId && edge.chapter <= targetChapter) {
        return false
      }
      if (edge.source === characterId && edge.chapter <= targetChapter && edge.type === "kills") {
        // Character committed killing but might still be alive
        break
      }
    }

    // Check for destroyed/inactive status set before target chapter
    const destroyEdges = await this.getEdgesForNode(characterId, "destroyed")
    for (const edge of destroyEdges) {
      if (edge.target === characterId && edge.chapter <= targetChapter) {
        return false
      }
    }

    // If status was explicitly set to inactive/dead before target chapter
    if (
      (node.status === "inactive" || node.status === "destroyed") &&
      node.lastAppearance &&
      node.lastAppearance <= targetChapter
    ) {
      return false
    }

    return true
  }

  /**
   * Get the status of a location at a specific chapter
   */
  async getLocationStatusAtChapter(
    locationId: string,
    targetChapter: number,
  ): Promise<"active" | "destroyed" | "unknown"> {
    if (!this.initialized) await this.initialize()

    const node = await this.getNode(locationId)
    if (!node || node.type !== "location") return "unknown"

    // Check if location was destroyed before or at target chapter
    const destroyEdges = await this.getEdgesForNode(locationId, "destroyed")
    for (const edge of destroyEdges) {
      if (edge.target === locationId && edge.chapter <= targetChapter) {
        return "destroyed"
      }
    }

    // Check node status
    if (node.status === "destroyed" && node.lastAppearance && node.lastAppearance <= targetChapter) {
      return "destroyed"
    }

    return "active"
  }

  /**
   * Ingest knowledge from a memory entry
   * Extracts entities and relationships from memory content
   *
   * Enhanced integration with motif-tracker:
   * - Automatically creates nodes for motifs mentioned in memory
   * - Links motifs to characters and locations
   */
  async ingestFromMemoryEntry(memory: MemoryEntry): Promise<void> {
    if (!this.initialized) await this.initialize()

    try {
      // Extract characters as nodes
      for (const charName of memory.characters) {
        const existingChar = await this.findNodeByName("character", charName)
        if (!existingChar) {
          await this.addCharacter(charName, memory.chapter, {
            firstMemoryId: memory.id,
            significance: memory.significance,
          })
        } else {
          // Update last appearance
          await this.updateNodeStatus(existingChar.id, existingChar.status, memory.chapter)
        }
      }

      // Extract locations as nodes
      for (const locName of memory.locations) {
        const existingLoc = await this.findNodeByName("location", locName)
        if (!existingLoc) {
          await this.addLocation(locName, memory.chapter)
        }
      }

      // Extract events as nodes
      for (const eventName of memory.events) {
        const existingEvent = await this.findNodeByName("event", eventName)
        if (!existingEvent) {
          await this.addEvent(eventName, memory.chapter)
        }
      }

      // NEW: Extract and link motifs (integration with motif-tracker)
      for (const theme of memory.themes) {
        // Check if theme is a known motif
        const motifNode = await this.findNodeByName("concept", `motif_${theme}`)
        if (!motifNode) {
          await this.addNode({
            type: "concept",
            name: `motif_${theme}`,
            description: `Thematic motif: ${theme}`,
            firstAppearance: memory.chapter,
            status: "active",
            metadata: {
              isMotif: true,
              theme,
              significance: memory.significance,
            },
          })
        }

        // Link motif to characters involved
        for (const charName of memory.characters) {
          const charNode = await this.findNodeByName("character", charName)
          if (charNode) {
            await this.addEdge({
              source: charNode.id,
              target: (await this.findNodeByName("concept", `motif_${theme}`))!.id,
              type: "influenced_by",
              strength: memory.significance * 10,
              chapter: memory.chapter,
              metadata: {
                memoryId: memory.id,
                context: "thematic_association",
              },
            })
          }
        }
      }

      // Create character-location edges for this chapter
      const charNodes = await Promise.all(memory.characters.map((c) => this.findNodeByName("character", c)))
      const locNodes = await Promise.all(memory.locations.map((l) => this.findNodeByName("location", l)))

      for (const charNode of charNodes) {
        if (!charNode) continue
        for (const locNode of locNodes) {
          if (!locNode) continue
          // Check if edge already exists for this chapter
          const existingEdges = await this.getEdgesForNode(charNode.id)
          const hasEdge = existingEdges.some(
            (e) => e.target === locNode.id && e.type === "located_at" && e.chapter === memory.chapter,
          )
          if (!hasEdge) {
            await this.connectCharacterToLocation(charNode.id, locNode.id, memory.chapter)
          }
        }
      }

      log.info("memory_ingested", { memoryId: memory.id, chapter: memory.chapter, level: memory.level })
    } catch (error) {
      log.warn("memory_ingestion_failed", { memoryId: memory.id, error: String(error) })
    }
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

  async findNodeByName(type: NodeType, name: string): Promise<GraphNode | null> {
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
