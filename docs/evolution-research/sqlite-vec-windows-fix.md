# sqlite-vec Extension Loading Fix on Windows

## Problem

When running OpenCode on Windows (from a macOS-developed codebase), the application failed to start with the following error:

```
DrizzleError: Failed to run the query '
CREATE VIRTUAL TABLE IF NOT EXISTS `vec_vector_memory` USING vec0(embedding float[384]);
'
```

## Root Cause Analysis

### Issue 1: Package Name Mapping

The original code used `process.platform` directly to construct the package name:

```typescript
// WRONG: process.platform returns "win32", but package is named "windows"
const platformPkg = `sqlite-vec-${platform}-${arch}` // "sqlite-vec-win32-x64" (doesn't exist!)
```

The correct mapping:
| process.platform | Package Name |
|-----------------|-------------|
| `darwin` | `sqlite-vec-darwin-*` |
| `linux` | `sqlite-vec-linux-*` |
| `win32` | `sqlite-vec-windows-*` |

### Issue 2: Project Root Path Calculation

The code used `import.meta.dirname` to find the project root, but miscalculated the relative path:

```typescript
// WRONG: From packages/opencode/src/storage/, "../../.." goes to packages/opencode/
const projectRoot = path.resolve(import.meta.dirname, "../../..")

// CORRECT: Need 4 levels up to reach project root
const projectRoot = path.resolve(import.meta.dirname, "../../../..")
```

Path traversal:

```
packages/opencode/src/storage/db.ts
    └── ../../    → packages/opencode/src/
    └── ../../../   → packages/opencode/
    └── ../../../../ → project root (D:\Projs\opencodeclaw)
```

### Issue 3: Bun's Package Structure

Bun stores platform-specific packages in a special location:

```
node_modules/.bun/sqlite-vec-windows-x64@0.1.7-alpha.2/node_modules/sqlite-vec-windows-x64/vec0.dll
```

Not directly in `node_modules/sqlite-vec-windows-x64/`.

## Solution

### Step 1: Correct Platform Mapping

```typescript
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
```

### Step 2: Correct Path Calculation

```typescript
// Go up 4 levels from packages/opencode/src/storage/db.ts
const projectRoot = path.resolve(import.meta.dirname, "../../../..")
```

### Step 3: Try Multiple Possible Paths

```typescript
const possiblePaths = [
  // Bun cache path (primary)
  path.join(projectRoot, "node_modules/.bun", `${platformPkg}@0.1.7-alpha.2/node_modules/${platformPkg}`, vecFileName),
  // Root node_modules (fallback)
  path.join(projectRoot, "node_modules", platformPkg, vecFileName),
]
```

### Step 4: Use Bun's Native loadExtension API

```typescript
import { Database } from "bun:sqlite"

const sqlite = new Database("database.db")
sqlite.loadExtension(vecPath) // NOT the JS wrapper!
```

## Debugging Process

### Test Script Creation

Created a test script to verify the loading logic:

```typescript
// packages/opencode/scripts/test-sqlite-vec.ts
import { Database } from "bun:sqlite"
import path from "path"
import { existsSync } from "fs"

const sqlite = new Database(":memory:")
const vecPath = "node_modules/.bun/sqlite-vec-windows-x64@0.1.7-alpha.2/..."

if (existsSync(vecPath)) {
  sqlite.loadExtension(vecPath)
  sqlite.exec("CREATE VIRTUAL TABLE test_vec USING vec0(embedding float[384])")
}
```

### Key Debug Output

```
platform: win32, arch: x64
pkg: sqlite-vec-windows-x64, file: vec0.dll
projectRoot: D:\Projs\opencodeclaw
Checking paths:
  - D:\Projs\opencodeclaw\node_modules\.bun\sqlite-vec-windows-x64@0.1.7-alpha.2\... (exists: true)
Loading from: D:\Projs\opencodeclaw\node_modules\.bun\...\vec0.dll
Loaded successfully!
Virtual table created successfully!
```

## Final Working Code

