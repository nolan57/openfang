# OpenCode Unit Testing Guide

## Overview

This document provides a comprehensive guide to unit testing in the OpenCode project, including testing frameworks, conventions, patterns, and best practices.

---

## 1. Testing Framework

### Framework: Bun Test

OpenCode uses **Bun's built-in test framework** which provides:

- Fast execution with native Bun runtime
- Built-in mocking and snapshot testing
- TypeScript/ESM support out of the box
- Compatible API with Jest

### Test Command

```bash
# Run all tests
bun test

# Run specific test file
bun test test/learning/hierarchical-memory.test.ts

# Run tests matching pattern
bun test -t "knowledge graph"

# Run with coverage
bun test --coverage

# Watch mode
bun test --watch

# With timeout (default 30000ms)
bun test --timeout 60000
```

### Package Configuration

```json
// packages/opencode/package.json
{
  "scripts": {
    "test": "bun test --timeout 30000",
    "typecheck": "tsgo --noEmit"
  }
}
```

---

## 2. Test Structure

### Directory Layout

```
packages/opencode/
├── src/                          # Source code
│   ├── learning/
│   │   ├── knowledge-graph.ts
│   │   └── embedding-service.ts
│   └── ...
├── test/                         # Test files (mirrors src structure)
│   ├── preload.ts               # Global test setup
│   ├── fixture/
│   │   └── fixture.ts           # Test fixtures and helpers
│   ├── learning/
│   │   ├── hierarchical-memory.test.ts
│   │   └── learning.test.ts
│   ├── evolution/
│   ├── tool/
│   ├── util/
│   ├── storage/
│   ├── session/
│   ├── provider/
│   └── ...
└── migration/                    # Database migrations
```

### Test File Naming

- **Pattern**: `*.test.ts`
- **Location**: `test/<module>/<name>.test.ts`
- **Example**: `src/learning/knowledge-graph.ts` → `test/learning/knowledge-graph.test.ts`

---

## 3. Test Patterns

### Basic Test Structure

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { KnowledgeGraph } from "../../src/learning/knowledge-graph"

describe("KnowledgeGraph", () => {
  test("can add node", async () => {
    const kg = new KnowledgeGraph()
    const id = await kg.addNode({
      type: "file",
      entity_type: "code_file",
      entity_id: "test.ts",
      title: "Test File",
      content: "test content",
    })
    expect(id).toBeDefined()
    expect(typeof id).toBe("string")
  })
})
```

### With Setup/Teardown

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdir, writeFile, rm } from "fs/promises"
import { resolve } from "path"

const testDir = resolve(__dirname, "../../test-tmp/my-module")

async function setup() {
  await mkdir(testDir, { recursive: true })
  await writeFile(resolve(testDir, "test.ts"), "export const test = 1")
}

async function cleanup() {
  try {
    await rm(testDir, { recursive: true, force: true })
  } catch {}
}

describe("MyModule", () => {
  beforeEach(setup)
  afterEach(cleanup)

  test("does something", async () => {
    // Test implementation
  })
})
```

### Using Fixture Helper

```typescript
import { describe, test, expect } from "bun:test"
import { tmpdir } from "../fixture/fixture"

describe("Project Operations", () => {
  test("can read config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { model: "test/model", username: "testuser" },
    })

    // tmp.path is the temp directory path
    // tmp.extra contains any init return value
    // Auto-cleanup when test ends
  })

  test("with custom init", async () => {
    await using tmp = await tmpdir<string>({
      git: true,
      init: async (dir) => {
        const filePath = path.join(dir, "custom.txt")
        await Bun.write(filePath, "custom content")
        return filePath
      },
    })

    console.log(tmp.extra) // "/path/to/custom.txt"
  })
})
```

---

## 4. Testing Categories

### 4.1 Unit Tests

Pure function tests with no external dependencies:

