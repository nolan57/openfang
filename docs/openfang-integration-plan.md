# OpenFang Integration Plan for OpenCode Multi-Agent System

## 📊 Executive Summary

**OpenFang** is an Agent Operating System built in Rust with 137K LOC, 14 crates, and 1767+ tests. It complements OpenCode's TypeScript/Node.js implementation, providing high-performance, security-hardened agent runtime.

### Core Integration Value

- **Autonomous Hands System**: 4 pre-built autonomous agent packages (Collector, Researcher, Browser, Infisical-Sync)
- **16-Layer Security System**: Defense-in-depth architecture including WASM sandbox, Merkle audit trail, information flow taint tracking
- **40 Channel Adapters**: Coverage across Telegram, Discord, Slack, WhatsApp, and 36 other messaging platforms
- **27 LLM Providers**: Support for 123+ models via 3 native drivers
- **Workflow Engine**: Multi-step agent orchestration supporting sequential, parallel, conditional, and loop modes
- **Trigger System**: Event-driven automation mechanisms

---

## 🏗️ Architecture Comparison

### OpenFang Architecture (Rust)

```
14 Crates (bottom-up dependencies):
├── openfang-types        # Core type definitions
├── openfang-memory       # SQLite + vector embeddings + usage tracking
├── openfang-runtime      # Agent loop, 3 LLM drivers, 23 tools, WASM sandbox
├── openfang-kernel       # Orchestrates all subsystems
├── openfang-api          # REST/WS/SSE API (76 endpoints)
├── openfang-cli          # CLI daemon
├── openfang-channels     # 40 channel adapters
├── openfang-wire         # OFP P2P network protocol
├── openfang-skills       # 60 bundled skills
├── openfang-hands        # 4 autonomous Hands
├── openfang-extensions   # MCP integration, credential vault
├── openfang-migrate      # Migration engine
├── openfang-desktop      # Tauri 2.0 desktop app
└── xtask                 # Build automation
```

### OpenCode Architecture (TypeScript)

```
packages/opencode/src/:
├── collab/               # Multi-agent collaboration system
│   ├── coordinator.ts    # Task coordinator
│   ├── registry.ts       # Agent registry
│   ├── comms.ts          # Communication system
│   └── types.ts          # Type definitions
├── memory/               # Three-level memory system
│   ├── service.ts
│   ├── code-analyzer.ts
│   └── session_memory.sql.ts
├── evolution/            # Self-evolution system
│   ├── memory.ts
│   ├── skill.ts
│   └── store.ts
├── learning/             # Learning system
│   ├── knowledge-graph.ts
│   ├── hierarchical-memory.ts
│   └── vector-store.ts
├── scheduler/            # Scheduler
└── mcp/                  # MCP protocol support
```

### Key Differences

| Feature               | OpenFang                    | OpenCode                 |
| --------------------- | --------------------------- | ------------------------ |
| **Language**          | Rust                        | TypeScript               |
| **Agent Definition**  | agent.toml manifest         | Dynamic registration     |
| **Security Model**    | 16-layer hardcoded security | Permission-based         |
| **Autonomous Agents** | 4 Hands                     | None                     |
| **Channels**          | 40 adapters                 | Limited                  |
| **Workflow**          | Declarative JSON definition | Programmatic coordinator |
| **Memory Footprint**  | ~40MB idle                  | ~394MB                   |
| **Cold Start**        | <200ms                      | ~6s                      |

---

## 🎯 Integration Approaches

### Approach A: Runtime Integration (Recommended)

**Architecture**: Run OpenFang as a standalone service, communicate with OpenCode via REST API

#### 1. Service Layer Integration

