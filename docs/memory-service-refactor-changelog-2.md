# Architecture Upgrade Summary

This document summarizes the architectural improvements made to the OpenCode memory system and storage layer.

## Overview

The upgrade focuses on three key areas:
1. **sqlite-vec Loading Robustness** - Cross-platform extension loading with detailed error reporting
2. **Resumable Database Migration** - Prevent duplicate record errors on migration restart
3. **Type Safety Improvements** - Eliminate `any` types for better compile-time checking

---

## 1. sqlite-vec Loading Robustness (`db.ts`)

### Problem
The sqlite-vec extension loading was fragile, failing silently or with cryptic errors on different platforms (Windows, macOS, Linux).

### Solution
Implemented a comprehensive loading system with:
- Platform-specific configuration mapping
- Multiple fallback paths for extension discovery
- Detailed error reporting with actionable messages

### Key Changes

```typescript
interface VecLoadResult {
  loaded: boolean
  reason?: string
  path?: string
}

function getVecPlatformConfig(): VecPlatformConfig {
  const platformMap: Record<string, { fileName: string; packageName: string }> = {
    darwin: { fileName: "vec0.dylib", packageName: "darwin" },
    linux: { fileName: "vec0.so", packageName: "linux" },
    win32: { fileName: "vec0.dll", packageName: "windows" },
  }
  // Returns platform-specific config or undefined for unsupported platforms
}

function loadSqliteVecExtension(sqlite: BunDatabase, logger: typeof log): VecLoadResult {
  // 1. Verify Bun runtime
  // 2. Check platform support
  // 3. Try multiple extension paths:
  //    - ./node_modules/sqlite-vec/<platform>/<file>
  //    - ./node_modules/@opencode-ai/opencode/node_modules/sqlite-vec/<platform>/<file>
  //    - parent directory resolution
  // 4. Return detailed result with failure reason if unsuccessful
}
```

### Error Messages
The function now returns specific reasons for failures:
- `"not running in Bun runtime"` - Wrong JavaScript runtime
- `"unsupported platform: ${platform}"` - Platform not in support list
- `"extension file not found"` - sqlite-vec not installed correctly
- `"failed to load extension: ${error.message}"` - Loading failed with details

---

## 2. Resumable Database Migration (`json-migration.ts`)

### Problem
When migration was interrupted or needed to be re-run, duplicate primary key errors would occur because records were already inserted.

### Solution
Implemented a state tracking system that:
1. Checks if migration was previously completed
2. Queries existing record IDs before insertion
3. Skips records that already exist
4. Marks migration as complete only after successful completion

### Key Changes

#### Migration State Table
```typescript
const MIGRATION_VERSION = 1
const STATE_TABLE = "json_migration_state"

function createMigrationStateTable(sqlite: Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
      version INTEGER PRIMARY KEY,
      completed_at INTEGER NOT NULL
    )
  `)
}

function isMigrationCompleted(sqlite: Database): boolean {
  const result = sqlite
    .query<{ count: number }, []>(`SELECT COUNT(*) as count FROM ${STATE_TABLE} WHERE version = ?`)
    .get(MIGRATION_VERSION)
  return result?.count === 1
}

function markMigrationCompleted(sqlite: Database): void {
  sqlite.exec(`INSERT OR REPLACE INTO ${STATE_TABLE} (version, completed_at) VALUES (?, ?)`, [
    MIGRATION_VERSION,
    Date.now(),
  ])
}
```

#### Existing ID Query Functions
```typescript
function getExistingIds(sqlite: Database, table: string, column: string): Set<string> {
  const results = sqlite.query<{ id: string }, []>(`SELECT ${column} as id FROM ${table}`).all()
  return new Set(results.map((r) => r.id))
}

