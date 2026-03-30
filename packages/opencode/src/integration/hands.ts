import type { OpenFangHttpClient } from "./client"

export interface HandInfo {
  id: string
  name: string
  description: string
  tools: string[]
  schedule?: string
  guardrails?: string[]
  requirements?: string[]
}

export const AvailableHands: Record<string, HandInfo> = {
  collector: {
    id: "collector",
    name: "Collector Hand",
    description: "OSINT intelligence collection, 24/7 monitoring, knowledge graph construction",
    tools: [
      "monitor_changes",
      "build_knowledge_graph",
      "event_publish",
      "memory_store",
      "memory_recall",
      "knowledge_add_entity",
      "knowledge_add_relation",
      "knowledge_query",
      "schedule_create",
      "schedule_list",
      "schedule_delete",
    ],
    schedule: "continuous",
  },
  researcher: {
    id: "researcher",
    name: "Researcher Hand",
    description: "Deep research with cross-source verification and cited reports",
    tools: [
      "web_search",
      "web_fetch",
      "generate_report",
      "memory_store",
      "memory_recall",
      "schedule_create",
      "schedule_list",
      "schedule_delete",
    ],
    schedule: "on_demand",
  },
  browser: {
    id: "browser",
    name: "Browser Hand",
    description: "Web automation with safety guardrails",
    tools: [
      "browser_navigate",
      "browser_click",
      "browser_type",
      "browser_screenshot",
      "browser_read_page",
      "browser_close",
    ],
    schedule: "on_demand",
    guardrails: ["purchase_approval_required"],
    requirements: ["python3", "chromium"],
  },
  "infisical-sync": {
    id: "infisical-sync",
    name: "Infisical Sync Hand",
    description: "Secret synchronization and credential management",
    tools: [
      "vault_set",
      "vault_get",
      "vault_list",
      "vault_delete",
      "shell_exec",
      "memory_store",
      "memory_recall",
      "knowledge_add_entity",
      "knowledge_add_relation",
      "knowledge_query",
      "schedule_create",
      "schedule_list",
      "schedule_delete",
    ],
    schedule: "hourly",
    requirements: ["INFISICAL_URL", "INFISICAL_CLIENT_ID", "INFISICAL_CLIENT_SECRET"],
  },
}

export class HandsManager {
  constructor(private client: OpenFangHttpClient) {}

  async activateHand(handName: string): Promise<void> {
    const hand = AvailableHands[handName]
    if (!hand) {
      throw new Error(`Hand '${handName}' not found`)
    }

    // 1. Activate Hand in OpenFang
    await this.client.activateHand(handName)

    // 2. Register as Agent in OpenCode registry
    const { Registry } = await import("../collab/registry")
    await Registry.register({
      id: `hand-${handName}`,
      name: hand.name,
      type: "custom",
      role: "specialist",
      state: "running",
      capabilities: hand.tools,
      config: {
        model: {
          providerID: "openfang",
          modelID: handName,
        },
        tools: hand.tools,
        permission: {
          network: ["*"],
          memory: {
            read: ["*"],
            write: ["self.*"],
          },
          shell: hand.requirements ? ["*"] : [],
        },
        maxSteps: 100,
        timeout: 300,
      },
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    })
  }

  async pauseHand(handName: string): Promise<void> {
    await this.client.pauseHand(handName)
  }

  async getStatus(handName: string) {
    return this.client.getHandStatus(handName)
  }

  async deactivateHand(handName: string): Promise<void> {
    await this.client.deactivateHand(handName)

    // Remove from OpenCode registry
    const { Registry } = await import("../collab/registry")
    await Registry.unregister(`hand-${handName}`)
  }

  listAvailableHands(): string[] {
    return Object.keys(AvailableHands)
  }

  getHandInfo(handName: string): HandInfo | undefined {
    return AvailableHands[handName]
  }
}
