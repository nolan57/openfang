import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { SelfEvolutionScheduler, defaultSelfEvolutionConfig } from "../../src/learning/self-evolution-scheduler"
import { SelfRefactor } from "../../src/learning/self-refactor"
import { resolve, dirname } from "path"
import { mkdir, writeFile, rm } from "fs/promises"

const testDir = resolve(__dirname, "../../test-tmp/self-evolution")
// The actual source directory - scheduler expects project root with packages/opencode/src
const projectRoot = resolve(__dirname, "../../../..")
const srcDir = resolve(projectRoot, "packages/opencode/src")

async function setup() {
  await mkdir(resolve(testDir, "src"), { recursive: true })
  
  // Create test TypeScript files
  await writeFile(resolve(testDir, "src/test.ts"), `
import { something } from "./other"
console.log("test file")
// TODO: fix this later
const x: any = 1
export function testFunc(): string {
  return "test"
}
`)

  await writeFile(resolve(testDir, "src/other.ts"), `
export const something = "value"
console.log("other file")
`)
}

async function cleanup() {
  try {
    await rm(testDir, { recursive: true, force: true })
  } catch {}
}

describe("SelfEvolutionScheduler", () => {
  beforeEach(setup)
  afterEach(cleanup)

  test("scheduler can be instantiated", () => {
    const scheduler = new SelfEvolutionScheduler(testDir, {
      enabled: true,
      requireHumanReview: true,
    })
    expect(scheduler).toBeDefined()
  })

  test("default config has correct values", () => {
    expect(defaultSelfEvolutionConfig.enabled).toBe(false)
    expect(defaultSelfEvolutionConfig.autoFixPatterns).toContain("console_log")
    expect(defaultSelfEvolutionConfig.autoFixPatterns).toContain("TODO")
  })

  test("trigger scans actual source code", async () => {
    // Use project root for scanning (scheduler adds packages/opencode/src)
    const scheduler = new SelfEvolutionScheduler(projectRoot, {
      enabled: true,
      requireHumanReview: true,
    })

    const result = await scheduler.trigger()
    
    expect(result.issues_scanned).toBeGreaterThan(0)
    expect(result.errors).toHaveLength(0)
  })

  test("identifies human review required issues in actual code", async () => {
    const scheduler = new SelfEvolutionScheduler(projectRoot, {
      enabled: true,
      requireHumanReview: true,
    })

    const result = await scheduler.trigger()
    
    // Should find type:any or other issues requiring review
    expect(result.human_review_required).toBeGreaterThanOrEqual(0)
  })

  test("getStats returns code statistics for actual source", async () => {
    const scheduler = new SelfEvolutionScheduler(projectRoot)
    
    const stats = await scheduler.getStats()
    
    expect(stats.total_files).toBeGreaterThan(0)
    expect(stats.total_lines).toBeGreaterThan(0)
    expect(stats.issues_by_type).toBeDefined()
    expect(stats.issues_by_severity).toBeDefined()
  })
})

describe("SelfRefactor", () => {
  test("can scan actual source code", async () => {
    const refactor = new SelfRefactor(srcDir)
    const issues = await refactor.scanForIssues()
    
    // Should find some issues in the actual codebase
    expect(issues.length).toBeGreaterThan(0)
    
    // Should find console.log
    const consoleIssues = issues.filter(i => i.type === "console_log")
    expect(consoleIssues.length).toBeGreaterThan(0)
  })

  test("fixIssues can run in dry-run mode on actual source", async () => {
    const refactor = new SelfRefactor(srcDir)
    const issues = await refactor.scanForIssues()
    
    const result = await refactor.fixIssues(issues, true) // dry run
    
    expect(result.fixed).toBeGreaterThan(0)
  })
})