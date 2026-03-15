# OpenCode Agent Guidelines

This file provides instructions for agentic coding agents operating in this repository. It covers build/test/lint commands, code style guidelines, and repository-specific practices.

## 🔧 Development Commands

### Running Tests

**From package directories (NOT repo root):**

```bash
# packages/opencode
bun test                           # Run all tests
bun test src/foo.test.ts           # Run single test file
bun test -t "test name pattern"    # Run tests matching pattern
bun test --watch                   # Watch mode
bun test --timeout 30000           # For longer running tests

# packages/app
bun test                    # Run all unit tests
bun test:unit               # Run unit tests
bun test:unit:watch         # Watch mode
bun test:e2e                # E2E tests
bun test:e2e:local          # Local E2E
bun test:e2e:ui             # E2E with UI
bun test:e2e:report         # Show E2E report
```

### Type Checking

```bash
bun typecheck                          # Root (runs turbo)
bun typecheck                          # Per package (packages/opencode, packages/app)
```

Note: Uses `tsgo` (TypeScript native preview) for faster type checking.

### Linting & Formatting

```bash
# packages/opencode
bun run lint                           # Run lint checks (coverage tests)
bun run format                         # Format code with Prettier

# Root level uses Prettier (configured in package.json)
```

### Building

```bash
bun turbo build                        # All packages
bun build                              # Per package
```

### Database (Drizzle)

**packages/opencode:**

```bash
bun run db generate --name <slug>     # Generate migration
bun run db                             # Run drizzle-kit
```

**packages/console/core:**

```bash
bun run db-dev                        # Drizzle kit on dev stage
bun run db-prod                       # Drizzle kit on production stage
bun run shell-dev                     # SST shell on dev
bun run shell-prod                    # SST shell on production
bun run update-models                 # Update models
bun run promote-models-to-dev         # Promote models to dev
bun run promote-models-to-prod        # Promote models to production
bun run update-black                  # Update black list
bun run promote-black-to-dev          # Promote black list to dev
bun run promote-black-to-prod         # Promote black list to production
```

### Development

```bash
bun dev                 # Main CLI (packages/opencode)
bun dev:desktop         # Tauri desktop app
bun dev:web             # Web app (packages/app)

# packages/console/app
bun run dev             # Console web app
bun run dev:remote      # Console with remote auth

# packages/enterprise
bun run dev             # Enterprise web app
```

### SDK Generation

```bash
# From packages/sdk/js
bun run build           # Generate SDK from OpenAPI spec
```

## 📝 Code Style Guidelines

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference as much as possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream

### Naming

Prefer single word names for variables and functions. Only use multiple words if necessary. Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const foo = 1
function journal(dir: string) {}
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const fooBar = 1
function prepareJournal(dir: string) {}
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

### Control Flow

Avoid `else` statements. Prefer early returns.

### Imports

Order imports: external libs, workspace packages, local imports.

```ts
import { z } from "zod"
import { a } from "@opencode-ai/sdk"
import { b } from "../util"
import { c } from "./foo"
```

### Error Handling

Avoid try/catch when possible. Use Result types or early returns instead.

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

### SolidJS (packages/app, packages/ui)

- Always prefer `createStore` over multiple `createSignal` calls

## 🧪 Testing Practices

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root; run from package dirs like `packages/opencode`
- Use `--timeout 30000` for longer running tests in opencode package
- Prefer integration tests over unit tests when testing real implementations
- Use descriptive test names that explain what is being tested

## 🌐 Browser Automation (packages/app)

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes

## 📦 Package-Specific Notes

### packages/desktop

- Never call `invoke` manually in this package.
- Use the generated bindings in `packages/desktop/src/bindings.ts` for core commands/events.

### packages/opencode

- **Schema**: Drizzle schema lives in `src/**/*.sql.ts`.
- **Naming**: tables and columns use snake*case; join columns are `<entity>_id`; indexes are `<table>*<column>\_idx`.
- **Migrations**: generated by Drizzle Kit using `drizzle.config.ts` (schema: `./src/**/*.sql.ts`, output: `./migration`).
- **Output**: creates `migration/<timestamp>_<slug>/migration.sql` and `snapshot.json`.
- **Tests**: migration tests should read the per-folder layout (no `_journal.json`).
- **Language**: Generate all documentation in English by default.
- **MCP**: Full MCP (Model Context Protocol) integration with OAuth support. See `src/mcp/` for implementation.
- **Evolution**: Self-evolution system with knowledge graph and hierarchical memory. See `src/learning/` and `src/evolution/`.
- **ACP**: Agent Client Protocol support for IDE integration. See `src/acp/`.
- **Collab**: Multi-agent collaboration system. See `src/collab/`.
- **Memory**: Three-level memory system (session, evolution, project) with code analysis. See `src/memory/`.
- **Observability**: OpenTelemetry-based X-Ray Mode for tracing and debugging. See `src/observability/`. **Requires `experimental.openTelemetry: true` in opencode.json** - OTEL env vars alone are not sufficient for AI SDK traces.

### packages/app

- NEVER try to restart the app, or the server process, EVER.
- `opencode dev web` proxies `https://app.opencode.ai`, so local UI/CSS changes will not show there.
- For local UI changes, run the backend and app dev servers separately:
  - Backend (from `packages/opencode`): `bun run --conditions=browser ./src/index.ts serve --port 4096`
  - App (from `packages/app`): `bun dev -- --port 4444`
  - Open `http://localhost:4444` to verify UI changes (it targets the backend at `http://localhost:4096`).

