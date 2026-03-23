# OpenCode Claw - Project Context

## Project Overview

**OpenCode** is an open-source AI coding agent with self-evolving capabilities. Unlike traditional AI assistants that reset each session, OpenCode maintains persistent memory across sessions, enabling long-term consistency and continuous self-improvement.

### Core Differentiators

| Feature | Traditional AI | OpenCode |
|---------|---------------|----------|
| Session Memory | Lost after conversation | Permanent, searchable |
| Pattern Learning | None | Auto-detects reusable patterns |
| Skill Development | Manual setup only | Auto-generates SKILL.md files |
| Failure Learning | Repeats mistakes | Negative memory prevents repetition |
| Project Understanding | Starts fresh | Hierarchical code memory |
| Self-Improvement | None | Continuous evolution |

### Key Capabilities

- **Self-Evolving Agent System**: Three-layer evolution (prompt optimization, skill generation, memory enhancement)
- **Three-Layer Memory**: Session, Evolution, and Project memory with vector-based semantic search
- **Negative Memory System**: Tracks failures to prevent repeated mistakes
- **Multi-Agent Architecture**: build, plan, explore, and custom agents with different permissions
- **Plugin System**: QQ Bot, Slack, iMessage, and custom plugin SDK
- **Multiple Interfaces**: TUI, Desktop (Tauri), Web, Console
- **20+ AI Providers**: Anthropic, OpenAI, Google, Azure, Bedrock, and more

---

## Tech Stack

- **Runtime**: Bun 1.3+
- **Language**: TypeScript 5.8.2
- **Type Checking**: `tsgo` (TypeScript native preview)
- **Build System**: Turborepo
- **Database**: SQLite with Drizzle ORM + sqlite-vec for vector search
- **Web Framework**: Hono (API server)
- **Frontend**: SolidJS, Kobalte (UI components)
- **Desktop**: Tauri
- **Documentation**: Astro
- **AI SDK**: Vercel AI SDK 5.x
- **Observability**: OpenTelemetry (Jaeger, Grafana, Prometheus)

---

## Project Structure

```
opencodeclaw/
├── packages/
│   ├── opencode/          # Core CLI & server (main package)
│   ├── plugin/            # Plugin SDK (@opencode-ai/plugin)
│   ├── plugin-qqbot/      # QQ Bot integration
│   ├── sdk/js/            # TypeScript/JavaScript SDK
│   ├── util/              # Shared utilities
│   ├── script/            # Build scripts
│   ├── function/          # Cloud functions
│   ├── identity/          # Logos and branding
│   └── docs/              # Documentation
├── deploy/
│   └── observability/     # Docker compose for OTel stack
├── docs/                  # Additional documentation
├── .github/               # GitHub workflows and templates
└── script/                # Repository scripts
```

### Core Package Structure (`packages/opencode/src/`)

```
src/
├── acp/              # Agent Client Protocol (IDE integration)
├── agent/            # Multi-agent system
├── auth/             # Authentication
├── cli/              # Command-line interface
├── collab/           # Multi-agent collaboration
├── command/          # Command system
├── config/           # Configuration handling
├── evolution/        # Self-evolution system
├── learning/         # Knowledge graph, hierarchical memory, vector store
├── mcp/              # Model Context Protocol integration
├── memory/           # Three-level memory system
├── observability/    # OpenTelemetry X-Ray Mode
├── provider/         # AI provider integrations
├── server/           # Hono-based API server
├── session/          # Session management
├── skill/            # Dynamic skill system
├── tool/             # Tool definitions and execution
└── index.ts          # Entry point
```

---

## Development Setup

### Requirements

- **Bun**: 1.3+
- **Node.js**: 22.x (via Bun)
- **Rust**: Required for Tauri desktop builds

### Installation

```bash
# Install dependencies
bun install

# Build all packages
bun turbo build
```

---

## Key Commands

### Development

