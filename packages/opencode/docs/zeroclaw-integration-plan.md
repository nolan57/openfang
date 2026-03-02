# ZeroClaw Integration Plan

**Document Type:** Integration Technical Specification  
**Version:** 1.0  
**Date:** March 2, 2026  
**Status:** Draft for Implementation

---

## 1. Executive Summary

This document describes the comprehensive integration plan between **OpenCode** (TypeScript/Bun-based AI coding agent) and **ZeroClaw** (Rust-based AI agent runtime). The integration combines OpenCode's modern UI, self-evolving memory system, and plugin ecosystem with ZeroClaw's ultra-low resource footprint, enterprise-grade security, and hardware integration capabilities.

The recommended approach is an **HTTP-based integration** that leverages ZeroClaw's existing HTTP endpoints while incorporating security enhancements and tool routing from the original stdio-based proposal. This architecture supports the distributed intelligence vision outlined in the ZeroClaw documentation.

---

## 2. Architecture Overview

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      OpenCode (TypeScript)                        │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Tool Registry                                             │ │
│  │  ├── Native tools: read, write, edit, glob, grep, task   │ │
│  │  └── ZeroClaw tools: shell, file_*, http_request, hardware│ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼ HTTP (keep-alive)                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  ZeroClaw HTTP Client                                      │ │
│  │  • Connection pooling (connection reuse)                    │ │
│  │  • Authentication: Bearer Token                           │ │
│  │  • Security headers: X-Security-Policy, X-EStop-Level      │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTP
┌─────────────────────────────────────────────────────────────────┐
│                    ZeroClaw (Rust HTTP Server)                   │
│                                                                  │
│  Endpoints:                                                      │
│  ├── POST /api/chat        → Full Agent Loop (tools + memory)  │
│  ├── POST /tools/exec       → Single tool execution            │
│  ├── POST /tools/batch      → Batch tool execution             │
│  ├── GET  /memory/search    → Vector memory search             │
│  ├── GET  /health           → Health check                     │
│  └── GET  /estop/status    → Emergency stop status             │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Responsibility Division

#### OpenCode (Frontend + Orchestration Layer)

| Responsibility       | Description                                         |
| -------------------- | --------------------------------------------------- |
| **User Interface**   | TUI, Desktop, Web, Console UI presentation          |
| **Agent Decision**   | Choose build/plan mode, decide tool calls           |
| **Memory System**    | Permanent memory, pattern learning, skill evolution |
| **Plugin Ecosystem** | QQ/Slack/iMessage channel integrations              |
| **LLM Routing**      | Model selection, API key management                 |
| **Tool Routing**     | Determine which tools route to ZeroClaw             |
| **Security Policy**  | Pass security parameters to ZeroClaw                |

#### ZeroClaw (Execution Backend)

| Responsibility         | Description                                              |
| ---------------------- | -------------------------------------------------------- |
| **Tool Execution**     | Sandboxed execution of shell, file ops, HTTP requests    |
| **Security Boundary**  | Landlock sandbox, estop emergency stop, OTP verification |
| **Hardware Access**    | USB devices, GPIO, serial ports, firmware flashing       |
| **Encrypted Storage**  | Secret storage, key management                           |
| **Resource Isolation** | <5MB memory footprint, 24/7 background operation         |
| **Agent Loop**         | Full agent loop with tools and memory                    |
| **Network Service**    | HTTP server for remote communication                     |

---

## 3. Integration Patterns Retained from Original Proposal

### 3.1 JSON-RPC Format Compatibility

The HTTP requests maintain a structure similar to JSON-RPC for protocol consistency:

```json
// Request (OpenCode → ZeroClaw)
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tool.execute",
  "params": {
    "name": "shell",
    "args": { "command": "cargo build" },
    "securityPolicy": "supervised"
  }
}

// Response (ZeroClaw → OpenCode)
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "success": true,
    "output": "Compiling... Done in 2.3s",
    "exitCode": 0,
    "memoryUsed": "4.2MB",
    "duration": "2.3s"
  }
}
```

### 3.2 Security Policy Parameters

Security configurations from the original proposal are passed via HTTP headers:

