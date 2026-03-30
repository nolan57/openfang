# OpenFang Integration

Hybrid architecture integration between OpenFang (Rust-based Agent OS) and OpenCode's multi-agent collaboration system.

## Architecture

This integration uses a **hybrid approach**:

- **Service Layer**: OpenFang runs as a standalone service (recommended for production)
- **WASM Layer**: Optional WASM module for low-latency operations (future enhancement)
- **Adapter Pattern**: `HybridOpenFangAdapter` provides unified interface for both layers

## Components

### Core Files

- **`types.ts`**: TypeScript type definitions for OpenFang entities (Agents, Hands, Workflows, Triggers)
- **`client.ts`**: REST API HTTP client wrapper (`OpenFangHttpClient`)
- **`capability-mapper.ts`**: Bidirectional capability/permission mapping between OpenFang and OpenCode
- **`error-handler.ts`**: Retry logic with exponential backoff and custom error types
- **`hands.ts`**: Hands manager for activating/deactivating OpenFang's autonomous agents
- **`hybrid-adapter.ts`**: Main hybrid adapter that coordinates service/WASM layers
- **`index.ts`**: Public API exports

## Setup

### 1. Install OpenFang Service

```bash
# Clone and build OpenFang
git clone https://github.com/RightNow-AI/openfang
cd openfang
cargo build --release

# Start the service
./target/release/openfang start
# Dashboard: http://localhost:4200
```

### 2. Configure OpenCode

Add to `~/.opencode/config.toml`:

```toml
[openfang]
enabled = true
base_url = "http://localhost:4200"
api_key = "optional-api-key"

[hands.researcher]
enabled = true
schedule = "0 6 * * *"

[hands.collector]
enabled = true
schedule = "continuous"
```

### 3. Initialize in OpenCode

```typescript
import { initHybridAdapter } from "@opencode-ai/integration"

// Initialize the hybrid adapter
const adapter = await initHybridAdapter({
  openfang: {
    enabled: true,
    base_url: "http://localhost:4200",
  },
})

// Activate Hands
await adapter.activateHand("researcher")
await adapter.activateHand("collector")

// Dispatch tasks
await adapter.dispatch({
  id: crypto.randomUUID(),
  action: "Research AI agent frameworks",
  payload: { topic: "multi-agent systems" },
  requirements: ["web_search", "generate_report"],
  priority: "high",
})
```

## Available Hands

### Collector Hand

- **Purpose**: OSINT intelligence collection, 24/7 monitoring
- **Tools**: monitor_changes, build_knowledge_graph, event_publish, memory_store/recall
- **Schedule**: Continuous (runs in background)

### Researcher Hand

- **Purpose**: Deep research with cross-source verification
- **Tools**: web_search, web_fetch, generate_report
- **Schedule**: On-demand (activated per task)

### Browser Hand

- **Purpose**: Web automation with safety guardrails
- **Tools**: browser_navigate, browser_click, browser_type, browser_screenshot
- **Guardrails**: Purchase approval required
- **Requirements**: python3, chromium

### Infisical-Sync Hand

- **Purpose**: Secret synchronization and credential management
- **Tools**: vault_set/get/list/delete, shell_exec
- **Requirements**: INFISICAL_URL, INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET
- **Schedule**: Hourly

## API Reference

### OpenFangClient

```typescript
class OpenFangClient {
  // Agent management
  spawnAgent(manifest): Promise<string>
  killAgent(agentId): Promise<void>
  listAgents(): Promise<OpenFangAgentInfo[]>

  // Hands
  activateHand(handName): Promise<void>
  pauseHand(handName): Promise<void>
  getHandStatus(handName): Promise<HandStatus>

  // Workflows
  runWorkflow(workflowId, input): Promise<WorkflowResult>
  createWorkflow(workflow): Promise<string>

  // Triggers
  createTrigger(trigger): Promise<string>
  listTriggers(agentId?): Promise<TriggerInfo[]>

  // Memory
  searchMemories(params): Promise<MemoryItem[]>
  storeMemory(memory): Promise<void>
}
```

### Hybrid Adapter

```typescript
class HybridOpenFangAdapter {
  // Initialization
  initialize(): Promise<void>

  // Task dispatch
  dispatch(task, strategy?): Promise<string>

  // Hands management
  activateHand(handName): Promise<void>
  getHandStatus(handName): Promise<HandStatus>
  listHands(): string[]

  // Health
  health(): Promise<{ status: string; available: boolean }>
}
```

## Error Handling

All operations use automatic retry with exponential backoff:

- **Max Retries**: 3
- **Base Delay**: 1 second
- **Backoff**: Exponential (2^n)
- **Non-Retryable**: 4xx errors (except 429), auth errors (401, 403)

```typescript
try {
  await adapter.activateHand("researcher")
} catch (error) {
  if (error instanceof OpenFangErrors.ConnectionFailed) {
    // Handle connection failure
  } else if (error instanceof OpenFangErrors.HandNotActive) {
    // Handle inactive hand
  }
}
```

## Testing

```bash
# Run integration tests
bun test src/integration/*.test.ts

# Run specific test
bun test src/integration/hands.test.ts
```

## Debugging

Enable debug logging:

```typescript
import { Log } from "@opencode-ai/util/log"
Log.setLevel("DEBUG")
```

Check OpenFang service health:

```bash
curl http://localhost:4200/api/health
```

## Performance

### Expected Latencies

| Operation                | Latency |
| ------------------------ | ------- |
| Agent Spawn              | <200ms  |
| Hand Activation          | <500ms  |
| Task Dispatch (simple)   | <100ms  |
| Task Dispatch (workflow) | <1s     |
| Memory Sync              | <100ms  |

### Benchmarks

Run benchmarks:

```bash
bun run benchmark:integration
```

## Limitations

1. **WASM Support**: Not yet implemented (future enhancement)
2. **Offline Mode**: Requires OpenFang service running
3. **Channel Integration**: Manual configuration required
4. **Audit Trail**: Separate logging systems (to be unified)

## Security

- API key authentication (optional but recommended)
- HTTPS for production deployments
- Credential vault for sensitive data
- Audit logging for all operations
- Path traversal protection
- SSRF protection

## Troubleshooting

### "Connection refused"

Ensure OpenFang service is running:

```bash
./target/release/openfang start
```

### "Hand not found"

Check available hands:

```bash
curl http://localhost:4200/api/hands
```

### "Permission denied"

Verify API key configuration and agent capabilities.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Implement changes
4. Write tests
5. Submit PR

## License

MIT

## Resources

- [OpenFang GitHub](https://github.com/RightNow-AI/openfang)
- [OpenFang Documentation](https://openfang.sh/docs)
- [OpenFang Discord](https://discord.gg/sSJqgNnq6X)
