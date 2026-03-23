# OpenCode

<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/identity/logo/opencode-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/identity/logo/opencode-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/identity/logo/opencode-light.svg" alt="OpenCode" width="200">
    </picture>
  </a>
</p>

<p align="center">
  <strong>The open-source AI coding agent with self-evolving capabilities.</strong>
</p>

<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord"></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square"></a>
  <a href="https://github.com/nolan57/opencodeclaw/actions/workflows/opencode.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/nolan57/opencodeclaw/opencode.yml?style=flat-square"></a>
</p>

---

## Overview

OpenCode is an AI coding agent designed to **remember, learn, and improve** over time. Unlike traditional AI assistants that start fresh each session, OpenCode builds persistent memory across sessions, enabling true long-term consistency and continuous self-improvement.

### Key Differentiators

| Feature | Traditional AI Assistants | OpenCode |
|---------|--------------------------|----------|
| **Session Memory** | Lost after conversation | Permanent, searchable |
| **Pattern Learning** | None | Auto-detects reusable patterns |
| **Skill Development** | Manual setup only | Auto-generates skills |
| **Failure Learning** | Repeats mistakes | Negative memory prevents repetition |
| **Project Understanding** | Starts fresh each time | Hierarchical code memory |
| **Self-Improvement** | None | Continuous evolution |

---

## Features

### 🤖 Self-Evolving Agent System

A three-layer evolution system that continuously improves:

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
│  Layer 3: Memory Enhancement                                │
│  • Extracts learnings from sessions                         │
│  • Cross-session pattern recognition                       │
│  • Relevance-based memory retrieval                         │
└─────────────────────────────────────────────────────────────┘
```

### 🧠 Three-Layer Memory Architecture

- **Session Memory**: Ephemeral context for current session
- **Evolution Memory**: Long-term skills, constraints, learned patterns
- **Project Memory**: Knowledge graph with code entities and relationships

### ⚠️ Negative Memory System

Prevents repeated failures by tracking what didn't work:

```typescript
negativeMemory.recordFailure({
  failure_type: "install_failed",
  description: "npm install timeout",
  context: { url: "..." },
  severity: 3,
})
```

### 📚 Learning from External Sources

- Web search, arXiv papers, GitHub integration
- Auto-scoring and tag extraction
- High-value items become skills automatically

### 🔧 Skill System

- SKILL.md format with metadata
- Auto-discovery across multiple directories
- Approval workflow for new skills

### 💻 Multi-Agent Architecture

- **build**: Full-access agent for code execution
- **plan**: Read-only agent for review
- **explore**: Fast agent for codebase exploration
- **custom**: User-defined agents with permissions

### 🌐 Plugin System

- QQ Bot (Tencent messaging)
- Slack integration
- iMessage support (macOS)
- Plugin SDK for custom platforms

### 🎨 Multiple Interfaces

- **TUI**: Rich terminal interface
- **Desktop**: Native app (Tauri)
- **Web**: Browser-based access
- **Console**: Server management

### 🔌 Multi-Provider Support

20+ AI providers including:

- Anthropic (Claude)
- OpenAI (GPT-4/4o)
- Google (Gemini)
- Azure OpenAI
- Amazon Bedrock
- And more...

---

## Installation

```bash
# Quick install
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # npm
bun add -g opencode-ai@latest       # bun
pnpm add -g opencode-ai@latest     # pnpm
brew install anomalyco/tap/opencode # macOS/Linux
scoop install opencode              # Windows
```

---

## Quick Start

```bash
# Run with a prompt
opencode "Create a REST API for user management"

# Continue a conversation
opencode -c

# Start ACP server (Agent Client Protocol)
opencode acp

# List MCP servers
opencode mcp list

# Evolution commands
opencode evolve list              # List skills
opencode evolve status            # Show system status
opencode evolve approve <id>       # Approve skill proposal
```

---

## Project Structure

```
packages/
├── opencode/           # Core CLI application
├── app/               # Main SolidJS web application
├── desktop/           # Tauri desktop application
├── console/          # Console web application
├── enterprise/       # Enterprise features
├── ui/               # Shared UI components
├── plugin/           # Plugin SDK
├── plugin-qqbot/     # QQ Bot plugin
├── slack/            # Slack integration
├── sdk/              # JavaScript/TypeScript SDK
├── function/         # Cloud functions
├── util/             # Utilities
├── identity/         # Logos and assets
├── web/              # Documentation site
└── containers/       # Docker configurations
```

---

## Architecture

### Data Flow

```
Session Complete
      │
      ▼
┌─────────────┐
│ Integration │ ─── Extracts tool calls & success status
└─────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│                    Evolution Layers                          │
├─────────────────────────────────────────────────────────────┤
│ Prompt   │ Analyzes → Generates suggestions → Saves        │
│ Skill    │ Detects patterns → Creates drafts → Approves   │
│ Memory   │ Extracts learnings → Stores → Retrieves         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
Vector Store (sqlite-vec)
      │
      ▼
Semantic Search for Future Sessions
```

### Database Schema

- **Sessions**: Messages, parts (text, tool calls, reasoning)
- **Knowledge Graph**: Nodes + Edges (relationships)
- **Vector Memory**: content, code, constraint, character, scene
- **Negative Memory**: failure_type, severity, blocked_items
- **Evolution Store**: prompts.json, skills.json, memories.json

---

## Configuration

Create `opencode.jsonc` in your project:

```jsonc
{
  "model": "claude-sonnet-4-20250514",
  "agent": "build",
  "mcp": {
    "server-name": {
      "type": "remote",
      "url": "https://example.com/mcp"
    }
  },
  "evolution": {
    "enabled": true,
    "directions": ["code quality", "performance optimization"],
    "sources": ["web", "github"]
  }
}
```

---

## Development

```bash
# Install dependencies
bun install

# Build all packages
bun turbo build

# Run tests
bun test                    # From package directory
bun test src/foo.test.ts    # Single file

# Type checking
bun typecheck               # Root or per package

# Development
bun run dev                 # CLI
bun run dev:desktop         # Desktop app
bun run dev:web             # Web app
```

---

## Observability

OpenCode includes an **X-Ray Mode** observability system for debugging:

```bash
cd deploy/observability
docker-compose up -d
```

- Jaeger UI: http://localhost:16686
- Grafana: http://localhost:3000

Features:
- Distributed tracing with OpenTelemetry
- Data lineage tracking (trace memory origins)
- Smart span truncation (prevent bloat)
- Background task context propagation

---

## Documentation

- [Architecture Specification](./SPEC.md)
- [Self-Evolving Agent](./packages/opencode/src/evolution/README.md)
- [Memory System](./docs/memory-system-comparison.md)
- [X-Ray Mode Guide](./docs/x-ray-mode-observability-guide.md)

---

## FAQ

### How is this different from Claude Code or Cursor?

OpenCode focuses on **long-term consistency** and **self-improvement**:

1. **Persistent Memory**: Remembers context across all sessions
2. **Self-Evolution**: Improves prompts, skills, and memories over time
3. **Negative Memory**: Learns from failures to avoid repeated mistakes
4. **Codebase Index**: Understands project structure semantically
5. **Plugin Ecosystem**: Extensible to any platform

### What models are supported?

20+ providers including Anthropic, OpenAI, Google, Azure, Bedrock, and more via the SDK.

---

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

**Community**: [Discord](https://discord.gg/opencode) | [X](https://x.com/opencode)

<p align="center">Built with ❤️ by the OpenCode community</p>