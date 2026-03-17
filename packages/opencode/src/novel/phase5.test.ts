import { describe, test, expect, beforeEach } from "bun:test"
import { CharacterLifecycleManager } from "./character-lifecycle"
import { MultiThreadNarrativeExecutor } from "./multi-thread-narrative"
import { EndGameDetector } from "./end-game-detection"

describe("CharacterLifecycleManager", () => {
  let manager: CharacterLifecycleManager

  beforeEach(() => {
    manager = new CharacterLifecycleManager()
    manager.setCurrentChapter(1)
  })

  test("registerCharacter creates lifecycle", () => {
    const lifecycle = manager.registerCharacter("alice", 1, 25)

    expect(lifecycle.characterId).toBe("alice")
    expect(lifecycle.currentAge).toBe(25)
    expect(lifecycle.lifeStage).toBe("adult")
    expect(lifecycle.status).toBe("active")
  })

  test("advanceTime ages characters", () => {
    manager.registerCharacter("alice", 1, 20)
    manager.setCurrentChapter(11) // 1 chapter = 1 year with default config

    const changes = manager.advanceTime(100) // Need more chapters to age

    const aliceLifecycle = manager.getLifecycle("alice")
    expect(aliceLifecycle?.currentAge).toBeGreaterThanOrEqual(20)
  })

  test("recordDeath marks character as dead", () => {
    const lifecycle = manager.registerCharacter("bob", 1, 30)

    const died = manager.recordDeath("bob", "battle wound")

    expect(died).toBe(true)
    const updated = manager.getLifecycle("bob")
    expect(updated?.status).toBe("dead")
    expect(updated?.deathChapter).toBe(1)
  })

  test("recordTransformation changes status", () => {
    manager.registerCharacter("charlie", 1, 25)

    const transformed = manager.recordTransformation("charlie", "active", "transformed", "cursed")

    expect(transformed).toBe(true)
    const updated = manager.getLifecycle("charlie")
    expect(updated?.status).toBe("transformed")
    expect(updated?.transformations.length).toBeGreaterThan(0)
  })

  test("getActiveCharacters returns only active", () => {
    manager.registerCharacter("alice", 1, 25)
    manager.registerCharacter("bob", 1, 30)
    manager.recordDeath("bob", "old age")

    const active = manager.getActiveCharacters()

    expect(active.length).toBe(1)
    expect(active[0].characterId).toBe("alice")
  })

  test("addLifeEvent records event", () => {
    manager.registerCharacter("alice", 1, 17)

    const event = manager.addLifeEvent("alice", {
      type: "coming_of_age",
      chapter: 2,
      description: "Alice came of age",
    })

    expect(event.type).toBe("coming_of_age")
    const lifecycle = manager.getLifecycle("alice")
    expect(lifecycle?.lifeEvents.length).toBe(2) // birth + coming_of_age
  })
})

