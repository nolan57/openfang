import { Database } from "bun:sqlite"
import path from "path"
import { existsSync } from "fs"

console.error("=== Test script started ===")

const sqlite = new Database(":memory:")
console.error("SQLite opened")

const platform = process.platform
const arch = process.arch
let vecFileName: string
let platformName: string

if (platform === "darwin") {
  vecFileName = "vec0.dylib"
  platformName = "darwin"
} else if (platform === "linux") {
  vecFileName = "vec0.so"
  platformName = "linux"
} else if (platform === "win32") {
  vecFileName = "vec0.dll"
  platformName = "windows"
} else {
  throw new Error(`Unsupported platform: ${platform}`)
}

const archSuffix = arch === "arm64" ? "-arm64" : "-x64"
const platformPkg = `sqlite-vec-${platformName}${archSuffix}`

const projectRoot = process.cwd()

console.error(`platform: ${platform}, arch: ${arch}`)
console.error(`pkg: ${platformPkg}, file: ${vecFileName}`)
console.error(`projectRoot: ${projectRoot}`)

const possiblePaths = [
  path.join(projectRoot, "node_modules/.bun", `${platformPkg}@0.1.7-alpha.2/node_modules/${platformPkg}`, vecFileName),
  path.join(projectRoot, "node_modules", platformPkg, vecFileName),
  path.join(projectRoot, "packages/opencode/node_modules", platformPkg, vecFileName),
]

console.error("Checking paths:")
for (const p of possiblePaths) {
  console.error(`  - ${p} (exists: ${existsSync(p)})`)
}

let loaded = false
for (const vecPath of possiblePaths) {
  if (existsSync(vecPath)) {
    console.error(`Loading from: ${vecPath}`)
    sqlite.loadExtension(vecPath)
    console.error("Loaded successfully!")
    loaded = true
    break
  }
}

if (!loaded) {
  console.error("FAILED to find extension!")
  process.exit(1)
}

// Try to create the virtual table
try {
  sqlite.exec("CREATE VIRTUAL TABLE IF NOT EXISTS test_vec USING vec0(embedding float[384])")
  console.error("Virtual table created successfully!")
} catch (e) {
  console.error("Failed to create virtual table:", e)
  process.exit(1)
}

console.error("=== Test completed ===")