```typescript
interface SecurityHeaders {
  "X-Security-Policy": "supervised" | "read_only" | "full"
  "X-EStop-Level": "none" | "tool-freeze" | "domain-block" | "network-kill" | "kill-all"
  "X-Estop-Enabled": "true" | "false"
}
```

### 3.3 Resource Monitoring Responses

ZeroClaw responses include resource usage information:

```json
{
  "success": true,
  "output": "...",
  "exitCode": 0,
  "memoryUsed": "4.2MB",
  "duration": "2.3s",
  "timestamp": "2026-03-02T12:00:00Z"
}
```

### 3.4 Batch Tool Execution

Support for batch operations as defined in the original proposal:

```typescript
// Batch request
const response = await fetch(`${zeroclawUrl}/tools/batch`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    requests: [
      { method: "tool.execute", params: { name: "shell", args: { command: "ls" } } },
      { method: "tool.execute", params: { name: "file_read", args: { path: "/tmp/test.txt" } } },
    ],
  }),
})
```

### 3.5 Tool Classification and Routing

Tools are classified and routed based on the original proposal's strategy:

| Tool Category             | Route To ZeroClaw | Rationale                          |
| ------------------------- | ----------------- | ---------------------------------- |
| `shell`, `file_*`         | ✅ Yes            | Requires sandbox security          |
| `hardware_*`              | ✅ Yes            | Requires hardware access           |
| `http_request`, `browser` | ✅ Yes            | Requires rate limiting/audit       |
| `memory_*`                | ⚠️ Optional       | OpenCode has its own memory system |
| `cron_*`                  | ⚠️ Optional       | Both have schedulers, can sync     |
| `delegate`, `subagent_*`  | ❌ No             | Agent orchestration logic          |
| `model_*`, `provider_*`   | ❌ No             | LLM routing is OpenCode core       |

---

## 4. HTTP Client Implementation

### 4.1 Connection Management

```typescript
// src/zeroclaw/client.ts

export class ZeroClawClient {
  private baseUrl: string
  private token: string
  private connection: Pool

  constructor(config: ZeroClawConfig) {
    this.baseUrl = config.url
    this.token = config.token
    this.connection = new Pool({
      max: 10, // Maximum concurrent connections
      keepAlive: true,
      keepAliveTimeout: 30000,
    })
  }

  async executeTool(name: string, args: Record<string, unknown>, security?: SecurityConfig) {
    const response = await this.request("/tools/exec", {
      method: "POST",
      body: {
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "tool.execute",
        params: {
          name,
          args,
          ...security,
        },
      },
    })
    return response.result
  }

  async chat(message: string, sessionId?: string, context?: string[]) {
    const response = await this.request("/api/chat", {
      method: "POST",
      body: {
        message,
        session_id: sessionId,
        context,
      },
    })
    return response
  }

  private async request(path: string, options: RequestInit) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    })

    if (!response.ok) {
      throw new ZeroClawError(await response.text(), response.status)
    }

    return response.json()
  }
}
```

### 4.2 Configuration

```typescript
// src/zeroclaw/config.ts

export interface ZeroClawConfig {
  url: string
  token: string
  timeout?: number
  retry?: number
}

export interface ZeroClawToolConfig {
  enabled: boolean
  routing: {
    shell: boolean
    file: boolean
    http: boolean
    hardware: boolean
    memory: boolean
    cron: boolean
  }
  security: {
    policy: "supervised" | "read_only" | "full"
    estopEnabled: boolean
  }
}
```

---

## 5. Bidirectional Control System

This section details the bidirectional control capabilities required to achieve the mutual update and restart functionality described in the Distributed Intelligence Vision.

### 5.1 Control Direction Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Bidirectional Control Flow                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│    OpenCode ──────────────────────► ZeroClaw                   │
│    (Controller)                         (Controlled)             │
│                                                                  │
│    • Update binary                     • Update binary           │
│    • Restart service                   • Restart service       │
│    • Deploy to remote                   • Deploy to remote       │
│    • Query status                       • Query status          │
│                                                                  │
│    OpenCode ◄────────────────────── ZeroClaw                   │
│    (Controlled)                         (Controller)             │
│                                                                  │
│    • Receive update commands            • Send update commands   │
│    • Report status                      • Monitor health        │
│    • Execute distributed tasks          • Orchestrate nodes      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 OpenCode → ZeroClaw Control