```bash
# Root level
bun dev                    # Start CLI dev server
bun typecheck              # Type check all packages (tsgo)
bun test                   # Run tests (from packages/opencode)
bun lint                   # Run lint checks
bun format                 # Format with Prettier

# Per-package development
cd packages/opencode
bun dev                    # CLI development
bun test                   # Run tests
bun test src/foo.test.ts   # Single test file
bun test --timeout 30000   # Tests with extended timeout

cd packages/plugin
bun build                  # Build plugin package

cd packages/sdk/js
bun run build              # Generate SDK from OpenAPI spec
```

### Database (Drizzle)

```bash
# From packages/opencode
bun run db generate --name <slug>   # Generate migration
bun run db                          # Run drizzle-kit
```

### Building

```bash
# All packages
bun turbo build

# Single package
cd packages/opencode && bun build

# Standalone executable
./packages/opencode/script/build.ts --single
```

### Observability Stack

```bash
cd deploy/observability
docker-compose up -d

# Access dashboards
# Jaeger: http://localhost:16686
# Grafana: http://localhost:3000
```

---

## Architecture Highlights

### Self-Evolution System

Three-layer architecture for continuous improvement:

1. **Prompt Self-Optimization**: Analyzes sessions, generates improvements
2. **Skill Dynamic Generation**: Auto-creates SKILL.md files from patterns
3. **Memory Enhancement**: Extracts learnings, cross-session recognition

### Learning → Evolution Feedback Loop

The learning system can now **propose and apply modifications** to evolution artifacts:

```
Learning Analysis → EvolutionAnalyzer → Issue Detection
                         ↓
              ModificationProposal → Human Review → Apply
                         ↓
              Evolution Updated → Knowledge Graph
```

**Components:**
- `EvolutionAnalyzer`: Analyzes prompts, skills, memories for issues
- `LearningToEvolutionModifier`: Creates and applies modification proposals
- `LearningFeedbackLoop`: Orchestrates the complete feedback cycle

**Issue Types Detected:**
- `prompt_redundant`, `prompt_outdated`, `prompt_ineffective`
- `skill_unused`, `skill_code_quality`
- `memory_duplicate`, `memory_stale`, `memory_contradiction`

**Usage:**
```typescript
import { LearningFeedbackLoop } from "./src/learning"

const feedbackLoop = new LearningFeedbackLoop(projectDir, {
  autoGenerateProposals: true,
  minSeverity: "medium",
  requireHumanReview: true,
})

await feedbackLoop.initialize()
const result = await feedbackLoop.runCycle()
```

### Memory System

- **Session Memory**: Ephemeral context for current session
- **Evolution Memory**: Long-term skills, constraints, patterns
- **Project Memory**: Knowledge graph with code entities

Storage: SQLite with `sqlite-vec` for vector embeddings

### Database Schema

- Tables/columns use **snake_case**
- Join columns: `<entity>_id`
- Indexes: `<table>_<column>_idx`
- Migrations: `packages/opencode/migration/<timestamp>_<slug>/`

### MCP (Model Context Protocol)

Configuration in `opencode.jsonc`:

```jsonc
{
  "mcp": {
    "remote-server": {
      "type": "remote",
      "url": "https://example.com/mcp",
      "oauth": { "clientId": "xxx" }
    },
    "local-server": {
      "type": "local",
      "command": ["node", "server.js"],
      "environment": { "API_KEY": "xxx" }
    }
  }
}
```

---

## Code Style Guidelines

### General Principles

- Keep logic in one function unless composable/reusable
- Avoid `try/catch` where possible (use Result types or early returns)
- Avoid `any` type; use precise types
- Prefer single-word variable names
- Use Bun APIs (`Bun.file()`, etc.)
- Rely on type inference; avoid explicit annotations unless necessary
- Prefer functional array methods (`flatMap`, `filter`, `map`) over loops

### Naming

```ts
// Good
const foo = 1
function journal(dir: string) {}
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const fooBar = 1
function prepareJournal(dir: string) {}
const journalPath = path.join(dir, "journal.json")
```

### Control Flow

```ts
// Good - early returns, no else
if (!condition) return
// continue logic

// Bad
if (condition) {
  // logic
} else {
  // else logic
}
```

