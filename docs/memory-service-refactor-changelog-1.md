# Memory Service Refactor - Changelog

**Date:** 2026-03-11  
**Branch:** v2  
**Version:** 1.2.10

---

## Overview

This document details the refactoring of the Memory Service System to achieve production-grade standards. The refactoring addresses three core modules: `SessionMemoryService`, `EvolutionMemoryService`, and `ProjectMemoryService`, with a focus on persistence, search enhancement, and robust error handling.

---

## Files Modified

### 1. `packages/opencode/src/memory/session_memory.sql.ts` (NEW)

**Purpose:** Defines SQLite database schemas for persistent memory storage.

**Content:**

```typescript
// Tables defined:
// - session_memory: Stores session-level memories with TTL support
// - session_message: Stores individual messages within sessions
// - project_memory: Stores project-level knowledge and patterns
// - project_memory_relation: Stores relationships between project entities
```

**Schema Details:**

| Table | Columns | Purpose |
|-------|---------|---------|
| `session_memory` | `id`, `agent_ids`, `created_at`, `expires_at`, `time_created`, `time_updated` | Session container with TTL |
| `session_message` | `id`, `session_id`, `role`, `content`, `agent_id`, `timestamp` | Individual messages |
| `project_memory` | `id`, `entity_type`, `entity_id`, `title`, `content`, `file_path`, `line_number`, `metadata`, `embedding` | Project entities |
| `project_memory_relation` | `id`, `source_id`, `target_id`, `relation_type`, `weight` | Entity relationships |

**Indexes Created:**
- `session_memory_expires_idx` - For efficient TTL cleanup
- `session_message_session_idx` - For fast message lookup by session
- `project_memory_entity_type_idx`, `project_memory_entity_id_idx`, `project_memory_file_path_idx` - For entity queries
- `project_memory_relation_source_idx`, `project_memory_relation_target_idx` - For relation traversals

---

### 2. `packages/opencode/src/memory/service.ts` (MODIFIED)

**Purpose:** Core memory service implementation with three-level architecture.

#### 2.1 New Custom Error Types

```typescript
// MissingParameterError - Thrown when required parameters are missing
export const MissingParameterError = NamedError.create(
  "MissingParameterError",
  z.object({
    parameter: z.string(),
    context: z.string(),
  }),
)

// UnsupportedMemoryTypeError - Thrown for invalid memory types
export const UnsupportedMemoryTypeError = NamedError.create(
  "UnsupportedMemoryTypeError",
  z.object({
    type: z.string(),
    supportedTypes: z.array(z.string()),
  }),
)

// ServiceNotInitializedError - Thrown when service is not ready
export const ServiceNotInitializedError = NamedError.create(
  "ServiceNotInitializedError",
  z.object({
    service: z.string(),
  }),
)

// SessionNotFoundError - Thrown when session doesn't exist
export const SessionNotFoundError = NamedError.create(
  "SessionNotFoundError",
  z.object({
    sessionId: z.string(),
  }),
)
```

#### 2.2 New Type Definitions

```typescript
interface MemoryResult {
  id: string
  type: MemoryType
  content: string
  similarity: number
  metadata?: Record<string, unknown>
}

interface SessionData {
  id: string
  agentIds: string[]
  messages: SessionMessage[]
  createdAt: number
  expiresAt: number
}

interface SessionMessage {
  id: string
  role: "user" | "assistant" | "agent" | "system"
  content: string
  agentId?: string
  timestamp: number
}

interface ProjectNode {
  entityType: string
  entityId: string
  title: string
  content?: string
  filePath?: string
  lineNumber?: number
  metadata?: Record<string, unknown>
}

interface IndexProjectOptions {
  files: Array<{ path: string; content: string; type?: string }>
  clearExisting?: boolean
}
```

#### 2.3 SessionMemoryService Changes

**Before (Memory-based):**
```typescript
class SessionMemoryService {
  private sessions = new Map<string, {...}>()  // Lost on restart
  
  async searchSession(sessionId, query) {
    // Simple includes() matching only
    return session.messages.filter(m => 
      m.content.toLowerCase().includes(queryLower)
    )
  }
}
```

**After (SQLite-backed):**
```typescript
class SessionMemoryService {
  // SQLite persistence via Database.use()
  
  async createSession(agentIds: string[], ttlMinutes = 60): Promise<string>
  async loadSession(sessionId: string): Promise<SessionData | null>
  async saveSession(session: SessionData): Promise<void>
  async addMessage(sessionId, message): Promise<void> // Throws SessionNotFoundError
  
  async searchSession(sessionId, query, options?: { limit?, useRegex? }) {
    // Multi-keyword matching with TF-IDF-like scoring
    // Optional regex support
    // Vector semantic search integration
    // Combined scoring and ranking
  }
  
  async cleanup(): Promise<number> {
    // Async database scan and delete expired sessions
  }
}
```

**Key Improvements:**
1. **Persistence:** Data survives application restarts via SQLite storage
2. **Search Enhancement:** 
   - Multi-keyword matching with scoring
   - Optional regex support
   - Vector semantic search integration
   - TF-IDF-like relevance scoring