// Used for:
const existingProjectIds = getExistingIds(sqlite, "project", "id")
const existingSessionIds = getExistingIds(sqlite, "session", "id")
const existingMessageIds = getExistingIds(sqlite, "message", "id")
const existingPartIds = getExistingIds(sqlite, "part", "id")
```

#### Skip Logic During Migration
```typescript
// Project migration
if (existingProjectIds.has(id)) {
  stats.skipped.projects++
  continue
}

// Session migration
if (existingSessionIds.has(id)) {
  stats.skipped.sessions++
  continue
}

// Message migration
if (existingMessageIds.has(id)) {
  stats.skipped.messages++
  continue
}

// Part migration
if (existingPartIds.has(id)) {
  stats.skipped.parts++
  continue
}
```

#### Statistics Tracking
```typescript
interface MigrationStats {
  projects: number
  sessions: number
  messages: number
  parts: number
  todos: number
  permissions: number
  shares: number
  skipped: {
    projects: number
    sessions: number
    messages: number
    parts: number
  }
  errors: string[]
}
```

---

## 3. Type Safety Improvements

### Files Modified

#### `json-migration.ts`
Replaced `any[]` with `unknown[]` for all migration value arrays:

```typescript
// Before
const projectValues = [] as any[]
const sessionValues = [] as any[]
const values = new Array(batch.length) as any[]

// After
const projectValues: unknown[] = []
const sessionValues: unknown[] = []
const values: unknown[] = []
```

#### `service.ts`
Fixed unsafe type assertion in error handling:

```typescript
// Before
throw new UnsupportedMemoryTypeError({
  type: (params as any).memoryType,
  supportedTypes: ["session", "evolution", "project"],
})

// After
throw new UnsupportedMemoryTypeError({
  type: params.memoryType as string,
  supportedTypes: ["session", "evolution", "project"],
})
```

### Benefits
- Compile-time type checking catches errors earlier
- Better IDE autocomplete and documentation
- Safer refactoring with confidence
- Clearer intent in code

---

## Migration Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Migration Start                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Create Migration State Table (if not exists)              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Check isMigrationCompleted()                               │
│  ┌─────────────────┐    ┌───────────────────────────────┐  │
│  │ Already Done?   │──Yes──▶│ Skip Migration, Return Early │  │
│  └─────────────────┘    └───────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │ No
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Query Existing IDs (projects, sessions, messages, parts)  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  BEGIN TRANSACTION                                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  For each record type:                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Check if ID exists?                                 │   │
│  │ ┌──────────┐    ┌────────────────────────────────┐ │   │
│  │ │ Yes      │──▶│ Skip (increment stats.skipped) │ │   │
│  │ └──────────┘    └────────────────────────────────┘ │   │
│  │ ┌──────────┐    ┌────────────────────────────────┐ │   │
│  │ │ No       │──▶│ Insert record                   │ │   │
│  │ └──────────┘    └────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  markMigrationCompleted()                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  COMMIT TRANSACTION                                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Log Statistics (inserted, skipped, errors, duration)      │
└─────────────────────────────────────────────────────────────┘
```

---

## Testing Recommendations

1. **Migration Resumability Test**
   - Run migration on a populated database
   - Interrupt migration mid-way
   - Re-run migration
   - Verify no duplicate key errors
   - Verify skipped count matches existing records

2. **Platform Extension Loading Test**
   - Test on Windows, macOS, and Linux
   - Verify appropriate error messages when extension missing
   - Verify successful loading when extension present

3. **Type Safety Validation**
   - Run `bun typecheck` on all modified files
   - Verify no `any` type warnings from linter

---

## Files Modified

| File | Changes |
|------|---------|
| `packages/opencode/src/storage/db.ts` | Added VecLoadResult interface, getVecPlatformConfig(), loadSqliteVecExtension() with robust error handling |
| `packages/opencode/src/storage/json-migration.ts` | Added migration state tracking, existing ID queries, skip logic, improved type safety |
| `packages/opencode/src/memory/service.ts` | Fixed type assertion in error handling |

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.0 | 2026-03-11 | Initial architecture upgrade |
