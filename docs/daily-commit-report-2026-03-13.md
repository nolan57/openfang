# Daily Commit Report - 2026-03-13

This report summarizes all commits made on March 13, 2026.

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Total Commits | 15 |
| Files Modified | 21 |
| Files Created | 17 |
| Lines Added | ~7,500 |
| Lines Removed | ~951 |

---

## Commit Details

### 1. fix(cli): prevent infinite process spawning on startup

**Commit:** `8d012f6659081dc0b4584952be622d02da88a12d`

**Reason:** Fixed a critical bug where the CLI launcher could spawn infinite processes when the binary path resolved to the launcher script itself.

**Changes:**

| Status | File Path |
|--------|-----------|
| Modified | `packages/opencode/bin/opencode` |
| Modified | `packages/opencode/src/cli/cmd/pr.ts` |

**Details:**
- Added self-reference detection in `bin/opencode` launcher to prevent infinite loops
- Validated `OPENCODE_BIN_PATH` and cached binary path before execution
- Used `getOpencodeCommand()` in `pr.ts` to safely spawn opencode process with correct binary path
- Added cross-platform support using `path.basename` for interpreter detection
- Added error logging for `gh` CLI failures with stderr output
- Added try-catch for JSON parsing of PR info

**Impact:** 2 files changed, 126 insertions(+), 11 deletions(-)

---

### 2. fix(storage): improve sqlite-vec extension loading for compiled binaries and symlinks

**Commit:** `0281e76ef9b36ba5c3fa3f894da5ce2d37622804`

**Reason:** Improved reliability of sqlite-vec extension loading across different installation methods and environments.

**Changes:**

| Status | File Path |
|--------|-----------|
| Modified | `packages/opencode/src/storage/db.ts` |

**Details:**
- Added `SQLITE_VEC_PATH` environment variable support for explicit path override
- Implemented multiple path resolution strategies in priority order:
  1. Environment variable (highest priority)
  2. Relative to executable path
  3. Resolved symlink location
  4. Current working directory
  5. User home directory locations
  6. Global bun install location
  7. Platform-specific global locations (Windows/Linux/macOS)
  8. `import.meta.dirname` (development mode, last resort)
- Used `realpathSync` to resolve symlinks for accurate path detection
- Added cross-platform support for common installation directories
- Improved error messages with installation hints

**Impact:** 1 file changed, 147 insertions(+), 31 deletions(-)

---

### 3. fix(learning): remove duplicate table definitions for knowledge_node and knowledge_edge

**Commit:** `5c9916e6a5e87bbb37cdafca845022b14a0da9f9`

**Reason:** Eliminated duplicate table definitions that caused schema conflicts and inconsistency.

**Changes:**

| Status | File Path |
|--------|-----------|
| Modified | `packages/opencode/src/learning/knowledge-graph.ts` |
| Modified | `packages/opencode/src/learning/learning.sql.ts` |

**Details:**
- Renamed `knowledge_node`/`knowledge_edge` to plural forms (`knowledge_nodes`/`knowledge_edges`) in `learning.sql.ts` for consistency
- Removed duplicate table definitions from `knowledge-graph.ts`
- Imported and re-exported table definitions from `learning.sql.ts` in `knowledge-graph.ts`
- Added backward compatibility aliases with `@deprecated` annotations

**Impact:** 2 files changed, 11 insertions(+), 25 deletions(-)

---

### 4. fix(storage): improve macOS SQLite path detection for Homebrew compatibility

**Commit:** `c08905ffcd1a919c6f06500369c981ce5af5902e`

**Reason:** Fixed SQLite path detection issues on macOS, particularly for Homebrew installations.

**Changes:**

| Status | File Path |
|--------|-----------|
| Modified | `packages/opencode/src/storage/db.ts` |

**Details:**
- Added `SQLITE_CUSTOM_PATH` environment variable support (highest priority)
- Auto-detected from Homebrew Cellar with version parsing
- Fallback to known common paths
- Used `import.meta.dirname` as last resort