3. **Cleanup Mechanism:** Database-scanned TTL cleanup instead of in-memory iteration

#### 2.4 ProjectMemoryService Changes

**Before (Empty Implementation):**
```typescript
class ProjectMemoryService {
  async indexProject(): Promise<{ entitiesAdded: number }> {
    return { entitiesAdded: 0 }  // No-op
  }
  
  async indexChanges(changes): Promise<void> {}  // Empty
  
  async searchProject(_query, limit = 10): Promise<MemoryResult[]> {
    return []  // Always empty
  }
}
```

**After (Full Implementation):**
```typescript
class ProjectMemoryService {
  async indexProject(options: IndexProjectOptions): Promise<{
    entitiesAdded: number
    relationsAdded: number
  }> {
    // Extract code entities (functions, classes, interfaces, types, constants)
    // Store in project_memory table
    // Create embeddings for semantic search
    // Extract import relations
    // Store in project_memory_relation table
  }
  
  async indexChanges(changes: Array<{ file, type, content? }>): Promise<void> {
    // Handle add/modify/delete operations
    // Update project_memory accordingly
  }
  
  async searchProject(query: string, limit = 10): Promise<MemoryResult[]> {
    // Search by entity name, file path, content
    // Vector search integration
    // Merged and ranked results
  }
  
  async getEntity(id: string): Promise<MemoryResult | null>
  async getStats(): Promise<{ totalEntities: number; byType: Record<string, number> }>
}
```

**Entity Extraction Patterns:**
```typescript
const entityPatterns = [
  { pattern: /(?:export\s+)?function\s+(\w+)/g, type: "function" },
  { pattern: /(?:export\s+)?class\s+(\w+)/g, type: "class" },
  { pattern: /(?:export\s+)?interface\s+(\w+)/g, type: "interface" },
  { pattern: /(?:export\s+)?type\s+(\w+)/g, type: "type" },
  { pattern: /(?:export\s+)?const\s+(\w+)/g, type: "constant" },
]
```

#### 2.5 MemoryService Changes

**Before (Weak Error Handling):**
```typescript
class MemoryService {
  async add(params): Promise<AddMemoryResult[]> {
    switch (params.memoryType) {
      case "session":
        // Silent return if sessionId missing
        return []
      default:
        return []  // No error for unknown types
    }
  }
}
```

**After (Robust Error Handling):**
```typescript
class MemoryService {
  private initPromise: Promise<void> | null = null  // Prevent concurrent init
  
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new ServiceNotInitializedError({ service: "MemoryService" })
    }
  }
  
  async add(params: AddMemoryParams): Promise<AddMemoryResult[]> {
    this.ensureInitialized()
    
    switch (params.memoryType) {
      case "session": {
        const sessionId = params.metadata?.sessionId as string
        if (!sessionId) {
          throw new MissingParameterError({
            parameter: "metadata.sessionId",
            context: "Session memory requires a sessionId",
          })
        }
        // ... implementation
      }
      case "evolution": {
        // ... implementation
      }
      case "project": {
        // ... implementation
      }
      default:
        throw new UnsupportedMemoryTypeError({
          type: String((params as any).memoryType),
          supportedTypes: ["session", "evolution", "project"],
        })
    }
  }
}
```

**Key Improvements:**
1. **Initialization Protection:** `initPromise` prevents concurrent initialization
2. **Strict Parameter Validation:** Throws `MissingParameterError` for missing required params
3. **Type Safety:** Throws `UnsupportedMemoryTypeError` for unknown types
4. **State Checking:** `ensureInitialized()` guards all operations

---

### 3. `packages/opencode/src/memory/index.ts` (MODIFIED)

**Before:**
```typescript
export { Memory, MemoryService, type MemoryResult, type CrossMemoryResult, type AddMemoryResult } from "./service"
```

**After:**
```typescript
// Core service exports
export { Memory, MemoryService } from "./service"

// Type exports
export type {
  MemoryResult,
  CrossMemoryResult,
  AddMemoryResult,
  SessionData,
  SessionMessage,
  ProjectNode,
  ProjectRelation,
  AdvancedSearchOptions,
  IndexProjectOptions,
} from "./service"

// Error exports
export {
  MissingParameterError,
  UnsupportedMemoryTypeError,
  ServiceNotInitializedError,
  SessionNotFoundError,
} from "./service"

// Re-export types from collab
export type { MemoryType, AddMemoryParams, SearchParams, MemoryRef } from "../collab/types"
```

---

### 4. `packages/opencode/src/storage/schema.ts` (MODIFIED)

**Before:**
```typescript
export { ControlAccountTable } from "../control/control.sql"
export { SessionTable, MessageTable, PartTable, TodoTable, PermissionTable } from "../session/session.sql"
export { SessionShareTable } from "../share/share.sql"
export { ProjectTable } from "../project/project.sql"
```