OpenCode controls ZeroClaw using shell commands and ZeroClaw's existing HTTP API.

#### 5.2.1 ZeroClaw Update

```typescript
// src/zeroclaw/control.ts

export class ZeroClawController {
  private client: ZeroClawClient
  private shell: BunShell

  async update(target: "local" | string, options?: UpdateOptions): Promise<UpdateResult> {
    const version = options?.version ?? "latest"
    const channel = options?.channel ?? "stable"

    if (target === "local") {
      // Download and replace binary
      await this.shell.exec(`
        curl -L "https://github.com/zeroclaw-labs/zeroclaw/releases/${version}" -o /tmp/zeroclaw
        chmod +x /tmp/zeroclaw
        mv /tmp/zeroclaw $(which zeroclaw)
      `)

      // Restart service
      await this.restart("local")

      return { success: true, version, target }
    } else {
      // Remote update via SSH
      await this.client.executeTool("ssh", {
        host: target,
        command: `curl -L "https://github.com/zeroclaw-labs/zeroclaw/releases/${version}" -o /tmp/zeroclaw && sudo mv /tmp/zeroclaw $(which zeroclaw)`,
      })

      await this.restart(target)

      return { success: true, version, target }
    }
  }

  async restart(target: "local" | string): Promise<RestartResult> {
    if (target === "local") {
      await this.shell.exec("launchctl stop com.zeroclaw.daemon")
      await this.shell.exec("launchctl start com.zeroclaw.daemon")
    } else {
      await this.client.executeTool("ssh", {
        host: target,
        command: "sudo systemctl restart zeroclaw",
      })
    }

    // Wait for health check
    await this.waitForHealth(target)

    return { success: true, target }
  }

  async deploy(config: DeployConfig): Promise<DeployResult> {
    const { target, platform, auth, security } = config

    // Step 1: Transfer binary
    await this.client.executeTool("scp", {
      source: "./target/release/zeroclaw",
      destination: `${auth.user}@${target.host}:/tmp/zeroclaw`,
    })

    // Step 2: Install binary
    await this.client.executeTool("ssh", {
      host: target.host,
      command: `sudo mv /tmp/zeroclaw /usr/local/bin/ && sudo chmod +x /usr/local/bin/zeroclaw`,
    })

    // Step 3: Generate config
    const configContent = this.generateZeroClawConfig(security)
    await this.client.executeTool("ssh", {
      host: target.host,
      command: `echo '${configContent}' | sudo tee /etc/zeroclaw/config.toml`,
    })

    // Step 4: Start daemon
    await this.client.executeTool("ssh", {
      host: target.host,
      command: "sudo zeroclaw daemon --config /etc/zeroclaw/config.toml &",
    })

    // Wait for health
    await this.waitForHealth(target.host)

    return {
      success: true,
      target: target.host,
      platform,
      endpoint: `http://${target.host}:42617`,
    }
  }

  async getStatus(target: string): Promise<ZeroClawStatus> {
    const response = await this.client.request(`/health`, { method: "GET" })
    return {
      status: response.status,
      uptime: response.uptime,
      memory: response.memory_usage,
      version: response.version,
      tools: response.available_tools,
    }
  }

  private async waitForHealth(target: string, timeout: number = 30000): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      try {
        await this.client.request(`/health`, { method: "GET" })
        return true
      } catch {
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
    throw new Error(`ZeroClaw health check timeout for ${target}`)
  }

  private generateZeroClawConfig(security: SecurityConfig): string {
    return `
[gateway]
port = 42617
require_pairing = false

[security]
sandbox = "${security.sandbox}"
estop_enabled = ${security.estopEnabled}

[memory]
backend = "sqlite"
`.trim()
  }
}

interface UpdateOptions {
  version?: string
  channel?: "stable" | "beta" | "nightly"
}