**Impact:** 1 file changed, 89 insertions(+), 1 deletion(-)

---

### 5. refactor(learning): add vector store interface abstraction

**Commit:** `600054399f8f04855a71cf0b702b850a4668363b`

**Reason:** Abstracted the vector store implementation to enable future migration to different backends (e.g., pgvector, external vector DBs).

**Changes:**

| Status | File Path |
|--------|-----------|
| Created | `packages/opencode/src/learning/sqlite-vec-store.ts` |
| Created | `packages/opencode/src/learning/vector-store-interface.ts` |
| Modified | `packages/opencode/src/learning/vector-store.ts` |

**Details:**
- Created `IVectorStore` interface for different vector backends
- Implemented `SqliteVecStore` using sqlite-vec extension
- Updated `VectorStore` as backward compatible facade
- Enabled future migration to pgvector or external vector DBs

**Impact:** 3 files changed, 848 insertions(+), 625 deletions(-)

---

### 6. refactor(memory): use shared VectorStore instance across modules

**Commit:** `7983fb78d3a3e4117d522872511b8b7946a21a0b`

**Reason:** Eliminated duplicate VectorStore instances across modules to reduce memory footprint and ensure consistent configuration.

**Changes:**

| Status | File Path |
|--------|-----------|
| Modified | `packages/opencode/src/evolution/memory.ts` |
| Modified | `packages/opencode/src/learning/dynamic-query-generator.ts` |
| Modified | `packages/opencode/src/learning/hierarchical-memory.ts` |
| Modified | `packages/opencode/src/learning/media-store.ts` |
| Modified | `packages/opencode/src/learning/vector-store.ts` |
| Modified | `packages/opencode/src/memory/service.ts` |
| Modified | `packages/opencode/src/observability/instrumented-hierarchical-memory.ts` |

**Details:**
- Added `getSharedVectorStore()` for singleton pattern
- Updated MemoryService to use shared instance via `IVectorStore`
- Updated HierarchicalMemory, MediaStore, DynamicQueryGenerator
- Updated evolution/memory.ts and observability module
- Replaced `embedAndStore` with `store` method
- Replaced `deleteByNodeId` with `deleteById` where appropriate

**Benefits:**
- Single VectorStore instance shared across all modules
- Reduced memory footprint and connection overhead
- Consistent configuration across the application
- Backward compatible with existing code

**Impact:** 7 files changed, 146 insertions(+), 72 deletions(-)

---

### 7. refactor(memory): unify MemoryService as single entry point

**Commit:** `6069442b9a13ad01294cfa3fd2d9a5ec8af6173d`

**Reason:** Consolidated memory operations under a single unified API to eliminate code duplication and provide consistent memory access patterns.

**Changes:**

| Status | File Path |
|--------|-----------|
| Modified | `packages/opencode/src/evolution/memory.ts` |
| Modified | `packages/opencode/src/memory/service.ts` |
| Modified | `packages/opencode/src/session/prompt.ts` |
| Modified | `packages/opencode/src/tool/memory.ts` |

**Details:**
- Added `getRelevantMemories()` with hybrid search combining:
  - Vector similarity search
  - Keyword matching
  - Temporal decay scoring
  - MMR (Maximal Marginal Relevance) re-ranking
- Added `extractMemoriesWithLLM()` for LLM-based memory extraction
- Updated `session/prompt.ts` to use unified Memory singleton
- Simplified `tool/memory.ts` to use `Memory.getRelevantMemories()`
- Deprecated `evolution/memory.ts`, kept as re-export for backward compatibility

**Benefits:**
- Single entry point for all memory operations
- Consistent API across the application
- Hybrid search improves memory relevance
- Backward compatible through re-exports

**Impact:** 4 files changed, 405 insertions(+), 404 deletions(-)

---

### 8. docs: add documentation and daily commit report

