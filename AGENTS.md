# OpenCode Agent Guidelines

This file provides instructions for agentic coding agents operating in this repository.

## 🔧 Development Commands

**Run all commands from package directories (NOT repo root), unless noted.**

### Tests

```bash
bun test                           # Run all tests
bun test src/foo.test.ts           # Run single test file
bun test -t "pattern"              # Run tests matching pattern
bun test --watch                   # Watch mode
bun test --timeout 30000           # Longer running tests
```

Root shortcuts: `bun test`, `bun test:unit`, `bun test:e2e`, `bun test:live`, `bun test:coverage`

### Type Check, Lint, Format

```bash
bun typecheck                      # Root (turbo) or per-package (uses tsgo)
bun run lint                       # Lint checks (packages/opencode)
bun run format                     # Prettier format
```

### Build & Dev

```bash
bun turbo build                    # All packages
bun build                          # Per package
bun dev                            # Main CLI
bun dev:desktop                    # Tauri desktop
bun dev:web                        # Web app
```

### Database (Drizzle)

```bash
bun run db generate --name <slug>  # Generate migration (packages/opencode)
bun run db                         # Run drizzle-kit
```

Schema: `src/**/*.sql.ts` | Migrations: `migration/<timestamp>_<slug>/`
Naming: snake*case for tables/columns; indexes: `<table>*<column>\_idx`

## 📝 Code Style

### Principles

- Rely on type inference; avoid explicit annotations unless needed for exports/clarity
- Avoid `any`, `try/catch`, and `else` — use Result types and early returns
- Prefer `const` over `let`; use ternaries instead of reassignment
- Prefer single-word variable/function names; inline single-use values
- Use Bun APIs when possible (`Bun.file()`, etc.)
- Prefer functional array methods (flatMap, filter, map) over for loops

### Naming

```ts
// Good
const foo = 1
function journal(dir: string) {}
const journal = await Bun.file(path.join(dir, "journal.json")).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

### Imports

Order: external libs → workspace packages → local imports

```ts
import { z } from "zod"
import { a } from "@opencode-ai/sdk"
import { b } from "../util"
import { c } from "./foo"
```

### SolidJS (packages/app, packages/ui)

- Always prefer `createStore` over multiple `createSignal` calls
- CSS-first styling with custom properties

## 🧪 Testing

- Avoid mocks; test actual implementation
- Prefer integration tests over unit tests
- Use descriptive test names explaining what is being tested
- Tests cannot run from repo root; run from package dirs

## 📦 Package Notes

### packages/opencode

- MCP, ACP, Collab, Evolution, Memory systems in `src/`
- Observability requires `experimental.openTelemetry: true` in opencode.json
- Three-level memory: session, evolution, project

### packages/app

- NEVER restart the app or server process
- Local dev: Backend `bun run --conditions=browser ./src/index.ts serve --port 4096`, App `bun dev -- --port 4444`

### packages/desktop

- Never call `invoke` manually; use `packages/desktop/src/bindings.ts`

## 🔗 Workspace Dependencies

Use `catalog:` for shared dependency versions:

```json
{ "dependencies": { "zod": "catalog:", "typescript": "catalog:" } }
```

## ⚙️ Config Paths

- **macOS**: `~/Library/Application Support/opencode/config/`
- **Linux**: `$XDG_CONFIG_HOME/opencode`
- **Windows**: `%APPDATA%/opencode`

## 🔁 Version Control

- NEVER commit unless explicitly asked
- Run typecheck and tests before considering tasks complete
- Default branch: `v2` (local `main` may not exist)
