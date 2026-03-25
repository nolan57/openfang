# Self-Evolution System Data Storage Architecture Analysis

## Root Cause

The Dashboard showing "Knowledge Items" as 0 is caused by: **no evolution run data being stored in the database**.

### Problem Analysis

The `/evolve` CLI command calls `runLearning()` **without wrapping it in `Instance.provide()`**, resulting in:

1. **Missing Database Context**: Drizzle ORM requires the database connection provided by Instance
2. **Silent Failure**: `Database.use()` doesn't throw errors, but operations don't execute
3. **Data Loss**: Both `learning_run` and `knowledge` tables remain empty

### Code Comparison

**❌ Incorrect Code**:

```typescript
const { runLearning } = await import("../../learning/command")
const result = await runLearning({})
```

**✅ Correct Code**:

```typescript
await Instance.provide({
  directory: process.cwd(),
  fn: async () => {
    const { runLearning } = await import("../../learning/command")
    const result = await runLearning({})
  },
})
```

---

## Data Storage Architecture

The self-evolution system uses a **dual-storage architecture**:

### 1. Database Storage (SQLite)

**Purpose**: Structured queries, statistical analysis, relational retrieval

**Table Structure**:

- `learning_run` - Run records
  - id, trigger, status, topics, items_collected, notes_created
- `knowledge` - Knowledge items
  - id, run_id, source, url, title, summary, tags, value_score, action
- `archive_snapshot` - System snapshots
  - id, snapshot_type, state, checksum, is_golden
- `negative_memory` - Failure records
  - id, failure_type, description, context, severity

**Storage Location**:

```
~/.local/share/opencode/opencode.db
```

**Advantages**:

- ✅ Fast queries and statistics
- ✅ Supports complex relational queries
- ✅ Transaction safety
- ✅ Data integrity constraints

### 2. File System Storage (Markdown)

**Purpose**: Human-readable, version control, offline access

**Directory Structure**:

```
~/docs/learning/notes/
├── {runId-1}/
│   ├── index.md           # Run index and statistics
│   ├── Note_Title_1.md    # Learning note 1
│   └── Note_Title_2.md    # Learning note 2
├── {runId-2}/
│   └── ...
```

**Note Format**:

```markdown
# Title

**Source:** search  
**URL:** https://...

---

[Full content]

---

_Collected at: 2026-03-25_
```

**Advantages**:

- ✅ Human-readable
- ✅ Easy to share and version control
- ✅ Database-independent
- ✅ Long-term preservation

---

## Data Flow

```
┌─────────────┐
│  Collector  │ Collect data (Exa API)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Analyzer  │ Analyze and score
└──────┬──────┘
       │
       ├──────────────────┐
       │                  │
       ▼                  ▼
┌─────────────┐    ┌─────────────┐
│ Knowledge   │    │ NoteGen     │
│ Store       │    │             │
│ (Database)  │    │ (File Sys)  │
└─────────────┘    └─────────────┘
```

### Key Code

**command.ts (Lines 239-261)**:

```typescript
// Store to database
await store.saveKnowledge(
  analyzed.map((i) => ({
    run_id: runId,
    source: i.source,
    url: i.url,
    title: i.title,
    summary: i.summary,
    tags: i.tags,
    value_score: i.value_score,
    action: i.action,
  })),
)

// Generate notes to file system
const notes = await noteGen.generate(
  runId,
  analyzed.map((a) => ({
    source: a.source,
    url: a.url,
    title: a.title,
    content: a.content,
  })),
)
```

---

## Fixed Issues

### 1. CLI Instance Context

**File**: `src/cli/cmd/evolve.ts`
**Issue**: `runLearning` call lacks Instance context
**Fix**: Wrapped in `Instance.provide()`

### 2. Dashboard API Fallback

**File**: `src/server/routes/evolution.ts`
**Issue**: API only queries database, ignores file system data
**Fix**: Added file system fallback logic

- Extract knowledge item info from note files
- Parse statistics from index.md
- Create virtual run records

---

## Dashboard Data Sources

### Current Implementation (Hybrid Mode)

| Data Item           | Primary Source    | Fallback Source                 |
| ------------------- | ----------------- | ------------------------------- |
| Total Runs          | DB `learning_run` | File system directory count     |
| Knowledge Items     | DB `knowledge`    | File system Markdown file count |
| Source Distribution | DB GROUP BY       | Parse note file content         |
| Action Types        | DB GROUP BY       | Estimate (based on source)      |
| Run History         | DB SELECT         | File system directory metadata  |
| Run Details         | DB JOIN           | Parse note files                |

### Ideal Implementation (Pure Database)

All data should be read from the database, with file system serving only as:

- Human-readable backup
- Offline access support
- Version control integration

---

## Verification Steps

### 1. Check Database

```bash
sqlite3 ~/.local/share/opencode/opencode.db "
  SELECT COUNT(*) FROM learning_run;
  SELECT COUNT(*) FROM knowledge;
"
```

### 2. Check File System

```bash
ls -la ~/docs/learning/notes/
# Should have multiple run directories

ls ~/docs/learning/notes/{runId}/
# Should have index.md and multiple note files
```

### 3. Test API

```bash
curl http://localhost:4096/api/evolution/stats | jq '.data'
# totalRuns and totalKnowledge should be > 0
```

### 4. Run Evolution

```bash
bun run src/index.ts evolve
# Check database after completion
```

---

## Suggested Improvements

### 1. Data Sync Tool

Create tool to recover from file system when database is corrupted:

```typescript
// src/learning/sync.ts
export async function syncFromFileSystem() {
  // Scan file system
  // Parse note content
  // Batch insert to database
}
```

### 2. Migration Verification

Check migration status on startup:

```typescript
// src/learning/migration-check.ts
export async function ensureMigrations() {
  // Check if required tables exist
  // Prompt user to run migrations
}
```

### 3. Write Confirmation Logs

Add logs in `saveKnowledge`:

```typescript
log.info("saved knowledge to DB", { count: items.length, runId })
```

### 4. Unit Tests

Add tests to ensure data storage:

```typescript
test("runLearning stores data in database", async () => {
  const result = await runLearning({})
  expect(result.success).toBe(true)

  const runs = db.select().from(learning_runs).all()
  expect(runs.length).toBeGreaterThan(0)
})
```

---

## Summary

**Data Storage Strategy**:

- ✅ **Database**: Primary storage for queries and statistics
- ✅ **File System**: Secondary storage for readability and backup
- ⚠️ **Issue**: CLI lacks Instance context causing database write failures
- ✅ **Fix**: Added Instance context + API fallback logic

**Dashboard Currently Displays**:

- Total Runs: ✅ Read from file system
- Knowledge Items: ✅ Read from file system
- Source Distribution: ✅ Estimated (based on file count)
- Action Types: ✅ Estimated
- Run History: ✅ Read from file system
- Run Details: ✅ Parsed from note files

**Recommendation**: Fix the Instance context issue to ensure data is correctly written to the database, then remove the file system fallback logic to maintain a single source of truth.
