# Evolution Dashboard Static File Serving Fix

## Problem

When starting the OpenCode web server and accessing the Evolution Dashboard, the page displayed:
```json
{"success":false,"error":"File not found"}
```

The server was running correctly, and API endpoints like `/api/evolution/stats` were working, but the static HTML file at `/api/evolution/static/evolution-dashboard.html` could not be served.

## Root Cause Analysis

### Issue 1: Hono Wildcard Parameter in Nested Routes

When routes are registered using `.route()` prefix in Hono, wildcard parameters (`*`) are not properly extracted using `c.req.param("*")`. The parameter returns `undefined` instead of the expected path segment.

**Example:**
```typescript
// In server.ts
app.route("/api/evolution", EvolutionRoutes())

// In evolution.ts - This doesn't work as expected
app.get("/static/*", async (c) => {
  const filename = c.req.param("*") // Returns undefined!
})
```

### Issue 2: Variable Name Shadowing

In `server.ts`, the catch-all proxy route used `const path = c.req.path`, which shadowed the imported `path` module from Node.js, causing `path.join()` to fail with:
```
Error: The "paths[2]" property must be of type string, got undefined
```

**Problematic code:**
```typescript
.all("/*", async (c) => {
  const path = c.req.path  // Shadows imported 'path' module!
  const response = await proxy(`https://app.opencode.ai${path}`, {...})
})
```

## Solution

### Approach

Instead of relying on nested route wildcard parameters, we:

1. Added an explicit route in `server.ts` that handles `/api/evolution/static/*` **before** the catch-all proxy route
2. Extract the filename by stripping the prefix from `c.req.path` instead of using wildcard parameters
3. Fixed the variable name shadowing issue in the proxy route

### Files Modified

#### 1. `packages/opencode/src/server/server.ts`

**Changes:**

1. Added `path` import:
```typescript
import path from "path"
```

2. Added explicit static file route before the catch-all proxy:
```typescript
// Serve evolution dashboard static files before catch-all proxy
.get("/api/evolution/static/*", async (c) => {
  // Use c.req.path and strip the prefix to get the filename
  const fullPath = c.req.path
  const prefix = "/api/evolution/static/"
  const filename = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : ""
  const packageRoot = process.cwd()
  const filePath = path.join(packageRoot, "src/server/static", filename)
  if (!filename) return c.json({ success: false, error: "File not found" }, 404)
  const file = Bun.file(filePath)
  const exists = await file.exists()
  if (!exists) {
    return c.json({ success: false, error: "File not found" }, 404)
  }
  return c.html(await file.text())
})
```

3. Fixed variable shadowing in proxy route:
```typescript
// Before (broken)
.all("/*", async (c) => {
  const path = c.req.path  // ❌ Shadows imported module
  const response = await proxy(`https://app.opencode.ai${path}`, {...})
})

// After (fixed)
.all("/*", async (c) => {
  const requestPath = c.req.path  // ✅ No shadowing
  const response = await proxy(`https://app.opencode.ai${requestPath}`, {...})
})
```

#### 2. `packages/opencode/src/server/routes/evolution.ts`

**Changes:**

1. Removed unused imports:
```typescript
// Removed
import { fileURLToPath } from "url"
```

2. Removed unused constants:
```typescript
// Removed all of these
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const STATIC_DIR = path.join(__dirname, "../static")
log.info("static directory configured", { STATIC_DIR, __dirname })
```

3. Removed the static file route (moved to server.ts):
```typescript
// Removed the entire app.get("/static/*", ...) handler
// Added comment explaining the move
// Static file serving moved to server.ts to avoid route matching issues
```

## Technical Details

### Why Wildcard Parameters Fail in Nested Routes

When you register a route with `.route("/prefix", subApp)`, Hono mounts the subApp at that prefix. However, the wildcard parameter extraction happens at the subApp level, and the path matching doesn't properly propagate the wildcard segment back through the nested route structure.

**Workaround:** Use `c.req.path` and manually strip the known prefix:
```typescript
const fullPath = c.req.path  // e.g., "/api/evolution/static/evolution-dashboard.html"
const prefix = "/api/evolution/static/"
const filename = fullPath.slice(prefix.length)  // "evolution-dashboard.html"
```

### Route Order Matters

In Hono (and most routing frameworks), route order is critical. The explicit static file route must be registered **before** the catch-all `/*` proxy route:

```typescript
app
  .get("/api/evolution/static/*", staticHandler)  // ✅ Specific route first
  .all("/*", proxyHandler)                        // ✅ Catch-all last
```

If the order is reversed, the catch-all would match first and the static files would never be served.

### Using Bun.file() API

The fix uses Bun's native file API for efficient file operations:
```typescript
const file = Bun.file(filePath)
const exists = await file.exists()
const content = await file.text()
return c.html(content)
```

This is more efficient than Node.js `fs.readFile()` and integrates well with Bun's runtime.

## Testing

### Endpoints

After the fix, the following endpoints work correctly:

| Endpoint | Description | Status |
|----------|-------------|--------|
| `http://localhost:4096/api/evolution/static/evolution-dashboard.html` | Dashboard HTML | ✅ Working |
| `http://localhost:4096/api/evolution/stats` | Evolution statistics | ✅ Working |
| `http://localhost:4096/api/evolution/runs` | Evolution runs list | ✅ Working |
| `http://localhost:4096/api/evolution/notes` | Learning notes | ✅ Working |

### Verification Commands

```bash
# Test static file serving
curl -s http://localhost:4096/api/evolution/static/evolution-dashboard.html | head -c 200

# Test API endpoint
curl -s http://localhost:4096/api/evolution/stats

# Expected output: {"success":true,"data":{...}}
```

### Starting the Server

Using the evolution dashboard script:
```bash
cd packages/opencode/scripts
./evolution-dashboard.sh
```

Or manually:
```bash
cd packages/opencode
bun run src/index.ts serve --port 4096
```

## Lessons Learned

1. **Test wildcard parameters in nested routes**: Don't assume `c.req.param("*")` works the same way in nested route handlers.

2. **Avoid variable name shadowing**: Be careful not to shadow imported modules with local variables, especially common names like `path`.

3. **Route order is critical**: Always register specific routes before catch-all routes.

4. **Use path manipulation as fallback**: When wildcard parameters fail, manually extract path segments using string operations.

5. **Add debug logging early**: Adding console.log statements at the beginning of route handlers helps identify whether the route is being matched.

## Related Code

### Hono Route Registration Pattern

```typescript
// server.ts pattern
app
  .route("/api/evolution", EvolutionRoutes())  // Mount sub-routes
  .get("/api/evolution/static/*", handler)     // Explicit static route
  .all("/*", proxyHandler)                     // Catch-all proxy
```

### Static File Serving Pattern

```typescript
.get("/api/evolution/static/*", async (c) => {
  const fullPath = c.req.path
  const prefix = "/api/evolution/static/"
  const filename = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : ""
  
  if (!filename) {
    return c.json({ success: false, error: "File not found" }, 404)
  }
  
  const filePath = path.join(process.cwd(), "src/server/static", filename)
  const file = Bun.file(filePath)
  
  if (!(await file.exists())) {
    return c.json({ success: false, error: "File not found" }, 404)
  }
  
  return c.html(await file.text())
})
```

## Future Improvements

1. **Centralized static file serving**: Consider creating a dedicated static file middleware that can be reused across different routes.

2. **Configuration-driven paths**: Make the static file directory configurable via environment variables or config files.

3. **Cache headers**: Add proper cache headers for static assets to improve performance.

4. **Content-Type detection**: Automatically detect and set Content-Type based on file extension.

5. **Error handling**: Provide more detailed error messages for debugging (e.g., permission errors vs. file not found).

---

**Date:** 2026-03-25  
**Author:** OpenCode Development Team  
**Related Issues:** Evolution Dashboard, Static File Serving, Hono Routing

## Dashboard Display Issues Fix (Follow-up)

### Problem

After fixing the static file serving, the dashboard opened but showed:

1. **Empty stats**: All statistics showed 0 or empty data
2. **Charts not rendering**: Source and action charts were blank
3. **Notes view error**: Clicking "学习笔记" (Learning Notes) cards opened raw JSON instead of a readable HTML page

### Root Causes

1. **Empty database tables**: The `learning_runs` and `knowledge` tables were empty because the evolution system hadn't been run yet
2. **Notes stored in filesystem**: Learning notes were saved as Markdown files in `/home/urio/docs/learning/notes/`, not in the database
3. **Raw JSON response**: The `viewNotes()` function opened the API endpoint directly, which returns JSON instead of rendered HTML

### Solution

#### 1. Added Empty State Handling

Added visual feedback when no data is available:

```html
<!-- Empty Data Message -->
<div id="emptyDataMessage" class="hidden card p-8 mb-8 text-center">
  <div class="text-6xl mb-4">🌱</div>
  <h2 class="text-2xl font-bold text-gray-800 mb-2">暂无进化数据</h2>
  <p class="text-gray-600 mb-4">
    系统还没有运行过自进化流程。运行 <code>/evolve</code> 命令开始第一次进化。
  </p>
</div>
```

#### 2. Conditional Chart Rendering

Charts now show "暂无数据" (No data) message when there's no data:

```javascript
if (stats.bySource.length > 0) {
  new Chart(sourceCtx, { /* ... chart config ... */ })
} else {
  sourceCtx.canvas.parentElement.innerHTML = 
    '<div class="h-64 flex items-center justify-center text-gray-400">暂无数据</div>'
}
```

#### 3. Custom Notes Viewer

Created a custom HTML viewer for learning notes that:

- Fetches the index markdown via API
- Parses the markdown to extract note links and sources
- Displays notes as cards with color-coded source tags
- Allows clicking individual notes to view full content

```javascript
function viewNotes(runId) {
  const notesWindow = window.open('', '_blank')
  notesWindow.document.write(`
    <!doctype html>
    <html lang="zh-CN">
      <!-- ... custom viewer HTML and CSS ... -->
      <script>
        fetch('/api/evolution/notes/${runId}/index')
          .then(r => r.json())
          .then(data => {
            // Parse markdown and render notes
            const lines = content.split('\\n').filter(line => line.startsWith('- ['))
            // ... render note cards with source tags ...
          })
      <\/script>
    </html>
  `)
  notesWindow.document.close()
}
```

#### 4. Empty State for All Sections

Added empty state messages for all data sections:

| Section | Empty State Message |
|---------|--------------------|
| Stats | 🌱 暂无进化数据 + instructions to run `/evolve` |
| Charts | "暂无数据" in chart containers |
| Runs Table | "暂无进化运行记录" in table body |
| Notes List | "暂无学习笔记" in grid |
| Snapshots | "暂无系统快照" in list |

### Files Modified

- **`packages/opencode/src/server/static/evolution-dashboard.html`**:
  - Added empty data message div
  - Updated `loadData()` to handle empty stats
  - Added conditional chart rendering
  - Fixed `viewNotes()` to render HTML viewer
  - Added empty state handling for runs table, notes list, and snapshots

### Testing

```bash
# Start server
cd packages/opencode/scripts
./evolution-dashboard.sh

# Open dashboard
xdg-open "http://localhost:4096/api/evolution/static/evolution-dashboard.html"

# Verify empty state shows when no data
curl http://localhost:4096/api/evolution/stats
# Expected: {"success":true,"data":{"totalRuns":0,"totalKnowledge":0,...}}

# Verify notes API works
curl http://localhost:4096/api/evolution/notes
# Expected: List of note runs with metadata
```

### Visual Improvements

1. **Source Tags**: Color-coded badges for note sources:
   - 🔵 `search` - Blue background
   - 🔴 `arxiv` - Red background  
   - 🟢 `github` - Green background

2. **Empty State Icon**: Large emoji (🌱) to make empty state friendly and actionable

3. **Loading States**: All sections show appropriate loading or empty states

### Next Steps

To populate the dashboard with data:

1. Run the evolution command: `/evolve` in OpenCode
2. This will:
   - Create entries in `learning_runs` table
   - Populate `knowledge` table with collected items
   - Generate markdown notes in the filesystem
3. Refresh the dashboard to see populated charts and statistics

---
