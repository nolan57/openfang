import { describe, test, expect } from "bun:test"
import {
  validateRawStateUpdate,
  validateTrauma,
  validateSkill,
  validateGoal,
  validateRelationship,
  validateMindModel,
  validateWorldState,
  withRetry,
  RetryConfig,
  createCorrelationId,
  createCorrelationContext,
} from "../validation"

describe("validation", () => {
  describe("validateRawStateUpdate", () => {
    test("validates valid state update", () => {
      const data = {
        character_updates: [
          {
            name: "Alice",
            stress_delta: 10,
            status_change: "active",
          },
        ],
      }
      const result = validateRawStateUpdate(data)
      expect(result.success).toBe(true)
      expect(result.data?.character_updates?.[0]?.name).toBe("Alice")
    })

    test("rejects invalid state update", () => {
      const data = {
        character_updates: [
          {
            name: 123, // Invalid type
          },
        ],
      }
      const result = validateRawStateUpdate(data)
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    test("accepts empty update", () => {
      const result = validateRawStateUpdate({})
      expect(result.success).toBe(true)
    })
  })

  describe("validateTrauma", () => {
    test("validates valid trauma entry", () => {
      const data = {
        name: "Battle Shock",
        description: "PTSD from combat",
        tags: ["psychological_fear"],
        severity: 7,
        source_event: "Battle of Hastings",
        acquiredChapter: 1,
      }
      const result = validateTrauma(data)
      expect(result.success).toBe(true)
    })

    test("rejects trauma with invalid severity", () => {
      const data = {
        name: "Battle Shock",
        description: "PTSD from combat",
        tags: ["psychological_fear"],
        severity: 15, // Out of range
        source_event: "Battle of Hastings",
        acquiredChapter: 1,
      }
      const result = validateTrauma(data)
      expect(result.success).toBe(false)
    })
  })

  describe("validateSkill", () => {
    test("validates valid skill entry", () => {
      const data = {
        name: "Swordsmanship",
        category: "Combat",
        level: 5,
        description: "Expert sword fighter",
        source_event: "Training montage",
        difficulty: 7,
        acquiredChapter: 2,
      }
      const result = validateSkill(data)
      expect(result.success).toBe(true)
    })

    test("rejects skill with invalid level", () => {
      const data = {
        name: "Swordsmanship",
        category: "Combat",
        level: 15, // Out of range
        description: "Expert sword fighter",
        source_event: "Training montage",
        difficulty: 7,
        acquiredChapter: 2,
      }
      const result = validateSkill(data)
      expect(result.success).toBe(false)
    })
  })

  describe("validateGoal", () => {
    test("validates valid goal", () => {
      const data = {
        type: "main",
        description: "Defeat the dark lord",
        priority: 10,
        status: "active",
        progress: 0,
      }
      const result = validateGoal(data)
      expect(result.success).toBe(true)
    })

    test("rejects goal with invalid status", () => {
      const data = {
        type: "main",
        description: "Defeat the dark lord",
        priority: 10,
        status: "unknown", // Invalid status
        progress: 0,
      }
      const result = validateGoal(data)
      expect(result.success).toBe(false)
    })
  })

  describe("validateRelationship", () => {
    test("validates valid relationship", () => {
      const data = {
        trust: 50,
        hostility: 20,
        dominance: 0,
        friendliness: 60,
        attachmentStyle: "secure",
      }
      const result = validateRelationship(data)
      expect(result.success).toBe(true)
    })

    test("rejects relationship with trust out of range", () => {
      const data = {
        trust: 150, // Out of range
        hostility: 20,
        dominance: 0,
        friendliness: 60,
        attachmentStyle: "secure",
      }
      const result = validateRelationship(data)
      expect(result.success).toBe(false)
    })
  })

  describe("validateMindModel", () => {
    test("validates valid mind model", () => {
      const data = {
        publicSelf: "Friendly and outgoing",
        privateSelf: "Secretly anxious",
        blindSpot: "Doesn't realize how they affect others",
      }
      const result = validateMindModel(data)
      expect(result.success).toBe(true)
    })

    test("rejects mind model missing fields", () => {
      const data = {
        publicSelf: "Friendly and outgoing",
        // Missing privateSelf and blindSpot
      }
      const result = validateMindModel(data)
      expect(result.success).toBe(false)
    })
  })

  describe("validateWorldState", () => {
    test("validates valid world state", () => {
      const data = {
        events: ["War started", "King crowned"],
        threats: ["Dragon invasion"],
        opportunities: ["Alliance offer"],
        activeClues: ["Secret passage found"],
      }
      const result = validateWorldState(data)
      expect(result.success).toBe(true)
    })
  })
})

describe("withRetry", () => {
  test("succeeds on first attempt", async () => {
    let attempts = 0
    const result = await withRetry(async () => {
      attempts++
      return "success"
    })
    expect(result).toBe("success")
    expect(attempts).toBe(1)
  })

  test("retries on failure", async () => {
    let attempts = 0
    const result = await withRetry(
      async () => {
        attempts++
        if (attempts < 3) {
          throw new Error("Temporary failure")
        }
        return "success"
      },
      new RetryConfig({ maxRetries: 3, baseDelayMs: 10 }),
    )
    expect(result).toBe("success")
    expect(attempts).toBe(3)
  })

  test("throws after max retries", async () => {
    let attempts = 0
    try {
      await withRetry(
        async () => {
          attempts++
          throw new Error("Permanent failure")
        },
        new RetryConfig({ maxRetries: 2, baseDelayMs: 10 }),
      )
      expect(true).toBe(false) // Should not reach here
    } catch (e) {
      expect(attempts).toBe(3) // Initial + 2 retries
    }
  })
})

describe("correlation", () => {
  test("createCorrelationId returns unique ids", () => {
    const id1 = createCorrelationId()
    const id2 = createCorrelationId()
    expect(id1).not.toBe(id2)
  })

  test("createCorrelationContext creates context", () => {
    const ctx = createCorrelationContext("test-operation")
    expect(ctx.operation).toBe("test-operation")
    expect(ctx.correlationId).toBeDefined()
    expect(ctx.timestamp).toBeGreaterThan(0)
  })
})