```typescript
// packages/opencode/src/integration/openfang-client.ts
export class OpenFangClient {
  private baseUrl: string
  private apiKey?: string

  constructor(config: { baseUrl?: string; apiKey?: string }) {
    this.baseUrl = config.baseUrl ?? "http://localhost:4200"
    this.apiKey = config.apiKey
  }

  // Agent management
  async spawnAgent(manifest: OpenFangAgentManifest): Promise<string>
  async killAgent(agentId: string): Promise<void>
  async listAgents(): Promise<OpenFangAgentInfo[]>

  // Hand activation
  async activateHand(handName: string): Promise<void>
  async pauseHand(handName: string): Promise<void>
  async getHandStatus(handName: string): Promise<HandStatus>

  // Workflow execution
  async runWorkflow(workflowId: string, input: string): Promise<WorkflowResult>
  async createWorkflow(workflow: WorkflowDefinition): Promise<string>

  // Trigger management
  async createTrigger(trigger: TriggerDefinition): Promise<string>
  async listTriggers(): Promise<TriggerInfo[]>

  // Memory synchronization
  async syncMemory(memories: MemoryItem[]): Promise<void>
}
```

#### 2. Coordinator Enhancement

```typescript
// packages/opencode/src/collab/coordinator.ts extension
export class HybridTaskCoordinator extends TaskCoordinator {
  private openfangClient: OpenFangClient

  async dispatch(task: Task, strategy?: DispatchStrategy): Promise<string> {
    // 1. Try using OpenFang Agent (if capabilities match)
    const openfangAgents = await this.openfangClient.listAgents()
    const matchingOpenFangAgent = this.findMatchingAgent(task, openfangAgents)

    if (matchingOpenFangAgent) {
      return this.dispatchToOpenFang(task, matchingOpenFangAgent)
    }

    // 2. Fallback to native OpenCode Agent
    return super.dispatch(task, strategy)
  }

  async dispatchParallel(task: Task, agentCount: number): Promise<string> {
    // Leverage OpenFang's fan-out mode
    const workflowId = await this.createFanOutWorkflow(task, agentCount)
    return this.openfangClient.runWorkflow(workflowId, task.payload.input)
  }
}
```

#### 3. Capability Mapping Layer

```typescript
// packages/opencode/src/integration/capability-mapper.ts
export const OpenFangToOpenCodeCapabilities = {
  // OpenFang tools -> OpenCode tools
  file_read: "file:read",
  file_write: "file:write",
  shell_exec: "shell:execute",
  web_search: "web:search",
  web_fetch: "web:fetch",
  memory_store: "memory:write",
  memory_recall: "memory:read",

  // OpenFang capabilities -> OpenCode permissions
  ToolInvoke: "tool:invoke",
  MemoryRead: "memory:read",
  MemoryWrite: "memory:write",
  NetConnect: "network:connect",
  AgentSpawn: "agent:spawn",
  ShellExec: "shell:execute",
}

export function mapCapabilities(openfangCaps: OpenFangCapability[]): OpenCodePermission[] {
  return openfangCaps.map((cap) => OpenFangToOpenCodeCapabilities[cap.type]).filter(Boolean)
}
```

#### 4. Configuration Integration

```toml
# ~/.opencode/config.toml extension
[openfang]
enabled = true
base_url = "http://localhost:4200"
api_key = "optional-api-key"

# Autonomous Hands configuration
[hands]
researcher.enabled = true
schedule = "0 6 * * *"  # Every day at 6 AM

# Channel integration
[channels.openfang]
enabled = true
telegram_bot_token = "xxx"
discord_bot_token = "xxx"
```

---

### Approach B: Code-Level Integration

**Architecture**: Compile OpenFang's Rust code as WASM modules, load directly in OpenCode

#### 1. WASM Module Build

```bash
# In openfang directory
cargo build --target wasm32-unknown-unknown -p openfang-runtime
wasm-pack build --target bundler
```

#### 2. OpenCode Loader

