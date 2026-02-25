import { describe, test, expect, beforeEach } from "bun:test"
import { analyzeTaskForSkill, approveSkill, rejectSkill, getPendingSkills } from "../../src/evolution/skill"
import { resolve } from "path"
import { rm } from "fs/promises"

const testDir = resolve(__dirname, ".test-skill")

describe("Skill Evolution", () => {
  beforeEach(async () => {
    try {
      await rm(testDir, { recursive: true })
    } catch {}
  })

  test("analyzeTaskForSkill returns false when success is false", async () => {
    const result = await analyzeTaskForSkill(testDir, "ses123", "test task", ["read"], false)
    expect(result.shouldCreate).toBe(false)
    expect(result.skill).toBeUndefined()
  })

  test("analyzeTaskForSkill returns false when no tools are repeated", async () => {
    const result = await analyzeTaskForSkill(testDir, "ses123", "test task", ["read", "write", "edit"], true)
    expect(result.shouldCreate).toBe(false)
  })

  test("analyzeTaskForSkill creates skill when tools are repeated 3+ times", async () => {
    const result = await analyzeTaskForSkill(
      testDir,
      "ses123",
      "test task about file operations",
      ["read file", "read config", "read data", "write file", "write config", "write data"],
      true,
    )
    expect(result.shouldCreate).toBe(true)
    expect(result.skill).toBeDefined()
    expect(result.skill?.name).toBe("auto-read-task")
    expect(result.skill?.status).toBe("draft")
    expect(result.skill?.triggerPatterns.length).toBeGreaterThan(0)
  })

  test("approveSkill creates skill file and updates status", async () => {
    const result = await analyzeTaskForSkill(
      testDir,
      "ses123",
      "test task",
      ["read a", "read b", "read c", "read d", "read e", "read f"],
      true,
    )

    const skillId = result.skill!.id
    const skillDir = await approveSkill(testDir, skillId)

    expect(skillDir).not.toBeNull()
    expect(skillDir).toContain(".opencode/skills")
  })

  test("rejectSkill updates status to rejected", async () => {
    const result = await analyzeTaskForSkill(
      testDir,
      "ses123",
      "test task",
      ["read a", "read b", "read c", "read d", "read e", "read f"],
      true,
    )

    const skillId = result.skill!.id
    await rejectSkill(testDir, skillId)

    const pending = await getPendingSkills(testDir)
    expect(pending.length).toBe(0)
  })

  test("getPendingSkills returns draft skills", async () => {
    await analyzeTaskForSkill(
      testDir,
      "ses123",
      "test task",
      ["read a", "read b", "read c", "read d", "read e", "read f"],
      true,
    )

    const pending = await getPendingSkills(testDir)
    expect(pending.length).toBe(1)
    expect(pending[0].status).toBe("draft")
  })
})