**Commit:** `0f8b9f70b`

**Reason:** Added documentation files for session processing analysis, prompt evolution planning, and daily commit report.

**Changes:**

| Status | File Path |
|--------|-----------|
| Created | `docs/daily-commit-report-2026-03-13.md` |
| Created | `docs/llm-session-processing-analysis.md` |
| Created | `docs/plans/perfect-prompt.md` |
| Created | `docs/plans/prompt-evo.md` |
| Created | `docs/prompt-files-analysis.md` |

**Details:**
- Added daily commit report summarizing all work done on 2026-03-13
- Added LLM session processing analysis documentation
- Added prompt-related planning documents for future improvements

**Impact:** 5 files changed, 1848 insertions(+)

---

### 9. feat(storage): add periodic database backup

**Commit:** `05d1b4503`

**Reason:** Implemented scheduled database backups to ensure data safety, rather than only backing up on specific events.

**Changes:**

| Status | File Path |
|--------|-----------|
| Modified | `packages/opencode/src/index.ts` |
| Modified | `packages/opencode/src/storage/db.ts` |

**Details:**
- Added `startPeriodicBackup()` function using the Scheduler module
- Default backup interval: 30 minutes (configurable)
- Uses global scope to ensure single backup timer across instances
- Lazy imports Scheduler to avoid circular dependencies
- Backup runs on startup and then at configured intervals
- Still retains exit-time backup for graceful shutdown scenarios

**Benefits:**
- Automatic data protection without user intervention
- Reduced risk of data loss from unexpected crashes
- Configurable backup interval via parameter
- Non-blocking operation using Scheduler

**Impact:** 2 files changed, 74 insertions(+), 45 deletions(-)

---

### 10. docs: update daily commit report with latest changes

**Commit:** `082f2a829`

**Reason:** Updated the daily commit report to include all commits made throughout the day.

**Changes:**

| Status | File Path |
|--------|-----------|
| Modified | `docs/daily-commit-report-2026-03-13.md` |

**Details:**
- Updated summary statistics to reflect 9 total commits
- Added entries for periodic backup and documentation commits
- Updated thematic summary with new categories

**Impact:** 1 file changed, 123 insertions(+), 23 deletions(-)

---

### 11. refactor(storage): improve db.ts robustness and maintainability

**Commit:** `29ac10d5d`

**Reason:** Addressed three critical improvements to the database module for better reliability and maintainability.

**Changes:**

| Status | File Path |
|--------|-----------|
| Modified | `packages/opencode/src/storage/db.ts` |

**Details:**

**1. Backup Mechanism Optimization:**
- Added WAL checkpoint (`PRAGMA wal_checkpoint(TRUNCATE)`) before backup
- Ensures backup is a consistent snapshot by merging WAL content into main database
- Eliminates race condition between backup copy and ongoing WAL writes

**2. Dynamic sqlite-vec Version Scanning:**
- Removed hardcoded version string (`0.1.7-alpha.2`)
- Implemented dynamic scanning of `node_modules/.bun` directory
- Sorts versions semantically and selects the newest
- More resilient to package updates

**3. Transaction Context Robustness:**
- Added debug logging when starting new transaction roots
- Explicitly clear effects array on transaction rollback
- Added comments documenting the effects protection mechanism

**Benefits:**
- Atomic backup synchronization with WAL checkpoint
- No more version-specific hardcoded paths
- Better debugging visibility for transaction lifecycle
- Effects are guaranteed not to execute on rollback

**Impact:** 1 file changed, 84 insertions(+), 13 deletions(-)

---

### 12. feat(learning): enhance memory system with unified embedding, encryption, and compression

**Commit:** `939ebe989`

**Reason:** Comprehensive enhancement of the memory system implementing unified embedding strategy, sensitive content encryption, global cognitive graph, dynamic query loop, and memory compression.

**Changes:**

