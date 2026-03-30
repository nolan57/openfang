import { Log } from "../util/log"
import type {
  OpenFangAgentManifest,
  OpenFangAgentInfo,
  HandStatus,
  WorkflowDefinition,
  WorkflowResult,
  TriggerDefinition,
  TriggerInfo,
  MemoryItem,
  OpenFangChannel,
  ChannelConfig,
} from "./types"

export class OpenFangHttpClient {
  private client: typeof fetch
  private baseUrl: string
  private apiKey?: string

  constructor(config: { baseUrl: string; apiKey?: string }) {
    this.client = fetch
    this.baseUrl = config.baseUrl
    this.apiKey = config.apiKey
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }

    const response = await this.client(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const error = await response.text().catch(() => "Unknown error")
      throw new Error(`OpenFang API error: ${response.status} - ${error}`)
    }

    return response.json()
  }

  // Agent endpoints
  async spawnAgent(manifest: OpenFangAgentManifest): Promise<string> {
    const result = await this.request<{ agent_id: string }>("POST", "/api/agents/spawn", manifest)
    return result.agent_id
  }

  async killAgent(agentId: string): Promise<void> {
    await this.request("POST", `/api/agents/${agentId}/kill`)
  }

  async listAgents(): Promise<OpenFangAgentInfo[]> {
    return this.request("GET", "/api/agents")
  }

  async getAgent(agentId: string): Promise<OpenFangAgentInfo> {
    return this.request("GET", `/api/agents/${agentId}`)
  }

  // Hand endpoints
  async listHands(): Promise<Array<{ id: string; name: string; status: string }>> {
    return this.request("GET", "/api/hands")
  }

  async activateHand(handName: string): Promise<void> {
    await this.request("POST", `/api/hands/${handName}/activate`)
  }

  async pauseHand(handName: string): Promise<void> {
    await this.request("POST", `/api/hands/${handName}/pause`)
  }

  async getHandStatus(handName: string): Promise<HandStatus> {
    return this.request("GET", `/api/hands/${handName}/status`)
  }

  async deactivateHand(handName: string): Promise<void> {
    await this.request("POST", `/api/hands/${handName}/deactivate`)
  }

  // Workflow endpoints
  async listWorkflows(): Promise<Array<{ id: string; name: string; steps: number }>> {
    return this.request("GET", "/api/workflows")
  }

  async runWorkflow(workflowId: string, input: string): Promise<WorkflowResult> {
    return this.request("POST", `/api/workflows/${workflowId}/run`, {
      input,
    })
  }

  async createWorkflow(workflow: WorkflowDefinition): Promise<string> {
    const result = await this.request<{ workflow_id: string }>("POST", "/api/workflows", workflow)
    return result.workflow_id
  }

  async getWorkflowRuns(workflowId: string): Promise<Array<{ id: string; status: string }>> {
    return this.request("GET", `/api/workflows/${workflowId}/runs`)
  }

  // Trigger endpoints
  async listTriggers(agentId?: string): Promise<TriggerInfo[]> {
    const query = agentId ? `?agent_id=${agentId}` : ""
    return this.request("GET", `/api/triggers${query}`)
  }

  async createTrigger(trigger: TriggerDefinition): Promise<string> {
    const result = await this.request<{ trigger_id: string }>("POST", "/api/triggers", trigger)
    return result.trigger_id
  }

  async updateTrigger(triggerId: string, enabled: boolean): Promise<void> {
    await this.request("PUT", `/api/triggers/${triggerId}`, { enabled })
  }

  async deleteTrigger(triggerId: string): Promise<void> {
    await this.request("DELETE", `/api/triggers/${triggerId}`)
  }

  // Memory endpoints
  async searchMemories(params: { query: string; limit?: number; memoryType?: string }): Promise<MemoryItem[]> {
    const queryParams = new URLSearchParams()
    queryParams.set("query", params.query)
    if (params.limit) queryParams.set("limit", params.limit.toString())
    if (params.memoryType) queryParams.set("memoryType", params.memoryType)

    return this.request("GET", `/api/memory/search?${queryParams.toString()}`)
  }

  async storeMemory(memory: MemoryItem): Promise<void> {
    await this.request("POST", "/api/memory", memory)
  }

  async memoryExists(memoryId: string): Promise<boolean> {
    try {
      await this.request("GET", `/api/memory/${memoryId}`)
      return true
    } catch {
      return false
    }
  }

  // Channel endpoints
  async configureChannel(channel: OpenFangChannel, config: ChannelConfig): Promise<void> {
    await this.request("POST", `/api/channels/${channel}/setup`, config)
  }

  async enableChannel(channel: OpenFangChannel): Promise<void> {
    await this.request("POST", `/api/channels/${channel}/enable`)
  }

  async disableChannel(channel: OpenFangChannel): Promise<void> {
    await this.request("POST", `/api/channels/${channel}/disable`)
  }

  async broadcast(params: { channels: string[]; content: string; format?: string }): Promise<void> {
    await this.request("POST", "/api/channels/broadcast", params)
  }

  // Health check
  async health(): Promise<{ status: string; agents: number; version: string }> {
    return this.request("GET", "/api/health")
  }

  // Event endpoints
  async getRecentEvents(limit?: number): Promise<Array<{ type: string; payload: any; timestamp: string }>> {
    const query = limit ? `?limit=${limit}` : ""
    return this.request("GET", `/api/events/recent${query}`)
  }

  async publishEvent(event: { type: string; payload: any; timestamp: string }): Promise<void> {
    await this.request("POST", "/api/events/publish", event)
  }
}