### Imports Order

```ts
import { z } from "zod"                    // External libs
import { a } from "@opencode-ai/sdk"       // Workspace packages
import { b } from "../util"                // Local imports
import { c } from "./foo"
```

### SolidJS (packages/app, packages/ui)

- Prefer `createStore` over multiple `createSignal` calls
- CSS-first styling with custom properties

---

## Testing Practices

- Run tests from package directories, NOT repo root
- Avoid mocks; test actual implementations
- Use `--timeout 30000` for longer tests in `packages/opencode`
- Prefer integration tests over unit tests
- Descriptive test names explaining what is tested

```bash
bun test                           # All tests
bun test src/foo.test.ts           # Single file
bun test -t "pattern"              # Match pattern
bun test --timeout 30000           # Extended timeout
```

---

## Configuration

### opencode.jsonc (Project Config)

```jsonc
{
  "default_agent": "build",
  "evolution": {
    "enabled": true,
    "directions": ["code quality", "performance"],
    "sources": ["search", "arxiv", "github"],
    "maxItemsPerRun": 10,
    "cooldownHours": 24
  },
  "experimental": {
    "openTelemetry": true,
    "batch_tool": false,
    "mcp_timeout": 60000
  }
}
```

### Config Paths by OS

- **macOS**: `~/Library/Application Support/opencode/config/`
- **Linux**: `$XDG_CONFIG_HOME/opencode`
- **Windows**: `%APPDATA%/opencode`

---

## Important Notes

### Version Control

- Default branch: `v2`
- NEVER commit changes unless explicitly requested
- Run typecheck and tests before marking tasks complete
- Use `v2` or `opencodeclaw/v2` for diffs (local `main` may not exist)

### packages/desktop

- Never call `invoke` manually
- Use generated bindings from `packages/desktop/src/bindings.ts`

### packages/app (Web UI)

- NEVER restart the app or server process
- For local UI changes, run servers separately:
  ```bash
  # Backend (packages/opencode)
  bun run --conditions=browser ./src/index.ts serve --port 4096
  
  # App (packages/app)
  bun dev -- --port 4444
  
  # Open http://localhost:4444
  ```

### Output Language

- Prefer **en-US** for responses
- Do NOT translate code, CLI commands, file paths, or technical artifacts
- Preserve tool/system outputs verbatim

---

## Key Files

| File | Purpose |
|------|---------|
| `AGENTS.md` | Agent guidelines (build/test/lint, code style) |
| `CONTRIBUTING.md` | Contribution guidelines and PR expectations |
| `package.json` | Root workspace config with dependency catalog |
| `turbo.json` | Turborepo task configuration |
| `tsconfig.json` | TypeScript config (extends @tsconfig/bun) |
| `bunfig.toml` | Bun configuration |
| `opencode.jsonc` | OpenCode runtime configuration |

---

## Dependencies (Catalog)

Shared versions defined in root `package.json`:

| Package | Version |
|---------|---------|
| typescript | 5.8.2 |
| zod | 4.1.8 |
| drizzle-orm | 1.0.0-beta.12-a5629fb |
| ai | 5.0.124 |
| hono | 4.10.7 |
| shiki | 3.20.0 |
| remeda | 2.26.0 |
| luxon | 3.6.1 |

Use `catalog:` in package dependencies to reference these versions.

---

## Troubleshooting

### Debugging with Bun

```bash
# Run with inspector
bun run --inspect=ws://localhost:6499/ dev

# Wait for debugger
bun run --inspect-ws://localhost:6499/ dev

# Break on start
bun run --inspect-brk=ws://localhost:6499/ dev
```

For TUI debugging, use `bun dev spawn` instead of `bun dev` (server runs in worker thread).

### SDK Regeneration

After API/SDK changes:

```bash
./script/generate.ts
```

---

## Resources

- **Website**: https://opencode.ai
- **Discord**: https://opencode.ai/discord
- **npm**: https://www.npmjs.com/package/opencode-ai
- **GitHub**: https://github.com/nolan57/opencodeclaw
