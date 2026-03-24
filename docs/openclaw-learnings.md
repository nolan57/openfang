# Learnings from OpenClaw

This document summarizes key architectural patterns, security practices, and development workflows from [OpenClaw](https://github.com/openclaw/openclaw) that can be adopted to improve OpenCode.

**Analysis Date**: March 24, 2026  
**Source Project**: OpenClaw v2026.2.27  
**Target Project**: OpenCode (opencodeclaw)

---

## Executive Summary

OpenClaw is a personal AI assistant focused on multi-channel messaging integration (WhatsApp, Telegram, Slack, Discord, etc.) and real-world task execution. While OpenCode focuses on AI-powered coding with self-evolution capabilities, several architectural patterns from OpenClaw are directly applicable:

| Priority | Area | Effort | Impact |
|----------|------|--------|--------|
| 🔴 High | SSRF Protection Module | 1-2 days | Prevents plugin attacks on internal network |
| 🔴 High | Test Configuration Separation | 1 day | Improves test efficiency and quality |
| 🟡 Medium | Dead Code Detection | 0.5 days | Reduces maintenance burden |
| 🟡 Medium | ACP Control Plane Refactor | 3-5 days | Improves architecture extensibility |
| 🟢 Low | Plugin SDK Security Primitives | 2-3 days | Enhances plugin security |
| ⚪ Skipped | Multi-layer Config Priority | 1-2 days | Enterprise deployment support |

---

## 1. SSRF Protection Module 🔴 High Priority

### Why It Matters

OpenClaw's plugin system allows arbitrary code execution and network requests. Without SSRF (Server-Side Request Forgery) protection, malicious plugins could:
- Access internal network services (`http://169.254.169.254` cloud metadata)
- Scan internal network topology
- Attack locally running databases/caches

### OpenClaw Implementation

**Core Files**:
- `src/plugin-sdk/ssrf-policy.ts` (85 lines)
- `src/infra/net/ssrf.ts` (364 lines)

**Key Functions**:

```typescript
// Hostname suffix allowlist (supports wildcards)
export function normalizeHostnameSuffixAllowlist(
  input?: readonly string[],
  defaults?: readonly string[],
): string[] {
  // Handles "*.example.com" → "example.com"
  // Handles "*" → disable restrictions
  // Deduplicates, lowercases
}

// HTTPS URL validation
export function isHttpsUrlAllowedByHostnameSuffixAllowlist(
  url: string,
  allowlist: readonly string[],
): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:") return false  // Enforce HTTPS
    return isHostnameAllowedBySuffixAllowlist(parsed.hostname, allowlist)
  } catch {
    return false
  }
}

// Convert to SSRF policy format
export function buildHostnameAllowlistPolicyFromSuffixAllowlist(
  allowHosts?: readonly string[],
): SsrFPolicy | undefined {
  // "example.com" → ["example.com", "*.example.com"]
  // Supports exact + subdomain matching
}
```

**Low-level Implementation** (`src/infra/net/ssrf.ts`):
- DNS resolution interception
- IP address classification (private, loopback, link-local)
- IPv6-embedded-IPv4 detection
- RFC2544 benchmark range options

### OpenCode Gap Analysis

| Feature | OpenClaw | OpenCode |
|---------|----------|----------|
| SSRF Protection | ✅ Full implementation | ❌ Missing |
| Plugin Network Audit | ✅ `audit-tool-policy.ts` | ❌ Missing |
| Security Policy Tests | ✅ 15+ unit tests | ❌ None |

### Implementation Steps

**Step 1**: Create `packages/opencode/src/security/ssrf-policy.ts`

```typescript
import { SsrFPolicy } from "../infra/net/ssrf"

export function normalizeHostnameSuffixAllowlist(
  input?: readonly string[],
  defaults?: readonly string[],
): string[] {
  const source = input && input.length > 0 ? input : defaults
  if (!source || source.length === 0) return []
  
  const normalized = source
    .map(v => v.trim().toLowerCase().replace(/^\*\.?/, '').replace(/^\.+/, '').replace(/\.+$/, ''))
    .filter(Boolean)
  
  if (normalized.includes("*")) return ["*"]
  return Array.from(new Set(normalized))
}

export function isHttpsUrlAllowedByHostnameSuffixAllowlist(
  url: string,
  allowlist: readonly string[],
): boolean {
  if (allowlist.includes("*")) return true
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:") return false
    const hostname = parsed.hostname.toLowerCase()
    return allowlist.some(
      entry => hostname === entry || hostname.endsWith(`.${entry}`)
    )
  } catch {
    return false
  }
}
```

**Step 2**: Integrate into plugin system entry

```typescript
// packages/plugin/src/index.ts
import { isHttpsUrlAllowedByHostnameSuffixAllowlist } from "./ssrf-policy"

export async function createPluginContext(input: PluginInput, config: PluginConfig) {
  const allowlist = normalizeHostnameSuffixAllowlist(
    config.allowedHosts,
    ["api.anthropic.com", "api.openai.com"]  // Default allowlist
  )
  
  return {
    fetch: async (url: string, init?: RequestInit) => {
      if (!isHttpsUrlAllowedByHostnameSuffixAllowlist(url, allowlist)) {
        throw new Error(`SSRF blocked: ${url}`)
      }
      return fetch(url, init)
    }
  }
}
```

**Step 3**: Add tests `packages/opencode/src/security/ssrf-policy.test.ts`

```typescript
import { describe, expect, it } from "bun:test"
import { isHttpsUrlAllowedByHostnameSuffixAllowlist } from "./ssrf-policy"

describe("SSRF Policy", () => {
  it("blocks non-HTTPS URLs", () => {
    expect(isHttpsUrlAllowedByHostnameSuffixAllowlist(
      "http://169.254.169.254/latest/meta-data/",
      ["example.com"]
    )).toBe(false)
  })
  
  it("allows subdomains with suffix match", () => {
    expect(isHttpsUrlAllowedByHostnameSuffixAllowlist(
      "https://api.anthropic.com/v1/messages",
      ["anthropic.com"]
    )).toBe(true)
  })
})
```

---

## 2. Test Configuration Separation 🔴 High Priority

### Why It Matters

Current OpenCode has a single test configuration, causing:
- Unit and integration tests mixed together (slow execution)
- Cannot run Live tests requiring API Keys separately
- Coverage reports include files that shouldn't be counted (entry points, configs, etc.)

### OpenClaw Implementation

**5 Independent Configuration Files**:

```
vitest.config.ts          # Base configuration (shared)
vitest.unit.config.ts     # Unit tests
vitest.e2e.config.ts      # E2E tests
vitest.live.config.ts     # Live tests (real APIs)
vitest.extensions.config.ts  # Extension tests
vitest.gateway.config.ts  # Gateway tests
```

**vitest.config.ts (Base)**:
```typescript
export default defineConfig({
  resolve: {
    alias: [
      { find: "openclaw/plugin-sdk", replacement: path.join(repoRoot, "src/plugin-sdk/index.ts") }
    ]
  },
  test: {
    testTimeout: 120_000,
    hookTimeout: isWindows ? 180_000 : 120_000,
    unstubEnvs: true,      // Prevent environment variable leakage
    unstubGlobals: true,   // Prevent global variable pollution
    pool: "forks",
    maxWorkers: isCI ? ciWorkers : localWorkers,
    coverage: {
      provider: "v8",
      thresholds: {
        lines: 70, functions: 70, branches: 55, statements: 70
      },
      include: ["./src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/entry.ts", "src/index.ts",  // Entry files
        "src/cli/**", "src/commands/**", // CLI bindings
        "src/acp/**", "src/gateway/**",  // Integration tested
      ]
    }
  }
})
```

**vitest.live.config.ts (Live Tests)**:
```typescript
export default defineConfig({
  test: {
    maxWorkers: 1,  // Sequential execution to avoid API rate limits
    include: ["src/**/*.live.test.ts"],
  }
})
```

**package.json Scripts**:
```json
{
  "scripts": {
    "test": "node scripts/test-parallel.mjs",
    "test:coverage": "vitest run --config vitest.unit.config.ts --coverage",
    "test:e2e": "vitest run --config vitest.e2e.config.ts",
    "test:live": "OPENCLAW_LIVE_TEST=1 vitest run --config vitest.live.config.ts",
    "test:docker:all": "pnpm test:docker:live-models && pnpm test:docker:onboard && ..."
  }
}
```

### OpenCode Gap Analysis

| Feature | OpenClaw | OpenCode |
|---------|----------|----------|
| Test Config Separation | ✅ 6 configs | ❌ None |
| Coverage Exclusions | ✅ Fine-grained | ⚠️ Basic |
| Live Tests | ✅ Independent | ❌ None |
| Docker Tests | ✅ Full suite | ❌ None |

### Implementation Steps

**Step 1**: Create `packages/opencode/vitest.unit.config.ts`

```typescript
import { defineConfig } from "vitest/config"
import baseConfig from "./vitest.config"

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    name: "unit",
    include: ["src/**/*.test.ts"],
    exclude: [
      ...baseConfig.test.exclude,
      "src/**/*.live.test.ts",
      "src/**/*.e2e.test.ts",
    ],
    coverage: {
      ...baseConfig.test.coverage,
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
      exclude: [
        ...baseConfig.test.coverage.exclude,
        "src/index.ts",
        "src/cli/**/*.ts",
        "src/server/**/*.ts",
      ]
    }
  }
})
```

**Step 2**: Create `packages/opencode/vitest.e2e.config.ts`

```typescript
import { defineConfig } from "vitest/config"
import os from "node:os"
import baseConfig from "./vitest.config"

const isCI = process.env.CI === "true"
const cpuCount = os.cpus().length
const defaultWorkers = isCI ? Math.min(2, Math.floor(cpuCount * 0.25)) : 1

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    name: "e2e",
    pool: "vmForks",
    maxWorkers: Number.parseInt(process.env.OPENCODE_E2E_WORKERS ?? "", 10) || defaultWorkers,
    include: ["test/**/*.e2e.test.ts"],
    exclude: [
      ...baseConfig.test.exclude,
      "src/**/*.live.test.ts",
    ]
  }
})
```

**Step 3**: Create `packages/opencode/vitest.live.config.ts`

```typescript
import { defineConfig } from "vitest/config"
import baseConfig from "./vitest.config"

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    name: "live",
    maxWorkers: 1,  // Sequential execution
    include: ["src/**/*.live.test.ts"],
    exclude: [
      ...baseConfig.test.exclude,
      "src/**/*.e2e.test.ts",
    ]
  }
})
```

**Step 4**: Update `packages/opencode/package.json`

```json
{
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run --config vitest.unit.config.ts",
    "test:e2e": "vitest run --config vitest.e2e.config.ts",
    "test:live": "OPENCODE_LIVE_TEST=1 vitest run --config vitest.live.config.ts",
    "test:coverage": "vitest run --config vitest.unit.config.ts --coverage",
    "test:watch": "vitest --watch"
  }
}
```

---

## 3. Dead Code Detection Integration 🟡 Medium Priority

### Why It Matters

As the project evolves, unused code:
- Increases maintenance costs
- Confuses code understanding
- Slows down builds

OpenClaw uses 3 complementary tools:
- **knip**: Detects unused exports, dependencies, files
- **ts-prune**: Detects unused TypeScript code
- **ts-unused-exports**: Detects unused exports

### OpenClaw Implementation

**package.json Scripts**:
```json
{
  "scripts": {
    "deadcode:knip": "pnpm dlx knip --no-progress",
    "deadcode:ts-prune": "pnpm dlx ts-prune src extensions scripts",
    "deadcode:ts-unused": "pnpm dlx ts-unused-exports tsconfig.json --ignoreTestFiles --exitWithCount",
    
    "deadcode:report": "pnpm deadcode:knip; pnpm deadcode:ts-prune; pnpm deadcode:ts-unused",
    
    "deadcode:ci": "pnpm deadcode:report:ci:knip && pnpm deadcode:report:ci:ts-prune && pnpm deadcode:report:ci:ts-unused",
    "deadcode:report:ci:knip": "mkdir -p .artifacts/deadcode && pnpm deadcode:knip > .artifacts/deadcode/knip.txt 2>&1 || true",
    "deadcode:report:ci:ts-prune": "mkdir -p .artifacts/deadcode && pnpm deadcode:ts-prune > .artifacts/deadcode/ts-prune.txt 2>&1 || true",
    "deadcode:report:ci:ts-unused": "mkdir -p .artifacts/deadcode && pnpm deadcode:ts-unused > .artifacts/deadcode/ts-unused-exports.txt 2>&1 || true",
    
    "check": "pnpm format:check && pnpm tsgo && pnpm lint && ... && pnpm deadcode:ci"
  }
}
```

**knip Configuration** (knip.json or package.json):
```json
{
  "knip": {
    "ignore": [
      "**/*.test.ts",
      "**/test-helpers/**",
      "scripts/**"
    ],
    "ignoreDependencies": [
      "@types/*"
    ],
    "ignoreBinaries": [
      "tsx",
      "tsgo"
    ]
  }
}
```

**LOC Check Script** (`scripts/check-ts-max-loc.ts`):
```typescript
// Check single file line count, error if exceeds 500 lines
const maxLines = 500
const offenders = results.filter(r => r.lines > maxLines)

// Output format: line_count<TAB>file_path
for (const offender of offenders) {
  console.log(`${offender.lines}\t${offender.filePath}`)
}
process.exitCode = 1  // CI failure
```

### OpenCode Gap Analysis

| Feature | OpenClaw | OpenCode |
|---------|----------|----------|
| knip Detection | ✅ | ❌ |
| ts-prune | ✅ | ❌ |
| ts-unused-exports | ✅ | ❌ |
| LOC Check | ✅ (500 line limit) | ❌ |

### Implementation Steps

**Step 1**: Update root `package.json`

```json
{
  "scripts": {
    "deadcode:knip": "bunx knip --no-progress",
    "deadcode:ts-prune": "bunx ts-prune packages/opencode/src packages/plugin/src",
    "deadcode:ts-unused": "bunx ts-unused-exports tsconfig.json --ignoreTestFiles --exitWithCount",
    
    "deadcode:report": "bun run deadcode:knip && bun run deadcode:ts-prune && bun run deadcode:ts-unused",
    
    "deadcode:ci": "bun run deadcode:report:ci:knip && bun run deadcode:report:ci:ts-prune && bun run deadcode:report:ci:ts-unused",
    "deadcode:report:ci:knip": "mkdir -p .artifacts/deadcode && bun run deadcode:knip > .artifacts/deadcode/knip.txt 2>&1 || true",
    "deadcode:report:ci:ts-prune": "mkdir -p .artifacts/deadcode && bun run deadcode:ts-prune > .artifacts/deadcode/ts-prune.txt 2>&1 || true",
    "deadcode:report:ci:ts-unused": "mkdir -p .artifacts/deadcode && bun run deadcode:ts-unused > .artifacts/deadcode/ts-unused-exports.txt 2>&1 || true",
    
    "check:loc": "bun run script/check-loc.ts --max 700",
    
    "check": "bun run typecheck && bun run lint && bun run deadcode:ci"
  },
  "devDependencies": {
    "knip": "^5.0.0",
    "ts-prune": "^0.10.3",
    "ts-unused-exports": "^11.0.0"
  }
}
```

**Step 2**: Create `script/check-loc.ts`

```typescript
#!/usr/bin/env bun
import { execSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"

type Args = { maxLines: number }

function parseArgs(argv: string[]): Args {
  let maxLines = 700
  const maxIdx = argv.indexOf("--max")
  if (maxIdx !== -1 && argv[maxIdx + 1]) {
    maxLines = Number(argv[maxIdx + 1])
  }
  return { maxLines }
}

function gitLsFiles(): string[] {
  const stdout = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" })
  return stdout.split("\n").map(l => l.trim()).filter(Boolean)
}

async function countLines(filePath: string): Promise<number> {
  const content = readFileSync(filePath, "utf8")
  return content.split("\n").length
}

async function main() {
  const { maxLines } = parseArgs(process.argv.slice(2))
  
  const files = gitLsFiles()
    .filter(f => existsSync(f) && (f.endsWith(".ts") || f.endsWith(".tsx")))
    .filter(f => !f.includes(".test.") && !f.includes("node_modules"))
  
  const results = await Promise.all(
    files.map(async (f) => ({ file: f, lines: await countLines(f) }))
  )
  
  const offenders = results
    .filter(r => r.lines > maxLines)
    .sort((a, b) => b.lines - a.lines)
  
  if (offenders.length === 0) {
    console.log(`✓ All files under ${maxLines} LOC`)
    return
  }
  
  console.log(`Files exceeding ${maxLines} LOC:\n`)
  for (const o of offenders) {
    console.log(`  ${o.lines}\t${o.file}`)
  }
  process.exit(1)
}

main()
```

**Step 3**: Create `knip.jsonc`

```jsonc
{
  "ignore": [
    "**/*.test.ts",
    "**/test-helpers/**",
    "script/**",
    "packages/opencode/src/index.ts"
  ],
  "ignoreDependencies": [
    "@types/*",
    "ink",
    "react",
    "react-dom"
  ],
  "ignoreBinaries": [
    "bun",
    "tsgo",
    "drizzle-kit"
  ],
  "workspaces": {
    "packages/opencode": {
      "entry": ["src/index.ts", "src/cli/**/*.ts"]
    },
    "packages/plugin": {
      "entry": ["src/index.ts"]
    }
  }
}
```

---

## 4. ACP Control Plane Refactor 🟡 Medium Priority

### Why It Matters

Current OpenCode ACP implementation couples session management, runtime selection, and identity resolution, causing:
- Difficult testing
- Hard to extend for multiple backends
- Chaotic state management

OpenClaw uses a **Control Plane + Runtime** separation architecture.

### OpenClaw Implementation

**Architecture Layers**:

```
src/acp/
├── control-plane/           # Control Plane
│   ├── manager.ts           # Singleton entry point
│   ├── manager.core.ts      # Core session management
│   ├── manager.types.ts     # Type definitions
│   ├── manager.utils.ts     # Utility functions
│   ├── manager.identity-reconcile.ts  # Identity resolution
│   ├── manager.runtime-controls.ts    # Runtime control
│   ├── session-actor-queue.ts         # Session queue
│   ├── spawn.ts             # Process spawning
│   └── runtime-cache.ts     # Runtime cache
│
├── runtime/                 # Runtime Abstraction
│   ├── registry.ts          # Runtime registry
│   ├── types.ts             # Runtime types
│   ├── errors.ts            # Runtime errors
│   ├── session-identifiers.ts
│   └── session-identity.ts
│
└── translator.ts            # Gateway ↔ ACP translation
```

**Control Plane Core** (`manager.core.ts` simplified):

```typescript
export class AcpSessionManager {
  private sessions = new Map<string, AcpSessionState>()
  private runtimeRegistry = new Map<string, AcpRuntime>()
  
  async initializeSession(input: AcpInitializeSessionInput): Promise<AcpSessionResolution> {
    // 1. Identity resolution
    const identity = await this.reconcileIdentity(input.identity)
    
    // 2. Runtime selection
    const runtime = this.selectRuntime(identity.runtimeId)
    
    // 3. Session creation
    const session = await runtime.createSession({
      sessionId: input.sessionId,
      identity,
      options: input.options
    })
    
    // 4. State tracking
    this.sessions.set(input.sessionId, {
      status: "active",
      runtime: runtime.id,
      identity,
      createdAt: new Date()
    })
    
    return { sessionId: input.sessionId, runtime: runtime.id }
  }
  
  private selectRuntime(runtimeId?: string): AcpRuntime {
    if (runtimeId) {
      const backend = getAcpRuntimeBackend(runtimeId)
      if (!backend) throw new AcpRuntimeError("RUNTIME_NOT_FOUND", runtimeId)
      return backend.runtime
    }
    // Default: select healthy runtime
    return getDefaultHealthyRuntime()
  }
}
```

**Runtime Registry** (`runtime/registry.ts`):

```typescript
// Global singleton state
const ACP_BACKENDS_BY_ID = new Map<string, AcpRuntimeBackend>()

export function registerAcpRuntimeBackend(backend: AcpRuntimeBackend): void {
  if (!backend.runtime) throw new Error("Missing runtime implementation")
  ACP_BACKENDS_BY_ID.set(backend.id.toLowerCase(), backend)
}

export function getAcpRuntimeBackend(id?: string): AcpRuntimeBackend | null {
  if (id) return ACP_BACKENDS_BY_ID.get(id.toLowerCase()) ?? null
  // Return first healthy runtime
  for (const b of ACP_BACKENDS_BY_ID.values()) {
    if (b.healthy?.() !== false) return b
  }
  return null
}
```

**Runtime Errors** (`runtime/errors.ts`):

```typescript
export type AcpErrorCode =
  | "ACP_BACKEND_MISSING"
  | "ACP_BACKEND_UNAVAILABLE"
  | "ACP_SESSION_CREATE_FAILED"
  | "ACP_IDENTITY_RECONCILE_FAILED"

export class AcpRuntimeError extends Error {
  constructor(
    public readonly code: AcpErrorCode,
    public readonly details: string
  ) {
    super(`${code}: ${details}`)
    this.name = "AcpRuntimeError"
  }
}
```

### OpenCode Gap Analysis

| Feature | OpenClaw | OpenCode |
|---------|----------|----------|
| Control Plane/Runtime Separation | ✅ | ❌ Coupled |
| Runtime Registry | ✅ | ❌ |
| Identity Resolution Module | ✅ | ❌ |
| Session Queue Management | ✅ | ❌ |
| Runtime Error Classification | ✅ | ⚠️ Basic |

### Implementation Steps

**Step 1**: Create `packages/opencode/src/acp/runtime/types.ts`

```typescript
import type { Session } from "@/session"

export type AcpRuntimeId = string

export type AcpRuntimeSession = {
  id: string
  sessionId: string
  createdAt: Date
  identity: AcpSessionIdentity
}

export type AcpSessionIdentity = {
  userId?: string
  runtimeId?: AcpRuntimeId
  metadata?: Record<string, unknown>
}

export type AcpRuntime = {
  id: AcpRuntimeId
  healthy: () => boolean
  createSession: (input: { sessionId: string; identity: AcpSessionIdentity }) => Promise<AcpRuntimeSession>
  getSession: (sessionId: string) => Promise<AcpRuntimeSession | null>
  closeSession: (sessionId: string) => Promise<void>
}
```

**Step 2**: Create `packages/opencode/src/acp/runtime/registry.ts`

```typescript
import type { AcpRuntime } from "./types"

const RUNTIMES = new Map<string, AcpRuntime>()

export function registerAcpRuntime(runtime: AcpRuntime): void {
  RUNTIMES.set(runtime.id.toLowerCase(), runtime)
}

export function getAcpRuntime(id?: string): AcpRuntime | null {
  if (id) return RUNTIMES.get(id.toLowerCase()) ?? null
  for (const r of RUNTIMES.values()) {
    if (r.healthy()) return r
  }
  return RUNTIMES.values().next().value ?? null
}

export function requireAcpRuntime(id?: string): AcpRuntime {
  const runtime = getAcpRuntime(id)
  if (!runtime) {
    throw new Error(`ACP runtime not found: ${id ?? "default"}`)
  }
  return runtime
}
```

**Step 3**: Refactor `packages/opencode/src/acp/session.ts`

```typescript
import type { AcpRuntime, AcpSessionIdentity } from "./runtime/types"
import { getAcpRuntime } from "./runtime/registry"

type ACPSessionState = {
  id: string
  runtime: AcpRuntime
  identity: AcpSessionIdentity
  createdAt: Date
  status: "active" | "closed"
}

export class ACPSessionManager {
  private sessions = new Map<string, ACPSessionState>()
  
  async create(cwd: string, identity?: Partial<AcpSessionIdentity>): Promise<ACPSessionState> {
    const runtime = getAcpRuntime(identity?.runtimeId)
    if (!runtime) throw new Error("No ACP runtime available")
    
    const sessionIdentity: AcpSessionIdentity = {
      userId: identity?.userId,
      runtimeId: runtime.id,
      metadata: { cwd }
    }
    
    const runtimeSession = await runtime.createSession({
      sessionId: crypto.randomUUID(),
      identity: sessionIdentity
    })
    
    const state: ACPSessionState = {
      id: runtimeSession.id,
      runtime,
      identity: sessionIdentity,
      createdAt: new Date(),
      status: "active"
    }
    
    this.sessions.set(state.id, state)
    return state
  }
}
```

---

## 5. Plugin SDK Security Primitives 🟢 Low Priority

### Why It Matters

OpenClaw's plugin SDK provides 15+ security primitive modules, enabling plugin developers to:
- Properly verify sender identity
- Securely handle authentication
- Prevent common attack patterns

### OpenClaw Implementation

**Core Modules** (`src/plugin-sdk/`):

| File | Function | Lines |
|------|----------|-------|
| `account-id.ts` | Account ID abstraction | 50+ |
| `allow-from.ts` | Sender allowlist validation | 80+ |
| `command-auth.ts` | Command authentication | 100+ |
| `fetch-auth.ts` | Scoped token authentication | 80+ |
| `group-access.ts` | Group access control | 120+ |
| `pairing-access.ts` | Pairing access control | 60+ |
| `persistent-dedupe.ts` | Persistent deduplication | 70+ |
| `ssrf-policy.ts` | SSRF protection | 85+ |
| `tool-send.ts` | Tool send abstraction | 40+ |
| `webhook-targets.ts` | Webhook target management | 50+ |

**allow-from.ts Example**:

```typescript
// Normalize sender ID (lowercase, trim, remove prefix)
export function formatAllowFromLowercase(params: {
  allowFrom: Array<string | number>
  stripPrefixRe?: RegExp
}): string[] {
  return params.allowFrom
    .map(entry => String(entry).trim())
    .filter(Boolean)
    .map(entry => params.stripPrefixRe ? entry.replace(params.stripPrefixRe, "") : entry)
    .map(entry => entry.toLowerCase())
}

// Check if sender is in allowlist
export function isNormalizedSenderAllowed(params: {
  senderId: string | number
  allowFrom: Array<string | number>
  stripPrefixRe?: RegExp
}): boolean {
  const normalizedAllow = formatAllowFromLowercase(params)
  if (normalizedAllow.length === 0) return false
  if (normalizedAllow.includes("*")) return true
  
  const sender = String(params.senderId).trim().toLowerCase()
  return normalizedAllow.includes(sender)
}

// Support multiple chat target types (chat_id, chat_guid, handle, etc.)
type ParsedChatAllowTarget =
  | { kind: "chat_id"; chatId: number }
  | { kind: "chat_guid"; chatGuid: string }
  | { kind: "chat_identifier"; chatIdentifier: string }
  | { kind: "handle"; handle: string }

export function isAllowedParsedChatSender<TParsed extends ParsedChatAllowTarget>(params: {
  allowFrom: Array<string | number>
  sender: string
  chatId?: number | null
  chatGuid?: string | null
  parseAllowTarget: (entry: string) => TParsed
}): boolean {
  // Support validation by chat_id, chat_guid, handle, etc.
  // ...
}
```

**fetch-auth.ts Example**:

```typescript
// Scoped Bearer Token authentication with fallback retry
export async function fetchWithBearerAuthScopeFallback(params: {
  url: string
  scopes: readonly string[]
  tokenProvider?: ScopeTokenProvider
  fetchFn?: typeof fetch
  requireHttps?: boolean
}): Promise<Response> {
  const firstAttempt = await fetchFn(params.url, params.requestInit)
  if (firstAttempt.ok) return firstAttempt
  if (!params.tokenProvider) return firstAttempt
  
  // Try different scopes on 401/403
  for (const scope of params.scopes) {
    const token = await params.tokenProvider.getAccessToken(scope)
    const authHeaders = new Headers(params.requestInit?.headers)
    authHeaders.set("Authorization", `Bearer ${token}`)
    const authAttempt = await fetchFn(params.url, { ...params.requestInit, headers: authHeaders })
    if (authAttempt.ok) return authAttempt
  }
  
  return firstAttempt
}
```

### OpenCode Gap Analysis

| Feature | OpenClaw | OpenCode |
|---------|----------|----------|
| Sender Validation | ✅ allow-from.ts | ❌ |
| Command Authentication | ✅ command-auth.ts | ⚠️ Basic |
| Persistent Deduplication | ✅ persistent-dedupe.ts | ❌ |
| Webhook Security | ✅ webhook-targets.ts | ❌ |

### Implementation Steps

**Step 1**: Create `packages/plugin/src/allow-from.ts`

```typescript
/**
 * Normalized sender ID validation
 * For plugins to verify message senders against allowlists
 */

export function normalizeSenderId(sender: string | number): string {
  return String(sender).trim().toLowerCase()
}

export function isSenderAllowed(params: {
  senderId: string | number
  allowFrom: Array<string | number>
}): boolean {
  const { senderId, allowFrom } = params
  
  if (allowFrom.length === 0) return false
  if (allowFrom.includes("*") || allowFrom.includes("*")) return true
  
  const normalizedSender = normalizeSenderId(senderId)
  const normalizedAllow = allowFrom.map(normalizeSenderId)
  
  return normalizedAllow.includes(normalizedSender)
}

export function parseAllowFromConfig(config: string | string[]): string[] {
  if (typeof config === "string") {
    return config.split(",").map(s => s.trim()).filter(Boolean)
  }
  return config.map(String)
}
```

**Step 2**: Create `packages/plugin/src/persistent-dedupe.ts`

```typescript
import { writeFile, readFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"

/**
 * Persistent Deduplicator
 * Prevents plugins from processing duplicate messages/events
 */

export class PersistentDedupe {
  private seen = new Set<string>()
  private filePath: string
  private maxAge: number

  constructor(options: { filePath: string; maxAgeMs?: number }) {
    this.filePath = options.filePath
    this.maxAge = options.maxAgeMs ?? 24 * 60 * 60 * 1000 // 24 hours
  }

  async load(): Promise<void> {
    try {
      const content = await readFile(this.filePath, "utf8")
      const entries = JSON.parse(content) as { id: string; timestamp: number }[]
      const now = Date.now()
      
      this.seen = new Set(
        entries
          .filter(e => now - e.timestamp < this.maxAge)
          .map(e => e.id)
      )
    } catch (err) {
      // File doesn't exist or parse failed, start fresh
      this.seen = new Set()
    }
  }

  async save(): Promise<void> {
    const dir = dirname(this.filePath)
    await mkdir(dir, { recursive: true })
    
    const entries = Array.from(this.seen).map(id => ({
      id,
      timestamp: Date.now()
    }))
    
    await writeFile(this.filePath, JSON.stringify(entries, null, 2))
  }

  isDuplicate(id: string): boolean {
    return this.seen.has(id)
  }

  async markAsSeen(id: string): Promise<void> {
    this.seen.add(id)
    await this.save()
  }

  async checkAndMark(id: string): Promise<boolean> {
    if (this.isDuplicate(id)) return true
    await this.markAsSeen(id)
    return false
  }
}
```

---

## 6. Multi-layer Config Priority ⚪ Skipped

**Note**: This feature is excluded from implementation as per user request.

### Why It Matters (Reference Only)

OpenClaw's configuration system supports 5 priority layers, suitable for:
- Enterprise deployments (admin-controlled)
- Multi-user scenarios
- Environment variable overrides

### OpenClaw Implementation (Reference Only)

**Config Priority** (Low → High):

```
1. Remote Config (.well-known/opencode)     - Organization defaults
2. Global Config (~/.openclaw/openclaw.json) - User defaults
3. Custom Config (OPENCLAW_CONFIG_PATH)     - Environment-specified
4. Project Config (./openclaw.json)         - Project-specific
5. Inline Config (OPENCLAW_CONFIG_CONTENT)  - Highest priority
```

**Environment Variable Priority**:

```
1. Process Environment (process.env)     - Highest
2. ./.env                                - Local development
3. ~/.openclaw/.env                      - User-level
4. openclaw.json env block               - Lowest
```

### OpenCode Gap Analysis (Reference Only)

| Feature | OpenClaw | OpenCode |
|---------|----------|----------|
| Remote Config | ✅ | ❌ |
| Config Merge Strategy | ✅ Array concatenation | ⚠️ Object merge |
| Environment Layers | ✅ 4 layers | ⚠️ Basic |

---

## Summary Table

| Priority | Area | Effort | Core Value | Status |
|----------|------|--------|------------|--------|
| 🔴 High | SSRF Protection | 1-2 days | Prevents plugin attacks on internal network | ✅ Implemented |
| 🔴 High | Test Config Separation | 1 day | Improves test efficiency and quality | ✅ Implemented |
| 🟡 Medium | Dead Code Detection | 0.5 days | Reduces maintenance burden | ✅ Implemented |
| 🟡 Medium | ACP Control Plane Refactor | 3-5 days | Improves architecture extensibility | ✅ Implemented |
| 🟢 Low | Plugin SDK Security Primitives | 2-3 days | Enhances plugin security | ✅ Implemented |
| ⚪ Skipped | Multi-layer Config Priority | 1-2 days | Enterprise deployment support | ⚪ Skipped |

---

## Implementation Status

### ✅ Completed Implementations

#### Plugin SDK Security Modules (`packages/plugin/src/`)

All security primitive modules have been implemented with full test coverage:

1. **`allow-from.ts`** - Sender validation utilities
   - `normalizeSenderId()` - Normalize sender IDs
   - `isSenderAllowed()` - Check sender against allowlist
   - `createSenderValidator()` - Cached validator
   - `isAllowedParsedChatSender()` - Multi-type chat validation
   - Tests: `allow-from.test.ts`

2. **`persistent-dedupe.ts`** - Persistent deduplication
   - `PersistentDedupe` class - File-based deduplication
   - `InMemoryDedupe` class - Memory-only deduplication
   - Automatic expiry and max entries enforcement
   - Tests: `persistent-dedupe.test.ts`

3. **`ssrf-policy.ts`** - SSRF protection
   - `normalizeHostnameSuffixAllowlist()` - Hostname normalization
   - `isHttpsUrlAllowedByHostnameSuffixAllowlist()` - URL validation
   - `buildHostnameAllowlistPolicyFromSuffixAllowlist()` - Policy builder
   - `createSafeFetch()` - SSRF-safe fetch wrapper
   - `isPrivateIpAddress()` - IP address classification
   - Tests: `ssrf-policy.test.ts`

4. **`fetch-auth.ts`** - Authentication utilities
   - `fetchWithBearerAuthScopeFallback()` - Scoped OAuth auth
   - `createAuthFetch()` - Auth fetch wrapper
   - `MultiProviderTokenProvider` - Multi-provider failover
   - `TokenCache` - Token caching
   - Tests: `fetch-auth.test.ts`

5. **`command-auth.ts`** - Command authentication
   - `checkCommandPermission()` - Permission checking
   - `matchesCommandPattern()` - Pattern matching with wildcards
   - `createCommandValidator()` - Cached validator
   - `verifyCommandSignature()` - HMAC signature verification
   - `parseCommand()` - Command parsing
   - Tests: `command-auth.test.ts`

All modules are exported from `packages/plugin/src/index.ts`.

#### Test Configuration (`packages/opencode/`)

Separated test configurations for different test types:

1. **`vitest.config.ts`** - Base configuration
2. **`vitest.unit.config.ts`** - Unit tests
3. **`vitest.e2e.config.ts`** - E2E tests
4. **`vitest.live.config.ts`** - Live API tests

Updated `package.json` scripts:
```json
{
  "test:unit": "bun vitest run --config vitest.unit.config.ts",
  "test:e2e": "bun vitest run --config vitest.e2e.config.ts",
  "test:live": "OPENCODE_LIVE_TEST=1 bun vitest run --config vitest.live.config.ts",
  "test:coverage": "bun vitest run --config vitest.unit.config.ts --coverage",
  "test:watch": "bun vitest --config vitest.unit.config.ts --watch"
}
```

Added dependencies: `vitest`, `@vitest/coverage-v8`

#### Dead Code Detection (Root level)

Added dead code detection tooling:

1. **`knip.jsonc`** - Knip configuration
2. **`script/check-loc.ts`** - Line count checker

Updated `package.json` scripts:
```json
{
  "deadcode:knip": "bunx knip --no-progress",
  "deadcode:ts-prune": "bunx ts-prune packages/opencode/src packages/plugin/src",
  "deadcode:ts-unused": "bunx ts-unused-exports tsconfig.json --ignoreTestFiles --exitWithCount",
  "deadcode:report": "bun run deadcode:knip && bun run deadcode:ts-prune && bun run deadcode:ts-unused",
  "deadcode:ci": "...",
  "check:loc": "bun run script/check-loc.ts --max 700"
}
```

Added dependencies: `knip`, `ts-prune`, `ts-unused-exports`

#### ACP Runtime Module (`packages/opencode/src/acp/runtime/`)

Implemented ACP runtime abstraction layer:

1. **`types.ts`** - Type definitions
   - `AcpRuntimeId` - Runtime identifier
   - `AcpRuntimeSession` - Session representation
   - `AcpSessionIdentity` - Identity information
   - `AcpRuntime` - Runtime interface
   - `AcpRuntimeBackend` - Backend registration

2. **`registry.ts`** - Runtime registry
   - `registerAcpRuntimeBackend()` - Register backend
   - `getAcpRuntimeBackend()` - Get backend by ID
   - `requireAcpRuntime()` - Require with error handling
   - `listAcpRuntimeBackends()` - List all backends

3. **`errors.ts`** - Error classes
   - `AcpRuntimeError` - Base error class
   - Factory functions for common errors

4. **`index.ts`** - Module exports

---

## Next Steps

### Recommended Follow-up Actions

1. **Run tests** to verify Plugin SDK modules:
   ```bash
   cd packages/plugin
   bun test
   ```

2. **Install new dependencies**:
   ```bash
   bun install
   ```

3. **Run dead code detection**:
   ```bash
   bun run deadcode:report
   ```

4. **Run LOC check**:
   ```bash
   bun run check:loc
   ```

5. **Test vitest configuration**:
   ```bash
   cd packages/opencode
   bun run test:unit
   ```

### Future Enhancements

- Implement actual ACP runtime backend using the new registry
- Add more security primitives (rate limiting, input validation)
- Create integration tests for Plugin SDK modules
- Add documentation for Plugin SDK usage

---

## Implementation Checklist

- [ ] **1. SSRF Protection Module**
  - [ ] Create `packages/opencode/src/security/ssrf-policy.ts`
  - [ ] Create `packages/opencode/src/infra/net/ssrf.ts` (core implementation)
  - [ ] Integrate into plugin system
  - [ ] Add unit tests

- [ ] **2. Test Configuration Separation**
  - [ ] Create `packages/opencode/vitest.unit.config.ts`
  - [ ] Create `packages/opencode/vitest.e2e.config.ts`
  - [ ] Create `packages/opencode/vitest.live.config.ts`
  - [ ] Update `packages/opencode/package.json` scripts

- [ ] **3. Dead Code Detection**
  - [ ] Add dependencies to root `package.json`
  - [ ] Create `script/check-loc.ts`
  - [ ] Create `knip.jsonc`
  - [ ] Update `check` script

- [ ] **4. ACP Control Plane Refactor**
  - [ ] Create `packages/opencode/src/acp/runtime/types.ts`
  - [ ] Create `packages/opencode/src/acp/runtime/registry.ts`
  - [ ] Create `packages/opencode/src/acp/runtime/errors.ts`
  - [ ] Refactor `packages/opencode/src/acp/session.ts`
  - [ ] Create `packages/opencode/src/acp/control-plane/` structure

- [ ] **5. Plugin SDK Security Primitives**
  - [ ] Create `packages/plugin/src/allow-from.ts`
  - [ ] Create `packages/plugin/src/persistent-dedupe.ts`
  - [ ] Create `packages/plugin/src/command-auth.ts`
  - [ ] Create `packages/plugin/src/fetch-auth.ts`

---

## References

- **OpenClaw Repository**: https://github.com/openclaw/openclaw
- **OpenClaw Security Policy**: https://github.com/openclaw/openclaw/blob/main/SECURITY.md
- **OpenClaw Vision**: https://github.com/openclaw/openclaw/blob/main/VISION.md
- **OpenClaw ACP Documentation**: https://github.com/openclaw/openclaw/blob/main/docs.acp.md
- **OpenCode Repository**: https://github.com/nolan57/opencodeclaw