**After:**
```typescript
export { ControlAccountTable } from "../control/control.sql"
export { SessionTable, MessageTable, PartTable, TodoTable, PermissionTable } from "../session/session.sql"
export { SessionShareTable } from "../share/share.sql"
export { ProjectTable } from "../project/project.sql"
// New exports for memory system
export { session_memory, session_message, project_memory, project_memory_relation } from "../memory/session_memory.sql"
```

---

## Database Migration Required

A new migration should be generated to create the new tables:

```bash
bun run db generate --name memory_service_tables
```

Expected migration SQL:
```sql
CREATE TABLE session_memory (
  id TEXT PRIMARY KEY,
  agent_ids TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);

CREATE TABLE session_message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session_memory(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  agent_id TEXT,
  timestamp INTEGER NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);

CREATE TABLE project_memory (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  file_path TEXT,
  line_number INTEGER,
  metadata TEXT,
  embedding TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);

CREATE TABLE project_memory_relation (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES project_memory(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES project_memory(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  weight INTEGER DEFAULT 1,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);

-- Indexes
CREATE INDEX session_memory_expires_idx ON session_memory(expires_at);
CREATE INDEX session_message_session_idx ON session_message(session_id);
CREATE INDEX project_memory_entity_type_idx ON project_memory(entity_type);
CREATE INDEX project_memory_entity_id_idx ON project_memory(entity_id);
CREATE INDEX project_memory_file_path_idx ON project_memory(file_path);
CREATE INDEX project_memory_relation_source_idx ON project_memory_relation(source_id);
CREATE INDEX project_memory_relation_target_idx ON project_memory_relation(target_id);
```

---

## Usage Examples

### Error Handling

```typescript
import { 
  Memory, 
  MissingParameterError, 
  UnsupportedMemoryTypeError,
  ServiceNotInitializedError,
  SessionNotFoundError 
} from "@opencode-ai/memory"

// Handle missing parameter error
try {
  await Memory.add({
    memoryType: "session",
    content: "test content"
    // Missing sessionId
  })
} catch (error) {
  if (error instanceof MissingParameterError) {
    console.error(`Missing: ${error.data.parameter}`)
    console.error(`Context: ${error.data.context}`)
    // Output: Missing: metadata.sessionId
    //         Context: Session memory requires a sessionId in metadata
  }
}

// Handle unsupported type error
try {
  await Memory.add({
    memoryType: "unknown" as any,
    content: "test"
  })
} catch (error) {
  if (error instanceof UnsupportedMemoryTypeError) {
    console.error(`Unsupported type: ${error.data.type}`)
    console.error(`Supported types: ${error.data.supportedTypes.join(", ")}`)
    // Output: Unsupported type: unknown
    //         Supported types: session, evolution, project
  }
}

// Handle session not found
try {
  await Memory.getSessionService().addMessage("non-existent-session", {
    role: "user",
    content: "Hello"
  })
} catch (error) {
  if (error instanceof SessionNotFoundError) {
    console.error(`Session not found: ${error.data.sessionId}`)
  }
}
```

### Correct Usage

```typescript
import { Memory } from "@opencode-ai/memory"

// Initialize (automatic on first use, but can be called explicitly)
await Memory.init()

// Create and use session memory
const sessionId = await Memory.createSession(["agent-1", "agent-2"])

await Memory.add({
  memoryType: "session",
  content: "User prefers TypeScript over JavaScript",
  metadata: { sessionId, role: "user" }
})

// Search session memory with regex
const results = await Memory.search({
  query: "TypeScript|JavaScript",
  memoryType: "session",
  limit: 10
}, { useRegex: true })

// Index project files
await Memory.getProjectService().indexProject({
  files: [
    { path: "src/index.ts", content: "export function main() {}" },
    { path: "src/utils.ts", content: "export const helper = () => {}" }
  ],
  clearExisting: true
})

// Search project entities
const entities = await Memory.search({
  query: "helper function",
  memoryType: "project"
})
```

---

## Breaking Changes

1. **SessionMemoryService constructor signature:** No longer accepts in-memory Map
2. **Missing parameters now throw errors:** Instead of silently returning empty results
3. **Unknown memory types throw errors:** Instead of returning empty array
4. **New required fields:** `metadata.sessionId` is now required for session memory type

---

## Testing Recommendations

1. **Unit tests for error handling:**
   - Test `MissingParameterError` for all required parameters
   - Test `UnsupportedMemoryTypeError` for invalid types
   - Test `ServiceNotInitializedError` before initialization

2. **Integration tests:**
   - Test session persistence across simulated restarts
   - Test TTL cleanup with expired sessions
   - Test project indexing with real TypeScript files

3. **Performance tests:**
   - Benchmark search with large message counts
   - Test vector search performance with many embeddings

---

## Checklist

- [x] Create `session_memory.sql.ts` with table definitions
- [x] Refactor `SessionMemoryService` with SQLite persistence
- [x] Implement `ProjectMemoryService` core logic
- [x] Add robust error handling to `MemoryService`
- [x] Update type exports in `index.ts`
- [x] Update schema exports in `schema.ts`
- [x] TypeScript type check passes
- [ ] Generate database migration
- [ ] Run integration tests
- [ ] Update AGENTS.md with new commands (if needed)
