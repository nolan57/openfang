import type { AgentInfo, AgentType, AgentRole, AgentState } from "./types"

const agents = new Map<string, AgentInfo>()

export class AgentRegistry {
  async register(agent: AgentInfo): Promise<void> {
    agents.set(agent.id, agent)
  }

  async unregister(agentId: string): Promise<void> {
    agents.delete(agentId)
  }

  async get(agentId: string): Promise<AgentInfo | null> {
    return agents.get(agentId) ?? null
  }

  async list(filter?: { type?: AgentType; role?: AgentRole; state?: AgentState }): Promise<AgentInfo[]> {
    let results = Array.from(agents.values())

    if (filter?.type) results = results.filter((a) => a.type === filter.type)
    if (filter?.role) results = results.filter((a) => a.role === filter.role)
    if (filter?.state) results = results.filter((a) => a.state === filter.state)

    return results
  }

  async findByCapability(capability: string): Promise<AgentInfo[]> {
    return Array.from(agents.values()).filter((agent) => agent.capabilities.includes(capability))
  }

  async updateState(agentId: string, state: AgentState): Promise<void> {
    const agent = agents.get(agentId)
    if (agent) {
      agents.set(agentId, { ...agent, state })
    }
  }

  async touch(agentId: string): Promise<void> {
    const agent = agents.get(agentId)
    if (agent) {
      agents.set(agentId, { ...agent, lastActiveAt: new Date().toISOString() })
    }
  }

  async getAvailableAgents(requirements: string[]): Promise<AgentInfo[]> {
    const allAgents = await this.list({ state: "idle" })
    if (requirements.length === 0) return allAgents

    return allAgents.filter((agent) => requirements.some((req) => agent.capabilities.includes(req)))
  }
}

export const Registry = new AgentRegistry()
