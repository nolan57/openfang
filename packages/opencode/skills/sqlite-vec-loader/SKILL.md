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

On macOS, you may also see:

```
Error: This build of sqlite3 does not support dynamic extension loading
```

## Solution

### Step 0: macOS - Use Homebrew SQLite (Required!)

Apple's proprietary SQLite build does NOT support dynamic extensions. You must use Homebrew's vanilla SQLite:

```typescript
import { Database } from "bun:sqlite"

// Must be called BEFORE creating any Database instance!
if (process.platform === "darwin") {
  Database.setCustomSQLite("/opt/homebrew/Cellar/sqlite/3.51.2_1/lib/libsqlite3.dylib")
}
```

Prerequisite: `brew install sqlite`

### Step 1: Identify Platform and Architecture

```typescript
const platform = process.platform // "darwin" | "linux" | "win32"
const arch = process.arch // "arm64" | "x64"
```

### Step 2: Map Platform to Package Name

**Important**: The package name differs from `process.platform`:

| process.platform | Package Name | Binary Filename |
|-----------------|-------------|-----------------|
| darwin          | darwin      | vec0.dylib      |
| linux           | linux       | vec0.so         |
| win32           | windows     | vec0.dll        |

```typescript
let platformName: string
if (platform === "darwin") {
  platformName = "darwin"
} else if (platform === "linux") {
  platformName = "linux"
} else if (platform === "win32") {
  platformName = "windows" // NOT "win32"!
}
```

### Step 3: Determine Binary Filename

| Platform | Arch  | Filename   |
| -------- | ----- | ---------- |
| darwin   | arm64 | vec0.dylib |
| darwin   | x64   | vec0.dylib |
| linux    | arm64 | vec0.so    |
| linux    | x64   | vec0.so    |
| win32    | x64   | vec0.dll   |

### Step 4: Find Binary Path (Bun Package Manager)

When using Bun, platform-specific binaries are stored in `.bun` cache. Calculate the correct project root:

```typescript
// From packages/opencode/src/storage/db.ts, go up 4 levels
const projectRoot = path.resolve(import.meta.dirname, "../../../..")

const platformPkg = `sqlite-vec-${platformName}${arch === "arm64" ? "-arm64" : "-x64"}`

const possiblePaths = [
  // Bun cache path (most reliable)
  path.join(
    projectRoot,
    "node_modules/.bun",
    `${platformPkg}@0.1.7-alpha.2/node_modules/${platformPkg}`,
    vecFileName,
  ),
  // Root node_modules
  path.join(projectRoot, "node_modules", platformPkg, vecFileName),
]
```

### Step 5: Load Extension

```typescript
import { Database } from "bun:sqlite"

// Step 0: macOS requires custom SQLite
if (process.platform === "darwin") {
  Database.setCustomSQLite("/opt/homebrew/Cellar/sqlite/3.51.2_1/lib/libsqlite3.dylib")
}

const sqlite = new Database("database.db")

for (const vecPath of possiblePaths) {
  if (existsSync(vecPath)) {
    sqlite.loadExtension(vecPath)
    // Verify by creating a test table
    sqlite.exec("CREATE VIRTUAL TABLE IF NOT EXISTS test_vec USING vec0(embedding float[384])")
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
5. **Platform Name Mapping**: `process.platform` returns "win32" but packages use "windows"
6. **macOS SQLite Limitation**: Apple's SQLite doesn't support dynamic extensions - must use Homebrew's vanilla build

## Platform Comparison

| Platform | SQLite Source | Dynamic Extensions | Solution |
|----------|--------------|-------------------|----------|
| Windows  | System (vanilla) | ✅ Supported | Direct loadExtension |
| Linux    | System (usually vanilla) | ✅ Supported | Direct loadExtension |
| macOS    | Apple (restricted) | ❌ Not supported | Use Homebrew SQLite + setCustomSQLite |

## Usage in Project

The project's database initialization code (`src/storage/db.ts`) implements this pattern:

```typescript
export const Client = lazy(() => {
  // macOS: Use Homebrew's SQLite (Apple's doesn't support dynamic extensions)
  if (process.platform === "darwin") {
    BunDatabase.setCustomSQLite("/opt/homebrew/Cellar/sqlite/3.51.2_1/lib/libsqlite3.dylib")
  }

  const sqlite = new BunDatabase(path.join(Global.Path.data, "opencode.db"), { create: true })

  // Load sqlite-vec extension
  try {
    const platform = process.platform
    const arch = process.arch
    let vecFileName: string
    let platformName: string

    // Map platform correctly
    if (platform === "darwin") {
      vecFileName = "vec0.dylib"
      platformName = "darwin"
    } else if (platform === "linux") {
      vecFileName = "vec0.so"
      platformName = "linux"
    } else if (platform === "win32") {
      vecFileName = "vec0.dll"
      platformName = "windows" // NOT "win32"!
    }

    const archSuffix = arch === "arm64" ? "-arm64" : "-x64"
    const platformPkg = `sqlite-vec-${platformName}${archSuffix}`

    // Calculate correct project root (4 levels up from packages/opencode/src/storage/)
    const projectRoot = path.resolve(import.meta.dirname, "../../../..")

    const possiblePaths = [
      path.join(
        projectRoot,
        "node_modules/.bun",
        `${platformPkg}@0.1.7-alpha.2/node_modules/${platformPkg}`,
        vecFileName,
      ),
      path.join(projectRoot, "node_modules", platformPkg, vecFileName),
    ]

    for (const vecPath of possiblePaths) {
      if (existsSync(vecPath)) {
        sqlite.loadExtension(vecPath)
        break
      }
    }
  } catch (error) {
    log.error("failed to load sqlite-vec extension", { error })
  }

  // Continue with Drizzle setup...
  const db = drizzle({ client: sqlite, schema })
  migrate(db, entries)
  return db
})
```

## Triggers

This skill activates when:

- Working with VectorStore or vector search functionality
- Debugging sqlite-vec extension loading issues
- Setting up the database on a new platform (macOS/Linux/Windows)
- Building for different architectures (arm64/x64)

## Actions

1. Check if running on macOS and set custom SQLite if needed
2. Identify the platform and architecture
3. Map platform name correctly (darwin/linux/windows)
4. Determine the correct binary filename
5. Calculate project root path (4 levels up from storage/)
6. Search for the binary in Bun's package structure
7. Load the extension using `sqlite.loadExtension(path)`
8. Verify the extension is loaded by creating a test virtual table
