- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.
- NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked.
- When making significant code changes, run typecheck and tests before considering the task complete.

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
bun test:e2e:ui            # E2E with UI
```

### Type Checking

```bash
bun typecheck                          # Root (runs turbo)
bun typecheck                          # Per package (packages/opencode, packages/app)
```

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

### Database (Drizzle, packages/opencode)

```bash
bun run db generate --name <slug>     # Generate migration
bun run db                             # Run drizzle-kit
```

### Development

```bash
bun dev                 # Main CLI (packages/opencode)
bun dev:desktop         # Tauri desktop app
bun dev:web             # Web app (packages/app)
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

### SolidJS (packages/app)

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
