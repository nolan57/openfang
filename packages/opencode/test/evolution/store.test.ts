import { describe, test, expect, beforeEach } from "bun:test"
import {
  savePromptEvolution,
  getPromptEvolutions,
  saveSkillEvolution,
  getSkillEvolutions,
  updateSkillStatus,
  saveMemory,
  getMemories,
  incrementMemoryUsage,
} from "../../src/evolution/store"
import { resolve } from "path"
import { rm } from "fs/promises"

const testDir = resolve(__dirname, ".test-evolution")

describe("Evolution Store", () => {
  beforeEach(async () => {
    try {
      await rm(testDir, { recursive: true })
    } catch {}
  })

  test("save and get prompt evolutions", async () => {
    const evolution = await savePromptEvolution(testDir, {
      originalPrompt: "You are a coder",
      optimizedPrompt: "You are an expert coder who writes clean code",
      reason: "Added expertise emphasis based on task analysis",
      sessionID: "ses123",
    })

    const evolutions = await getPromptEvolutions(testDir)
    expect(evolutions.length).toBe(1)
    expect(evolutions[0].optimizedPrompt).toBe("You are an expert coder who writes clean code")
  })

  test("save and get skill evolutions", async () => {
    const skill = await saveSkillEvolution(testDir, {
      name: "test-skill",
      description: "A test skill",
      content: "# Test Skill\n\nDo things",
      triggerPatterns: ["test", "demo"],
      sessionID: "ses123",
    })

    const skills = await getSkillEvolutions(testDir)
    expect(skills.length).toBe(1)
    expect(skills[0].status).toBe("draft")
  })

  test("update skill status", async () => {
    const skill = await saveSkillEvolution(testDir, {
      name: "test-skill",
      description: "A test skill",
      content: "# Test Skill",
      triggerPatterns: [],
      sessionID: "ses123",
    })

    await updateSkillStatus(testDir, skill.id, "approved")

    const approved = await getSkillEvolutions(testDir, "approved")
    expect(approved.length).toBe(1)
  })

  test("save and get memories", async () => {
    const memory = await saveMemory(testDir, {
      key: "typescript-best-practices",
      value: "Use type inference when possible",
      context: "TypeScript coding tasks",
      sessionIDs: ["ses123", "ses456"],
    })

    const memories = await getMemories(testDir)
    expect(memories.length).toBe(1)
    expect(memories[0].key).toBe("typescript-best-practices")
  })

  test("increment memory usage", async () => {
    const memory = await saveMemory(testDir, {
      key: "test-memory",
      value: "Test value",
      context: "Test context",
      sessionIDs: ["ses123"],
    })

    await incrementMemoryUsage(testDir, memory.id)
    await incrementMemoryUsage(testDir, memory.id)

    const memories = await getMemories(testDir)
    expect(memories[0].usageCount).toBe(2)
  })

  test("filter memories by key", async () => {
    await saveMemory(testDir, {
      key: "typescript-tips",
      value: "Tip 1",
      context: "Context 1",
      sessionIDs: ["ses123"],
    })
    await saveMemory(testDir, {
      key: "javascript-tips",
      value: "Tip 2",
      context: "Context 2",
      sessionIDs: ["ses456"],
    })

    const filtered = await getMemories(testDir, "typescript")
    expect(filtered.length).toBe(1)
    expect(filtered[0].key).toBe("typescript-tips")
  })
})
