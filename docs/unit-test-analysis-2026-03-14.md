# Unit Test Analysis Report - 2026-03-14

## Current Status

### Test Execution

```
✅ Simple tests pass (util/lock, util/format, util/lazy)
⚠️ Full test suite timeout (needs investigation)
```

### Modified Files vs Test Coverage

| Modified File                         | Has Test | Status                                 |
| ------------------------------------- | -------- | -------------------------------------- |
| `src/learning/knowledge-graph.ts`     | ❌       | **Needs new test**                     |
| `src/learning/embedding-service.ts`   | ❌       | **Needs new test**                     |
| `src/learning/embed-utils.ts`         | ❌       | **Needs new test**                     |
| `src/learning/incremental-indexer.ts` | ❌       | **Needs new test**                     |
| `src/tool/code-index.ts`              | ❌       | **Needs new test**                     |
| `src/config/config.ts`                | ✅       | May need update for `embedding` config |
| `src/scheduler/*`                     | ⚠️       | **Existing test may be incompatible**  |
| `src/learning/vector-store.ts`        | ❌       | Needs test                             |
| `src/learning/sqlite-vec-store.ts`    | ❌       | Needs test                             |

---

## Gap Analysis

### 1. Knowledge Graph Tests (High Priority)

**File**: `src/learning/knowledge-graph.ts`

**Changes Made**:

- Added `.run()` to fix persistence issue
- Nodes/edges now properly saved to database

**Required Tests**:

```typescript
// test/learning/knowledge-graph.test.ts
describe("KnowledgeGraph", () => {
  test("addNode persists to database", async () => {
    const kg = new KnowledgeGraph()
    const id = await kg.addNode({
      type: "file",
      entity_type: "code_file",
      entity_id: "test.ts",
      title: "Test",
      content: "content",
    })

    // Verify in database
    const sqlite = Database.raw()
    const node = sqlite.prepare("SELECT * FROM knowledge_node WHERE id = ?").get(id)
    expect(node).toBeDefined()
  })

  test("addEdge creates relationship", async () => {})
  test("getStats returns correct counts", async () => {})
  test("getRelatedNodes traverses edges", async () => {})
})
```

### 2. Embedding Service Tests (High Priority)

**File**: `src/learning/embedding-service.ts`

**Changes Made**:

- New embedding configuration support
- DashScope API integration
- Multiple provider support

**Required Tests**:

```typescript
// test/learning/embedding-service.test.ts
describe("EmbeddingService", () => {
  test("KNOWN_EMBEDDING_DIMENSIONS has correct values", () => {
    expect(EmbeddingService.KNOWN_EMBEDDING_DIMENSIONS["text-embedding-3-small"]).toBe(1536)
  })

  test("createGenerator requires API key", async () => {
    delete process.env.DASHSCOPE_API_KEY
    await expect(
      EmbeddingService.createGenerator({ modelId: "dashscope/text-embedding-v4" })
    ).rejects.toThrow()
  })

  test("createGenerator returns embedding function", async () => {
    process.env.DASHSCOPE_API_KEY = "test-key"
    const embed = await EmbeddingService.createGenerator({...})
    expect(typeof embed).toBe("function")
  })
})
```

### 3. Embed Utils Tests (High Priority)

**File**: `src/learning/embed-utils.ts`

**Required Tests**:

```typescript
// test/learning/embed-utils.test.ts
describe("embedWithDimensions", () => {
  test("throws without DASHSCOPE_API_KEY", async () => {
    delete process.env.DASHSCOPE_API_KEY
    await expect(embedWithDimensions({ model: "text-embedding-v4", value: "test" })).rejects.toThrow(
      "DASHSCOPE_API_KEY is required",
    )
  })

  test("calls DashScope API with correct parameters", async () => {
    // Mock fetch
    process.env.DASHSCOPE_API_KEY = "test-key"
    // Test API call
  })
})
```

### 4. Incremental Indexer Tests (Medium Priority)

**File**: `src/learning/incremental-indexer.ts`

**Changes Made**:

- Switched from `simpleEmbedding` to DashScope embeddings
- Updated dimensions from 384 to 1536

**Required Tests**:

```typescript
// test/learning/incremental-indexer.test.ts
describe("IncrementalIndexer", () => {
  test("configure sets source directory", () => {})
  test("start subscribes to file watcher", () => {})
  test("stop clears pending changes", () => {})
  test("handleFileEvent queues add/change/delete", () => {})
  test("flush processes pending changes", () => {})
  test("addToIndex uses DashScope embeddings", () => {})
  test("updateInIndex updates embedding", () => {})
  test("removeFromIndex deletes entry", () => {})
})
```

### 5. Code Index Tool Tests (Medium Priority)

**File**: `src/tool/code-index.ts`

**Changes Made**:

- Replaced `simpleEmbedding` with DashScope API
- Removed `hashString` and `simpleEmbedding` functions
- Added `DASHSCOPE_API_KEY` requirement

