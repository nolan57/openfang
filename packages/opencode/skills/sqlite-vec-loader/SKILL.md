---
name: sqlite-vec-loader
description: Load sqlite-vec SQLite extension for vector search in Bun runtime
---

# sqlite-vec Extension Loader

## Description

This skill provides the method to correctly load sqlite-vec extension in Bun runtime. sqlite-vec is a SQLite extension for vector search, used by the project's VectorStore.

## Context

When working with Bun + Drizzle + sqlite-vec, the extension must be loaded manually using Bun's native `loadExtension()` API. Drizzle ORM only generates SQL - it does not automatically load C extensions.

## The Problem

The following error occurs when sqlite-vec is not properly loaded:

```
DrizzleError: Failed to run the query '
CREATE VIRTUAL TABLE IF NOT EXISTS `vec_vector_memory` USING vec0(embedding float[384]);
'
```

## Solution

### Step 1: Identify Platform and Architecture

```typescript
const platform = process.platform // "darwin" | "linux" | "win32"
const arch = process.arch // "arm64" | "x64"
```

### Step 2: Determine Binary Filename

| Platform | Arch  | Filename   |
| -------- | ----- | ---------- |
| darwin   | arm64 | vec0.dylib |
| darwin   | x64   | vec0.dylib |
| linux    | arm64 | vec0.so    |
| linux    | x64   | vec0.so    |
| win32    | x64   | vec0.dll   |

### Step 3: Find Binary Path (Bun Package Manager)

When using Bun, platform-specific binaries are stored in `.bun` cache:

```typescript
const platformPkg = `sqlite-vec-${platform}${arch === "arm64" ? "-arm64" : "-x64"}`

const possiblePaths = [
  // Bun cache path (most reliable)
  path.join(
    process.cwd(),
    "node_modules/.bun",
    `${platformPkg}@0.1.7-alpha.2/node_modules/${platformPkg}`,
    vecFileName,
  ),
  // Root node_modules
  path.join(process.cwd(), "node_modules", platformPkg, vecFileName),
  // Project packages
  path.join(
    process.cwd(),
    "packages/opencode/node_modules/.bun",
    `${platformPkg}@0.1.7-alpha.2/node_modules/${platformPkg}`,
    vecFileName,
  ),
]
```

### Step 4: Load Extension

```typescript
import { Database } from "bun:sqlite"

const sqlite = new Database("database.db")

for (const vecPath of possiblePaths) {
  if (existsSync(vecPath)) {
    sqlite.loadExtension(vecPath)
    console.log("Loaded sqlite-vec from:", vecPath)
    break
  }
}
```

## Key Points

1. **Manual Loading Required**: Unlike some Node.js wrappers, Bun requires explicit `loadExtension()` call
2. **Path Varies by Package Manager**: Bun stores platform binaries in `.bun/` folder, not directly in `node_modules/`
3. **Version Matters**: The path includes the version (e.g., `sqlite-vec-darwin-arm64@0.1.7-alpha.2`)
4. **Fallback Strategy**: Always try multiple paths as the package structure may vary

## Usage in Project

The project's database initialization code (`src/storage/db.ts`) implements this pattern:

```typescript
// Load sqlite-vec extension for vector search
try {
  const platform = process.platform
  const arch = process.arch
  let vecFileName = platform === "darwin" ? "vec0.dylib" : platform === "linux" ? "vec0.so" : "vec0.dll"

  const platformPkg = `sqlite-vec-${platform}${arch === "arm64" ? "-arm64" : "-x64"}`

  const possiblePaths = [
    path.join(
      process.cwd(),
      "node_modules/.bun",
      `${platformPkg}@0.1.7-alpha.2/node_modules/${platformPkg}`,
      vecFileName,
    ),
    path.join(process.cwd(), "node_modules", platformPkg, vecFileName),
    path.join(
      process.cwd(),
      "packages/opencode/node_modules/.bun",
      `${platformPkg}@0.1.7-alpha.2/node_modules/${platformPkg}`,
      vecFileName,
    ),
  ]

  for (const vecPath of possiblePaths) {
    if (existsSync(vecPath)) {
      sqlite.loadExtension(vecPath)
      break
    }
  }
} catch (error) {
  console.warn("Failed to load sqlite-vec:", error)
}
```

## Triggers

This skill activates when:

- Working with VectorStore or vector search functionality
- Debugging sqlite-vec extension loading issues
- Setting up the database on a new platform (macOS/Linux/Windows)
- Building for different architectures (arm64/x64)

## Actions

1. Identify the platform and architecture
2. Determine the correct binary filename
3. Search for the binary in Bun's package structure
4. Load the extension using `sqlite.loadExtension(path)`
5. Verify the extension is loaded by creating a test virtual table