| Status | File Path |
|--------|-----------|
| Created | `packages/opencode/src/learning/embedding-service.ts` |
| Created | `packages/opencode/src/session/handlers.ts` |
| Created | `packages/opencode/src/util/encryption.ts` |
| Created | `packages/opencode/migration/20260313194937_knowledge_graph_indexes/migration.sql` |
| Created | `packages/opencode/migration/20260313_memory_type_field/migration.sql` |
| Modified | `packages/opencode/src/evolution/store.ts` |
| Modified | `packages/opencode/src/evolution/types.ts` |
| Modified | `packages/opencode/src/learning/dynamic-query-generator.ts` |
| Modified | `packages/opencode/src/learning/index.ts` |
| Modified | `packages/opencode/src/learning/knowledge-graph.ts` |
| Modified | `packages/opencode/src/learning/learning.sql.ts` |
| Modified | `packages/opencode/src/learning/media-store.ts` |
| Modified | `packages/opencode/src/learning/sqlite-vec-store.ts` |
| Modified | `packages/opencode/src/learning/vector-store-interface.ts` |
| Modified | `packages/opencode/src/learning/vector-store.ts` |
| Modified | `packages/opencode/src/session/prompt.ts` |
| Modified | `packages/opencode/src/session/prompts/types.ts` |
| Modified | `packages/opencode/src/storage/db.ts` |
| Modified | `packages/opencode/src/tool/memory.ts` |

**Details:**

**1. Unified Embedding Strategy (Target 1):**
- Created `EmbeddingService` for auto-detecting embedding model dimensions
- Supports 40+ known embedding models (OpenAI, Cohere, Google, Mistral, etc.)
- Three-level detection: config > known models > API probe > default
- Auto-configures `EMBEDDING_DIM` environment variable
- Updated `media-store.ts` and `vector-store.ts` to use unified service
- Records `embeddingModel` in VectorEntry metadata for debugging

**2. Sensitive Content Encryption (Target 4a):**
- Created `util/encryption.ts` using Web Crypto API (no external dependencies)
- AES-GCM encryption with 256-bit keys
- Requires `MEMORY_ENCRYPTION_KEY` environment variable (explicit configuration to prevent data loss)
- `saveMemory()` accepts `options.sensitive` parameter
- Automatic decryption on `getMemories()` with error handling
- Key generation command: `openssl rand -base64 32`

**3. Global Cognitive Graph (Target 2):**
- Added `memory_type` field to `knowledge_nodes` table (`session` | `evolution` | `project` | `media`)
- Added new relation types: `evolves_to`, `references`, `contains`
- Implemented `linkMemories()` for cross-type linking
- Implemented `getLinkedMemories()` with direction and type filtering
- Database migration for new field and index

**4. Dynamic Query Closed Loop (Target 3):**
- Implemented `executeGeneratedQueries()` for complete feedback loop
- Flow: Generate queries → Execute searches → Store results → Record gaps
- New types: `QueryExecutionResult`, `QueryLoopResult`
- Stores successful results as `query_feedback` memories
- Records unresolved knowledge gaps with high priority

**5. Memory Compression (Target 4b):**
- Implemented `getMemoryStats()` for storage analysis
- Implemented `archiveMemory()` for soft-delete (marks as archived, not deleted)
- Implemented `summarizeSimilarMemories()` using LLM to consolidate related memories
- Implemented `runMemoryCompression()` for batch processing
- New fields: `archived`, `archivedAt`, `archivedReason`, `summaryFor`
- Compression threshold configurable (default: 3 similar memories)

**6. Session Handlers (Target 4 - from earlier session):**
- Created modular handlers for decoupled main loop
- `handleSubtask()`, `handleCompaction()`, `handleContextOverflow()`
- `handleMemoryInjection()` with context-aware filtering
- `handleDynamicMemoryRefresh()` for topic drift detection
- `handleMemoryUsageFeedback()` for usage tracking

