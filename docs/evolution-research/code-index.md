# OpenCode Code Index

## Overview

This document describes the multi-level vector index built for the `packages/opencode` codebase, enabling semantic search across the codebase architecture.

## Generated Files

| File                             | Description                                                   |
| -------------------------------- | ------------------------------------------------------------- |
| `code-index.json`                | Hierarchical module structure with parent-child relationships |
| `code-index-detailed.json`       | Detailed index with purpose, exports, dependencies, keywords  |
| `code-index-vector-entries.json` | Flat vector entries ready for database import                 |

## Index Structure

### Module Index (21 modules)

| Module     | Path           | Purpose                                     |
| ---------- | -------------- | ------------------------------------------- |
| agent      | src/agent      | Agent configurations (build, plan, explore) |
| cli        | src/cli        | Command-line interface and TUI              |
| config     | src/config     | Hierarchical configuration loading          |
| evolution  | src/evolution  | Prompt/skill/memory evolution               |
| file       | src/file       | File operations (watcher, ripgrep)          |
| global     | src/global     | XDG-based path configuration                |
| learning   | src/learning   | Self-improvement system with vector store   |
| lsp        | src/lsp        | Language Server Protocol (20+ languages)    |
| mcp        | src/mcp        | Model Context Protocol integration          |
| permission | src/permission | Tool permission rules                       |
| project    | src/project    | Project management                          |
| provider   | src/provider   | AI provider abstraction (20+ providers)     |
| session    | src/session    | Conversation session management             |
| shell      | src/shell      | Shell command execution                     |
| skill      | src/skill      | Reusable prompt templates                   |
| snapshot   | src/snapshot   | Git-based file versioning                   |
| storage    | src/storage    | SQLite with Drizzle ORM                     |
| tool       | src/tool       | Tool definition and registry                |
| util       | src/util       | Utility functions                           |
| worktree   | src/worktree   | Git worktree isolation                      |
| zeroclaw   | src/zeroclaw   | Secure remote sandbox                       |

### Vector Entries (28 total)

- 21 module-level entries
- 7 core file entries (index.ts, provider.ts, prompt.ts, tool.ts, vector-store.ts, db.ts, server.ts)

## Database Migration

### Target Table

```sql
CREATE TABLE vector_memory (
  id TEXT PRIMARY KEY,
  node_type TEXT NOT NULL,      -- 'module', 'file', 'function', 'concept'
  node_id TEXT NOT NULL,        -- unique identifier
  entity_title TEXT NOT NULL,   -- human-readable title
  vector_type TEXT NOT NULL,    -- 'code' for code entries
  embedding TEXT NOT NULL,      -- JSON array of floats
  model TEXT NOT NULL DEFAULT 'simple',
  dimensions INTEGER NOT NULL DEFAULT 384,
  metadata TEXT,                -- JSON object
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
```

### Import Script

```typescript
// Load vector entries
import entries from "./code-index-vector-entries.json"

// For each entry, generate embedding from content_text
function generateEmbedding(text: string): number[] {
  // Simple hash-based embedding (deterministic, cross-platform)
  // ... implementation from vector-store.ts
}

// Insert into database
for (const entry of entries.vector_entries) {
  const embedding = generateEmbedding(entry.content_text)

  await db.insert(vector_memory).values({
    id: entry.node_id,
    node_type: entry.node_type,
    node_id: entry.node_id,
    entity_title: entry.entity_title,
    vector_type: "code",
    embedding: JSON.stringify(embedding),
    model: "simple",
    dimensions: 384,
    metadata: JSON.stringify(entry.metadata),
    time_created: Date.now(),
    time_updated: Date.now(),
  })
}
```

## Transferring to Other Machines

### Method 1: Copy Database File

```bash
# Copy the entire database
scp user@machineA:/path/to/opencode.db user@machineB:/path/to/
```

### Method 2: Export/Import JSON

```bash
# Export from source machine
sqlite3 opencode.db "SELECT * FROM vector_memory WHERE vector_type='code'" > vectors.json

# Import on target machine (requires schema)
cat vectors.json | sqlite3 opencode.db
```

### Method 3: Regenerate from JSON

```bash
# Copy code-index-vector-entries.json to target
# Run import script to regenerate vectors
```

## Vector Search Usage

```typescript
const results = await vectorStore.search("how does session prompt work", {
  vector_type: "code",
  limit: 5,
})

// Returns matching modules/files with similarity scores
```

## Notes

- Embedding model: `simple` (hash-based, deterministic)
- Dimensions: 384
- Compatible with sqlite-vec for fast cosine similarity search
- Fallback to text similarity when vec is unavailable

## Generated

- Date: 2026-03-06
- Package: packages/opencode
- Total entries: 28
- Total modules: 21

---

## packages/plugin-qqbot

### Overview

QQ Bot Plugin for OpenCode - integrates QQ messaging platform (Tencent QQ) with the AI assistant.

### Generated Files

| File                                                   | Description                                   |
| ------------------------------------------------------ | --------------------------------------------- |
| `packages/plugin-qqbot/code-index.json`                | Hierarchical module structure                 |
| `packages/plugin-qqbot/code-index-vector-entries.json` | Flat vector entries ready for database import |

### Module Index (6 modules)

| Module   | Path            | Purpose                              |
| -------- | --------------- | ------------------------------------ |
| plugin   | src/index.ts    | Plugin entry point                   |
| gateway  | src/gateway.ts  | WebSocket connection management      |
| api      | src/api.ts      | QQ Bot API client                    |
| outbound | src/outbound.ts | Outbound message handling            |
| config   | src/config.ts   | Configuration loading and validation |
| types    | src/types.ts    | TypeScript type definitions          |

### Key Concepts

- **WebSocket Gateway**: Real-time event connection to QQ API
- **Session Management**: Per user/group/channel conversation continuity
- **Message Streaming**: AI responses streamed to QQ with chunked sending
- **Rate Limiting**: Max 4 replies per hour per recipient
- **Media Handling**: Image upload via QQ Bot API
- **Intent System**: Subscribe to specific event types
- **Policy-based Access**: pairing, allowlist, open, disabled policies

### Configuration

Environment variables: `QQBOT_ENABLED`, `QQBOT_APP_ID`, `QQBOT_CLIENT_SECRET`, `QQBOT_DEFAULT_AGENT`, `QQBOT_DM_POLICY`, `QQBOT_GROUP_POLICY`, etc.

### Vector Entries (11 total)

- 6 module-level entries
- 5 core file entries

### Generated

- Date: 2026-03-06
- Package: packages/plugin-qqbot
- Total entries: 11
- Total modules: 6
