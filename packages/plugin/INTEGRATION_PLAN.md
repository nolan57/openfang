# Plugin QQBot Integration Plan

## Overview

Integrate `@opencode-ai/plugin-qqbot` into `@opencode-ai/plugin` package as a built-in plugin provider.

---

## Option A: Subpackage Integration (Recommended) ⭐

### Directory Structure

```
packages/plugin/
├── src/
│   ├── index.ts                    # Main entry, exports everything
│   ├── tool.ts                     # Tool definition utilities
│   ├── shell.ts                    # Shell utilities
│   │
│   ├── security/                   # Security utilities (existing)
│   │   ├── allow-from.ts
│   │   ├── command-auth.ts
│   │   ├── fetch-auth.ts
│   │   ├── persistent-dedupe.ts
│   │   └── ssrf-policy.ts
│   │
│   ├── providers/                  # New: Plugin providers
│   │   ├── index.ts                # Provider entry point
│   │   │
│   │   └── qqbot/                  # QQ Bot provider
│   │       ├── index.ts            # Main entry
│   │       ├── gateway.ts          # WebSocket gateway
│   │       ├── api.ts              # QQ API calls
│   │       ├── config.ts           # Configuration loading
│   │       ├── types.ts            # Type definitions
│   │       └── outbound.ts         # Outbound message handling
│   │
│   └── hooks/                      # New: Common hooks implementation
│       ├── plugin-status.ts        # Status reporting
│       └── plugin-restart.ts       # Restart logic
│
├── package.json
└── tsconfig.json
```

### Change List

#### 1. Update `package.json`

```json
{
  "name": "@opencode-ai/plugin",
  "version": "2.0.0",
  "exports": {
    ".": "./src/index.ts",
    "./tool": "./src/tool.ts",
    "./providers": "./src/providers/index.ts",
    "./providers/qqbot": "./src/providers/qqbot/index.ts",
    "./security": "./src/security/index.ts"
  },
  "dependencies": {
    "zod": "4.1.8",
    "silk-wasm": "^3.3.4"  // Moved from plugin-qqbot
  }
}
```

#### 2. Update `src/index.ts`

```typescript
// Export core types
export type {
  Plugin,
  PluginInput,
  Hooks,
  AuthHook,
  ToolDefinition,
  ToolContext,
  PluginStatusType,
  PluginLogType,
  StatusReporter,
} from "./index"

// Export utilities
export * from "./tool"
export * from "./shell"

// Export security utilities
export * from "./security/allow-from"
export * from "./security/persistent-dedupe"
export * from "./security/ssrf-policy"
export * from "./security/fetch-auth"
export * from "./security/command-auth"

// Export providers
export * from "./providers"
```

#### 3. Create `src/providers/index.ts`

```typescript
// Export all providers
export * from "./qqbot"

// Provider registry (for future expansion)
export type ProviderRegistry = {
  qqbot: typeof import("./qqbot")
}
```

#### 4. Migrate QQBot Code

Move `packages/plugin-qqbot/src/*` to `packages/plugin/src/providers/qqbot/`

Changes needed:
- Import paths: `@opencode-ai/plugin` → relative paths
- Remove circular dependencies

#### 5. Update `gateway.ts` Imports

```typescript
// Before
import type { PluginInput } from "@opencode-ai/plugin"

// After
import type { PluginInput } from "../../index"
```

#### 6. Unified Configuration Loading

In `src/providers/qqbot/config.ts`:

```typescript
import type { PluginInput } from "../../index"
import type { QQBotPluginConfig, ResolvedQQBotAccount } from "./types"

// Configuration loading logic remains the same
export function loadConfig(input: PluginInput): QQBotPluginConfig {
  // ... existing logic
}
```

### Usage Methods

#### Method 1: Use as Plugin Directly

```typescript
// In opencode.jsonc
{
  "plugins": {
    "qqbot": {
      "enabled": true,
      "appId": "xxx",
      "clientSecret": "xxx"
    }
  }
}
```

#### Method 2: Import as Provider

```typescript
import { QQBotPlugin } from "@opencode-ai/plugin/providers/qqbot"

// Use in custom plugin
const MyPlugin = async (input) => {
  const qqbotHooks = await QQBotPlugin(input)
  return {
    ...qqbotHooks,
    // Add custom hooks
  }
}
```

---

## Option B: Keep Independent, Optimize Dependencies

Keep `plugin-qqbot` as an independent package, optimize relationship with `plugin` package.

### Change List

#### 1. Update `plugin-qqbot/package.json`

```json
{
  "name": "@opencode-ai/plugin-qqbot",
  "peerDependencies": {
    "@opencode-ai/plugin": ">=2.0.0"
  },
  "dependencies": {
    "zod": "catalog:",
    "silk-wasm": "^3.3.4"
  }
}
```