```typescript
// test/util/lock.test.ts
import { describe, expect, test } from "bun:test"
import { Lock } from "../../src/util/lock"

describe("util.lock", () => {
  test("writer exclusivity: blocks reads and other writes", async () => {
    const key = "lock:" + Math.random().toString(36).slice(2)

    using writer1 = await Lock.write(key)
    // Test exclusivity behavior
  })
})
```

### 4.2 Integration Tests

Tests with database, filesystem, or other services:

```typescript
// test/storage/json-migration.test.ts
import { describe, test, expect, beforeEach } from "bun:test"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"

describe("JsonMigration", () => {
  function createTestDb() {
    const sqlite = new Database(":memory:")
    sqlite.exec("PRAGMA foreign_keys = ON")
    // Apply migrations
    return drizzle(sqlite)
  }

  test("migrates project data", async () => {
    // Integration test with real database
  })
})
```

### 4.3 Tool Tests

Testing tool implementations:

```typescript
// test/tool/bash.test.ts
import { describe, test, expect } from "bun:test"
import { BashTool } from "../../src/tool/bash"

describe("BashTool", () => {
  test("executes simple command", async () => {
    const result = await BashTool.execute({
      command: "echo 'hello'",
      description: "Test echo",
    })
    expect(result.output).toContain("hello")
  })
})
```

---

## 5. Test Fixtures

### Global Test Setup (preload.ts)

```typescript
// test/preload.ts - Runs before all tests
import os from "os"
import path from "path"
import fs from "fs/promises"
import { afterAll } from "bun:test"

// Set XDG env vars FIRST, before any src/ imports
const dir = path.join(os.tmpdir(), "opencode-test-data-" + process.pid)
await fs.mkdir(dir, { recursive: true })
afterAll(() => {
  fsSync.rmSync(dir, { recursive: true, force: true })
})

process.env["XDG_DATA_HOME"] = path.join(dir, "share")
process.env["XDG_CACHE_HOME"] = path.join(dir, "cache")
process.env["XDG_CONFIG_HOME"] = path.join(dir, "config")
process.env["XDG_STATE_HOME"] = path.join(dir, "state")

// Clear provider env vars to ensure clean test state
delete process.env["ANTHROPIC_API_KEY"]
delete process.env["OPENAI_API_KEY"]
// ... more cleanup
```

### Fixture Helper (fixture/fixture.ts)

```typescript
// test/fixture/fixture.ts
import { $ } from "bun"
import * as fs from "fs/promises"
import os from "os"
import path from "path"
import type { Config } from "../../src/config/config"

type TmpDirOptions<T> = {
  git?: boolean // Initialize git repo
  config?: Partial<Config.Info> // Write opencode.json
  init?: (dir: string) => Promise<T> // Custom setup
  dispose?: (dir: string) => Promise<T> // Custom cleanup
}

export async function tmpdir<T>(options?: TmpDirOptions<T>) {
  const dirpath = path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2))
  await fs.mkdir(dirpath, { recursive: true })

  if (options?.git) {
    await $`git init`.cwd(dirpath).quiet()
    await $`git commit --allow-empty -m "root commit"`.cwd(dirpath).quiet()
  }

  if (options?.config) {
    await Bun.write(
      path.join(dirpath, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        ...options.config,
      }),
    )
  }

  const extra = await options?.init?.(dirpath)

  return {
    [Symbol.asyncDispose]: async () => {
      await options?.dispose?.(dirpath)
      // Auto cleanup
    },
    path: dirpath,
    extra: extra as T,
  }
}
```

---

## 6. Mocking Strategies

### 6.1 Environment Variables

```typescript
// test/something.test.ts
describe("with API key", () => {
  const originalKey = process.env.DASHSCOPE_API_KEY

  beforeEach(() => {
    process.env.DASHSCOPE_API_KEY = "test-key"
  })

  afterEach(() => {
    if (originalKey) {
      process.env.DASHSCOPE_API_KEY = originalKey
    } else {
      delete process.env.DASHSCOPE_API_KEY
    }
  })

  test("uses API key", async () => {
    // Test with API key
  })
})
```

### 6.2 Mock Modules (Bun's mock)