```typescript
// packages/opencode/src/integration/openfang-wasm.ts
import init, { OpenFangKernel, AgentManifest } from "@openfang/wasm"

export class OpenFangWasmRuntime {
  private kernel: OpenFangKernel | null = null

  async initialize(config: OpenFangConfig): Promise<void> {
    await init()
    this.kernel = new OpenFangKernel(config)
    await this.kernel.boot()
  }

  async spawnAgent(manifest: AgentManifest): Promise<string> {
    if (!this.kernel) throw new Error("Kernel not initialized")
    return this.kernel.spawn_agent(manifest)
  }

  async executeToolCall(agentId: string, toolName: string, params: Record<string, any>): Promise<any> {
    return this.kernel.execute_tool_call(agentId, toolName, params)
  }
}
```

**Advantages**:

- No network overhead
- Unified process management
- Better type safety

**Disadvantages**:

- WASM performance overhead (~30%)
- Some system calls unavailable
- Higher build complexity

---

### Approach C: Hybrid Architecture (Best Practice)

**Architecture**: Use WASM for core runtime, standalone service for heavy operations

```typescript
// packages/opencode/src/integration/hybrid-adapter.ts
export class HybridOpenFangAdapter {
  private wasmRuntime: OpenFangWasmRuntime
  private serviceClient: OpenFangClient

  constructor(config: HybridConfig) {
    // Lightweight operations use WASM
    this.wasmRuntime = new OpenFangWasmRuntime()
    await this.wasmRuntime.initialize(config.wasm)

    // Heavy operations use service
    this.serviceClient = new OpenFangClient(config.service)
  }

  async dispatch(task: Task): Promise<TaskResult> {
    // Simple tasks use WASM (low latency)
    if (task.priority === "high" && task.complexity < 0.3) {
      return this.wasmRuntime.execute(task)
    }

    // Complex tasks use service (full functionality)
    return this.serviceClient.execute(task)
  }
}
```

---

## 🔌 Specific Integration Points

### 1. Hands System Integration

OpenFang's 4 Hands can serve as OpenCode's autonomous agents:

```typescript
// packages/opencode/src/integration/hands-registry.ts
export const AvailableHands = {
  collector: {
    name: "Collector Hand",
    description: "OSINT intelligence collection, 24/7 monitoring",
    tools: ["monitor_changes", "build_knowledge_graph", "event_publish"],
    schedule: "continuous",
  },
  researcher: {
    name: "Researcher Hand",
    description: "Deep research with cross-source verification",
    tools: ["web_search", "web_fetch", "generate_report"],
    schedule: "on_demand",
  },
  browser: {
    name: "Browser Hand",
    description: "Web automation with safety guardrails",
    tools: ["navigate", "fill_form", "click_button"],
    schedule: "on_demand",
    guardrails: ["purchase_approval_required"],
  },
  "infisical-sync": {
    name: "Infisical Sync Hand",
    description: "Secret synchronization, credential management",
    tools: ["vault_set", "vault_get", "vault_list"],
    schedule: "hourly",
    requirements: ["INFISICAL_URL", "INFISICAL_CLIENT_ID"],
  },
}

export class HandsManager {
  async activateHand(handName: keyof typeof AvailableHands): Promise<void> {
    const hand = AvailableHands[handName]

    // 1. Activate Hand in OpenFang
    await openfangClient.activateHand(handName)

    // 2. Register as Agent in OpenCode
    await Registry.register({
      id: `hand-${handName}`,
      name: hand.name,
      capabilities: hand.tools,
      schedule: hand.schedule,
    })
  }
}
```

### 2. Workflow Engine Integration

Use OpenFang workflows as a special task type in OpenCode:

