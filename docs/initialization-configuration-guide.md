# OpenCode Initialization & Configuration Guide

This document provides comprehensive instructions for initializing and configuring the three-layer memory system and multi-agent architecture in OpenCode.

---

## Table of Contents

1. [Overview](#overview)
2. [Configuration Files](#configuration-files)
3. [Environment Variables](#environment-variables)
4. [Three-Layer Memory System](#three-layer-memory-system)
5. [Multi-Agent Architecture](#multi-agent-architecture)
6. [Self-Evolution System](#self-evolution-system)
7. [Initialization Methods](#initialization-methods)
8. [CLI Commands](#cli-commands)
9. [Directory Structure](#directory-structure)
10. [Quick Start](#quick-start)

---

## Overview

OpenCode features a sophisticated architecture with:

- **Three-Layer Memory**: Session (ephemeral), Evolution (persistent), Project (knowledge graph)
- **Multi-Agent System**: Build, Plan, Explore, General, and custom agents
- **Self-Evolution**: Continuous improvement through prompt optimization, skill generation, and memory enhancement
- **Observability**: X-Ray Mode for distributed tracing

---

## Configuration Files

### Main Configuration: `opencode.jsonc`

Create this file in your project root. This is the primary configuration file.

```jsonc
{
  // === Basic Configuration ===
  "model": "claude-sonnet-4-20250514",
  "default_agent": "build",
  "theme": "catppuccin",

  // === Agent Configuration ===
  "agent": {
    "build": {
      "model": { "providerID": "anthropic", "modelID": "claude-sonnet-4-20250514" },
      "temperature": 0.7,
      "steps": 100
    },
    "plan": {
      "model": { "providerID": "anthropic", "modelID": "claude-sonnet-4-20250514" },
      "permission": { "denied": ["Edit", "Write"] }
    },
    "explore": {
      "model": { "providerID": "openai", "modelID": "gpt-4o" }
    }
  },

  // === Self-Evolution System ===
  "evolution": {
    "enabled": true,
    "directions": [
      "AI",
      "code generation",
      "agent systems",
      "Self-evolution",
      "Long-range consistency"
    ],
    "sources": ["search", "arxiv", "github"],
    "maxItemsPerRun": 10,
    "cooldownHours": 24
  },

  // === MCP Servers ===
  "mcp": {
    "server-name": {
      "type": "remote",
      "url": "https://example.com/mcp"
    }
  },

  // === Experimental Features ===
  "experimental": {
    "openTelemetry": true,
    "batch_tool": false,
    "mcp_timeout": 60000
  },

  // === Provider Configuration ===
  "provider": {
    "openai": {
      "apiKey": { "env": "OPENAI_API_KEY" }
    }
  }
}
```

### Global Configuration: `~/.config/opencode/opencode.jsonc`

User-level configuration that applies to all projects.

```jsonc
{
  "model": "anthropic/claude-sonnet-4-20250514",
  "autoupdate": true,
  "share": "manual"
}
```

### Local Configuration: `.opencode/opencode.jsonc`

Project-specific overrides located in `.opencode/` directory.

---

## Environment Variables

### Core Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENCODE_CONFIG` | Custom config file path | `/path/to/config.jsonc` |
| `OPENCODE_CONFIG_CONTENT` | Inline config JSON | `{"model": "..."}` |
| `OPENCODE_DISABLE_PROJECT_CONFIG` | Disable project config | `true` |
| `OPENCODE_CONFIG_DIR` | Custom .opencode directory | `/path/to/.opencode` |
| `OPENCODE_TEST_HOME` | Test home directory | `/tmp/test-home` |

### Provider API Keys

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GOOGLE_API_KEY` | Google AI API key |
| `AWS_BEARER_TOKEN_BEDROCK` | AWS Bedrock authentication |

### Observability (X-Ray Mode)

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_ENABLED` | `true` | Enable/disable observability |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318/v1/traces` | OTel Collector endpoint |
| `OTEL_SAMPLE_RATE` | `1.0` (dev) / `0.01` (prod) | Trace sampling rate |
| `OTEL_MAX_EVENT_PAYLOAD_SIZE` | `5000` | Max span event payload bytes |
| `NODE_ENV` | `development` | Environment (development/production) |

### Server Configuration

| Variable | Description |
|----------|-------------|
| `OPENCODE_SERVER_PASSWORD` | TUI connection password |
| `OPENCODE_CONTROL_TOKEN` | Control API token |
| `HTTP_PROXY` / `HTTPS_PROXY` | Proxy settings |

---

## Three-Layer Memory System

### Architecture

```
MemoryService
    │
    ├── SessionMemoryService (Ephemeral)
    │   └── SQLite + TTL, auto-cleanup on expiration
    │
    ├── EvolutionMemoryService (Long-term)
    │   └── Vector Store (sqlite-vec)
    │       - Skills
    │       - Constraints
    │       - Learned Patterns
    │
    └── ProjectMemoryService (Knowledge Graph)
        └── Knowledge Graph + Vector
            - Code Entities
            - File Relations
            - API Graph
```

### Memory Types

| Type | Lifecycle | Storage | Use Case |
|------|-----------|---------|----------|
| **Session** | Session-bound | SQLite + Vector | Current conversation context |
| **Evolution** | Permanent | Vector Store | Skills, constraints, patterns |
| **Project** | Project-bound | Knowledge Graph | Codebase understanding |

### Configuration

The memory system is automatically initialized on first use. No manual configuration required.

```typescript
// Programmatic access (optional)
import { Memory, MemoryService } from "./memory"

// First call auto-initializes
await Memory.init()

// Search memories
const results = await Memory.search({ query: "typescript", limit: 5 })

// Access individual layers
Memory.getSessionService()    // SessionMemoryService
Memory.getEvolutionService()  // EvolutionMemoryService
Memory.getProjectService()    // ProjectMemoryService
```

---

## Multi-Agent Architecture

### Default Agents

| Agent | Mode | Description |
|-------|------|-------------|
| **build** | primary | Default agent with full tool permissions |
| **plan** | primary | Planning mode (read-only, no edit tools) |
| **explore** | subagent | Fast code exploration |
| **general** | subagent | Multi-step general tasks |
| **compaction** | hidden | Context compression |
| **title** | hidden | Session title generation |
| **summary** | hidden | Session summarization |

### Agent Configuration Schema

```typescript
interface Agent {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  model?: {
    modelID: string
    providerID: string
  }
  temperature?: number
  topP?: number
  prompt?: string
  permission: PermissionRuleset
  steps?: number      // Max iterations
  hidden?: boolean
  color?: string
}
```

### Creating Custom Agents

Create `.opencode/agents/*.md` files:

```markdown
---
name: my-agent
description: Custom agent for specific tasks
mode: subagent
model:
  providerID: anthropic
  modelID: claude-sonnet-4-20250514
temperature: 0.7
permission:
  allowed:
    - Read
    - Search
  denied:
    - Bash
    - Edit
---

You are a specialized code review agent...
```

---

## Self-Evolution System

### Three-Layer Evolution

```
┌─────────────────────────────────────────────────────────────┐
│                    Self-Evolving Agent                        │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Prompt Self-Optimization                          │
│  • Analyzes session interactions                            │
│  • Generates prompt improvements                            │
│  • Stores optimized prompts for future use                  │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Skill Dynamic Generation                         │
│  • Detects reusable task patterns                          │
│  • Auto-generates SKILL.md files                           │
│  • Requires approval before activation                     │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Memory Enhancement                               │
│  • Extracts learnings from sessions                        │
│  • Cross-session pattern recognition                       │
│  • Relevance-based memory retrieval                        │
└─────────────────────────────────────────────────────────────┘
```

### Configuration

```jsonc
{
  "evolution": {
    "enabled": true,
    "directions": [
      "AI",
      "code generation",
      "agent systems"
    ],
    "sources": ["search", "arxiv", "github"],
    "maxItemsPerRun": 10,
    "cooldownHours": 24
  }
}
```

### Programmatic Initialization

```typescript
import { createSelfEvolutionScheduler } from "./learning/self-evolution-scheduler"

const scheduler = createSelfEvolutionScheduler(projectDir, {
  enabled: true,
  scanIntervalMs: 24 * 60 * 60 * 1000,  // Daily
  requireHumanReview: true,
  autoFixPatterns: ["console_log", "TODO"],
  maxAutoFixPerRun: 10
})

scheduler.start()
```

---

## Initialization Methods

### Lazy Initialization (Recommended)

The system uses lazy initialization - services start on first use:

```typescript
// Memory auto-initializes on first call
const results = await Memory.search({ query: "..." })

// Agent auto-initializes on first use
await Agent.init()
```

### Explicit Initialization

```typescript
import { initObservability } from "./observability"
import { Memory } from "./memory"
import { Agent } from "./agent/agent"

// Initialize observability (X-Ray Mode)
initObservability({
  serviceName: "opencode-agent",
  serviceVersion: "1.0.0",
  environment: process.env.NODE_ENV || "development"
})

// Explicit memory initialization
await Memory.init()

// Explicit agent initialization
await Agent.init()
```

---

## CLI Commands

### Evolution Management

```bash
# List artifacts (skills, memories)
opencode evolve list

# Show system status
opencode evolve status

# List pending approvals
opencode evolve pending

# Approve/reject skills
opencode evolve approve <id>
opencode evolve reject <id>

# List learned memories
opencode evolve memories
```

### Self-Evolution

```bash
# Scan for code issues
opencode evolve scan

# Auto-fix issues
opencode evolve fix

# Code statistics
opencode evolve stats

# Build module summaries
opencode evolve summaries build

# Search summaries
opencode evolve summaries search <query>

# Generate project overview
opencode evolve overview
```

### MCP (Model Context Protocol)

```bash
# List MCP servers
opencode mcp list

# Add MCP server
opencode mcp add

# Authenticate with MCP server
opencode mcp auth <name>

# List auth status
opencode mcp auth list
```

### ACP (Agent Client Protocol)

```bash
# Start ACP server
opencode acp

# With custom working directory
opencode acp --cwd <directory>
```

---

## Directory Structure

```
project-root/
├── opencode.jsonc          # Project configuration
├── .opencode/               # Local configuration (optional)
│   ├── agents/
│   │   └── *.md            # Custom agents
│   ├── commands/
│   │   └── *.md            # Custom commands
│   ├── plugins/
│   │   └── *.ts            # Custom plugins
│   └── opencode.jsonc       # Local overrides
├── src/                     # Source code
└── ...other project files

~/.config/opencode/          # User configuration
└── opencode.jsonc           # Global settings
```

---

## Quick Start

### 1. Minimal Configuration

Create `opencode.jsonc` in project root:

```jsonc
{
  "evolution": {
    "enabled": true
  }
}
```

### 2. Set API Key

```bash
# Linux/macOS
export ANTHROPIC_API_KEY=sk-...

# Windows (PowerShell)
$env:ANTHROPIC_API_KEY="sk-..."
```

### 3. Run OpenCode

```bash
# Basic usage
opencode "Create a REST API for user management"

# Continue conversation
opencode -c

# Start ACP server
opencode acp
```

### 4. Enable X-Ray Mode (Optional)

```bash
# Start observability stack
cd deploy/observability
docker-compose up -d

# Access Jaeger
# http://localhost:16686
```

---

## Configuration Precedence

Configuration is loaded in the following order (lowest to highest priority):

1. Remote `.well-known/opencode` (organization defaults)
2. Global config `~/.config/opencode/opencode.jsonc`
3. Custom config (`OPENCODE_CONFIG`)
4. Project config `opencode.jsonc`
5. `.opencode/` directory config
6. Inline config (`OPENCODE_CONFIG_CONTENT`)
7. Managed config directory (enterprise, highest priority)

---

## Troubleshooting

### Memory Not Persisting

- Ensure write permissions on project directory
- Check SQLite database location in logs

### Evolution Not Working

- Verify `"evolution": { "enabled": true }` in config
- Check `evolution.directions` and `evolution.sources` are configured

### Agents Not Initializing

- Verify agent configuration in `opencode.jsonc`
- Check `.opencode/agents/` directory for custom agents

### X-Ray Mode Not Working

- Ensure Docker is running
- Verify `OTEL_ENABLED=true`
- Check Jaeger connectivity at http://localhost:16686

---

## Additional Resources

- [Architecture Specification](./SPEC.md)
- [X-Ray Mode Guide](./docs/x-ray-mode-observability-guide.md)
- [Memory System Comparison](./docs/memory-system-comparison.md)