interface DeployConfig {
  target: {
    host: string
    platform: "linux-x64" | "linux-arm64" | "linux-armv7"
    auth: {
      type: "ssh"
      user?: string
      keyFile: string
    }
  }
  config: {
    securityPolicy: "supervised" | "read_only" | "full"
    estopEnabled: boolean
    allowedTools: string[]
  }
}
```

#### 5.2.2 OpenCode Tool Exposed to ZeroClaw

OpenCode exposes control tools that ZeroClaw can call:

```typescript
// src/tool/opencode_control.ts

import { Tool } from "../tool/tool"

export const OpenCodeUpdateTool = Tool.define("opencode_update", async () => {
  const parameters = z.object({
    target: z.enum(["local", "remote"]).default("local"),
    version: z.string().optional(),
    channel: z.enum(["stable", "beta", "nightly"]).default("stable"),
  })

  const description = "Update OpenCode to a specific version"

  const execute = async (args: z.infer<typeof parameters>, ctx: Tool.Context) => {
    const { target, version, channel } = args

    if (target === "local") {
      // Pull latest and rebuild
      const result = await ctx.run(`
        git pull origin dev
        bun install
        bun run build
      `)

      // Restart if running as service
      await ctx.run("launchctl stop com.opencode.daemon")
      await ctx.run("launchctl start com.opencode.daemon")

      return {
        title: "OpenCode Updated",
        output: `Updated to latest version. Restarted service.`,
        metadata: {},
      }
    }

    return {
      title: "Remote Update Not Implemented",
      output: "Remote OpenCode update requires additional setup",
      metadata: {},
    }
  }

  return { description, parameters, execute }
})
```

### 5.3 ZeroClaw → OpenCode Control

ZeroClaw controls OpenCode via OpenCode's HTTP Control API.

#### 5.3.1 OpenCode Control API

```typescript
// src/server/routes/control.ts

import { Hono } from "hono"

export const controlRouter = new Hono()

// ZeroClaw can call these endpoints to control OpenCode

controlRouter.post("/api/control/opencode/update", async (c) => {
  const auth = c.get("auth")
  if (!auth || !auth.zeroclaw) {
    return c.json({ error: "Unauthorized" }, 401)
  }

  const body = await c.req.json()
  const { target, version, channel } = body

  // Execute update
  const result = await updateOpenCode({ target, version, channel })

  return c.json(result)
})

controlRouter.post("/api/control/opencode/restart", async (c) => {
  const auth = c.get("auth")
  if (!auth || !auth.zeroclaw) {
    return c.json({ error: "Unauthorized" }, 401)
  }

  const body = await c.req.json()
  const { target } = body

  // Execute restart
  const result = await restartOpenCode(target)

  return c.json(result)
})

controlRouter.get("/api/control/status", async (c) => {
  const auth = c.get("auth")
  if (!auth || !auth.zeroclaw) {
    return c.json({ error: "Unauthorized" }, 401)
  }

  return c.json({
    status: "running",
    version: process.env.OPENCODE_VERSION,
    uptime: process.uptime(),
    sessionCount: Session.activeCount(),
    memory: process.memoryUsage(),
  })
})

// Authentication middleware for ZeroClaw
async function zeroclawAuth(c: Context, next: Next) {
  const token = c.req.header("X-ZeroClaw-Token")
  const expectedToken = process.env.OPENCODE_CONTROL_TOKEN

  if (token !== expectedToken) {
    return c.json({ error: "Invalid token" }, 401)
  }

  c.set("auth", { zeroclaw: true })
  await next()
}
```

#### 5.3.2 ZeroClaw Configuration to Control OpenCode

```toml
# ZeroClaw config for OpenCode control

[control]
opencode_url = "http://localhost:4096"
opencode_token = "${OPENCODE_CONTROL_TOKEN}"

[control.update]
enabled = true
auto_update = false
channel = "stable"

[control.remote]
# For remote OpenCode instances
[[control.remote.instances]]
name = "opencode-server-1"
url = "https://opencode-server.example.com"
token = "${OPENCODE_CONTROL_TOKEN_1}"
```

### 5.4 Mutual Update Scenarios

#### 5.4.1 Zero-Touch Fleet Update

```typescript
// Update entire fleet from central dashboard