```typescript
// packages/opencode/src/collab/workflow-adapter.ts
export class WorkflowAdapter {
  async executeOpenFangWorkflow(workflowId: string, input: string): Promise<TaskResult> {
    const result = await openfangClient.runWorkflow(workflowId, input)

    return {
      taskId: workflowId,
      agentId: "openfang-workflow-engine",
      success: result.status === "completed",
      payload: { output: result.output },
      duration: result.duration_ms,
    }
  }

  async createWorkflowFromTasks(tasks: Task[]): Promise<string> {
    const workflow: WorkflowDefinition = {
      name: `auto-generated-${Date.now()}`,
      description: "Auto-generated from OpenCode tasks",
      steps: tasks.map((task, i) => ({
        name: `step-${i}`,
        agent_name: task.agentId,
        prompt: task.action,
        mode: i === 0 ? "sequential" : "fan_out",
        timeout_secs: task.timeout ?? 120,
        output_var: `step_${i}_output`,
      })),
    }

    return openfangClient.createWorkflow(workflow)
  }
}
```

### 3. Trigger System Integration

Connect OpenFang triggers with OpenCode's event bus:

```typescript
// packages/opencode/src/collab/trigger-bridge.ts
export class TriggerBridge {
  constructor() {
    this.setupEventForwarding()
  }

  private async setupEventForwarding() {
    // Listen to OpenCode event bus
    EventBus.subscribe(async (event) => {
      // Forward to OpenFang trigger engine
      await openfangClient.publishEvent({
        type: event.type,
        payload: event.payload,
        timestamp: event.timestamp,
      })
    })

    // Listen to OpenFang event bus (via polling API)
    setInterval(async () => {
      const events = await openfangClient.getRecentEvents()
      for (const event of events) {
        EventBus.publish({
          type: `openfang:${event.type}`,
          payload: event.payload,
        })
      }
    }, 1000)
  }

  async createCrossSystemTrigger(config: {
    openfangPattern: TriggerPattern
    openCodeAction: (event: any) => Promise<void>
  }): Promise<void> {
    // Create trigger in OpenFang
    const triggerId = await openfangClient.createTrigger({
      pattern: config.openfangPattern,
      prompt_template: "{{event}}",
    })

    // Listen for trigger execution in OpenCode
    EventBus.subscribe(`openfang:trigger_fired:${triggerId}`, async (event) => {
      await config.openCodeAction(event.payload)
    })
  }
}
```

### 4. Channel Adapter Integration

Leverage OpenFang's 40 channel adapters:

```typescript
// packages/opencode/src/integration/channel-bridge.ts
export class ChannelBridge {
  private openfangChannels: Set<string> = new Set()

  async enableChannel(channel: OpenFangChannel, config: ChannelConfig): Promise<void> {
    // 1. Configure channel in OpenFang
    await openfangClient.configureChannel(channel, config)
    this.openfangChannels.add(channel)

    // 2. Register routing rules in OpenCode
    await Registry.registerChannelHandler(channel, async (message) => {
      // 3. Route message to appropriate agent
      const agentId = await Coordinator.selectAgent({
        requirements: [channel],
      })
      return Coordinator.dispatch({
        id: crypto.randomUUID(),
        action: "handle_channel_message",
        payload: { channel, message },
        requirements: [channel],
      })
    })
  }

  async broadcastToChannels(channels: string[], content: string): Promise<void> {
    // Use OpenFang's broadcast capability
    await openfangClient.broadcast({
      channels,
      content,
      format: "markdown",
    })
  }
}
```

### 5. Memory System Synchronization

Establish bidirectional memory synchronization:

```typescript
// packages/opencode/src/integration/memory-sync.ts
export class MemorySynchronizer {
  private syncInterval: NodeJS.Timeout | null = null

  startSync(intervalMs: number = 60000): void {
    this.syncInterval = setInterval(async () => {
      await this.performSync()
    }, intervalMs)
  }

  private async performSync(): Promise<void> {
    const [openCodeMemories, openfangMemories] = await Promise.all([
      Memory.search({ query: "*", limit: 100 }),
      openfangClient.searchMemories({ query: "*", limit: 100 }),
    ])

    // Sync OpenCode -> OpenFang
    for (const memory of openCodeMemories) {
      const exists = await openfangClient.memoryExists(memory.id)
      if (!exists) {
        await openfangClient.storeMemory({
          id: memory.id,
          type: this.mapMemoryType(memory.type),
          content: memory.content,
          metadata: memory.metadata,
        })
      }
    }

    // Sync OpenFang -> OpenCode
    for (const memory of openfangMemories) {
      const exists = await Memory.exists(memory.id)
      if (!exists) {
        await Memory.add({
          memoryType: this.mapMemoryType(memory.type),
          content: memory.content,
          metadata: memory.metadata,
        })
      }
    }
  }

  private mapMemoryType(type: OpenFangMemoryType): MemoryType {
    const mapping: Record<OpenFangMemoryType, MemoryType> = {
      session: "session",
      evolution: "evolution",
      project: "project",
    }
    return mapping[type] ?? "session"
  }
}
```

