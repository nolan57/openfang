# Memory Service Refactor Changelog #3

This document summarizes all changes made in the third phase of the memory service refactoring, focusing on three critical production-grade improvements:

1. **AST-based Code Analysis** - Replacing regex parsing with accurate AST parsing
2. **Non-blocking Migration** - Background migration with resumable support
3. **Vector Dimension Guard** - Dynamic validation for embedding model changes

---

## Overview

| Category | Files Changed | Files Created |
|----------|---------------|---------------|
| AST Code Analysis | 2 | 1 |
| Migration System | 0 | 1 |
| Vector Dimension | 2 | 1 |
| Schema | 1 | 0 |
| Dependencies | 1 | 0 |

---

## 1. AST-Based Code Analysis

### Problem
`ProjectMemoryService` used regex patterns to extract code entities, which failed on:
- Generic types (`class Foo<T extends Bar>`)
- Decorators (`@Injectable()`)
- Complex TypeScript syntax (JSX, type annotations)
- Nested structures

### Solution
Implemented `CodeAnalyzer` class using `@babel/parser` for accurate AST parsing.

### Files

#### NEW: `packages/opencode/src/memory/code-analyzer.ts`

Complete AST-based code analysis system:

```typescript
// Key exports
export class CodeAnalyzer {
  parse(content: string, filePath: string): ASTFile | null
  extractEntities(content: string, filePath: string): CodeEntity[]
  extractImports(content: string, filePath: string): ImportInfo[]
  extractMethodCalls(content: string, filePath: string): MethodCallInfo[]
  analyze(content: string, filePath: string, resolvedPaths?: Map<string, string>): AnalysisResult
}

// Entity types extracted
export interface CodeEntity {
  type: "class" | "interface" | "function" | "variable" | "type" | "enum" | "method" | "property"
  name: string
  filePath: string
  lineNumber: number
  columnNumber: number
  endLineNumber: number
  content?: string
  documentation?: string
  signature?: string
  exported: boolean
  async?: boolean
  static?: boolean
  visibility?: "public" | "private" | "protected"
  generics?: string[]
  extends?: string
  implements?: string[]
  decorators?: string[]
  metadata?: Record<string, unknown>
}

// Import tracking
export interface ImportInfo {
  source: string
  specifiers: Array<{
    type: "default" | "namespace" | "named"
    name: string
    alias?: string
  }>
  lineNumber: number
}

// Method call tracking
export interface MethodCallInfo {
  callerFile: string
  callerFunction?: string
  calleeName: string
  calleeObject?: string
  lineNumber: number
}
```

**Key Features:**
- Platform-independent (pure JavaScript, no native dependencies)
- Supports `.ts`, `.tsx`, `.js`, `.jsx` files
- Extracts JSDoc documentation comments
- Handles TypeScript-specific syntax (generics, decorators, type annotations)
- Fallback to regex parsing for unsupported file types

**Internal AST Type Guards:**
```typescript
function isIdentifier(node: ASTNode): node is { type: "Identifier"; name: string; loc?: SourceLocation }
function isClassDeclaration(node: ASTNode): node is ClassDeclarationNode
function isFunctionDeclaration(node: ASTNode): node is FunctionDeclarationNode
function isTSInterfaceDeclaration(node: ASTNode): node is TSInterfaceDeclarationNode
// ... etc
```

#### MODIFIED: `packages/opencode/src/memory/service.ts`

**Changes:**
1. Added import for `CodeAnalyzer`:
```typescript
import { CodeAnalyzer, type CodeEntity, type ImportInfo } from "./code-analyzer"
```