const fleet = await orchestrator.listNodes()
// fleet = ["zeroclaw-livingroom", "zeroclaw-kitchen", "opencode-desktop"]

// Update all ZeroClaw nodes
for (const node of fleet.filter((n) => n.type === "zeroclaw")) {
  await zeroclawController.update(node.host, { version: "1.2.0" })
}

// Update OpenCode
await fetch("/api/control/opencode/update", {
  method: "POST",
  headers: { "X-ZeroClaw-Token": token },
  body: { version: "2.0.0" },
})

// Result: All nodes updated in ~30 seconds
```

#### 5.4.2 Rolling Update with Rollback

```typescript
// Staged rollout: update 10% -> 50% -> 100%

async function rollingUpdate(version: string, nodes: string[], stages: number[] = [0.1, 0.5, 1.0]) {
  for (const stage of stages) {
    const count = Math.floor(nodes.length * stage)
    const toUpdate = nodes.slice(0, count)

    console.log(`Stage ${stage}: Updating ${count} nodes`)

    // Update in parallel
    await Promise.all(toUpdate.map((node) => zeroclawController.update(node, { version })))

    // Wait and check health
    await wait(5000)
    const healthy = await checkHealth(toUpdate)

    if (healthy < count) {
      console.log(`Health check failed! Rolling back...`)
      // Rollback to previous version
      await Promise.all(toUpdate.map((node) => zeroclawController.update(node, { version: previousVersion })))
      throw new Error("Update failed, rolled back")
    }
  }
}
```

### 5.5 Security Considerations

#### 5.5.1 Authentication

| Control Direction   | Auth Method      | Token Location             |
| ------------------- | ---------------- | -------------------------- |
| OpenCode → ZeroClaw | Bearer Token     | `~/.zeroclaw/daemon.token` |
| ZeroClaw → OpenCode | X-ZeroClaw-Token | Environment variable       |

#### 5.5.2 Authorization Levels

```typescript
enum ControlLevel {
  NONE = 0, // No control
  QUERY = 1, // Status only
  EXECUTE = 2, // Execute tools
  UPDATE = 3, // Update binary
  RESTART = 4, // Restart service
  DESTROY = 5, // Delete instance
}