```typescript
// packages/opencode/src/storage/db.ts

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

    // Step 1: Map platform correctly
    if (platform === "darwin") {
      vecFileName = "vec0.dylib"
      platformName = "darwin"
    } else if (platform === "linux") {
      vecFileName = "vec0.so"
      platformName = "linux"
    } else if (platform === "win32") {
      vecFileName = "vec0.dll"
      platformName = "windows" // Key: "windows", not "win32"
    }

    // Step 2: Construct package name
    const archSuffix = arch === "arm64" ? "-arm64" : "-x64"
    const platformPkg = `sqlite-vec-${platformName}${archSuffix}`

    // Step 3: Calculate correct project root (4 levels up!)
    const projectRoot = path.resolve(import.meta.dirname, "../../../..")

    // Step 4: Try multiple possible paths
    const possiblePaths = [
      path.join(
        projectRoot,
        "node_modules/.bun",
        `${platformPkg}@0.1.7-alpha.2/node_modules/${platformPkg}`,
        vecFileName,
      ),
      path.join(projectRoot, "node_modules", platformPkg, vecFileName),
    ]

    // Step 5: Load extension
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

## macOS-Specific Issue: Apple's SQLite Doesn't Support Dynamic Extensions

### Problem

After fixing the Windows issues, the same error occurred on macOS:

```
Error: This build of sqlite3 does not support dynamic extension loading
```

### Root Cause

Apple's proprietary SQLite build (included with macOS) does **not** support dynamic extension loading for security reasons. This is a fundamental limitation of the system SQLite library.

### Solution

Use Homebrew's vanilla SQLite which supports dynamic extensions:

```typescript
// packages/opencode/src/storage/db.ts

export const Client = lazy(() => {
  // On macOS, Apple's SQLite doesn't support dynamic extensions
  // Use Homebrew's vanilla SQLite which supports extensions
  if (process.platform === "darwin") {
    BunDatabase.setCustomSQLite("/opt/homebrew/Cellar/sqlite/3.51.2_1/lib/libsqlite3.dylib")
  }

  const sqlite = new BunDatabase(path.join(Global.Path.data, "opencode.db"), { create: true })
  // ... rest of the code
})
```

### Prerequisites

Install Homebrew's SQLite:

```bash
brew install sqlite
```

This installs the vanilla SQLite to `/opt/homebrew/Cellar/sqlite/<version>/lib/libsqlite3.dylib`.

### Version Considerations

The path includes a version number (`3.51.2_1`). When upgrading SQLite via Homebrew, you may need to update the path in the code. Consider using a dynamic lookup:

```typescript
if (process.platform === "darwin") {
  // Dynamically find the latest SQLite version
  const { stdout } = await $`ls /opt/homebrew/Cellar/sqlite/`.text()
  const latestVersion = stdout.trim().split("\n").pop()
  if (latestVersion) {
    BunDatabase.setCustomSQLite(`/opt/homebrew/Cellar/sqlite/${latestVersion}/lib/libsqlite3.dylib`)
  }
}
```

### Platform Comparison

| Platform | SQLite Source | Dynamic Extensions | Solution |
|----------|--------------|-------------------|----------|
| Windows | System (vanilla) | ✅ Supported | Direct loadExtension |
| Linux | System (usually vanilla) | ✅ Supported | Direct loadExtension |
| macOS | Apple (restricted) | ❌ Not supported | Use Homebrew SQLite + setCustomSQLite |

## Key Lessons

1. **Bun vs Node.js Package Structure**: Bun stores platform-specific binaries in `.bun/` cache, not directly in `node_modules/`

2. **Platform Name Mapping**: `process.platform` returns "win32" but packages use "windows"

3. **Path Resolution**: When running from different directories (`packages/opencode/` vs project root), `import.meta.dirname` resolves differently - need to test from actual execution context

4. **Manual Extension Loading**: Unlike some Node.js wrappers, Bun requires explicit `sqlite.loadExtension(path)` call - Drizzle doesn't do this automatically

5. **macOS SQLite Limitation**: Apple's SQLite doesn't support dynamic extensions - must use Homebrew's vanilla build

6. **Cross-Platform Testing**: A fix that works on one platform (Windows) doesn't necessarily work on another (macOS) - always test on all target platforms

## References

- [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec)
- [Bun SQLite Documentation](https://bun.sh/docs/api/sqlite)
- [Bun loadExtension API](https://github.com/oven-sh/bun/issues/3085)