### 6. Security System Integration

Leverage OpenFang's 16-layer security systems:

```typescript
// packages/opencode/src/integration/security-gateway.ts
export class SecurityGateway {
  // 1. Path traversal protection
  async validatePath(path: string): Promise<boolean> {
    const result = await openfangClient.validatePath(path)
    return result.safe
  }

  // 2. SSRF protection
  async isSafeUrl(url: string): Promise<boolean> {
    return !openfangClient.isSsrfTarget(url)
  }

  // 3. Loop protection
  async checkToolLoop(agentId: string, toolCalls: ToolCall[]): Promise<LoopAnalysis> {
    return openfangClient.analyzeToolLoop(agentId, toolCalls)
  }

  // 4. Credential management
  async storeSecret(key: string, value: string): Promise<void> {
    await openfangClient.storeCredential({
      key,
      value,
      encryption: "AES-256-GCM",
    })
  }

  // 5. Audit trail
  async getAuditTrail(agentId: string): Promise<AuditEntry[]> {
    return openfangClient.getAuditLog(agentId)
  }
}
```

---

## 📋 Implementation Roadmap

### Phase 1: Foundation Integration (2 weeks)

**Goal**: Establish basic communication and capability mapping

**Week 1**:

- [ ] Implement `OpenFangClient` REST API wrapper
- [ ] Create capability mapping layer
- [ ] Add configuration parsing
- [ ] Write integration tests

**Week 2**:

- [ ] Implement agent lifecycle synchronization
- [ ] Establish one-way memory sync (OpenCode -> OpenFang)
- [ ] Documentation and examples

**Deliverables**:

- `packages/opencode/src/integration/openfang-client.ts`
- `packages/opencode/src/integration/capability-mapper.ts`
- Configuration documentation

---

### Phase 2: Hands Integration (2 weeks)

**Goal**: Activate 4 Hands as autonomous agents

**Week 3**:

- [ ] Implement `HandsManager`
- [ ] Integrate Researcher Hand
- [ ] Integrate Collector Hand
- [ ] Establish scheduling system

**Week 4**:

- [ ] Integrate Browser and Infisical-Sync Hands
- [ ] Implement Hand status monitoring
- [ ] Add approval gateway (for Browser Hand)

**Deliverables**:

- `packages/opencode/src/integration/hands-registry.ts`
- 4 autonomous running Hands
- Hand configuration UI (packages/app)

---

### Phase 3: Workflows and Triggers (2 weeks)

**Goal**: Complete workflow and event-driven automation

**Week 5**:

- [ ] Implement `WorkflowAdapter`
- [ ] Create JSON -> OpenCode Task converter
- [ ] Test fan-out/collect modes

**Week 6**:

- [ ] Implement `TriggerBridge`
- [ ] Connect event buses
- [ ] Create cross-system triggers

**Deliverables**:

- `packages/opencode/src/collab/workflow-adapter.ts`
- `packages/opencode/src/collab/trigger-bridge.ts`
- Workflow example library

---

### Phase 4: Channels and Security (2 weeks)

**Goal**: 40 channels and 16-layer security systems

**Week 7**:

- [ ] Implement `ChannelBridge`
- [ ] Integrate 5 core channels (Telegram, Discord, Slack, WhatsApp, Email)
- [ ] Establish message routing

