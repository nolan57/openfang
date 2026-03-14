import { Database } from "../storage/db"
import { eq, and, sql } from "drizzle-orm"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import { knowledge_nodes, knowledge_edges, vector_memory, archive_snapshot } from "./learning.sql"

// Re-export table definitions for backward compatibility
export { knowledge_nodes, knowledge_edges, vector_memory, archive_snapshot }

// 删除节点时的依赖错误
export const DependencyError = NamedError.create(
  "DependencyError",
  z.object({
    nodeId: z.string(),
    dependencies: z.array(
      z.object({
        sourceId: z.string(),
        sourceTitle: z.string(),
        relation: z.string(),
      }),
    ),
  }),
)

const log = Log.create({ service: "knowledge-graph" })

export type NodeType = "file" | "skill" | "memory" | "constraint" | "agenda" | "code_entity"
export type RelationType =
  | "depends_on"
  | "related_to"
  | "conflicts_with"
  | "derives_from"
  | "implements"
  | "may_affect"
  | "supersedes"
  | "imports"
  | "calls"
  | "evolves_to" // [ENH] Target 2: session -> evolution
  | "references" // [ENH] Target 2: cross-type reference
  | "contains" // [ENH] Target 2: containment relation

// [ENH] Target 2: Memory type for cross-type linking
export type MemoryType = "session" | "evolution" | "project" | "media"