describe("MultiThreadNarrativeExecutor", () => {
  let executor: MultiThreadNarrativeExecutor

  beforeEach(() => {
    executor = new MultiThreadNarrativeExecutor()
  })

  test("createThread creates narrative thread", () => {
    const thread = executor.createThread("Main Story", "Alice", 5)

    expect(thread.name).toBe("Main Story")
    expect(thread.povCharacter).toBe("Alice")
    expect(thread.status).toBe("active")
    expect(thread.priority).toBe(5)
  })

  test("advanceThread adds chapter", async () => {
    const thread = executor.createThread("Main Story", "Alice")

    await executor.advanceThread(thread.id, {
      summary: "Alice discovers the truth",
      events: ["discovery", "confrontation"],
      characters: ["Alice", "Bob"],
      location: "Castle",
    })

    const updated = executor.getThread(thread.id)
    expect(updated?.chapters.length).toBe(1)
    expect(updated?.currentChapter).toBe(2) // Starts at 1, then advances to 2
  })

  test("pauseThread pauses thread", () => {
    const thread = executor.createThread("Main Story", "Alice")

    const paused = executor.pauseThread(thread.id)

    expect(paused).toBe(true)
    const updated = executor.getThread(thread.id)
    expect(updated?.status).toBe("paused")
  })

  test("mergeThreads combines threads", () => {
    const thread1 = executor.createThread("Story A", "Alice")
    const thread2 = executor.createThread("Story B", "Bob")

    executor.advanceThread(thread1.id, {
      summary: "A1",
      events: [],
      characters: [],
    })
    executor.advanceThread(thread2.id, {
      summary: "B1",
      events: [],
      characters: [],
    })

    const merged = executor.mergeThreads(thread1.id, thread2.id)

    expect(merged).toBe(true)
    const target = executor.getThread(thread2.id)
    expect(target?.chapters.length).toBe(2)
  })

  test("getActiveThreads returns active threads", () => {
    executor.createThread("Thread 1", "Alice")
    executor.createThread("Thread 2", "Bob")
    const thread3 = executor.createThread("Thread 3", "Charlie")
    executor.pauseThread(thread3.id)

    const active = executor.getActiveThreads()

    expect(active.length).toBe(2)
  })
})

describe("EndGameDetector", () => {
  let detector: EndGameDetector

  beforeEach(() => {
    detector = new EndGameDetector()
  })

  test("addCriterion adds completion criterion", () => {
    const criterion = detector.addCriterion({
      type: "major_arc_resolved",
      description: "Main story arc resolved",
      threshold: 100,
    })

    expect(criterion.type).toBe("major_arc_resolved")
    expect(criterion.threshold).toBe(100)
    expect(criterion.met).toBe(false)
  })

  test("updateCriterion updates progress", () => {
    const criterion = detector.addCriterion({
      type: "character_arcs_complete",
      description: "All character arcs complete",
      threshold: 100,
    })

    const updated = detector.updateCriterion(criterion.id, 75)

    expect(updated?.current).toBe(75)
    expect(updated?.met).toBe(false)

    const updated2 = detector.updateCriterion(criterion.id, 100)
    expect(updated2?.met).toBe(true)
  })

  test("checkCompletion returns report", async () => {
    const detector = new EndGameDetector({
      minCompletionScore: 0,
      requiredCriteria: [],
      enableSequelHooks: false,
      enableEpilogue: false,
    })

    detector.addCriterion({
      type: "chapter_count",
      description: "Test",
      threshold: 100,
    })

    detector.updateCriterion(Array.from(detector["criteria"].keys())[0], 50)

    const report = await detector.checkCompletion()

    expect(report.isComplete).toBeDefined()
    expect(report.completionScore).toBeDefined()
    expect(Array.isArray(report.recommendations)).toBe(true)
  })

  test("generateSequelHooks returns hooks", async () => {
    const detector2 = new EndGameDetector({
      minCompletionScore: 0,
      requiredCriteria: [],
      enableSequelHooks: true,
      enableEpilogue: false,
    })

    detector2.addCriterion({
      type: "chapter_count",
      description: "Test",
      threshold: 1,
    })
    detector2.updateCriterion(Array.from(detector2["criteria"].keys())[0], 100)

    const report = await detector2.checkCompletion()

    expect(report.sequelHooks).toBeDefined()
    expect(report.sequelHooks?.length).toBeGreaterThan(0)
  })

  test("generateDenouementStructure returns structure", () => {
    const structure = detector.generateDenouementStructure()

    expect(structure.length).toBe(4)
    expect(structure[0].focus).toBe("Immediate Aftermath")
    expect(structure[3].focus).toBe("Thematic Echo & Final Image")
  })

  test("getCriterionProgress returns progress", () => {
    detector.addCriterion({
      type: "user_satisfaction",
      description: "User rating",
      threshold: 80,
    })

    const progress = detector.getCriterionProgress()

    expect(progress.length).toBe(1)
    expect(progress[0].type).toBe("user_satisfaction")
  })
})
