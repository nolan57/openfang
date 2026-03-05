# Vector Store Database Sync Analysis

This document analyzes the sqlite-vec database synchronization logic in the OpenCode self-evolution and long-context consistency system.

## Overview

The project uses `sqlite-vec` for vector search capabilities. Vector data is stored in two tables:

- `vector_memory` - Regular SQLite table storing metadata and serialized embeddings
- `vec_vector_memory` - Virtual table created by sqlite-vec for efficient vector search

The `VectorStore` class (`src/learning/vector-store.ts`) manages synchronization between `knowledge_nodes` and vector storage.

## Startup Flow

1. **Database initialization** (`src/storage/db.ts:82`): sqlite-vec extension is loaded when opening the database
2. **VectorStore initialization**: When first accessed, creates the virtual table and checks if sync is needed
3. **Sync check** (`maybeSync()`): Determines whether to synchronize knowledge nodes to vector storage

## Issues Found

### 1. Incomplete Sync Check Logic (Critical Bug)

**Location**: `src/learning/vector-store.ts:54-80`

```typescript
const firstNode = allNodes[0]
const exists = db.select({ id: vector_memory.id }).from(vector_memory).where(eq(vector_memory.id, firstNode.id)).get()

return !exists
```

**Problem**: The sync check only verifies whether the **first** node from `knowledge_nodes` exists in `vector_memory`. This approach is flawed:

- If nodes 2-100 have been synced but node 1 has not, the code will trigger a full resync
- If nodes 2-100 exist in `vector_memory` but node 1 does not (e.g., it was added later), the code will attempt to sync again, causing unnecessary processing
- The logic cannot accurately determine if "complete" synchronization has occurred

**Impact**: Unnecessary repeated synchronization attempts, degraded startup performance, potential duplicate processing.

---

### 2. SYNC_VERSION Never Used

**Location**: `src/learning/vector-store.ts:44`

```typescript
private readonly SYNC_VERSION = 1
```

**Problem**: A `SYNC_VERSION` constant is defined but never utilized anywhere in the codebase. This means:

- If the embedding algorithm changes (e.g., different dimensions, different model), there's no mechanism to trigger a forced re-sync
- Old vector embeddings will remain even when they become incompatible with the current algorithm

**Impact**: No graceful migration path when embedding strategy changes; stale vectors may produce incorrect search results.

---

### 3. SQL Injection Risk

**Location**: `src/learning/vector-store.ts:119, 325, 397`

```typescript
// Line 119
sqlite.exec(`INSERT INTO vec_vector_memory(rowid, embedding) VALUES ('${id}', vec_f32('${embeddingJson}'))`)

// Line 325
sqlite.exec(`DELETE FROM vec_vector_memory WHERE rowid = '${nodeId}'`)

// Line 397
sqlite.exec(`INSERT INTO vec_vector_memory(rowid, embedding) VALUES ('${node.id}', vec_f32('${embeddingJson}'))`)
```

**Problem**: String interpolation is used to build SQL queries instead of parameterized queries. While `id` values come from `crypto.randomUUID()` (which generates safe identifiers), this pattern is risky if the source of IDs ever changes.

**Impact**: Potential SQL injection vulnerability if ID generation logic is modified.

---

### 4. No Orphan Vector Cleanup

**Problem**: When nodes are deleted from `knowledge_nodes`, the corresponding entries in `vector_memory` and `vec_vector_memory` are not automatically removed. There's no cleanup mechanism for:

- Deleted knowledge nodes
- Outdated embeddings
- Invalid references

**Impact**: Vector storage grows unbounded with stale data; search results may include references to non-existent nodes.

---

### 5. Sync Efficiency Issues

**Location**: `src/learning/vector-store.ts:341-404`

The `syncKnowledgeNodes()` function iterates through all knowledge nodes and checks if each exists in `vector_memory`:

```typescript
const existing = Database.use((db) =>
  db.select({ id: vector_memory.id }).from(vector_memory).where(eq(vector_memory.id, node.id)).get(),
)
```

**Problems**:

1. Individual SELECT queries for each node (N+1 query pattern)
2. Due to issue #1, sync may be triggered unnecessarily when partial sync already exists
3. No batch processing or transaction management for bulk inserts

**Impact**: Poor performance with large knowledge graphs; potential database lock contention.

---

### 6. Missing Error Handling for Vector Operations

**Location**: `src/learning/vector-store.ts:82-93`

```typescript
async ensureVecTable(): Promise<void> {
  if (this.vecTableInitialized) return

  const sqlite = Database.raw()
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_vector_memory USING vec0(
      embedding float[${this.defaultDimensions}]
    )
  `)
  // No error handling for failed virtual table creation
  this.vecTableInitialized = true
}
```

**Problem**: No try-catch around virtual table creation. If sqlite-vec fails to load or table creation fails, the flag is still set to true, leaving the system in an inconsistent state.

**Impact**: Silent failures may cause subsequent vector operations to behave unexpectedly.

---

## Recommendations

1. **Fix sync check logic**: Use a count-based approach or maintain a sync metadata table to track synchronization state accurately

2. **Implement SYNC_VERSION**: Store current version in database and compare during startup; trigger full resync when version mismatches

3. **Use parameterized queries**: Replace string interpolation with proper parameterized SQL

4. **Add cleanup mechanism**: Implement periodic or on-demand cleanup of orphaned vectors

5. **Optimize sync**: Use batch inserts and transactions for better performance

6. **Add error handling**: Wrap vector operations in try-catch blocks with proper logging
