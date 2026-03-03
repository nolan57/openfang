# OpenCode - Project Context

## Project Overview

**OpenCode** is an open-source AI-powered coding agent with self-evolving capabilities. It provides a full-featured terminal-based AI coding assistant with support for multiple agents, models, and plugin integrations.

### Key Features

- **Multiple Agents**: Switch between `build` (full-access) and `plan` (read-only) agents
- **Model Agnostic**: Works with Claude, OpenAI, Google, Anthropic, Azure, Amazon Bedrock, or local models
- **Plugin System**: Extensible architecture for QQ Bot, Slack, iMessage, and custom integrations
- **Self-Evolving**: Permanent memory, pattern learning, and skill retention across sessions
- **Multiple UIs**: Terminal UI (TUI), Desktop App, Web Interface, and Console App
- **Scheduler**: Built-in cron job support for automation

## Tech Stack

| Category | Technology |
|----------|------------|
| **Runtime** | Bun 1.3+ |
| **Language** | TypeScript 5.8+ |
| **Package Manager** | Bun |
| **Build Tool** | Turborepo |
| **Frontend** | SolidJS, TailwindCSS 4 |
| **Backend** | Hono, Drizzle ORM |
| **AI SDK** | Vercel AI SDK |
| **Desktop** | Tauri v2 |
| **Database** | SQLite (via Drizzle) |

## Project Structure

```
opencode/
├── packages/
│   ├── opencode/          # Core CLI application & server
│   ├── plugin/            # Plugin SDK and system
│   ├── plugin-qqbot/      # QQ Bot plugin implementation
│   ├── slack/             # Slack integration
│   ├── desktop/           # Tauri desktop application
│   ├── app/               # Shared web UI components
│   ├── web/               # Web interface
│   ├── console/           # Console app system
│   ├── sdk/               # Client SDKs (JS/TS)
│   ├── ui/                # Shared UI components
│   ├── util/              # Shared utilities
│   ├── function/          # Serverless functions
│   ├── script/            # Build and utility scripts
│   └── docs/              # Documentation
├── .github/               # GitHub workflows and templates
├── .opencode/             # OpenCode configuration
├── nix/                   # Nix package definitions
├── patches/               # Package patches
├── script/                # Root-level scripts
└── docs/                  # Additional documentation
```

## Building and Running

### Prerequisites

- **Bun 1.3+** (required)
- **Tauri dependencies** (for desktop app development)
- **Rust toolchain** (for desktop app builds)

### Installation

```bash
bun install
```

### Development Commands

| Command | Description |
|---------|-------------|
| `bun dev` | Start core CLI in development mode |
| `bun dev <directory>` | Run against a specific directory |
| `bun dev serve` | Start headless API server (port 4096) |
| `bun dev spawn` | Run server in main thread (for debugging) |
| `bun dev:web` | Start web app dev server |
| `bun dev:desktop` | Start Tauri desktop dev |
| `bun run build` | Build all packages (via Turbo) |
| `bun run typecheck` | Type check all packages |

### Package-Specific Commands

```bash
# Core CLI
bun run --cwd packages/opencode dev

# Web app (requires server running first)
bun run --cwd packages/app dev

# Desktop app
bun run --cwd packages/desktop tauri dev

# Build standalone executable
./packages/opencode/script/build.ts --single
```

### Debugging

For reliable debugging, run manually with inspect flag:

```bash
# Debug server
bun run --inspect=ws://localhost:6499/ --cwd packages/opencode ./src/index.ts serve --port 4096

# Debug TUI
bun run --inspect=ws://localhost:6499/ --cwd packages/opencode --conditions=browser ./src/index.ts
```

Export `BUN_OPTIONS=--inspect=ws://localhost:6499/` to avoid repeating the flag.

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `QQBOT_ENABLED` | Enable QQ Bot plugin |
| `QQBOT_APP_ID` | QQ Bot App ID |
| `QQBOT_CLIENT_SECRET` | QQ Bot Client Secret |
| `QQBOT_MARKDOWN_SUPPORT` | Enable Markdown in QQ messages |
| `SCHEDULER_ENABLED` | Enable scheduler |
| `OPENCODE_DISABLE_SHARE` | Disable usage sharing |