```typescript
import { mock, beforeEach } from "bun:test"

beforeEach(() => {
  mock.module("../../src/external/api", () => ({
    fetchData: () => Promise.resolve({ mock: "data" }),
  }))
})
```

### 6.3 Database Mocking

```typescript
// Use in-memory SQLite for tests
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"

function createTestDb() {
  const sqlite = new Database(":memory:")
  return drizzle(sqlite, { schema })
}
```

---

## 7. Testing Best Practices

### 7.1 Test Organization

```
describe("ModuleName", () => {
  describe("functionName", () => {
    test("should do X when Y", async () => {
      // Arrange
      const input = "test"

      // Act
      const result = await functionUnderTest(input)

      // Assert
      expect(result).toBe(expected)
    })
  })
})
```

### 7.2 Assertion Patterns

```typescript
// Basic assertions
expect(value).toBe(expected)
expect(value).toEqual({ key: "value" })
expect(array).toContain(item)
expect(fn).toThrow()

// Async assertions
await expect(promise).resolves.toBe(value)
await expect(promise).rejects.toThrow()

// Type assertions
expect(typeof value).toBe("string")
expect(value).toBeDefined()
expect(value).toBeNull()
```

### 7.3 Avoid Common Mistakes

```typescript
// ❌ Don't test implementation details
test("calls internal function", () => {
  expect(internalMock).toHaveBeenCalled() // Fragile
})

// ✅ Test observable behavior
test("returns correct result", () => {
  expect(result).toBe(expected) // Robust
})

// ❌ Don't use real API keys
test("fetches from API", async () => {
  process.env.REAL_API_KEY = "sk-xxx" // Security risk
})

// ✅ Use test fixtures
test("fetches from API", async () => {
  process.env.API_KEY = "test-key" // Safe
})
```

---

## 8. Test Coverage

### Running Coverage

```bash
bun test --coverage
```

### Coverage Configuration

Create `bunfig.toml` in package root:

```toml
[test]
coverage = true
coverageThreshold = 0.7
coverageReporter = ["text", "lcov"]
```

### Coverage Goals

| Module Type          | Target Coverage |
| -------------------- | --------------- |
| Utility functions    | 90%+            |
| Core business logic  | 80%+            |
| Tool implementations | 70%+            |
| Integration code     | 50%+            |

---

## 9. Test Examples by Category

### 9.1 Learning Module Tests

```typescript
// test/learning/knowledge-graph.test.ts
import { describe, test, expect, beforeEach } from "bun:test"
import { KnowledgeGraph } from "../../src/learning/knowledge-graph"
import { Database } from "../../src/storage/db"

describe("KnowledgeGraph", () => {
  beforeEach(async () => {
    // Reset database state
  })

  test("addNode creates node with valid ID", async () => {
    const kg = new KnowledgeGraph()
    const id = await kg.addNode({
      type: "file",
      entity_type: "code_file",
      entity_id: "test.ts",
      title: "Test",
      content: "content",
    })

    expect(id).toMatch(/^[a-f0-9-]{36}$/) // UUID format
  })

  test("getStats returns correct counts", async () => {
    const kg = new KnowledgeGraph()
    await kg.addNode({ type: "file", ... })
    await kg.addNode({ type: "code_entity", ... })

    const stats = await kg.getStats()
    expect(stats.nodes).toBe(2)
  })
})
```

### 9.2 Tool Tests

```typescript
// test/tool/code-index.test.ts
import { describe, test, expect } from "bun:test"
import { BuildCodeIndexTool } from "../../src/tool/code-index"
import { tmpdir } from "../fixture/fixture"

describe("BuildCodeIndexTool", () => {
  test("builds index for package", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const srcDir = path.join(dir, "src")
        await fs.mkdir(srcDir)
        await Bun.write(path.join(srcDir, "index.ts"), "export function test() { return 1 }")
      },
    })

    const result = await BuildCodeIndexTool.execute({
      packagePath: tmp.path,
      outputMode: "database",
    })

    expect(result.title).toBe("Code Index Built")
    expect(result.metadata.added).toBeGreaterThan(0)
  })
})
```

