# Parallel Index Building with ZeroClaw

## Question

Can we distribute the code indexing work across multiple ZeroClaw instances?

## Answer

**Yes, it's feasible.** The project already has the infrastructure to spawn and manage multiple ZeroClaw instances.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    BUILD INDEX SCRIPT                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Scan Project Files                                          │
│     └─> Get list of all .ts/.js files                         │
│                                                                  │
│  2. Split into Chunks                                           │
│     └─> Partition files across N ZeroClaw instances            │
│                                                                  │
│  3. Parallel Processing                                          │
│     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│     │ ZeroClaw #1 │ │ ZeroClaw #2 │ │ ZeroClaw #N │        │
│     │ Chunk 1     │ │ Chunk 2     │ │ Chunk N     │        │
│     └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                                  │
│  4. Aggregate Results                                           │
│     └─> Merge summaries to .opencode/memory/summaries/        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation

### 1. Script: `script/build-index.ts`

```typescript
#!/usr/bin/env bun

import { glob } from "glob"
import { ZeroClawClient } from "../src/zeroclaw/client"
import { chunk } from "remeda"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"

const MAX_PARALLEL = 4 // Number of ZeroClaw instances
const SUMMARY_DIR = ".opencode/memory/summaries"

async function main() {
  // 1. Scan files
  const files = await glob(["packages/*/src/**/*.ts", "packages/*/src/**/*.js"]).then((paths) =>
    paths.filter((p) => !p.includes("node_modules")),
  )

  console.log(`Found ${files.length} files to index`)

  // 2. Split into chunks
  const chunks = chunk(files, Math.ceil(files.length / MAX_PARALLEL))

  // 3. Process in parallel
  const promises = chunks.map((chunk, i) => processChunk(chunk, i))
  const results = await Promise.all(promises)

  // 4. Aggregate
  const allSummaries = results.flat()
  console.log(`Generated ${allSummaries.length} summaries`)
}

async function processChunk(files: string[], instanceId: number) {
  const client = new ZeroClawClient({
    url: `http://localhost${45000 + instanceId}`,
    token: process.env.ZEROCLAW_TOKEN || "default",
    autoStart: true,
    startPort: 45000 + instanceId,
  })

  const summaries = []

  for (const file of files) {
    const content = readFileSync(file, "utf-8")

    // Call LLM via ZeroClaw
    const response = await client.chat({
      message: `Generate a brief summary of this TypeScript file. 
        Focus on: purpose, key functions, dependencies.
        Output JSON: { purpose, keyFunctions: string[], dependencies: string[] }`,
      context: [content.slice(0, 8000)], // Truncate if needed
    })

    const summary = JSON.parse(response.reply)
    summaries.push({
      file,
      ...summary,
      timestamp: Date.now(),
    })

    console.log(`[${instanceId}] Processed: ${file}`)
  }

  return summaries
}

main()
```

---

### 2. Prompt Integration

Update agent prompt to load summaries:

```typescript
// src/session/prompt.ts

async function loadModuleSummaries(query: string): Promise<string[]> {
  const summaries = await vectorStore.search(query, { limit: 5 })

  return summaries.map((s) =>
    `
## File: ${s.file}
${s.purpose}
Key functions: ${s.keyFunctions.join(", ")}
  `.trim(),
  )
}

const SYSTEM_PROMPT = `
You are an AI coding assistant.

## Relevant Code Context
{context}

Use the above context to answer the user's question.
`
```

---

## Workflow

```
npm run build:index
       │
       ▼
┌─────────────────────────────────────┐
│  1. Scan .ts/.js files             │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  2. Split into 4 chunks             │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  3. Spawn 4 ZeroClaw instances      │
│     - Port 45000                    │
│     - Port 45001                    │
│     - Port 45002                    │
│     - Port 45003                    │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  4. Parallel LLM processing         │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  5. Store summaries + vectors        │
└─────────────────────────────────────┘
```

---

## Configuration

Add to `package.json`:

```json
{
  "scripts": {
    "build:index": "bun run script/build-index.ts"
  }
}
```

Environment variables:

```bash
ZEROCLAW_TOKEN=your_token npm run build:index
```

---

## Benefits

| Aspect          | Benefit                             |
| --------------- | ----------------------------------- |
| **Speed**       | 4x faster with 4 instances          |
| **Cost**        | Parallel API calls                  |
| **Reliability** | One instance fails, others continue |
| **Scalability** | Easy to increase MAX_PARALLEL       |

---

## Offline Mode

For batch processing without live API:

```typescript
// Use cached LLM responses or local embedding model
const useOffline = process.env.OFFLINE === "true"

// If offline, skip LLM calls and use simple heuristic
if (useOffline) {
  return generateSimpleSummary(content)
}
```

---

## Conclusion

**Yes, this is the right approach.** The project already has:

- ZeroClaw spawn management
- Tool execution capability
- Parallel processing infrastructure

The script would leverage existing components to distribute the indexing work efficiently.
