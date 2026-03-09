- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.
- NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked.
- When making significant code changes, run typecheck and tests before considering the task complete.

## Project Structure

```
packages/
├── app/           # SolidJS web app (main UI)
├── console/       # Console sub-packages (app, core, mail, resource, function)
│   ├── app/       # Console web app
│   ├── core/      # Core logic with DB scripts
│   ├── mail/      # Email handling
│   └── resource/  # Resources
├── desktop/       # Tauri desktop app
├── docs/          # Documentation
├── enterprise/    # Enterprise web app
├── extensions/    # IDE extensions (zed)
├── function/      # Cloud functions
├── opencode/      # Main CLI package
├── plugin/        # Plugin SDK
├── plugin-qqbot/  # QQ Bot plugin
├── script/        # Build scripts
├── sdk/           # JavaScript SDK
├── slack/         # Slack integration
├── ui/            # Shared UI components
├── util/          # Shared utilities
└── web/           # Astro docs site
```

## Commands

### Running Tests

**From repo root (NOT allowed):**

```bash
bun test  # Will fail with "do not run tests from root"
```

**From package directories:**

```bash
# packages/opencode
bun test                           # Run all tests
bun test src/foo.test.ts           # Run single test file
bun test -t "test name pattern"    # Run tests matching pattern
bun test --watch                   # Watch mode

# packages/app
bun test                    # Run all unit tests
bun test:unit               # Run unit tests
bun test:unit:watch         # Watch mode
bun test:e2e                # E2E tests
bun test:e2e:local          # Local E2E
bun test:e2e:ui             # E2E with UI
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

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
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

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root; run from package dirs like `packages/opencode`
- Use `--timeout 30000` for longer running tests in opencode package
- Prefer integration tests over unit tests when testing real implementations
- Use descriptive test names that explain what is being tested

## Browser Automation (packages/app)

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes

## Packages Notes

### packages/desktop

- Never call `invoke` manually in this package.
- Use the generated bindings in `packages/desktop/src/bindings.ts` for core commands/events.

### packages/opencode

- **Schema**: Drizzle schema lives in `src/**/*.sql.ts`.
- **Naming**: tables and columns use snake_case; join columns are `<entity>_id`; indexes are `<table>_<column>_idx`.
- **Migrations**: generated by Drizzle Kit using `drizzle.config.ts` (schema: `./src/**/*.sql.ts`, output: `./migration`).
- **Output**: creates `migration/<timestamp>_<slug>/migration.sql` and `snapshot.json`.
- **Tests**: migration tests should read the per-folder layout (no `_journal.json`).
- **Language**: Generate all documentation in English by default.

### packages/app

- NEVER try to restart the app, or the server process, EVER.
- `opencode dev web` proxies `https://app.opencode.ai`, so local UI/CSS changes will not show there.
- For local UI changes, run the backend and app dev servers separately:
  - Backend (from `packages/opencode`): `bun run --conditions=browser ./src/index.ts serve --port 4096`
  - App (from `packages/app`): `bun dev -- --port 4444`
  - Open `http://localhost:4444` to verify UI changes (it targets the backend at `http://localhost:4096`).

## Integrations

### Slack (packages/slack)

Slack integration using `@slack/bolt`. Run with `bun run dev` from the package directory.

### QQ Bot (packages/plugin-qqbot)

QQ Bot plugin for controlling OpenCode via QQ messages.

### Web Docs (packages/web)

Astro-based documentation site. Run with `bun run dev` from the package directory.

## Workspace Dependencies

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