**7. Database Migrations:**
- `20260313194937_knowledge_graph_indexes`: Indexes for knowledge graph queries
- `20260313_memory_type_field`: memory_type column and index

**Benefits:**
- Consistent vector space across all embedding operations
- Secure storage for sensitive memories with explicit key management
- Cross-type memory relationships enable unified cognitive graph
- Closed-loop learning with automatic gap detection
- Automatic memory consolidation reduces storage bloat
- Modular architecture improves code maintainability

**Impact:** 23 files changed, 2979 insertions(+), 162 deletions(-)

---

### 13. fix(storage): auto-use stored embedding dimension when EMBEDDING_DIM not set

**Commit:** `60f382c1d`

**Reason:** Fixed a critical bug where the application would fail to start when `EMBEDDING_DIM` environment variable was not set but the database had stored dimension from previous sessions (e.g., 1536 from `text-embedding-3-small`).

**Changes:**

| Status | File Path |
|--------|-----------|
| Modified | `packages/opencode/src/storage/db.ts` |

**Details:**

**Previous Behavior:**
- `validateVectorDimensions()` used hardcoded `DEFAULT_EMBEDDING_DIM = 384`
- If database had stored dimension (e.g., 1536) but no `EMBEDDING_DIM` env was set
- Would throw `VectorDimensionMismatchError` and block startup

**New Logic:**
1. If `EMBEDDING_DIM` env is explicitly set → validate against stored dimension, error if mismatch
2. If no env set and database has stored dimension → use stored dimension (preserve existing vectors)
3. If fresh database (no stored dimension) → use `DEFAULT_EMBEDDING_DIM = 384`
4. Auto-updates `process.env.EMBEDDING_DIM` so `EmbeddingService` picks up correct dimension

**Benefits:**
- No manual `EMBEDDING_DIM` configuration required for existing databases
- Automatic preservation of existing vector data
- Clear error message only when user explicitly sets conflicting dimension
- Seamless migration between different embedding models

**Impact:** 1 file changed, 52 insertions(+), 20 deletions(-)

---

### 14. fix: properly close MCP servers on exit

**Commit:** `fdfad021a`

**Reason:** Fixed a critical bug where MCP server processes were left running after the main application exited.

**Changes:**

| Status | File Path |
|--------|-----------|
| Modified | `packages/opencode/src/index.ts` |

**Details:**

**Previous Behavior:**
- `index.ts` finally block called `process.exit()` directly
- MCP clients were created via `Instance.state()` with dispose functions
- Dispose functions were never called on exit
- MCP server processes (subprocesses, Docker containers) remained running

**New Behavior:**
- Added `Instance.disposeAll()` call in finally block before `process.exit()`
- Updated SIGINT/SIGTERM handlers to also trigger `Instance.disposeAll()`
- MCP clients are now properly closed via their registered dispose hooks

**How It Works:**
1. `Instance.disposeAll()` iterates all state instances
2. MCP module's dispose function closes all MCP client connections
3. MCP client `close()` method terminates server processes
4. Then `process.exit()` is called

**Benefits:**
- No orphaned MCP server processes after exit
- Clean shutdown of Docker-based MCP servers
- Proper resource cleanup on SIGINT/SIGTERM

**Impact:** 1 file changed, 13 insertions(+), 1 deletion(-)

---

### 15. feat(scheduler): implement in-process job scheduling with cron support

**Commit:** `pending`

**Reason:** Implemented a comprehensive in-process job scheduling system to replace the external mcp-cron approach, which spawned new processes for each task execution.

**Changes:**

| Status | File Path |
|--------|-----------|
| Created | `packages/opencode/src/scheduler/types.ts` |
| Created | `packages/opencode/src/scheduler/job.sql.ts` |
| Created | `packages/opencode/src/scheduler/job.ts` |
| Created | `packages/opencode/src/scheduler/cron.ts` |
| Created | `packages/opencode/src/scheduler/executor.ts` |
| Modified | `packages/opencode/src/scheduler/index.ts` |
| Created | `packages/opencode/src/server/routes/scheduler.ts` |
| Modified | `packages/opencode/src/server/server.ts` |
| Created | `packages/opencode/migration/20260313000000_scheduler_system/migration.sql` |

