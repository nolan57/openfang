import { OpenFangHttpClient } from "./client"
import { OpenFangErrorHandler } from "./error-handler"
import { convertOpenFangAgentToOpenCode } from "./capability-mapper"
import type { Task, TaskResult, DispatchStrategy } from "../collab/types"
import type { OpenFangConfig } from "./types"
import { HandsManager } from "./hands"
import type { OpenFangAgentInfo } from "./types"
import { OpenFangWasmRuntime, type OpenFangWasmConfig } from "./wasm-runtime"

export interface HybridConfig {
  openfang: OpenFangConfig & {
    wasm_config?: OpenFangWasmConfig
  }
}

export class HybridOpenFangAdapter {
  private serviceClient: OpenFangHttpClient
  private wasmRuntime: OpenFangWasmRuntime | null = null
  private errorHandler: OpenFangErrorHandler
  private handsManager: HandsManager | null = null
  private initialized = false
  private useWasmForSimpleTasks = false

  constructor(config: HybridConfig) {
    this.serviceClient = new OpenFangHttpClient({
      baseUrl: config.openfang.base_url,
      apiKey: config.openfang.api_key,
    })
    this.errorHandler = new OpenFangErrorHandler()

    // Initialize WASM runtime if enabled
    if (config.openfang.wasm_enabled && config.openfang.wasm_module_path) {
      this.wasmRuntime = new OpenFangWasmRuntime({
        modulePath: config.openfang.wasm_module_path,
        enableStreaming: true,
      })
      this.useWasmForSimpleTasks = true
    }

    if (config.openfang.enabled) {
      this.handsManager = new HandsManager(this.serviceClient)
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    // Initialize WASM runtime first (if enabled)
    if (this.wasmRuntime && this.useWasmForSimpleTasks) {
      try {
        await this.wasmRuntime.initialize()
        console.log("[OpenFang] WASM runtime initialized")
      } catch (error) {
        console.warn("[OpenFang] WASM initialization failed, falling back to service layer")
        this.useWasmForSimpleTasks = false
      }
    }

    // Health check for service
    try {
      const health = await this.serviceClient.health()
      console.log(`[OpenFang] Connected to ${health.status} (v${health.version}) with ${health.agents} agents`)
      this.initialized = true
    } catch (error) {
      console.warn("[OpenFang] Service not available, hybrid features disabled")
      throw error
    }
  }

  async dispatch(task: Task, strategy?: DispatchStrategy): Promise<string> {
    if (!this.initialized) {
      throw new Error("OpenFang adapter not initialized")
    }

    // Try WASM first for simple tasks (ultra-low latency)
    if (this.useWasmForSimpleTasks && this.wasmRuntime && this.isSimpleTask(task)) {
      try {
        console.log("[OpenFang] Dispatching to WASM runtime")
        return await this.wasmRuntime.dispatch(task)
      } catch (error) {
        console.warn("[OpenFang] WASM dispatch failed, falling back to service")
        // Fall through to service dispatch
      }
    }

    // Simple tasks use direct service call (low latency)
    if (this.isSimpleTask(task)) {
      return this.dispatchToService(task)
    }

    // Complex tasks use full workflow
    return this.dispatchViaWorkflow(task)
  }

  private isSimpleTask(task: Task): boolean {
    // Tasks with low complexity can use direct dispatch
    const complexity = this.estimateComplexity(task)
    return complexity < 0.3
  }

  private estimateComplexity(task: Task): number {
    // Simple heuristic based on action and payload
    let complexity = 0.1

    if (task.action.includes("search") || task.action.includes("fetch")) {
      complexity += 0.2
    }

    if (task.action.includes("write") || task.action.includes("create")) {
      complexity += 0.3
    }

    if (task.payload && typeof task.payload === "object") {
      complexity += Object.keys(task.payload).length * 0.05
    }

    return Math.min(complexity, 1.0)
  }

  private async dispatchToService(task: Task): Promise<string> {
    return this.errorHandler.withRetry(async () => {
      // Find matching OpenFang agent
      const agents = await this.serviceClient.listAgents()
      const matchingAgent = this.findMatchingAgent(task, agents)

      if (!matchingAgent) {
        throw new Error(`No matching OpenFang agent for task: ${task.action}`)
      }

      // Dispatch to OpenFang
      const openfangAgent = convertOpenFangAgentToOpenCode(matchingAgent)

      // Create task message
      const { Comms, createTaskMessage } = await import("../collab/comms")
      const message = createTaskMessage(
        "hybrid-adapter",
        matchingAgent.id,
        task.id,
        task.action,
        task.payload,
        task.priority,
      )
      Comms.send(message)

      return matchingAgent.id
    }, "OpenFang service dispatch")
  }

  private async dispatchViaWorkflow(task: Task): Promise<string> {
    return this.errorHandler.withRetry(async () => {
      // Create a simple workflow for this task
      const workflowId = await this.serviceClient.createWorkflow({
        name: `task-${task.id}`,
        description: task.action,
        steps: [
          {
            name: "execute",
            prompt: task.action,
            mode: "sequential",
            timeout_secs: task.timeout ? Math.floor(task.timeout / 1000) : 120,
          },
        ],
      })

      // Execute workflow
      const result = await this.serviceClient.runWorkflow(workflowId, JSON.stringify(task.payload))

      // Store result - access the private map via module import
      const taskResultsMap: Map<string, TaskResult> = (globalThis as any).__opencode_task_results || new Map()
      taskResultsMap.set(task.id, {
        taskId: task.id,
        agentId: "openfang-workflow",
        success: result.status === "completed",
        payload: { output: result.output },
        duration: result.duration_ms ?? 0,
      })
      ;(globalThis as any).__opencode_task_results = taskResultsMap

      return "openfang-workflow"
    }, "OpenFang workflow dispatch")
  }

  private findMatchingAgent(task: Task, agents: OpenFangAgentInfo[]) {
    // Match based on task requirements and agent capabilities
    for (const agent of agents) {
      const agentCapabilities = agent.capabilities.tools

      // Check if agent has required capabilities
      if (task.requirements) {
        const hasAll = task.requirements.every((req) =>
          agentCapabilities.some((cap: string) => cap.includes(req) || req.includes(cap)),
        )
        if (hasAll) {
          return agent
        }
      } else {
        // No requirements, match by action keywords
        const actionKeywords = task.action.toLowerCase().split(" ")
        const matches = actionKeywords.some((keyword) =>
          agentCapabilities.some((cap: string) => cap.toLowerCase().includes(keyword)),
        )
        if (matches) {
          return agent
        }
      }
    }

    return null
  }

  // Hands management
  async activateHand(handName: string): Promise<void> {
    if (!this.handsManager) {
      throw new Error("Hands manager not initialized")
    }

    await this.handsManager.activateHand(handName)
  }

  async getHandStatus(handName: string) {
    if (!this.handsManager) {
      throw new Error("Hands manager not initialized")
    }

    return this.handsManager.getStatus(handName)
  }

  listHands(): string[] {
    return this.handsManager?.listAvailableHands() || []
  }

  // Health check
  async health(): Promise<{ status: string; available: boolean; wasm?: boolean }> {
    try {
      const serviceHealth = await this.serviceClient.health()
      const wasmHealth = this.wasmRuntime ? await this.wasmRuntime.health() : undefined

      return {
        status: serviceHealth.status,
        available: true,
        wasm: wasmHealth?.available ?? false,
      }
    } catch {
      return {
        status: "disconnected",
        available: false,
        wasm: false,
      }
    }
  }
}

// Singleton instance
let hybridAdapter: HybridOpenFangAdapter | null = null

export function getHybridAdapter(): HybridOpenFangAdapter {
  if (!hybridAdapter) {
    throw new Error("HybridOpenFangAdapter not initialized. Call initHybridAdapter first.")
  }
  return hybridAdapter
}

export async function initHybridAdapter(config: HybridConfig): Promise<HybridOpenFangAdapter> {
  if (hybridAdapter) {
    return hybridAdapter
  }

  hybridAdapter = new HybridOpenFangAdapter(config)
  await hybridAdapter.initialize()
  return hybridAdapter
}
