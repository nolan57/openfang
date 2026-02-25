import { describe, test, expect, beforeEach } from "bun:test"
import { extractMemories, getRelevantMemories } from "../../src/evolution/memory"
import { getMemories } from "../../src/evolution/store"
import { resolve } from "path"
import { rm } from "fs/promises"

const testDir = resolve(__dirname, ".test-memory")

describe("Memory", () => {
  beforeEach(async () => {
    try {
      await rm(testDir, { recursive: true })
    } catch {}
  })

  test("extractMemories extracts memories based on patterns in task", async () => {
    await extractMemories(testDir, "session-123", "I need help with typescript types", ["read file.ts"], "Success")

    const memories = await getMemories(testDir)
    expect(memories.length).toBe(1)
    expect(memories[0].key).toBe("typescript-tips")
  })

  test("extractMemories extracts memories based on patterns in toolCalls", async () => {
    await extractMemories(
      testDir,
      "session-123",
      "run tests", // Changed to not match debugging patterns
      ["jest --watch"],
      "Success",
    )

    const memories = await getMemories(testDir)
    expect(memories.length).toBe(1)
    expect(memories[0].key).toBe("testing-approach")
  })

  test("extractMemories extracts memories for refactoring patterns", async () => {
    await extractMemories(testDir, "session-123", "refactor this code", ["edit file.ts"], "Success")

    const memories = await getMemories(testDir)
    expect(memories.length).toBe(1)
    expect(memories[0].key).toBe("refactoring-guidance")
  })

  test("extractMemories extracts memories for debugging patterns", async () => {
    await extractMemories(testDir, "session-123", "fix bug in code", ["grep error"], "Success")

    const memories = await getMemories(testDir)
    expect(memories.length).toBe(1)
    expect(memories[0].key).toBe("debugging-tips")
  })

  test("extractMemories does not extract if no patterns match", async () => {
    await extractMemories(testDir, "session-123", "do something unrelated", ["ls -la"], "Success")

    const memories = await getMemories(testDir)
    expect(memories.length).toBe(0)
  })

  test("getRelevantMemories returns sorted memories by relevance", async () => {
    const { saveMemory } = await import("../../src/evolution/store")
    await saveMemory(testDir, {
      key: "typescript-tips",
      value: "Use explicit type annotations",
      context: "TypeScript work",
      sessionIDs: ["s1"],
    })
    await saveMemory(testDir, {
      key: "testing-approach",
      value: "Write tests first",
      context: "Testing work",
      sessionIDs: ["s2"],
    })

    const relevant = await getRelevantMemories(testDir, "typescript and testing tips")
    expect(relevant.length).toBe(2)
    expect(relevant[0].key).toBe("typescript-tips")
  })

  test("getRelevantMemories returns empty when no memories", async () => {
    const relevant = await getRelevantMemories(testDir, "some task")
    expect(relevant).toEqual([])
  })

  test("getRelevantMemories limits to 5 results", async () => {
    const { saveMemory } = await import("../../src/evolution/store")
    for (let i = 0; i < 10; i++) {
      await saveMemory(testDir, {
        key: `memory-${i}`,
        value: `Value ${i}`,
        context: "Context",
        sessionIDs: [`s${i}`],
      })
    }

    const relevant = await getRelevantMemories(testDir, "memory-1 memory-2 memory-3 memory-4 memory-5 memory-6")
    expect(relevant.length).toBe(5)
  })
})