2. Updated `indexProject()` method to use AST-based analysis:
```typescript
async indexProject(options: IndexProjectOptions): Promise<{ entitiesAdded: number; relationsAdded: number }> {
  // ...
  const analyzer = new CodeAnalyzer()
  
  // Build resolved paths map for dependency resolution
  const resolvedPaths = new Map<string, string>()
  for (const file of options.files) {
    resolvedPaths.set(file.path, file.path)
  }
  
  // Use AST-based CodeAnalyzer for accurate entity extraction
  try {
    const analysis = analyzer.analyze(file.content, file.path, resolvedPaths)
    
    // Extract entities with full metadata
    for (const entity of analysis.entities) {
      // Store with extended metadata including:
      // - exported status
      // - async/static flags
      // - visibility
      // - generics, extends, implements
      // - decorators
    }
    
    // Extract import relations
    for (const imp of analysis.imports) {
      // Resolve and store import relationships
    }
    
    // Extract method call relations
    for (const call of analysis.methodCalls) {
      // Track method call relationships
    }
  } catch (error) {
    // Fallback to regex for unsupported file types
  }
}
```

---

## 2. Non-Blocking Migration System

### Problem
`json-migration.ts` ran synchronously during application startup, causing:
- Health check timeouts on large datasets
- Service unavailability during migration
- No way to resume interrupted migrations

### Solution
Implemented `MigrationWorker` class for background, resumable migration.

### Files

#### NEW: `packages/opencode/src/storage/migration-worker.ts`

Complete non-blocking migration system:

```typescript
export type MigrationStatus = "pending" | "running" | "completed" | "failed"

export class MigrationWorker {
  constructor(sqlite: BunDatabase, options?: MigrationWorkerOptions)
  
  // Check current status
  getStatus(): MigrationStatus
  
  // Get checkpoint for resumption
  getCheckpoint(): MigrationCheckpoint | null
  
  // Check if migration is needed
  isMigrationNeeded(): boolean
  
  // Check if service can start (running or completed)
  canStartService(): boolean
  
  // Start migration in background (returns immediately)
  async start(migrationFn: () => Promise<MigrationStats>): Promise<void>
  
  // Start with batch processor
  async startBatched<T>(
    items: T[],
    processor: (batch: T[], offset: number) => Promise<number>,
    options: { phase: string; getItemId?: (item: T) => string },
  ): Promise<MigrationStats>
  
  // Stop migration (can be resumed)
  stop(): void
  
  // Reset state (for testing or re-run)
  reset(): void
}

export interface MigrationWorkerOptions {
  batchSize?: number      // Default: 50
  batchDelay?: number     // Default: 10ms
  onProgress?: (progress: MigrationProgress) => void
  onComplete?: (stats: MigrationStats) => void
  onError?: (error: Error) => void
}

export interface MigrationProgress {
  phase: string
  current: number
  total: number
  percent: number
  eta?: number  // Estimated time remaining in ms
}

export interface MigrationCheckpoint {
  phase: string
  current_file: string | null
  processed_count: number
  total_count: number
  started_at: number
  updated_at: number
}
```

**Database Tables Created:**
```sql
-- Status tracking
CREATE TABLE IF NOT EXISTS _migration_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'pending',
  started_at INTEGER,
  completed_at INTEGER,
  error_message TEXT,
  version INTEGER NOT NULL DEFAULT 1
)

-- Checkpoint for resumption
CREATE TABLE IF NOT EXISTS _migration_checkpoint (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  phase TEXT NOT NULL,
  current_file TEXT,
  processed_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

**Key Features:**
- Non-blocking: `start()` returns immediately
- Resumable: Checkpoint tracks progress, survives restart
- Yield to event loop: `yield()` method between batches
- Progress reporting: Callbacks for UI integration
- Graceful stop: Can be paused and resumed

**Usage Example:**
```typescript
const worker = new MigrationWorker(sqlite, {
  batchSize: 50,
  onProgress: (p) => console.log(`${p.phase}: ${p.percent}%`),
})

// Start in background
worker.start(async () => {
  // Your migration logic here
  return stats
})

// Service can start immediately in "degraded" mode
if (worker.canStartService()) {
  startMainService()
}
```

---

## 3. Vector Dimension Guard

### Problem
Vector column dimension was hardcoded (`384`). If embedding model changed:
- Insert failures with cryptic SQL errors
- No clear error message
- No guidance on how to fix

### Solution
Implemented dynamic dimension validation with clear error messages.

### Files

#### MODIFIED: `packages/opencode/src/storage/db.ts`

**New Exports:**
```typescript
// Configuration
export function getConfiguredEmbeddingDim(): number