**Required Tests**:

```typescript
// test/tool/code-index.test.ts
describe("BuildCodeIndexTool", () => {
  test("fails without DASHSCOPE_API_KEY", async () => {
    delete process.env.DASHSCOPE_API_KEY
    const result = await tool.execute({ packagePath: "test", outputMode: "database" })
    expect(result.output).toContain("DASHSCOPE_API_KEY")
  })

  test("builds index with DashScope embeddings", async () => {
    process.env.DASHSCOPE_API_KEY = "test-key"
    // Test with mock
  })

  test("extractExports finds named exports", () => {})
  test("extractPurpose extracts JSDoc comments", () => {})
  test("generateNodeId creates consistent IDs", () => {})
})
```

### 6. Scheduler Tests (Needs Review)

**File**: `src/scheduler/*`

**Issue**: New scheduler system is completely different from old one.

**Old Test**: `test/scheduler.test.ts` tests `Scheduler.register()` with `interval` and `scope`.

**New System**: Uses `scheduler_job`, `scheduler_execution` tables, cron expressions, and in-process execution.

**Required Actions**:

1. Update or rewrite `test/scheduler.test.ts`
2. Add tests for `Job` class
3. Add tests for `Executor` class
4. Add tests for cron parsing

---

## Recommended Actions

### Immediate (High Priority)

1. **Create test/learning/knowledge-graph.test.ts**
   - Test `addNode` persistence
   - Test `addEdge` relationships
   - Test `getStats` accuracy

2. **Create test/learning/embed-utils.test.ts**
   - Test API key requirement
   - Test DashScope API call
   - Mock external API

3. **Create test/tool/code-index.test.ts**
   - Test embedding generation
   - Test file processing
   - Test database insertion

### Short-term (Medium Priority)

4. **Create test/learning/incremental-indexer.test.ts**
   - Test file event handling
   - Test incremental updates

5. **Update test/scheduler.test.ts**
   - Adapt to new scheduler architecture
   - Test job creation/execution

6. **Create test/learning/embedding-service.test.ts**
   - Test configuration
   - Test provider support

### Long-term

7. **Add integration tests**
   - Full indexing pipeline
   - Knowledge graph query
   - Embedding workflow

---

## Test Implementation Template

```typescript
// test/learning/knowledge-graph.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { KnowledgeGraph } from "../../src/learning/knowledge-graph"
import { Database } from "../../src/storage/db"

describe("KnowledgeGraph", () => {
  let kg: KnowledgeGraph

  beforeEach(async () => {
    kg = new KnowledgeGraph()
    // Clear test data
    const sqlite = Database.raw()
    sqlite.run("DELETE FROM knowledge_node")
    sqlite.run("DELETE FROM knowledge_edge")
  })

  describe("addNode", () => {
    test("persists node to database", async () => {
      const id = await kg.addNode({
        type: "file",
        entity_type: "code_file",
        entity_id: "src/test.ts",
        title: "Test File",
        content: "test content",
      })

      expect(id).toBeDefined()
      expect(typeof id).toBe("string")

      const sqlite = Database.raw()
      const node = sqlite.prepare("SELECT * FROM knowledge_node WHERE id = ?").get(id)
      expect(node).toBeDefined()
      expect((node as any).title).toBe("Test File")
    })

    test("assigns UUID format id", async () => {
      const id = await kg.addNode({...})
      expect(id).toMatch(/^[a-f0-9-]{36}$/)
    })

    test("sets timestamps", async () => {
      const before = Date.now()
      const id = await kg.addNode({...})
      const after = Date.now()

      const node = sqlite.prepare("SELECT * FROM knowledge_node WHERE id = ?").get(id)
      expect((node as any).time_created).toBeGreaterThanOrEqual(before)
      expect((node as any).time_created).toBeLessThanOrEqual(after)
    })
  })

  describe("addEdge", () => {
    test("creates relationship between nodes", async () => {
      const id1 = await kg.addNode({...})
      const id2 = await kg.addNode({...})

      const edgeId = await kg.addEdge({
        source_id: id1,
        target_id: id2,
        relation: "calls",
      })

      expect(edgeId).toBeDefined()
    })
  })

  describe("getStats", () => {
    test("returns correct counts", async () => {
      await kg.addNode({ type: "file", ... })
      await kg.addNode({ type: "code_entity", ... })

      const stats = await kg.getStats()
      expect(stats.nodes).toBe(2)
    })
  })
})
```

---

## Summary

| Category                         | Count | Priority |
| -------------------------------- | ----- | -------- |
| Missing tests for modified files | 6     | High     |
| Tests needing updates            | 2     | Medium   |
| Total test files needed          | 5+    | -        |

**Key Gap**: No tests for knowledge graph persistence fix that was just implemented.

**Recommendation**: Start with `knowledge-graph.test.ts` to verify the `.run()` fix works correctly.

---

_Report generated: 2026-03-14_
