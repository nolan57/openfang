---
name: code-indexer
description: Build multi-level vector index for codebase architecture enabling semantic search
---

# Code Indexer Skill

## Description

This skill provides methods to build a multi-level vector index for any codebase, enabling semantic search across module structures, file purposes, and code concepts. The index can be used for long-term consistency and self-evolution.

## Context

For AI coding assistants to maintain context across large codebases and long conversations, having a semantic index of the codebase architecture is essential. This skill generates vector embeddings for:

- **Modules**: Top-level directory structures with purpose descriptions
- **Files**: Individual files with their role and exports
- **Concepts**: Key architectural patterns and relationships
- **Dependencies**: Import/export relationships between modules

## The Two Modes

### Mode 1: Generate Intermediate JSON Files

Generates portable JSON files that can be transferred to other machines:

```
{package}/
  code-index.json                 # Hierarchical structure
  code-index-vector-entries.json  # Flat entries for DB import
```

### Mode 2: Direct Database Write

Writes directly to the project's SQLite database using the VectorStore system.

## Implementation

### Step 1: Analyze Codebase Structure

Read key files to understand the architecture:

```typescript
// Scan top-level directories in src/
const modules = await glob("src/*/")

// For each module, identify:
// - Main entry point (index.ts)
// - Key exports
// - Dependencies on other modules
// - Purpose from comments/docstrings
```

### Step 2: Generate Vector Entries

For each module/file, create a vector entry:

```typescript
interface VectorEntry {
  node_id: string // unique identifier (e.g., "mod_agent")
  entity_title: string // human-readable name
  node_type: "module" | "file" | "function" | "concept"
  vector_type: "code"
  content_text: string // full description for embedding
  metadata: {
    path: string
    exports?: string[]
    keywords?: string[]
    line_count?: number
  }
}
```

### Step 3: Choose Output Mode

**For JSON files:**

```typescript
// Write to code-index-vector-entries.json
await Bun.write(`${packageDir}/code-index-vector-entries.json`, JSON.stringify({ vector_entries: entries }, null, 2))
```

**For database:**

```typescript
import { Database } from "./src/storage/db"
import { vector_memory } from "./src/learning/learning.sql"

for (const entry of entries) {
  const embedding = generateEmbedding(entry.content_text)

  Database.use((db) => {
    db.insert(vector_memory).values({
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
  })
}
```

### Step 4: Embedding Generation

Use simple hash-based embedding for cross-platform compatibility:

```typescript
function generateEmbedding(text: string): number[] {
  const dimensions = 384
  const words = text.toLowerCase().split(/\W+/)
  const wordFreq: Record<string, number> = {}

  for (const word of words) {
    if (word.length > 2) {
      wordFreq[word] = (wordFreq[word] || 0) + 1
    }
  }

  const hash1 = hashString(text)
  const hash2 = hashString(text.split("").reverse().join(""))

  const embedding: number[] = []
  for (let i = 0; i < dimensions; i++) {
    const posHash = hashString(text + i)
    const freqSum = Object.values(wordFreq).reduce((a, b) => a + b, 0)

    const value =
      Math.sin(hash1 * (i + 1) * 0.1) * 0.3 +
      Math.cos(hash2 * (i + 1) * 0.1) * 0.3 +
      (freqSum > 0
        ? (Object.entries(wordFreq).reduce((sum, [w, f]) => sum + Math.sin(hashString(w) * (i + 1) * 0.01) * f, 0) /
            freqSum) *
          0.4
        : 0)

    embedding.push(Math.tanh(value))
  }

  // Normalize
  const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0))
  return magnitude === 0 ? embedding : embedding.map((v) => v / magnitude)
}

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash)
}
```

## Example Output

### Hierarchical Structure (code-index.json)

```json
{
  "modules": [
    {
      "name": "agent",
      "path": "src/agent",
      "description": "Agent configurations",
      "key_files": [{ "file": "agent.ts", "purpose": "..." }]
    }
  ]
}
```

### Flat Entries (code-index-vector-entries.json)

```json
{
  "vector_entries": [
    {
      "node_id": "mod_agent",
      "entity_title": "Agent System",
      "node_type": "module",
      "content_text": "Agent configurations and generation...",
      "metadata": { "path": "src/agent", "exports": ["Agent", "generate"] }
    }
  ]
}
```

## Transferring to Other Machines

### Method 1: Copy Database File

```bash
scp user@machineA:/path/to/opencode.db user@machineB:/path/to/
```

### Method 2: Copy JSON Files + Regenerate

```bash
# Copy code-index-vector-entries.json
# Run import script on target machine
```

## Usage

When the user asks to:

- "Build index for this codebase"
- "Create vector index for X package"
- "Index the code structure"
- "Set up semantic search for codebase"

Activate this skill to:

1. Scan the target package's source directory
2. Analyze each module and file
3. Generate vector entries with descriptions
4. Output in requested format (JSON or DB)
5. Confirm completion with entry count

## Triggers

This skill activates when:

- Building code index for packages/opencode
- Building code index for plugin packages
- Setting up vector search for codebase architecture
- Creating self-evolution data foundation
- Establishing long-term consistency memory
