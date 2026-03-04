import { describe, test, expect } from "bun:test"
import { LearningConfig, defaultLearningConfig } from "../../src/learning/config"

describe("learning config", () => {
  test("default config has correct values", () => {
    expect(defaultLearningConfig.enabled).toBe(true)
    expect(defaultLearningConfig.schedule.cron).toBeUndefined()
    expect(defaultLearningConfig.schedule.idle_check).toBe(true)
    expect(defaultLearningConfig.topics).toEqual(["AI", "code generation", "agent systems"])
    expect(defaultLearningConfig.max_items_per_run).toBe(10)
  })

  test("config validation with cron", () => {
    const config: LearningConfig = {
      ...defaultLearningConfig,
      schedule: {
        cron: "0 10 * * 1,3,5",
        idle_check: false,
        idle_threshold_minutes: 60,
      },
    }
    expect(config.schedule.cron).toBe("0 10 * * 1,3,5")
    expect(config.schedule.idle_check).toBe(false)
  })

  test("config validation with topics", () => {
    const config: LearningConfig = {
      ...defaultLearningConfig,
      topics: ["machine learning", "typescript"],
    }
    expect(config.topics).toEqual(["machine learning", "typescript"])
  })
})

describe("learning scheduler", () => {
  test("scheduler can be instantiated", async () => {
    const { LearningScheduler } = await import("../../src/learning/scheduler")
    const scheduler = new LearningScheduler(defaultLearningConfig)
    expect(scheduler).toBeDefined()
  })

  test("getNextScheduledTime returns null without cron", async () => {
    const { LearningScheduler } = await import("../../src/learning/scheduler")
    const scheduler = new LearningScheduler(defaultLearningConfig)
    const nextTime = scheduler.getNextScheduledTime()
    expect(nextTime).toBeNull()
  })
})

describe("note generator", () => {
  test("note generator can be instantiated", async () => {
    const { NoteGenerator } = await import("../../src/learning/notes")
    const generator = new NoteGenerator("docs/learning/notes")
    expect(generator).toBeDefined()
  })
})

describe("negative memory module", () => {
  test("negative memory module can be imported", async () => {
    const nm = await import("../../src/learning/negative")
    expect(nm.NegativeMemory).toBeDefined()
  })

  test("negative memory class can be instantiated", async () => {
    const { NegativeMemory } = await import("../../src/learning/negative")
    const instance = new NegativeMemory()
    expect(instance).toBeDefined()
  })
})

describe("archive module", () => {
  test("archive module can be imported", async () => {
    const arc = await import("../../src/learning/archive")
    expect(arc.Archive).toBeDefined()
  })

  test("archive class can be instantiated", async () => {
    const { Archive } = await import("../../src/learning/archive")
    const instance = new Archive()
    expect(instance).toBeDefined()
  })
})
