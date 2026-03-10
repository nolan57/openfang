import type { MemoryType, AddMemoryParams, SearchParams, MemoryRef } from "../collab/types"
import { VectorStore } from "../learning/vector-store"
import { KnowledgeGraph } from "../learning/knowledge-graph"

export interface MemoryResult {
  id: string
  type: MemoryType
  content: string
  similarity: number
  metadata?: Record<string, unknown>
}

export interface CrossMemoryResult extends MemoryResult {
  links?: MemoryRef[]
}

export interface AddMemoryResult {
  id: string
  type: MemoryType
}

class SessionMemoryService {
  private sessions = new Map<
    string,
    {
      id: string
      agentIds: string[]
      messages: Array<{ role: string; content: string; agentId?: string; timestamp: string }>
      createdAt: string
      expiresAt: string
    }
  >()

  async createSession(agentIds: string[]): Promise<string> {
    const id = crypto.randomUUID()
    const ttlMinutes = 60
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString()

    this.sessions.set(id, {
      id,
      agentIds,
      messages: [],
      createdAt: new Date().toISOString(),
      expiresAt,
    })

    return id
  }

  async addMessage(sessionId: string, message: { role: string; content: string; agentId?: string }): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    session.messages.push({
      ...message,
      timestamp: new Date().toISOString(),
    })
  }

  async searchSession(sessionId: string, query: string, limit = 10): Promise<MemoryResult[]> {
    const session = this.sessions.get(sessionId)
    if (!session) return []

    const queryLower = query.toLowerCase()
    const results = session.messages
      .filter((m) => m.content.toLowerCase().includes(queryLower))
      .slice(-limit)
      .map((m, i) => ({
        id: `${sessionId}:${i}`,
        type: "session" as MemoryType,
        content: m.content,
        similarity: 1,
        metadata: { role: m.role, agentId: m.agentId },
      }))

    return results
  }

  async getMessages(sessionId: string) {
    const session = this.sessions.get(sessionId)
    return session?.messages ?? []
  }

  async endSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.expiresAt = new Date().toISOString()
    }
  }

  async cleanup(): Promise<number> {
    const now = new Date().toISOString()
    let count = 0

    for (const [id, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.sessions.delete(id)
        count++
      }
    }

    return count
  }
}

class EvolutionMemoryService {
  private vectorStore: VectorStore

  constructor() {
    this.vectorStore = new VectorStore()
  }

  async init(): Promise<void> {
    await this.vectorStore.init()
  }

  async addSkill(params: AddMemoryParams): Promise<AddMemoryResult> {
    const id = await this.vectorStore.embedAndStore({
      node_type: "skill",
      node_id: crypto.randomUUID(),
      entity_title: params.content.slice(0, 100),
      vector_type: "content",
      metadata: { ...params.metadata, type: "skill", content: params.content },
    })

    return { id, type: "evolution" }
  }

  async searchSkills(query: string, limit = 10): Promise<MemoryResult[]> {
    const results = await this.vectorStore.search(query, { limit })

    return results.map((r) => ({
      id: r.id,
      type: "evolution" as MemoryType,
      content: (r.metadata?.content as string) ?? r.entity_title,
      similarity: r.similarity,
      metadata: r.metadata,
    }))
  }
}

class ProjectMemoryService {
  private knowledgeGraph: KnowledgeGraph

  constructor() {
    this.knowledgeGraph = new KnowledgeGraph()
  }

  async init(): Promise<void> {}

  async indexProject(): Promise<{ entitiesAdded: number }> {
    return { entitiesAdded: 0 }
  }

  async indexChanges(changes: Array<{ file: string; type: string }>): Promise<void> {}

  async searchProject(_query: string, limit = 10): Promise<MemoryResult[]> {
    return []
  }

  async getEntity(id: string) {
    return this.knowledgeGraph.getNode(id)
  }

  async getStats(): Promise<{ totalEntities: number }> {
    return { totalEntities: 0 }
  }
}

export class MemoryService {
  private session: SessionMemoryService
  private evolution: EvolutionMemoryService
  private project: ProjectMemoryService
  private initialized = false

  constructor() {
    this.session = new SessionMemoryService()
    this.evolution = new EvolutionMemoryService()
    this.project = new ProjectMemoryService()
  }

  async init(): Promise<void> {
    if (this.initialized) return
    await this.evolution.init()
    await this.project.init()
    this.initialized = true
  }

  async add(params: AddMemoryParams): Promise<AddMemoryResult[]> {
    await this.init()

    switch (params.memoryType) {
      case "session": {
        const sessionId = params.metadata?.sessionId as string
        if (sessionId) {
          await this.session.addMessage(sessionId, {
            role: (params.metadata?.role as string) ?? "user",
            content: params.content,
            agentId: params.metadata?.agentId as string,
          })
          return [{ id: sessionId, type: "session" }]
        }
        return []
      }
      case "evolution": {
        const result = await this.evolution.addSkill(params)
        return [result]
      }
      case "project": {
        return [{ id: crypto.randomUUID(), type: "project" }]
      }
      default:
        return []
    }
  }

  async search(params: SearchParams): Promise<MemoryResult[]> {
    await this.init()

    const memoryType = params.memoryType ?? "project"

    switch (memoryType) {
      case "session": {
        const sessionId = params.filters?.sessionId as string
        if (!sessionId) return []
        return this.session.searchSession(sessionId, params.query, params.limit)
      }
      case "evolution": {
        return this.evolution.searchSkills(params.query, params.limit)
      }
      case "project": {
        return this.project.searchProject(params.query, params.limit)
      }
      default:
        return []
    }
  }

  getSessionService(): SessionMemoryService {
    return this.session
  }

  getEvolutionService(): EvolutionMemoryService {
    return this.evolution
  }

  getProjectService(): ProjectMemoryService {
    return this.project
  }
}

export const Memory = new MemoryService()