// Error type
export const VectorDimensionMismatchError = NamedError.create(
  "VectorDimensionMismatchError",
  z.object({
    storedDimension: z.number(),
    configuredDimension: z.number(),
    hint: z.string(),
  }),
)

// Validation functions
export { validateVectorDimensions, storeEmbeddingDim, getStoredEmbeddingDim, ensureSystemMetadataTable }
```

**Configuration:**
```typescript
// Default embedding dimension
const DEFAULT_EMBEDDING_DIM = 384

// Get from environment or default
export function getConfiguredEmbeddingDim(): number {
  const envDim = process.env.EMBEDDING_DIM
  if (envDim) {
    const dim = parseInt(envDim, 10)
    if (isNaN(dim) || dim <= 0) {
      log.warn("invalid EMBEDDING_DIM environment variable, using default", {
        value: envDim,
        default: DEFAULT_EMBEDDING_DIM,
      })
      return DEFAULT_EMBEDDING_DIM
    }
    return dim
  }
  return DEFAULT_EMBEDDING_DIM
}
```

**Validation Logic:**
```typescript
function validateVectorDimensions(sqlite: BunDatabase, logger: typeof log): number {
  const configuredDim = getConfiguredEmbeddingDim()
  const storedDim = getStoredEmbeddingDim(sqlite)

  // Fresh database - store and return
  if (storedDim === undefined) {
    storeEmbeddingDim(sqlite, configuredDim)
    return configuredDim
  }

  // Match - OK
  if (storedDim === configuredDim) {
    return configuredDim
  }

  // Mismatch - critical error
  throw new VectorDimensionMismatchError({
    storedDimension: storedDim,
    configuredDimension: configuredDim,
    hint: `Embedding model changed. You must either:
1. Set EMBEDDING_DIM=${storedDim} to use the existing vectors, or
2. Clear the vector_memory table and rebuild with the new dimension:
   DELETE FROM vector_memory;
   DELETE FROM vec_vector_memory;
   UPDATE system_metadata SET value = '${configuredDim}' WHERE key = 'embedding_dimension';

After changing dimension, restart the application.`,
  })
}
```

**Integration in Database Client:**
```typescript
export const Client = lazy(() => {
  // ... database setup ...
  
  // Validate vector dimensions after migrations
  try {
    const embeddingDim = validateVectorDimensions(sqlite, log)
    log.info("vector_dimension_validated", { dimension: embeddingDim })
  } catch (error) {
    if (error instanceof VectorDimensionMismatchError) {
      throw error  // Critical - prevent startup
    }
    log.warn("vector_dimension_validation_failed", { error })
  }
  
  return db
})
```

#### NEW: `packages/opencode/src/storage/system-metadata.sql.ts`

System metadata table for storing configuration:

```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const system_metadata = sqliteTable("system_metadata", {
  key: text().primaryKey(),
  value: text().notNull(),
  value_type: text().notNull().default("string"), // "string" | "number" | "json"
  description: text(),
  ...Timestamps,
})
```

**SQL Schema:**
```sql
CREATE TABLE system_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'string',
  description TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
)
```

#### MODIFIED: `packages/opencode/src/storage/schema.ts`

```typescript
export { system_metadata, Timestamps } from "./system-metadata.sql"
```

---

## 4. Knowledge Graph Type Updates

### MODIFIED: `packages/opencode/src/learning/knowledge-graph.ts`

Extended `NodeType` and `RelationType` to support code analysis:

```typescript
// Before
export type NodeType = "file" | "skill" | "memory" | "constraint" | "agenda"
export type RelationType =
  | "depends_on"
  | "related_to"
  | "conflicts_with"
  | "derives_from"
  | "implements"
  | "may_affect"
  | "supersedes"