**Week 8**:

- [ ] Implement `SecurityGateway`
- [ ] Integrate audit trail
- [ ] Performance optimization and stress testing

**Deliverables**:

- `packages/opencode/src/integration/channel-bridge.ts`
- `packages/opencode/src/integration/security-gateway.ts`
- Security audit logs

---

### Phase 5: Optimization and Production Ready (2 weeks)

**Goal**: Performance optimization, error handling, production deployment

**Week 9**:

- [ ] Implement hybrid architecture (WASM + Service)
- [ ] Optimize memory synchronization
- [ ] Add monitoring and metrics

**Week 10**:

- [ ] End-to-end testing
- [ ] Performance benchmarks
- [ ] Write production deployment guide
- [ ] User documentation

**Deliverables**:

- `packages/opencode/src/integration/hybrid-adapter.ts`
- Performance report
- Production deployment guide

---

## 🔧 Technical Implementation Details

### 1. REST API Wrapper

```typescript
// packages/opencode/src/integration/openfang-http.ts
export class OpenFangHttpClient {
  private client: typeof fetch

  constructor(private config: { baseUrl: string; apiKey?: string }) {
    this.client = fetch
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.client(`${this.config.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(this.config.apiKey && { Authorization: `Bearer ${this.config.apiKey}` }),
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const error = await response.text()
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

  // Hand endpoints
  async activateHand(handName: string): Promise<void> {
    await this.request("POST", `/api/hands/${handName}/activate`)
  }

  async getHandStatus(handName: string): Promise<HandStatus> {
    return this.request("GET", `/api/hands/${handName}/status`)
  }

  // Workflow endpoints
  async runWorkflow(workflowId: string, input: string): Promise<{ run_id: string; output: string; status: string }> {
    return this.request("POST", `/api/workflows/${workflowId}/run`, {
      input,
    })
  }

  async createWorkflow(workflow: WorkflowDefinition): Promise<string> {
    const result = await this.request<{ workflow_id: string }>("POST", "/api/workflows", workflow)
    return result.workflow_id
  }

  // Trigger endpoints
  async createTrigger(trigger: TriggerDefinition): Promise<string> {
    const result = await this.request<{ trigger_id: string }>("POST", "/api/triggers", trigger)
    return result.trigger_id
  }

  // Memory endpoints
  async searchMemories(params: { query: string; limit?: number }): Promise<MemoryItem[]> {
    return this.request("GET", "/api/memory/search", params)
  }

  async storeMemory(memory: MemoryItem): Promise<void> {
    await this.request("POST", "/api/memory", memory)
  }
}
```

### 2. Agent Manifests Conversion

```typescript
// packages/opencode/src/integration/manifest-converter.ts
export function convertOpenCodeAgentToOpenFang(agent: AgentInfo): OpenFangAgentManifest {
  return {
    name: agent.name,
    version: "0.1.0",
    description: `${agent.type} agent for ${agent.capabilities.join(", ")}`,
    module: "builtin:chat",
    model: {
      provider: agent.config.model.providerID,
      model: agent.config.model.modelID,
      max_tokens: agent.config.maxTokens ?? 8192,
      temperature: 0.7,
    },
    capabilities: {
      tools: agent.config.tools,
      network: agent.config.permission.network ?? ["*"],
      memory_read: agent.config.permission.memory?.read ?? ["*"],
      memory_write: agent.config.permission.memory?.write ?? ["self.*"],
      shell: agent.config.permission.shell ?? [],
    },
    resources: {
      max_llm_tokens_per_hour: 200000,
      max_concurrent_tools: agent.config.maxConcurrentTools ?? 10,
    },
  }
}