#### 2. Unified Zod Version

Current issue:
- `plugin` uses `zod@4.1.8`
- `plugin-qqbot` uses `zod@^3.24.0`

Solution: Unified use of `catalog:` reference to root `package.json` version.

#### 3. Export Types for QQBot Use

In `plugin/src/index.ts`, export more types:

```typescript
export type {
  PluginInput,
  Hooks,
  PluginStatusType,
  PluginLogType,
  StatusReporter,
  ProviderContext,
} from "./index"
```

### Advantages

- Maintains package independence
- Can be versioned and released separately
- Suitable for future third-party plugins

### Disadvantages

- Complex dependency management
- Difficult version synchronization
- Potential circular dependency issues

---

## Option C: Monorepo Workspace

Make `plugin-qqbot` a sub-package under `plugin` workspace.

### Directory Structure

```
packages/plugin/
├── packages/
│   ├── core/               # Core plugin SDK
│   └── qqbot/              # QQ Bot plugin
├── package.json            # Workspace root
└── tsconfig.json
```

### Advantages

- Clear module boundaries
- Can build and test independently
- Shared dependencies and configuration

### Disadvantages

- Complex structure
- Complex build configuration
- Does not follow current project conventions

---

## Recommended Option: Option A

### Reasons

1. **Follows Project Architecture**: Current `plugin` package is designed as an extensible SDK, built-in providers follow design intent
2. **Simplified Dependencies**: Reduces package count, lowers dependency complexity
3. **Unified Versioning**: Single version number, simplifies release and maintenance
4. **Shared Utilities**: Can directly use utility functions in `security/`
5. **Easy to Expand**: Future providers can be added (e.g., `discord`, `slack`, etc.)

### Implementation Steps

1. **Preparation Phase**
   - Backup current code
   - Create new branch `feature/plugin-qqbot-integration`

2. **Migrate Code**
   ```bash
   # Create directories
   mkdir -p packages/plugin/src/providers/qqbot
   
   # Move files
   cp packages/plugin-qqbot/src/*.ts packages/plugin/src/providers/qqbot/
   ```

3. **Update Imports**
   - Modify all `@opencode-ai/plugin` imports to relative paths
   - Update type imports

4. **Update package.json**
   - Add `silk-wasm` dependency
   - Add new exports entries

5. **Update Tests**
   - Move test files to `packages/plugin/src/providers/qqbot/*.test.ts`
   - Update test import paths

6. **Verify Build**
   ```bash
   cd packages/plugin
   bun run build
   bun run typecheck
   ```

7. **Update Documentation**
   - Update `packages/plugin/README.md`
   - Add QQBot provider documentation

8. **Deprecate Old Package**
   - Add `deprecated` field to `plugin-qqbot/package.json`
   - Update README to point to new location

---

## API Design

### Provider Pattern

```typescript
// providers/qqbot/index.ts
import type { Plugin, PluginInput, Hooks } from "../../index"

const QQBotPlugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  // Implementation
}

export { QQBotPlugin }
export type { QQBotPluginConfig, ResolvedQQBotAccount } from "./types"
```

### Configuration Extension

```typescript
// In opencode.jsonc
{
  "plugins": {
    "qqbot": {
      "enabled": true,
      "appId": "xxx",
      "clientSecret": "xxx",
      "dmPolicy": "pairing",
      "groupPolicy": "allowlist",
      "allowFrom": "*",
      // New features
      "enableVoice": true,
      "enableStt": true,
      "ttsVoice": "zh-CN-XiaoxiaoNeural",
      "enableTyping": true
    }
  }
}
```

---

## Migration Checklist

- [ ] Move all source files
- [ ] Update all import paths
- [ ] Update `package.json` exports
- [ ] Add `silk-wasm` dependency
- [ ] Migrate test files
- [ ] Update type exports
- [ ] Verify build
- [ ] Run tests
- [ ] Update documentation
- [ ] Deprecate old package (npm deprecate)

---

## Future Expansion

### Add More Providers

```
providers/
├── qqbot/          # QQ Bot
├── discord/        # Discord Bot (future)
├── slack/          # Slack Bot (future)
└── wechat/         # WeChat Bot (future)
```

### Provider Registry

```typescript
// providers/registry.ts
export const providerRegistry = {
  qqbot: () => import("./qqbot"),
  // discord: () => import("./discord"),
}

export async function loadProvider(name: string) {
  const provider = providerRegistry[name]
  if (!provider) throw new Error(`Provider ${name} not found`)
  return provider()
}
```

---

## Summary

**Recommended Option A** - Subpackage Integration, Reasons:
1. Simplified architecture
2. Unified management
3. Easy maintenance
4. Follows current project conventions
5. Provides clear path for future expansion