### 9.3 Embedding Service Tests

```typescript
// test/learning/embedding-service.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { EmbeddingService } from "../../src/learning/embedding-service"

describe("EmbeddingService", () => {
  const originalKey = process.env.DASHSCOPE_API_KEY

  beforeEach(() => {
    process.env.DASHSCOPE_API_KEY = "test-key"
  })

  afterEach(() => {
    if (originalKey) {
      process.env.DASHSCOPE_API_KEY = originalKey
    } else {
      delete process.env.DASHSCOPE_API_KEY
    }
  })

  test("getKnownDimensions returns correct values", () => {
    const dims = EmbeddingService.KNOWN_EMBEDDING_DIMENSIONS
    expect(dims["text-embedding-3-small"]).toBe(1536)
    expect(dims["text-embedding-v4"]).toBeUndefined() // DashScope not in known
  })

  test("createGenerator requires API key", async () => {
    delete process.env.DASHSCOPE_API_KEY
    await expect(EmbeddingService.createGenerator({ modelId: "dashscope/text-embedding-v4" })).rejects.toThrow(
      "DASHSCOPE_API_KEY is required",
    )
  })
})
```

---

## 10. CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - run: bun install

      - run: bun test --timeout 60000
        working-directory: packages/opencode

      - run: bun run typecheck
        working-directory: packages/opencode
```

### Pre-commit Hook

```bash
# .husky/pre-commit
bun test --timeout 30000
```

---

## 11. Debugging Tests

### Running Single Test

```bash
bun test test/learning/knowledge-graph.test.ts
```

### Verbose Output

```bash
bun test --verbose
```

### Debug with Console

```typescript
test("debug example", async () => {
  console.log("Debug output:", value)
  // Bun test shows console output by default
})
```

### Using Debugger

```bash
bun test --inspect-wait
# Then attach Chrome DevTools
```

---

## 12. Test Maintenance

### Keeping Tests Updated

1. **Run tests before commits**: `bun test`
2. **Update tests when changing APIs**: Keep tests in sync with implementation
3. **Remove obsolete tests**: Delete tests for removed functionality
4. **Add tests for new features**: Aim for coverage on new code

### Test Smells to Avoid

- **Slow tests**: Optimize or mark as integration
- **Flaky tests**: Fix timing issues, use proper awaits
- **Complex setup**: Extract to fixtures or helpers
- **Brittle assertions**: Test behavior, not implementation

---

## 13. Recommended Test Structure

```typescript
// test/<module>/<name>.test.ts

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { ModuleName } from "../../src/module/name"

// Test constants
const TEST_TIMEOUT = 10000

describe("ModuleName", () => {
  // Setup/Teardown
  beforeEach(async () => {
    // Initialize test state
  })

  afterEach(async () => {
    // Cleanup
  })

  // Happy path tests
  describe("normal operation", () => {
    test("does something correctly", async () => {
      // Arrange, Act, Assert
    })
  })

  // Edge cases
  describe("edge cases", () => {
    test("handles empty input", async () => {
      // Test edge case
    })
  })

  // Error handling
  describe("error handling", () => {
    test("throws on invalid input", async () => {
      // Test error case
    })
  })
})
```

---

## Summary

OpenCode's testing approach:

| Aspect    | Approach                             |
| --------- | ------------------------------------ |
| Framework | Bun Test (built-in)                  |
| Structure | `test/` mirrors `src/`               |
| Fixtures  | `tmpdir` helper with auto-cleanup    |
| Mocking   | Environment variables, in-memory DB  |
| Coverage  | `bun test --coverage`                |
| CI/CD     | GitHub Actions with typecheck + test |

Key principles:

- ✅ Write tests for new features
- ✅ Use fixtures for isolation
- ✅ Test behavior, not implementation
- ✅ Keep tests fast and deterministic
- ✅ Run tests and typecheck before commits

---

_Document Version: 1.0_  
_Last Updated: 2026-03-14_