### opencode.json

```json
{
  "model": "claude-sonnet-4-20250514",
  "agent": "build",
  "plugin": ["@opencode-ai/plugin-qqbot"],
  "allow": ["**/*"],
  "deny": []
}
```

## Development Conventions

### Code Style

- **Functions**: Keep logic in one function unless composable
- **Destructuring**: Avoid unnecessary destructuring; use dot notation
- **Control Flow**: Avoid `else` statements; use early returns
- **Variables**: Prefer `const` over `let`; use ternaries
- **Types**: Avoid `any`; prefer type inference when possible
- **Error Handling**: Use `.catch()` instead of `try/catch` where possible
- **Naming**: Prefer concise single-word identifiers
- **Bun APIs**: Use `Bun.file()` and other Bun helpers

### Schema Definitions (Drizzle)

Use snake_case for field names:

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})
```

### Testing

- Tests **cannot** run from repo root (guard in `do-not-run-tests-from-root`)
- Run tests from package directories: `cd packages/opencode && bun test`
- Avoid mocks; test actual implementation
- Do not duplicate logic into tests

### Git Workflow

- Default branch is `dev` (not `main`)
- Local `main` may not exist; use `dev` or `origin/dev` for diffs

## SDK Regeneration

After making changes to the API or SDK:

```bash
# Regenerate JavaScript SDK
./packages/sdk/js/script/build.ts

# Or regenerate all SDKs
./script/generate.ts
```

## Plugin Development

### Plugin Architecture

Plugins use the `Plugin` function pattern returning `Hooks`:

```typescript
export const MyPlugin: Plugin = async (input: PluginInput) => {
  const { client, directory } = input
  
  // Plugin initialization
  
  return {
    tool: {
      // Custom tools
    },
  }
}
```

### Key Considerations

- Plugins run in browser-like environment (no Node.js-specific libraries like `ws`)
- Use native WebSocket instead of `ws` library
- Configuration via environment variables (not custom JSON fields)
- Use `client.session.prompt()` for message handling

## Pull Request Guidelines

### Requirements

- **Must reference an existing issue** (use `Fixes #123` or `Closes #123`)
- Keep PRs small and focused
- Explain the issue and how your change fixes it
- For UI changes: include screenshots/videos

### PR Title Format

Follow conventional commits with optional scope:

```
feat: add new feature
fix(opencode): resolve startup crash
docs: update contributing guidelines
chore: bump dependency versions
refactor: simplify message handling
```

### Verification

For non-UI changes, explain:
- What did you test?
- How can a reviewer verify the fix?

## Important Files

| File | Purpose |
|------|---------|
| `package.json` | Root workspace configuration |
| `turbo.json` | Turborepo task configuration |
| `tsconfig.json` | TypeScript configuration (extends @tsconfig/bun) |
| `bunfig.toml` | Bun configuration |
| `.editorconfig` | Editor style settings |
| `AGENTS.md` | Coding style guide |
| `CONTRIBUTING.md` | Contribution guidelines |
| `DEVELOPMENT.md` | Development setup details |

## Documentation

Additional documentation available in:

- `docs/` - Memory system, TUI design, plugin comparisons
- `packages/docs/` - User-facing documentation

## Common Issues

### Browser Environment

Plugins run in browser-like environment. Use native APIs:

```typescript
// Use native WebSocket
const ws = new WebSocket(url)
ws.onopen = () => { ... }

// NOT Node.js ws library
```

### Agent Selection

When using `client.session.prompt()`, omit the `agent` parameter to use server default:

```typescript
// Good
await client.session.prompt({ body: { parts: [...] } })

// May cause issues
await client.session.prompt({ body: { parts: [...], agent: "build" } })
```

### Test Execution

Tests cannot run from repo root. Always run from package directory:

```bash
# Wrong (from root)
bun test

# Correct
cd packages/opencode && bun test
```