export function convertOpenFangAgentToOpenCode(openfangAgent: OpenFangAgentInfo): AgentInfo {
  return {
    id: openfangAgent.id,
    name: openfangAgent.name,
    type: mapModuleToType(openfangAgent.module),
    role: "worker",
    state: openfangAgent.state,
    capabilities: openfangAgent.capabilities.tools,
    config: {
      model: {
        providerID: openfangAgent.model.provider,
        modelID: openfangAgent.model.model,
      },
      tools: openfangAgent.capabilities.tools,
      permission: {
        network: openfangAgent.capabilities.network,
        memory: {
          read: openfangAgent.capabilities.memory_read,
          write: openfangAgent.capabilities.memory_write,
        },
        shell: openfangAgent.capabilities.shell,
      },
      maxTokens: openfangAgent.model.max_tokens,
      timeout: openfangAgent.resources.max_llm_tokens_per_hour,
    },
    createdAt: openfangAgent.created_at,
    lastActiveAt: openfangAgent.last_active_at,
  }
}

function mapModuleToType(module: string): AgentType {
  const mapping: Record<string, AgentType> = {
    "builtin:chat": "general",
    "builtin:coder": "build",
    "builtin:reviewer": "review",
    "builtin:tester": "test",
    "builtin:explorer": "explore",
  }
  return mapping[module] ?? "custom"
}
```

### 3. Error Handling and Retry

```typescript
// packages/opencode/src/integration/error-handler.ts
export class OpenFangErrorHandler {
  private static readonly MAX_RETRIES = 3
  private static readonly BASE_DELAY = 1000 // 1 second

  async withRetry<T>(operation: () => Promise<T>, context: string): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error as Error

        // Non-retryable errors
        if (this.isNonRetryableError(error)) {
          throw error
        }

        // Exponential backoff
        const delay = this.BASE_DELAY * Math.pow(2, attempt - 1)
        console.warn(`${context} failed (attempt ${attempt}/${this.MAX_RETRIES}): ${error}. Retrying in ${delay}ms...`)
        await this.sleep(delay)
      }
    }

    throw new Error(`${context} failed after ${this.MAX_RETRIES} retries: ${lastError}`)
  }

  private isNonRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      // 4xx errors (except 429)
      if (/4\d{2}/.test(error.message) && !error.message.includes("429")) {
        return true
      }
      // Auth errors
      if (error.message.includes("401") || error.message.includes("403")) {
        return true
      }
    }
    return false
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
```

---

## 📊 Performance Benchmarking Plan

### Test Scenarios

1. **Agent Spawn Time**
   - OpenCode native: ~6s
   - OpenFang service: <200ms
   - OpenFang WASM: ~500ms

2. **Tool Execution Latency**
   - File read (1KB)
   - Web search
   - Memory store/recall
   - Shell command

3. **Concurrent Agents**
   - 10 agents executing simultaneously
   - 50 agents executing simultaneously
   - 100 agents executing simultaneously

4. **Memory Synchronization**
   - 100 memories sync latency
   - 1000 memories sync latency
   - Conflict resolution performance

### Benchmarking Tools

```typescript
// tests/integration/openfang-benchmark.ts
import { benchmark } from "@opencode/benchmark"

await benchmark("OpenFang Agent Spawn", async () => {
  const agentId = await openfangClient.spawnAgent({
    name: `test-agent-${Date.now()}`,
    // ... manifest
  })
  return agentId
})

await benchmark("OpenFang Workflow Execution", async () => {
  const result = await openfangClient.runWorkflow("test-workflow", "test input")
  return result
})
```

---

## 🔐 Security Considerations

### 1. API Authentication

```typescript
// packages/opencode/src/integration/auth.ts
export class OpenFangAuth {
  private apiKey: string
  private tokenCache: TokenCache | null = null

  async authenticate(): Promise<string> {
    if (this.tokenCache?.isValid()) {
      return this.tokenCache.token
    }

    // OAuth 2.0 PKCE flow
    const token = await this.performOAuth()
    this.tokenCache = { token, expiresAt: Date.now() + 3600000 }
    return token
  }