**Details:**

**Architecture:**
```
Previous (mcp-cron):
  opencode → mcp-cron (node) → spawn opencode run (new process per task)

New (in-process):
  opencode → internal Scheduler (in-process task execution)
          → HTTP API for job management
```

**Components:**

1. **Type System (`types.ts`):**
   - `CronSchedule`: cron expression, interval, or one-time execution
   - `CronPayload`: agentTurn (AI tasks) or systemEvent (shell commands)
   - `JobOptions`: timeout, retry, deleteAfterRun settings
   - `ExecutionStatus`: pending, running, success, failed, cancelled

2. **Database Schema (`job.sql.ts`):**
   - `scheduler_job`: job definitions with schedule, payload, options
   - `scheduler_execution`: execution history with status tracking
   - `scheduler_log`: execution logs for debugging

3. **Job Management (`job.ts`):**
   - CRUD operations for jobs
   - Execution record management
   - Log appending and retrieval
   - State updates after execution

4. **Cron Parser (`cron.ts`):**
   - Uses `cron-parser` library for cron expression parsing
   - `getNextRunTime()`: calculates next execution time
   - `validateCronExpression()`: validates cron syntax
   - `describeSchedule()`: human-readable schedule description

5. **Executor (`executor.ts`):**
   - `executeJob()`: main execution entry point
   - `executeAgentTurn()`: in-process AI task execution via Session API
   - `executeSystemEvent()`: shell command execution via Bun.$
   - Timeout and heartbeat management
   - AbortController for cancellation support

6. **HTTP API (`routes/scheduler.ts`):**
   - `GET /scheduler`: list all jobs
   - `POST /scheduler`: create job
   - `GET /scheduler/:id`: get job details
   - `PATCH /scheduler/:id`: update job
   - `DELETE /scheduler/:id`: delete job
   - `POST /scheduler/:id/enable`: enable job
   - `POST /scheduler/:id/disable`: disable job
   - `POST /scheduler/:id/execute`: manual trigger
   - `GET /scheduler/:id/executions`: execution history
   - `GET /scheduler/execution/:id/logs`: execution logs
   - `POST /scheduler/describe`: describe schedule with next run times

**Benefits:**
- No process spawning overhead
- Shared memory and caching
- Faster task execution
- Simpler deployment (no external mcp-cron service)
- Direct access to Session API for agent tasks
- Consistent with OpenCode's internal architecture

**Impact:** 9 files changed, ~800 insertions(+)

---

## Files Summary

### New Files Created

| File Path | Purpose |
|-----------|---------|
| `packages/opencode/src/learning/sqlite-vec-store.ts` | SqliteVecStore implementation using sqlite-vec extension |
| `packages/opencode/src/learning/vector-store-interface.ts` | IVectorStore interface for vector backend abstraction |
| `packages/opencode/src/learning/embedding-service.ts` | Unified embedding service with auto-detection |
| `packages/opencode/src/session/handlers.ts` | Modular handlers for session main loop |
| `packages/opencode/src/util/encryption.ts` | Web Crypto API encryption utilities |
| `packages/opencode/src/scheduler/types.ts` | Scheduler type definitions |
| `packages/opencode/src/scheduler/job.sql.ts` | Scheduler database schema |
| `packages/opencode/src/scheduler/job.ts` | Job management operations |
| `packages/opencode/src/scheduler/cron.ts` | Cron expression parsing |
| `packages/opencode/src/scheduler/executor.ts` | In-process task execution |
| `packages/opencode/src/server/routes/scheduler.ts` | Scheduler HTTP API routes |
| `packages/opencode/migration/20260313194937_knowledge_graph_indexes/migration.sql` | Database migration for KG indexes |
| `packages/opencode/migration/20260313_memory_type_field/migration.sql` | Database migration for memory_type field |
| `packages/opencode/migration/20260313000000_scheduler_system/migration.sql` | Database migration for scheduler tables |
| `docs/daily-commit-report-2026-03-13.md` | Daily commit report summarizing all work |
| `docs/llm-session-processing-analysis.md` | LLM session processing analysis |
| `docs/prompt-files-analysis.md` | Prompt files analysis |

