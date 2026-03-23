import { describe, test, expect, beforeEach } from "bun:test"
import { reflectOnSession, suggestPromptOptimization } from "../../src/evolution/prompt"
import { savePromptEvolution } from "../../src/evolution/store"
import { resolve } from "path"
import { rm } from "fs/promises"

const testDir = resolve(__dirname, ".test-prompt")

describe("Prompt Reflection", () => {
  beforeEach(async () => {
    try {
      await rm(testDir, { recursive: true })
    } catch {}
  })

  test("reflectOnSession returns shouldOptimize false", async () => {
    const result = await reflectOnSession(testDir, "session-123", {
      task: "Test task",
      success: true,
      issues: [],
      messages: [],
    })

    expect(result.shouldOptimize).toBe(false)
    expect(result.reason).toBe("Self-reflection disabled for initial implementation")
  })

  test("suggestPromptOptimization returns null when no evolutions", async () => {
    const result = await suggestPromptOptimization(testDir, "test-agent", "You are a coder", "Test context")
    expect(result).toBeNull()
  })

  test("suggestPromptOptimization returns stored prompt when available", async () => {
    await savePromptEvolution(testDir, {
      originalPrompt: "You are a test-agent",
      optimizedPrompt: "You are an expert test-agent",
      reason: "Added expertise",
      sessionID: "ses123",
    })

    const result = await suggestPromptOptimization(testDir, "test-agent", "You are a test-agent", "Test context")
    expect(result).toBe("You are an expert test-agent")
  })

  test("suggestPromptOptimization returns null for non-matching agent", async () => {
    await savePromptEvolution(testDir, {
      originalPrompt: "You are a coder",
      optimizedPrompt: "You are an expert coder",
      reason: "Added expertise",
      sessionID: "ses123",
    })

    const result = await suggestPromptOptimization(testDir, "test-agent", "You are a test-agent", "Test context")
    expect(result).toBeNull()
  })
})
