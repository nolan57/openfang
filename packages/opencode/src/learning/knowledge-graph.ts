import { Database } from "../storage/db"
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { eq, and, sql } from "drizzle-orm"
import { Log } from "../util/log"

const log = Log.create({ service: "knowledge-graph" })

export const knowledge_nodes = sqliteTable("knowledge_node", {
  id: text().primaryKey(),
  type: text().notNull(), // "file" | "skill" | "memory" | "constraint" | "agenda"
  entity_type: text().notNull(), // 具体实体类型
  entity_id: text().notNull(),
  title: text().notNull(),
  content: text(),
  embedding: text(), // JSON vector for semantic search
  metadata: text(), // JSON additional data
  time_created: integer().notNull(),
  time_updated: integer().notNull(),
})

export const knowledge_edges = sqliteTable("knowledge_edge", {
  id: text().primaryKey(),
  source_id: text().notNull(),
  target_id: text().notNull(),
  relation: text().notNull(), // "depends_on" | "related_to" | "conflicts_with" | "derives_from"
  weight: integer().default(1),
  time_created: integer().notNull(),
})

export type NodeType = "file" | "skill" | "memory" | "constraint" | "agenda"
export type RelationType =
  | "depends_on"
  | "related_to"
  | "conflicts_with"
  | "derives_from"
  | "implements"
  | "may_affect"
  | "supersedes"

export interface KnowledgeNode {
  id: string
  type: NodeType
  entity_type: string
  entity_id: string
  title: string
  content?: string
  embedding?: number[]
  metadata?: Record<string, unknown>
}

export interface KnowledgeEdge {
  id: string
  source_id: string
  target_id: string
  relation: RelationType
  weight: number
}

export class KnowledgeGraph {
  async addNode(node: Omit<KnowledgeNode, "id" | "time_created" | "time_updated">): Promise<string> {
    const id = crypto.randomUUID()
    const now = Date.now()

    Database.use((db) =>
      db.insert(knowledge_nodes).values({
        id,
        type: node.type,
        entity_type: node.entity_type,
        entity_id: node.entity_id,
        title: node.title,
        content: node.content ?? "",
        embedding: node.embedding ? JSON.stringify(node.embedding) : null,
        metadata: node.metadata ? JSON.stringify(node.metadata) : null,
        time_created: now,
        time_updated: now,
      }),
    )

    log.info("node_added", { id, type: node.type, title: node.title })
    return id
  }

  async addEdge(edge: Omit<KnowledgeEdge, "id" | "time_created">): Promise<string> {
    const id = crypto.randomUUID()

    Database.use((db) =>
      db.insert(knowledge_edges).values({
        id,
        source_id: edge.source_id,
        target_id: edge.target_id,
        relation: edge.relation,
        weight: edge.weight,
        time_created: Date.now(),
      }),
    )

    log.info("edge_added", { id, relation: edge.relation })
    return id
  }

  async getNode(id: string): Promise<KnowledgeNode | null> {
    const result = Database.use((db) => db.select().from(knowledge_nodes).where(eq(knowledge_nodes.id, id)).get())

    if (!result) return null

    return {
      id: result.id,
      type: result.type as NodeType,
      entity_type: result.entity_type,
      entity_id: result.entity_id,
      title: result.title,
      content: result.content ?? undefined,
      embedding: result.embedding ? JSON.parse(result.embedding) : undefined,
      metadata: result.metadata ? JSON.parse(result.metadata) : undefined,
    }
  }

  async getRelatedNodes(nodeId: string, relation?: RelationType): Promise<KnowledgeNode[]> {
    const query = Database.use((db) => {
      if (relation) {
        return db
          .select()
          .from(knowledge_nodes)
          .innerJoin(knowledge_edges, eq(knowledge_nodes.id, knowledge_edges.target_id))
          .where(and(eq(knowledge_edges.source_id, nodeId), eq(knowledge_edges.relation, relation)))
          .all()
      }
      return db
        .select()
        .from(knowledge_nodes)
        .innerJoin(knowledge_edges, eq(knowledge_nodes.id, knowledge_edges.target_id))
        .where(eq(knowledge_edges.source_id, nodeId))
        .all()
    })

    return query.map((row) => ({
      id: row.knowledge_node.id,
      type: row.knowledge_node.type as NodeType,
      entity_type: row.knowledge_node.entity_type,
      entity_id: row.knowledge_node.entity_id,
      title: row.knowledge_node.title,
      content: row.knowledge_node.content ?? undefined,
      embedding: row.knowledge_node.embedding ? JSON.parse(row.knowledge_node.embedding) : undefined,
      metadata: row.knowledge_node.metadata ? JSON.parse(row.knowledge_node.metadata) : undefined,
    }))
  }

  async findNodesByType(type: NodeType): Promise<KnowledgeNode[]> {
    const results = Database.use((db) => db.select().from(knowledge_nodes).where(eq(knowledge_nodes.type, type)).all())

    return results.map((r) => ({
      id: r.id,
      type: r.type as NodeType,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      title: r.title,
      content: r.content ?? undefined,
      embedding: r.embedding ? JSON.parse(r.embedding) : undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }))
  }

  async updateNode(id: string, updates: Partial<KnowledgeNode>): Promise<void> {
    const updateData: Record<string, unknown> = {
      time_updated: Date.now(),
    }

    if (updates.title) updateData.title = updates.title
    if (updates.content) updateData.content = updates.content
    if (updates.embedding) updateData.embedding = JSON.stringify(updates.embedding)
    if (updates.metadata) updateData.metadata = JSON.stringify(updates.metadata)

    Database.use((db) => db.update(knowledge_nodes).set(updateData).where(eq(knowledge_nodes.id, id)))

    log.info("node_updated", { id })
  }

  async deleteNode(id: string): Promise<void> {
    Database.use((db) => {
      db.delete(knowledge_edges).where(eq(knowledge_edges.source_id, id))
      db.delete(knowledge_edges).where(eq(knowledge_edges.target_id, id))
      db.delete(knowledge_nodes).where(eq(knowledge_nodes.id, id))
    })

    log.info("node_deleted", { id })
  }

  async searchByContent(keyword: string, limit = 10): Promise<KnowledgeNode[]> {
    const results = Database.use((db) =>
      db
        .select()
        .from(knowledge_nodes)
        .where(
          sql`${knowledge_nodes.title} LIKE ${`%${keyword}%`} OR ${knowledge_nodes.content} LIKE ${`%${keyword}%`}`,
        )
        .limit(limit)
        .all(),
    )

    return results.map((r) => ({
      id: r.id,
      type: r.type as NodeType,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      title: r.title,
      content: r.content ?? undefined,
      embedding: r.embedding ? JSON.parse(r.embedding) : undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }))
  }

  async getStats(): Promise<{ nodes: number; edges: number; byType: Record<string, number> }> {
    const nodes = Database.use((db) => db.select().from(knowledge_nodes).all())
    const edges = Database.use((db) => db.select().from(knowledge_edges).all())

    const byType: Record<string, number> = {}
    for (const node of nodes) {
      byType[node.type] = (byType[node.type] || 0) + 1
    }

    return {
      nodes: nodes.length,
      edges: edges.length,
      byType,
    }
  }
}