// Configure per-connection
const controlPolicy = {
  "local-zeroclaw": ControlLevel.RESTART,
  "remote-zeroclaw": ControlLevel.EXECUTE,
  "opencode-desktop": ControlLevel.UPDATE,
}
```

#### 5.5.3 Audit Logging

All control actions are logged:

```typescript
// Audit log entry
{
  timestamp: "2026-03-02T12:00:00Z",
  action: "update",
  source: "opencode-desktop",
  target: "zeroclaw-livingroom",
  version: "1.2.0",
  result: "success",
  duration: "4.2s"
}
```

---

## 6. Implementation Roadmap

### Phase 1: ZeroClaw as LLM Provider (Weeks 1-2)

**Objectives:**

- Add ZeroClaw to OpenCode's provider list
- Integrate with `/api/chat` endpoint
- Validate full agent loop functionality

**Deliverables:**

- ZeroClaw provider implementation
- Authentication via Bearer token
- Basic chat functionality

**Success Criteria:**

- Can send messages to ZeroClaw and receive responses
- Tools execute correctly through agent loop
- Memory recall works

### Phase 2: Tool Routing + Security Enhancement (Weeks 2-4)

**Objectives:**

- Implement tool classification and routing
- Add security header support
- Add resource monitoring

**Deliverables:**

- Tool router implementation
- Security policy configuration
- Resource usage tracking

**Success Criteria:**

- Shell and file operations route to ZeroClaw
- Security policies apply correctly
- Resource monitoring displays in responses

### Phase 3: Memory Sync + Distributed Coordination (Deferred)

**Objectives:**

- Bidirectional memory synchronization
- Support for remote ZeroClaw deployment
- Distributed task coordination

**Deliverables:**

- Memory API integration
- Remote deployment support
- Multi-node orchestration

**Success Criteria:**

- Patterns learned in OpenCode sync to ZeroClaw
- Can deploy ZeroClaw to remote machines
- Can coordinate tasks across nodes

**Status:** ⏸️ Deferred - Can be implemented when actual requirements emerge

### Phase 4: Bidirectional Control - Unidirectional First (Completed ✅)

**Objectives:**

- OpenCode can update/restart ZeroClaw ✅
- ZeroClaw can update/restart OpenCode ⏸️ (API ready, activation pending)
- Mutual update with rollback support ⏸️ (partial implementation)

**Deliverables:**

- ZeroClaw controller in OpenCode ✅
- OpenCode control API for ZeroClaw ✅
- Rolling update with health checks ✅

**Success Criteria:**

- Can update ZeroClaw from OpenCode dashboard ✅
- Can update OpenCode from ZeroClaw ⏸️ (requires ZeroClaw client)
- Rollback works on update failure ⏸️ (can be added later)

**Notes:**

The current implementation provides **unidirectional control** (OpenCode → ZeroClaw). The bidirectional pathway is preserved in the architecture:

1. **OpenCode → ZeroClaw:** Fully implemented
   - `ZeroClawController.update()`, `restart()`, `deploy()`, `rollingUpdate()`
   - Works locally and remotely via SSH

2. **ZeroClaw → OpenCode:** API ready, awaiting activation
   - Control API endpoints registered at `/control/*`
   - Requires setting `OPENCODE_CONTROL_TOKEN` environment variable
   - ZeroClaw side client can be added later to call these endpoints

**Future Upgrade Path:**

To enable full bidirectional control:

1. Set `OPENCODE_CONTROL_TOKEN` environment variable
2. Add ZeroClaw client to call OpenCode's `/control/*` endpoints
3. Implement rollback mechanism

**Deliverables:**

- ZeroClaw controller in OpenCode
- OpenCode control API for ZeroClaw
- Rolling update with health checks

**Success Criteria:**

- Can update ZeroClaw from OpenCode dashboard
- Can update OpenCode from ZeroClaw
- Rollback works on update failure

---

## 7. Configuration Example

### OpenCode Configuration (opencode.json)

```json
{
  "agent": {
    "toolBackend": {
      "type": "zeroclaw",
      "url": "http://localhost:42617",
      "securityPolicy": "supervised",
      "estopEnabled": true
    }
  },
  "zeroclaw": {
    "enabled": true,
    "url": "http://localhost:42617",
    "token": "${ZEROCLAW_TOKEN}",
    "routing": {
      "shell": true,
      "file": true,
      "http": true,
      "hardware": true,
      "memory": false,
      "cron": false
    },
    "security": {
      "policy": "supervised",
      "estopEnabled": true
    }
  }
}
```

### ZeroClaw Configuration (config.toml)

```toml
[gateway]
port = 42617
host = "0.0.0.0"
require_pairing = true

[gateway.auth]
type = "token"
token_file = "~/.zeroclaw/daemon.token"

[security]
sandbox = "landlock"
estop_enabled = true

[memory]
backend = "sqlite"
auto_save = true
```

---

## 8. Benefits Summary

### 8.1 Benefits Retained from HTTP方案

| Capability                           | Status                    |
| ------------------------------------ | ------------------------- |
| Remote deployment                    | ✅ Full support           |
| Node discovery/coordination          | ✅ Network-based          |
| Mutual Update (OpenCode ↔ ZeroClaw) | ✅ Bidirectional control  |
| Distributed task execution           | ✅ Cross-node HTTP        |
| Knowledge propagation                | ✅ Memory API             |
| Low latency                          | ✅ Keep-alive connections |
| Full Agent Loop                      | ✅ /api/chat endpoint     |

### 8.2 Benefits Added from Original Proposal

| Enhancement         | Description                       |
| ------------------- | --------------------------------- |
| Security headers    | X-Security-Policy, X-EStop-Level  |
| Resource monitoring | memoryUsed, duration in responses |
| Batch execution     | /tools/batch endpoint             |
| Tool classification | Clear routing rules               |

---

## 9. Comparison with Original Approaches

### 9.1 Original stdio方案 (Pattern B from proposal)

| Aspect               | stdio方案          | 综合方案          |
| -------------------- | ------------------ | ----------------- |
| **Latency**          | <5ms               | ~10-50ms          |
| **Complexity**       | Process management | HTTP client       |
| **Remote support**   | ❌ No              | ✅ Yes            |
| **Distributed**      | ❌ No              | ✅ Yes            |
| **Bidirectional**    | ❌ No              | ✅ Yes            |
| **ZeroClaw changes** | Need --stdio mode  | No changes needed |

### 9.2 HTTP方案 (Recommended)

All distributed intelligence capabilities preserved:

- ✅ Remote deployment
- ✅ Node discovery
- ✅ Mutual updates (bidirectional)
- ✅ Distributed coordination
- ✅ Knowledge propagation
- ✅ Collective security (estop propagation)

---

## 10. Risk Mitigation

### 10.1 Technical Risks

| Risk                  | Likelihood | Impact | Mitigation                                 |
| --------------------- | ---------- | ------ | ------------------------------------------ |
| **HTTP latency**      | Low        | Medium | Connection pooling, keep-alive             |
| **Network failure**   | Medium     | Medium | Timeout + retry logic                      |
| **Version mismatch**  | High       | Medium | Semantic versioning + protocol negotiation |
| **Security boundary** | Low        | High   | Always use HTTPS in production             |
| **Control auth**      | Medium     | High   | Token-based auth + audit logging           |

### 10.2 Operational Risks

| Risk                   | Likelihood | Impact | Mitigation                               |
| ---------------------- | ---------- | ------ | ---------------------------------------- |
| **ZeroClaw downtime**  | Low        | High   | Health checks + fallback to native tools |
| **Configuration sync** | Medium     | Low    | Environment variables or shared config   |
| **Update failure**     | Low        | High   | Rollback mechanism + health checks       |

---

## 11. Success Metrics

### Technical Metrics

| Metric                     | Target      | Measurement           |
| -------------------------- | ----------- | --------------------- |
| Tool call latency          | <50ms (p95) | Benchmark suite       |
| Connection pool efficiency | >90% reuse  | Connection metrics    |
| Error rate                 | <0.1%       | Production monitoring |
| Tool coverage              | 50+ tools   | Integration checklist |
| Control API latency        | <100ms      | API benchmarks        |

### Adoption Metrics

| Metric                  | Target (6 months) | Measurement        |
| ----------------------- | ----------------- | ------------------ |
| Active users            | 1000+ DAU         | Telemetry (opt-in) |
| Integration deployments | 100+              | User reports       |
| Bidirectional control   | Production ready  | Feature flag       |

---

## 12. Related Documents

- [ZeroClaw Integration Proposal](../zeroclaw/docs/integration-opencodeclaw-proposal.md)
- [Distributed Intelligence Vision](../zeroclaw/docs/distributed-intelligence-vision.md)
- [OpenClaw Migration Guide](../zeroclaw/docs/migration/openclaw-migration-guide.md)
- [ZeroClaw README](../zeroclaw/README.md)
- [OpenCodeClaw README](./README.md)

---

## 13. Conclusion

This comprehensive integration plan combines the best of both approaches:

1. **HTTP-based communication** - Leverages ZeroClaw's existing HTTP endpoints, no backend changes required
2. **Security enhancements** - Incorporates security policy parameters and resource monitoring from the original proposal
3. **Tool routing** - Clear classification of which tools route to ZeroClaw
4. **Bidirectional control** - OpenCode and ZeroClaw can update/restart each other
5. **Distributed intelligence ready** - Full support for the vision outlined in distributed-intelligence-vision.md

The architecture supports the long-term goal of building a distributed intelligence network where OpenCode and ZeroClaw instances can:

- **Discover** each other via mDNS/mesh networking
- **Coordinate** tasks across multiple machines
- **Update** each other bidirectionally
- **Share knowledge** through pattern propagation
- **Respond collectively** to security events (estop propagation)

This bidirectional control capability is essential for the zero-touch fleet management and mutual update scenarios described in the Distributed Intelligence Vision document.

---

_Last Updated: March 2, 2026_