### Modified Files

| File Path | Commits |
|-----------|---------|
| `packages/opencode/src/storage/db.ts` | 6 |
| `packages/opencode/src/index.ts` | 2 |
| `packages/opencode/src/evolution/store.ts` | 2 |
| `packages/opencode/src/evolution/memory.ts` | 2 |
| `packages/opencode/src/learning/vector-store.ts` | 2 |
| `packages/opencode/src/learning/dynamic-query-generator.ts` | 2 |
| `packages/opencode/src/memory/service.ts` | 2 |
| `packages/opencode/src/learning/knowledge-graph.ts` | 2 |
| `packages/opencode/src/learning/learning.sql.ts` | 2 |
| `packages/opencode/src/learning/media-store.ts` | 2 |
| `packages/opencode/src/session/prompt.ts` | 2 |
| `packages/opencode/src/tool/memory.ts` | 2 |

---

## Thematic Summary

### Bug Fixes (6 commits)
- Fixed infinite process spawning in CLI launcher
- Improved sqlite-vec extension loading reliability
- Fixed duplicate table definitions in learning module
- Improved macOS SQLite path detection for Homebrew
- Fixed embedding dimension auto-detection to use stored dimension when env not set
- Fixed MCP server processes not closing on application exit

### Refactoring (4 commits)
- Abstracted vector store with IVectorStore interface
- Consolidated VectorStore instances using singleton pattern
- Unified MemoryService as single entry point for memory operations
- Improved db.ts robustness: WAL checkpoint backup, dynamic version scanning, transaction context safety

### Features (3 commits)
- Added periodic database backup with configurable interval
- Enhanced memory system with unified embedding, encryption, global cognitive graph, query loop, and compression
- Implemented in-process job scheduling with cron support, HTTP API, and database persistence

### Documentation (2 commits)
- Added daily commit report and session/prompt analysis documents
- Updated daily commit report with latest changes

### Key Architectural Improvements
1. **Vector Store Abstraction**: Created `IVectorStore` interface enabling future migration to pgvector or external vector databases
2. **Singleton Pattern**: Shared VectorStore instance reduces memory footprint and ensures consistent configuration
3. **Unified Memory API**: MemoryService now serves as the single entry point for all memory operations with hybrid search capabilities
4. **Periodic Backup**: Automatic database backups every 30 minutes for data protection
5. **Atomic Backup**: WAL checkpoint before backup ensures consistent snapshots without race conditions
6. **Unified Embedding**: `EmbeddingService` auto-detects dimensions and configures system for consistent vector space
7. **Memory Encryption**: Web Crypto API encryption for sensitive memories with explicit key management
8. **Global Cognitive Graph**: Cross-type memory linking with `memory_type` field and `linkMemories()` API
9. **Query Closed Loop**: Automatic query execution → result storage → gap recording cycle
10. **Memory Compression**: LLM-based summarization of similar memories with archival support
11. **Auto Dimension Detection**: Vector dimension automatically uses stored database value, eliminating manual configuration for existing deployments
12. **MCP Process Cleanup**: Proper shutdown of MCP server processes via `Instance.disposeAll()` ensures no orphaned subprocesses or containers after exit
13. **In-Process Job Scheduling**: Complete scheduler system with cron support, HTTP API, and database persistence replaces external mcp-cron approach that spawned new processes

---

*Report generated on 2026-03-13*