  private async performOAuth(): Promise<string> {
    // Implement OAuth 2.0 PKCE
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = await generateCodeChallenge(codeVerifier)

    // Redirect to OpenFang authorization endpoint
    const authUrl =
      `${OPENFANG_URL}/oauth/authorize?` +
      `client_id=${CLIENT_ID}&` +
      `code_challenge=${codeChallenge}&` +
      `response_type=code`

    // ... complete PKCE flow
    return accessToken
  }
}
```

### 2. Credential Storage

Use OpenFang's AES-256-GCM credential vault:

```typescript
await openfangClient.storeCredential({
  key: "anthropic_api_key",
  value: process.env.ANTHROPIC_API_KEY!,
  encryption: "AES-256-GCM",
})
```

### 3. Audit Logging

All cross-system operations should be audit logged:

```typescript
// packages/opencode/src/integration/audit.ts
export async function auditLog(
  action: string,
  actor: string,
  target: string,
  metadata: Record<string, any>,
): Promise<void> {
  await openfangClient.createAuditEntry({
    action,
    actor,
    target,
    timestamp: new Date().toISOString(),
    metadata,
    hash: computeHash(action, actor, target, metadata),
    previous_hash: await getLastHash(),
  })
}
```

---

## 📚 Documentation and Training

### Developer Documentation

1. **Quick Start**
   - Installing and configuring OpenFang service
   - First integration example
   - FAQ

2. **API Reference**
   - OpenFangClient API
   - Capability mapping reference
   - Error codes

3. **Architecture Guide**
   - Hybrid architecture design decisions
   - Performance optimization tips
   - Security best practices

### User Documentation

1. **Hands Usage Guide**
   - Activating and configuring Hands
   - Viewing Hand status
   - Customizing Hand behavior

2. **Workflow Creation**
   - JSON workflow definition syntax
   - Step modes explained
   - Example workflow library

3. **Channel Configuration**
   - Configuration for 40 channels
   - Message formatting
   - Rate limit configuration

---

## 🎯 Success Metrics

### Technical Metrics

- [ ] Agent spawn time reduced by 80% (<1.2s)
- [ ] Tool execution latency reduced by 50%
- [ ] Support for 100+ concurrent agents
- [ ] Memory sync latency <100ms
- [ ] 99.9% API availability

### Functional Metrics

- [ ] All 4 Hands available
- [ ] 10+ pre-built workflows
- [ ] 10+ channels integrated
- [ ] Trigger response time <1s

### User Metrics

- [ ] Developer satisfaction >4.5/5
- [ ] Documentation completeness >95%
- [ ] Example coverage 100%

---

## 🚀 Next Steps

### Getting Started

1. **Setup Development Environment** (1 day)

   ```bash
   # Clone OpenFang
   git clone https://github.com/RightNow-AI/openfang
   cd openfang
   cargo build --release

   # Start OpenFang service
   ./target/release/openfang start
   ```

2. **Create Integration Branch** (1 day)

   ```bash
   git checkout -b feature/openfang-integration
   ```

3. **Implement Base Client** (3 days)
   - `OpenFangClient` class
   - Basic API wrapper
   - Error handling

4. **Write Tests** (2 days)
   - Unit tests
   - Integration tests
   - End-to-end tests

### Resource Requirements

- **Developers**: 2-3 full-stack engineers
- **Time**: 10 weeks
- **Test Environment**: OpenFang service instance + OpenCode dev environment
- **Documentation**: 1 technical writer (2 weeks)

---

## 📞 Contact and Support

- **OpenFang GitHub**: https://github.com/RightNow-AI/openfang
- **OpenFang Discord**: https://discord.gg/sSJqgNnq6X
- **OpenFang Docs**: https://openfang.sh/docs

---

**Conclusion**: Integrating OpenFang into OpenCode's multi-agent system delivers significant performance improvements, security enhancements, and feature extensions. **Approach C (Hybrid Architecture)** is recommended to achieve low latency while maintaining full functionality. The full integration is estimated to take 10 weeks, implemented in 5 phases.