export interface KnowledgeNode {
  id: string
  type: NodeType
  entity_type: string
  entity_id: string
  title: string
  content?: string
  embedding?: number[]
  metadata?: Record<string, unknown>
  // [ENH] Target 2: Memory type for unified graph
  memory_type?: MemoryType
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
      db
        .insert(knowledge_nodes)
        .values({
          id,
          type: node.type,
          entity_type: node.entity_type,
          entity_id: node.entity_id,
          title: node.title,
          content: node.content ?? "",
          embedding: node.embedding ? JSON.stringify(node.embedding) : null,
          metadata: node.metadata ? JSON.stringify(node.metadata) : null,
          // [ENH] Target 2: Store memory type for cross-type linking
          memory_type: node.memory_type ?? null,
          time_created: now,
          time_updated: now,
        })
        .run(),
    )

    log.info("node_added", { id, type: node.type, title: node.title, memory_type: node.memory_type })
    return id
  }

  async addEdge(edge: Omit<KnowledgeEdge, "id" | "time_created">): Promise<string> {
    const id = crypto.randomUUID()

    Database.use((db) =>
      db
        .insert(knowledge_edges)
        .values({
          id,
          source_id: edge.source_id,
          target_id: edge.target_id,
          relation: edge.relation,
          weight: edge.weight,
          time_created: Date.now(),
        })
        .run(),
    )

    log.info("edge_added", { id, relation: edge.relation })
    return id
  }

  // [ENH] Target 2: Link memories across types
  /**
   * Create a relation between two memories, potentially across different memory types
   * @param sourceId - Source node ID
   * @param targetId - Target node ID
   * @param relation - Relation type (e.g., "evolves_to", "references")
   * @param weight - Relation weight (default: 1)
   */
  async linkMemories(sourceId: string, targetId: string, relation: RelationType, weight: number = 1): Promise<string> {
    // Verify both nodes exist
    const source = await this.getNode(sourceId)
    const target = await this.getNode(targetId)

    if (!source) {
      throw new Error(`Source node not found: ${sourceId}`)
    }
    if (!target) {
      throw new Error(`Target node not found: ${targetId}`)
    }

    const edgeId = await this.addEdge({
      source_id: sourceId,
      target_id: targetId,
      relation,
      weight,
    })

    log.info("memories_linked", {
      sourceId,
      targetId,
      sourceType: source.memory_type,
      targetType: target.memory_type,
      relation,
    })

    return edgeId
  }

  // [ENH] Target 2: Get linked memories across types
  /**
   * Get all memories linked to a node, optionally filtered by memory type
   */
  async getLinkedMemories(
    nodeId: string,
    options?: {
      relation?: RelationType
      memoryType?: MemoryType
      direction?: "outgoing" | "incoming" | "both"
    },
  ): Promise<KnowledgeNode[]> {
    const direction = options?.direction ?? "outgoing"
    const results: KnowledgeNode[] = []

    if (direction === "outgoing" || direction === "both") {
      const outgoing = await this.getRelatedNodes(nodeId, options?.relation)
      results.push(...outgoing)
    }

    if (direction === "incoming" || direction === "both") {
      const incoming = Database.use((db) => {
        if (options?.relation) {
          return db
            .select()
            .from(knowledge_nodes)
            .innerJoin(knowledge_edges, eq(knowledge_nodes.id, knowledge_edges.source_id))
            .where(and(eq(knowledge_edges.target_id, nodeId), eq(knowledge_edges.relation, options.relation)))
            .all()
        }
        return db
          .select()
          .from(knowledge_nodes)
          .innerJoin(knowledge_edges, eq(knowledge_nodes.id, knowledge_edges.source_id))
          .where(eq(knowledge_edges.target_id, nodeId))
          .all()
      })

      results.push(
        ...incoming.map((row: { knowledge_node: typeof knowledge_nodes.$inferSelect }) => ({
          id: row.knowledge_node.id,
          type: row.knowledge_node.type as NodeType,
          entity_type: row.knowledge_node.entity_type,
          entity_id: row.knowledge_node.entity_id,
          title: row.knowledge_node.title,
          content: row.knowledge_node.content ?? undefined,
          embedding: row.knowledge_node.embedding ? JSON.parse(row.knowledge_node.embedding) : undefined,
          metadata: row.knowledge_node.metadata ? JSON.parse(row.knowledge_node.metadata) : undefined,
        })),
      )
    }

    // Filter by memory type if specified
    if (options?.memoryType) {
      return results.filter((n) => n.memory_type === options.memoryType)
    }

    return results
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

  /**
   * 删除节点
   * @param id 节点 ID
   * @param force 是否强制删除（忽略依赖检查）
   * @throws DependencyError 如果存在关键依赖且未设置 force
   */
  async deleteNode(id: string, options?: { force?: boolean }): Promise<void> {
    const force = options?.force ?? false

    // 检查关键依赖关系（depends_on, implements 等入边）
    const criticalRelations = ["depends_on", "implements"]
    const dependencies = Database.use((db) =>
      db
        .select()
        .from(knowledge_edges)
        .innerJoin(knowledge_nodes, eq(knowledge_edges.source_id, knowledge_nodes.id))
        .where(
          and(
            eq(knowledge_edges.target_id, id),
            sql`${knowledge_edges.relation} IN (${sql.raw(criticalRelations.map((r) => `'${r}'`).join(", "))})`,
          ),
        )
        .all(),
    )

    if (dependencies.length > 0 && !force) {
      const depList = dependencies.map((row) => ({
        sourceId: row.knowledge_edge.source_id,
        sourceTitle: row.knowledge_node.title,
        relation: row.knowledge_edge.relation,
      }))

      log.warn("delete_node_blocked", { id, dependencies: depList })

      throw new DependencyError({
        nodeId: id,
        dependencies: depList,
      })
    }

    // 强制删除或无依赖，执行删除
    Database.use((db) => {
      db.delete(knowledge_edges).where(eq(knowledge_edges.source_id, id))
      db.delete(knowledge_edges).where(eq(knowledge_edges.target_id, id))
      db.delete(knowledge_nodes).where(eq(knowledge_nodes.id, id))
    })

    log.info("node_deleted", { id, force, hadDependencies: dependencies.length > 0 })
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

  /**
   * 向量相似性搜索：使用 sqlite-vec 原生函数查找语义相似的节点
   * @param embedding 查询向量（需与配置的维度一致）
   * @param options 搜索选项
   * @returns 相似节点列表，按相似度降序排列
   * @note 使用 sqlite-vec 的 vec_distance_cosine 函数，支持高效向量搜索
   */
  async findSimilarNodes(
    embedding: number[],
    options?: {
      topK?: number
      minSimilarity?: number
      nodeType?: NodeType
    },
  ): Promise<Array<KnowledgeNode & { similarity: number }>> {
    const topK = options?.topK ?? 5
    const minSimilarity = options?.minSimilarity ?? 0.3
    const embeddingJson = JSON.stringify(embedding)

    // 使用原生 SQLite 连接调用 sqlite-vec 函数
    const sqlite = Database.raw()

    // 检查 vec_vector_memory 表是否存在（sqlite-vec 扩展是否可用）
    let vecTableExists = false
    try {
      const tableCheck = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_vector_memory'")
        .get() as { name: string } | undefined
      vecTableExists = !!tableCheck
    } catch {
      log.warn("sqlite-vec table check failed, falling back to application-layer search")
    }

    if (!vecTableExists) {
      // 回退：使用应用层计算（适用于中小规模数据）
      return this.findSimilarNodesFallback(embedding, topK, minSimilarity, options?.nodeType)
    }

    // 使用 sqlite-vec 原生函数进行向量搜索
    const vecResults = sqlite
      .prepare(
        `SELECT vm.id, vm.node_id, vm.node_type, vm.entity_title, 
                1 - vec_distance_cosine(v.embedding, vec_f32(?)) as similarity
         FROM vec_vector_memory v
         INNER JOIN vector_memory vm ON v.id = vm.id
         WHERE similarity >= ?
         ORDER BY similarity DESC
         LIMIT ?`,
      )
      .all(embeddingJson, minSimilarity, topK * 2) as {
      id: string
      node_id: string
      node_type: string
      entity_title: string
      similarity: number
    }[]

    const results: Array<KnowledgeNode & { similarity: number }> = []

    for (const vec of vecResults) {
      if (vec.similarity === null) continue

      // 通过 node_id 关联到 knowledge_nodes（如果 node_type 指向知识节点）
      const node = await this.getNode(vec.node_id)
      if (!node) continue

      // 过滤节点类型
      if (options?.nodeType && node.type !== options.nodeType) continue

      results.push({
        ...node,
        similarity: Math.round(vec.similarity * 1000) / 1000,
      })

      if (results.length >= topK) break
    }

    log.info("vector_search_completed", {
      queryDim: embedding.length,
      resultsCount: results.length,
      minSimilarity,
      usedVecExtension: true,
    })

    return results
  }

  /**
   * 向量搜索回退方法：应用层计算余弦相似度
   * 适用于 sqlite-vec 扩展不可用的情况
   * @note 仅适用于中小规模数据（O(N) 复杂度）
   */
  private async findSimilarNodesFallback(
    embedding: number[],
    topK: number,
    minSimilarity: number,
    nodeType?: NodeType,
  ): Promise<Array<KnowledgeNode & { similarity: number }>> {
    // 获取所有带有 embedding 的节点
    let query = Database.use((db) =>
      db
        .select()
        .from(knowledge_nodes)
        .where(sql`${knowledge_nodes.embedding} IS NOT NULL`),
    )

    if (nodeType) {
      query = Database.use((db) =>
        db
          .select()
          .from(knowledge_nodes)
          .where(and(sql`${knowledge_nodes.embedding} IS NOT NULL`, eq(knowledge_nodes.type, nodeType))),
      )
    }

    const nodes = query.all()

    // 应用层计算余弦相似度
    const results: Array<KnowledgeNode & { similarity: number }> = []

    for (const node of nodes) {
      if (!node.embedding) continue

      try {
        const nodeEmbedding = JSON.parse(node.embedding) as number[]
        const similarity = this.cosineSimilarity(embedding, nodeEmbedding)

        if (similarity >= minSimilarity) {
          results.push({
            id: node.id,
            type: node.type as NodeType,
            entity_type: node.entity_type,
            entity_id: node.entity_id,
            title: node.title,
            content: node.content ?? undefined,
            embedding: nodeEmbedding,
            metadata: node.metadata ? JSON.parse(node.metadata) : undefined,
            similarity: Math.round(similarity * 1000) / 1000,
          })
        }
      } catch (e) {
        log.warn("failed_to_parse_embedding", { nodeId: node.id, error: String(e) })
      }
    }

    // 按相似度降序排序并返回 topK
    results.sort((a, b) => b.similarity - a.similarity)

    log.info("vector_search_fallback_completed", {
      queryDim: embedding.length,
      totalNodes: nodes.length,
      resultsCount: Math.min(results.length, topK),
      minSimilarity,
    })

    return results.slice(0, topK)
  }

  /**
   * 计算两个向量的余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`)
    }

    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    if (normA === 0 || normB === 0) return 0

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  async getStats(): Promise<{
    nodes: number
    edges: number
    byType: Record<string, number>
    orphanNodes: number
    avgConnectivity: number
    byRelation: Record<string, number>
  }> {
    const nodes = Database.use((db) => db.select().from(knowledge_nodes).all())
    const edges = Database.use((db) => db.select().from(knowledge_edges).all())

    // 按类型统计节点
    const byType: Record<string, number> = {}
    for (const node of nodes) {
      byType[node.type] = (byType[node.type] || 0) + 1
    }

    // 按关系类型统计边
    const byRelation: Record<string, number> = {}
    for (const edge of edges) {
      byRelation[edge.relation] = (byRelation[edge.relation] || 0) + 1
    }

    // 计算孤立节点（没有入边也没有出边）
    const connectedNodeIds = new Set<string>()
    for (const edge of edges) {
      connectedNodeIds.add(edge.source_id)
      connectedNodeIds.add(edge.target_id)
    }
    const orphanNodes = nodes.filter((n) => !connectedNodeIds.has(n.id)).length

    // 计算平均连接度
    const avgConnectivity = nodes.length > 0 ? edges.length / nodes.length : 0

    return {
      nodes: nodes.length,
      edges: edges.length,
      byType,
      orphanNodes,
      avgConnectivity: Math.round(avgConnectivity * 100) / 100,
      byRelation,
    }
  }

  /**
   * 健康检查：返回向量维度一致性、golden 快照状态等
   */
  async healthCheck(): Promise<{
    healthy: boolean
    issues: string[]
    vectorDimensions: {
      consistent: boolean
      dimensions: number[]
      configuredDim: number
    }
    goldenSnapshot: boolean
    snapshotCount: number
  }> {
    const issues: string[] = []

    // 检查向量维度一致性
    const vectorRecords = Database.use((db) =>
      db.select({ dimensions: vector_memory.dimensions }).from(vector_memory).all(),
    )

    const dimensions = [...new Set(vectorRecords.map((v) => v.dimensions))]
    const { getConfiguredEmbeddingDim } = await import("../storage/db")
    const configuredDim = getConfiguredEmbeddingDim()
    const vectorConsistent = dimensions.length <= 1 && (dimensions.length === 0 || dimensions[0] === configuredDim)

    if (!vectorConsistent) {
      issues.push(`向量维度不一致：期望 ${configuredDim}，实际存在 ${dimensions.join(", ")}`)
    }

    // 检查 golden 快照状态
    const goldenSnapshots = Database.use((db) =>
      db.select().from(archive_snapshot).where(eq(archive_snapshot.is_golden, 1)).all(),
    )

    const goldenSnapshot = goldenSnapshots.length > 0
    const snapshotCount = Database.use((db) => db.select().from(archive_snapshot).all()).length

    // 检查孤立节点比例（超过 50% 视为不健康）
    const stats = await this.getStats()
    if (stats.nodes > 0 && stats.orphanNodes / stats.nodes > 0.5) {
      issues.push(
        `孤立节点比例过高：${stats.orphanNodes}/${stats.nodes} (${Math.round((stats.orphanNodes / stats.nodes) * 100)}%)`,
      )
    }

    return {
      healthy: issues.length === 0,
      issues,
      vectorDimensions: {
        consistent: vectorConsistent,
        dimensions,
        configuredDim,
      },
      goldenSnapshot,
      snapshotCount,
    }
  }
}