// After
export type NodeType = "file" | "skill" | "memory" | "constraint" | "agenda" | "code_entity"
export type RelationType =
  | "depends_on"
  | "related_to"
  | "conflicts_with"
  | "derives_from"
  | "implements"
  | "may_affect"
  | "supersedes"
  | "imports"
  | "calls"
```

---

## 5. Dependencies

### MODIFIED: `packages/opencode/package.json`

Added `@babel/parser` for AST parsing:

```json
{
  "dependencies": {
    "@babel/parser": "^7.28.4",
    // ... other dependencies
  }
}
```

**Installation:**
```bash
cd packages/opencode
bun install
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDING_DIM` | `384` | Vector embedding dimension. Must match your embedding model. |

**Example:**
```bash
# For OpenAI text-embedding-3-small
EMBEDDING_DIM=1536

# For all-MiniLM-L6-v2 (default)
EMBEDDING_DIM=384
```

---

## Migration Guide

### For Existing Deployments

1. **Update dependencies:**
   ```bash
   cd packages/opencode
   bun install
   ```

2. **Set embedding dimension (if not using default):**
   ```bash
   export EMBEDDING_DIM=384
   ```

3. **Run migrations:**
   The `system_metadata` table will be created automatically.

4. **For embedding model changes:**
   - If switching models, clear vector tables first
   - Update `EMBEDDING_DIM` environment variable
   - Restart application

### For New Deployments

No action required. The system will:
1. Initialize `system_metadata` table
2. Store the configured embedding dimension
3. Validate on subsequent startups

---

## Error Handling

### VectorDimensionMismatchError

When thrown, the error includes a detailed `hint` field with remediation steps:

```typescript
try {
  const db = Database.Client()
} catch (error) {
  if (error instanceof VectorDimensionMismatchError) {
    console.error("Dimension mismatch!")
    console.error(`Stored: ${error.storedDimension}`)
    console.error(`Configured: ${error.configuredDimension}`)
    console.error(`Fix: ${error.hint}`)
    process.exit(1)
  }
}
```

---

## Testing Recommendations

### CodeAnalyzer Tests
```typescript
import { CodeAnalyzer } from "./code-analyzer"

const analyzer = new CodeAnalyzer()

// Test entity extraction
const entities = analyzer.extractEntities(`
  @Injectable()
  export class UserService<T extends User> extends BaseService<T> {
    async getUser(id: string): Promise<T | null> {
      return this.repository.findById(id)
    }
  }
`, "user.service.ts")

// Verify:
// - type: "class"
// - name: "UserService"
// - decorators: ["Injectable"]
// - generics: ["T"]
// - extends: "BaseService"
// - method: "UserService.getUser" with async: true
```

### MigrationWorker Tests
```typescript
// Test resumable migration
const worker = new MigrationWorker(sqlite, { batchSize: 10 })

// Start and stop mid-way
await worker.startBatched(items, processor, { phase: "test" })
worker.stop()

// Verify checkpoint saved
const checkpoint = worker.getCheckpoint()
assert(checkpoint.processed_count > 0)

// Resume - should continue from checkpoint
await worker.startBatched(items, processor, { phase: "test" })
```

### Vector Dimension Tests
```typescript
// Test validation
process.env.EMBEDDING_DIM = "768"
const dim = getConfiguredEmbeddingDim()
assert(dim === 768)

// Test mismatch error
storeEmbeddingDim(sqlite, 384)  // Old dimension
process.env.EMBEDDING_DIM = "768"  // New dimension

assertThrows(
  () => validateVectorDimensions(sqlite, log),
  VectorDimensionMismatchError
)
```

---

## Summary

| Component | Before | After |
|-----------|--------|-------|
| Code Parsing | Regex patterns | AST with @babel/parser |
| Migration | Blocking sync | Background async with checkpoint |
| Vector Dimension | Hardcoded 384 | Configurable via EMBEDDING_DIM |
| Error Handling | Cryptic SQL errors | NamedError with hints |

All changes are backward compatible. Existing data will work without modification.
