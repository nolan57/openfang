# OpenCode

<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo" width="200">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent - Enhanced with <strong>self-evolving</strong> capabilities.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

---

## The Unique Advantage: Self-Evolution & Long-Term Consistency

OpenCode is not just another AI coding assistant. It is designed to **remember, learn, and improve** over time, establishing true long-term consistency across sessions, projects, and conversations.

### What Makes OpenCode Different?

| Feature                    | Traditional AI Assistants    | OpenCode                                     |
| -------------------------- | ---------------------------- | -------------------------------------------- |
| **Session Memory**         | Lost after conversation ends | Permanent, searchable memories               |
| **Pattern Learning**       | None                         | Auto-detects and preserves reusable patterns |
| **Skill Development**      | Manual setup only            | Auto-generates skills from usage             |
| **Failure Learning**       | Repeats same mistakes        | Negative memory prevents repeated failures   |
| **Codebase Understanding** | Starts fresh each time       | Hierarchical memory of project structure     |
| **Self-Improvement**       | None                         | Continuous prompt/skill/memory evolution     |

---

## Core Features

### 🤖 Self-Evolving Agent System

The heart of OpenCode's uniqueness - a three-layer evolution system:

```
┌─────────────────────────────────────────────────────────────┐
│                    Self-Evolving Agent                        │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Prompt Self-Optimization                          │
│  • Analyzes session interactions                            │
│  • Generates prompt improvements                            │
│  • Stores optimized prompts for future use                  │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Skill Dynamic Generation                          │
│  • Detects reusable task patterns                           │
│  • Auto-generates SKILL.md files                            │
│  • Requires approval before activation                     │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Memory Enhancement                               │
│  • Extracts learnings from sessions                         │
│  • Cross-session pattern recognition                        │
│  • Relevance-based memory retrieval                         │
└─────────────────────────────────────────────────────────────┘
```

**What it does:**

- After each session, automatically reflects on success/failure
- Identifies reusable patterns and generates new skills
- Extracts memories that persist across sessions
- Uses vector embeddings for semantic search

### 🧠 Permanent Memory System

- **Long-term consistency**: Memories persist across sessions
- **Semantic search**: Vector-based similarity matching
- **Multi-level**: Session, project, and global memory tiers
- **Hierarchical Code Memory**: Understands project structure with module-level summaries

### ⚠️ Negative Memory (Anti-Pattern Learning)

The system that prevents repeated failures:

```typescript
// Records failures to avoid repeating them
negativeMemory.recordFailure({
  failure_type: "install_failed",
  description: "npm install timeout",
  context: { url: "..." },
  severity: 3,
})
```

- Tracks failed approaches (installation, skills, performance)
- Increments severity on repeated failures
- Blocks similar attempts above threshold
- Provides actionable recommendations based on failure history

### 📚 Learning from External Sources

Periodically learns from the web:

- **Multi-source collection**: Web search, arXiv papers, GitHub
- **Smart analysis**: Value scoring (0-100), tag extraction
- **Auto-installation**: High-value items become skills
- **Code suggestions**: Generates improvement proposals

### 🔧 Skill System

- **Reusable prompts**: SKILL.md format with metadata
- **Auto-discovery**: Scans multiple directories
- **Dynamic generation**: Creates skills from usage patterns
- **Approval workflow**: Human-in-the-loop for new skills

### 💻 Multi-Agent Architecture

- **build**: Full-access agent for code execution
- **plan**: Read-only agent for review
- **explore**: Fast agent for codebase exploration
- **custom**: User-defined agents with permissions

### 🌐 Plugin System

Extensible integrations for communication platforms:

- **QQ Bot**: Tencent QQ messaging
- **Slack**: Workspace integration
- **iMessage**: macOS support
- **Custom**: Plugin SDK for any platform

### 🎨 Multiple Interfaces

- **TUI**: Rich terminal interface
- **Desktop**: Native app (macOS/Windows/Linux)
- **Web**: Browser-based access
- **Console**: Server management

### 🔌 Multi-Provider Support

Works with 20+ AI providers:

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
npm i -g opencode-ai@latest        # or bun/pnpm/yarn
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

# List available commands
opencode --help
```

---

## Project Structure

```
packages/
├── opencode/           # Core CLI application
├── plugin/            # Plugin SDK and system
├── plugin-qqbot/      # QQ Bot plugin
├── slack/             # Slack integration
├── desktop/           # Desktop application
├── web/               # Web interface
├── console/           # Console app system
├── app/               # Main application
├── enterprise/        # Enterprise features
├── ui/                # Shared UI components
├── sdk/               # Client SDK
└── util/              # Utilities
```

---

## Architecture Deep Dive

### Evolution Data Flow

```
Session Complete
      │
      ▼
┌─────────────┐
│  Integration│ ─── Extracts tool calls & success status
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

```
Sessions
  └─ Messages
       └─ Parts (text, tool calls, reasoning)

Knowledge Graph
  └─ Nodes + Edges (relationships)

Vector Memory
  ├─ content    (general knowledge)
  ├─ code       (codebase understanding)
  ├─ constraint (rules, limits)
  ├─ character (personality)
  └─ scene     (context)

Negative Memory
  ├─ failure_type
  ├─ severity
  └─ blocked_items

Evolution Store
  ├─ prompts.json
  ├─ skills.json
  └─ memories.json
```

---

## Configuration

```json
{
  "model": "claude-sonnet-4-20250514",
  "agent": "build",
  "learning": {
    "enabled": true,
    "schedule": {
      "cron": "0 10 * * 1,3,5",
      "idle_check": true
    },
    "sources": ["search", "arxiv", "github"]
  }
}
```

---

## Documentation

- [Self-Evolving Agent Framework](./packages/opencode/SELF_EVOLVING_AGENT.md)
- [Memory System](./docs/memory-system-comparison.md)
- [Code Indexer Skill](./packages/opencode/skills/code-indexer/SKILL.md)

---

## Building from Source

```bash
# Install dependencies
bun install

# Build
bun run build

# Development
bun run dev
```

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

20+ providers including:

- Anthropic (Claude)
- OpenAI (GPT-4/4o)
- Google (Gemini)
- Azure OpenAI
- Amazon Bedrock
- OpenRouter
- Local models via compatible APIs

---

**Community**: [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)

<p align="center">Built with ❤️ by the OpenCode community</p>