### packages/ui

- Shared UI component library built with SolidJS and Kobalte.
- CSS-first styling with CSS custom properties for theming.
- Includes `TraceVisualizer` component for observability traces.
- See `packages/ui/AGENTS.md` for detailed component architecture.

## 🔗 Integrations

### MCP (Model Context Protocol)

MCP enables extensible tool capabilities. Configuration in `opencode.json`:

```json
{
  "mcp": {
    "my-server": {
      "type": "remote",
      "url": "https://example.com/mcp"
    },
    "local-server": {
      "type": "local",
      "command": ["node", "server.js"],
      "environment": { "API_KEY": "xxx" }
    }
  }
}
```

For OAuth-enabled servers:

```json
{
  "mcp": {
    "oauth-server": {
      "type": "remote",
      "url": "https://example.com/mcp",
      "oauth": {
        "clientId": "your-client-id"
      }
    }
  }
}
```

### Slack (packages/slack)

Slack integration using `@slack/bolt`. Run with `bun run dev` from the package directory.

### QQ Bot (packages/plugin-qqbot)

QQ Bot plugin for controlling OpenCode via QQ messages.

### Web Docs (packages/web)

Astro-based documentation site. Run with `bun run dev` from the package directory.

### Zed Extension (packages/extensions/zed)

IDE extension for Zed editor. Contains extension configuration and icons.

## 📦 Workspace Dependencies

This project uses Bun workspaces with a catalog for shared dependency versions. Key catalogs are defined in the root `package.json` under `workspaces.catalog`.

Use `catalog:` to reference catalog versions in package dependencies:

```json
{
  "dependencies": {
    "zod": "catalog:",
    "typescript": "catalog:"
  }
}
```

## 🚀 Evolution System

The evolution system enables self-improvement through:

- **Knowledge Graph**: Stores learned concepts and relationships (`src/learning/knowledge-graph.ts`)
- **Hierarchical Memory**: Multi-level memory with module summaries (`src/learning/hierarchical-memory.ts`)
- **Safety**: Cooldown periods and human review requirements (`src/learning/safety.ts`)
- **Skills**: Dynamically loaded capabilities that can be proposed and approved
- **Vector Store**: Semantic search and similarity (`src/learning/vector-store.ts`)

Configuration in `opencode.json`:

```json
{
  "evolution": {
    "enabled": true,
    "directions": ["code quality", "performance optimization"],
    "sources": ["web", "github"]
  }
}
```

## 🧠 Memory System

Three-level memory architecture:

- **Session Memory**: Temporary memories tied to a specific session
- **Evolution Memory**: Long-term memories from self-evolution processes
- **Project Memory**: Project-specific knowledge and patterns

Memory supports:

- Vector-based semantic search
- Tag-based categorization
- Metadata attachment
- Similarity scoring
- Code entity extraction via `CodeAnalyzer` (AST-based analysis for .ts/.tsx/.js/.jsx files)

## 👥 Collaboration System

Multi-agent collaboration system (`src/collab/`):

- **Coordinator**: Orchestrates multi-agent workflows
- **Registry**: Agent registration and discovery
- **Events**: Inter-agent event bus
- **Schema**: Collaboration data models

## 👁️ Observability System (X-Ray Mode)

OpenTelemetry-based observability for tracing and debugging (`src/observability/`):

### Components

- **init.ts**: Core initialization and configuration
- **spans.ts**: Span definitions for various operations
- **instrumented-critic.ts**: Instrumented critic evaluations
- **instrumented-self-refactor.ts**: Instrumented self-refactoring
- **instrumented-skill-sandbox.ts**: Instrumented skill sandbox execution
- **instrumented-hierarchical-memory.ts**: Instrumented memory operations
- **scheduler-context-fix.ts**: Context propagation for scheduled tasks

### Deployment

Observability stack in `deploy/observability/`:

- `docker-compose.yml`: OTel Collector, Prometheus, Grafana, Jaeger
- `otel-collector-config.yaml`: OTel Collector configuration
- `prometheus.yml`: Prometheus scrape config
- `grafana-provisioning/`: Grafana dashboards and datasources

### UI Components

- `TraceVisualizer` in `packages/ui/src/components/observability/` for visualizing traces

## 🗄️ Database Migrations

Migrations are stored in `packages/opencode/migration/` with per-folder layout:

- `20260127222353_familiar_lady_ursula/`
- `20260211171708_add_project_commands/`
- `20260213144116_wakeful_the_professor/`
- `20260304111115_learning_safety/`
- `20260304224737_vector_memory/`
- `20260308061812_knowledge_graph/`
- `20260310000000_collab_system/`

Each migration folder contains `migration.sql` and `snapshot.json`.

## ⚙️ Config Paths

- **macOS**: `~/Library/Application Support/opencode/config/` (defined in `src/global/index.ts`)
- **Linux**: `$XDG_CONFIG_HOME/opencode`
- **Windows**: `%APPDATA%/opencode`
- Old path `~/.config/opencode/` is deprecated but docs may still reference it.

## 🔁 Version Control Practices

- NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked.
- When making significant code changes, run typecheck and tests before considering the task complete.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.
- The default branch in this repo is `v2`.
- Local `main` ref may not exist; use `v2` or `opencodeclaw/v2` for diffs.
