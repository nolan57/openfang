import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { PersistentDedupe, InMemoryDedupe } from "./persistent-dedupe"
import { writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("PersistentDedupe", () => {
  let testFile: string

  beforeEach(async () => {
    testFile = join(tmpdir(), `dedupe-test-${Date.now()}.json`)
  })

  afterEach(async () => {
    try {
      await rm(testFile, { force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("constructor", () => {
    it("uses default values for optional options", () => {
      const dedupe = new PersistentDedupe({ filePath: testFile })
      expect(dedupe.size).toBe(0)
    })

    it("accepts custom maxAgeMs", () => {
      const dedupe = new PersistentDedupe({
        filePath: testFile,
        maxAgeMs: 60000, // 1 minute
      })
      expect(dedupe.size).toBe(0)
    })

    it("accepts custom maxEntries", () => {
      const dedupe = new PersistentDedupe({
        filePath: testFile,
        maxEntries: 100,
      })
      expect(dedupe.size).toBe(0)
    })
  })

  describe("load and save", () => {
    it("starts empty when file doesn't exist", async () => {
      const dedupe = new PersistentDedupe({ filePath: testFile })
      await dedupe.load()
      expect(dedupe.size).toBe(0)
    })

    it("loads existing entries", async () => {
      const now = Date.now()
      await writeFile(
        testFile,
        JSON.stringify([
          { id: "msg1", timestamp: now - 1000 },
          { id: "msg2", timestamp: now - 2000 },
          { id: "msg3", timestamp: now - 3000 },
        ]),
      )

      const dedupe = new PersistentDedupe({ filePath: testFile })
      await dedupe.load()

      expect(dedupe.size).toBe(3)
      expect(dedupe.isDuplicate("msg1")).toBe(true)
      expect(dedupe.isDuplicate("msg2")).toBe(true)
      expect(dedupe.isDuplicate("msg3")).toBe(true)
    })

    it("handles corrupted file gracefully", async () => {
      await writeFile(testFile, "not valid json")

      const dedupe = new PersistentDedupe({ filePath: testFile })
      await dedupe.load()

      expect(dedupe.size).toBe(0)
    })

    it("handles non-array JSON gracefully", async () => {
      await writeFile(testFile, JSON.stringify({ not: "an array" }))

      const dedupe = new PersistentDedupe({ filePath: testFile })
      await dedupe.load()

      expect(dedupe.size).toBe(0)
    })

    it("saves entries to disk", async () => {
      const dedupe = new PersistentDedupe({ filePath: testFile })
      await dedupe.load()
      await dedupe.markAsSeen("msg1")
      await dedupe.markAsSeen("msg2")

      // Reload to verify persistence
      const dedupe2 = new PersistentDedupe({ filePath: testFile })
      await dedupe2.load()

      expect(dedupe2.size).toBe(2)
      expect(dedupe2.isDuplicate("msg1")).toBe(true)
      expect(dedupe2.isDuplicate("msg2")).toBe(true)
    })

    it("creates parent directories when saving", async () => {
      const nestedFile = join(tmpdir(), `dedupe-test-${Date.now()}`, "subdir", "test.json")
      const dedupe = new PersistentDedupe({ filePath: nestedFile })
      await dedupe.load()
      await dedupe.markAsSeen("msg1")

      const dedupe2 = new PersistentDedupe({ filePath: nestedFile })
      await dedupe2.load()
      expect(dedupe2.isDuplicate("msg1")).toBe(true)

      // Cleanup
      await rm(nestedFile, { force: true, recursive: true })
    })
  })

  describe("isDuplicate", () => {
    it("returns false for unseen IDs", async () => {
      const dedupe = new PersistentDedupe({ filePath: testFile })
      await dedupe.load()
      expect(dedupe.isDuplicate("new-id")).toBe(false)
    })

    it("returns true for seen IDs", async () => {
      const dedupe = new PersistentDedupe({ filePath: testFile })
      await dedupe.load()
      await dedupe.markAsSeen("seen-id")
      expect(dedupe.isDuplicate("seen-id")).toBe(true)
    })
  })

  describe("checkAndMark", () => {
    it("returns false for new IDs and marks them", async () => {
      const dedupe = new PersistentDedupe({ filePath: testFile })
      await dedupe.load()

      const result = await dedupe.checkAndMark("new-id")
      expect(result).toBe(false)
      expect(dedupe.isDuplicate("new-id")).toBe(true)
    })

    it("returns true for duplicate IDs", async () => {
      const dedupe = new PersistentDedupe({ filePath: testFile })
      await dedupe.load()
      await dedupe.markAsSeen("existing-id")

      const result = await dedupe.checkAndMark("existing-id")
      expect(result).toBe(true)
    })

    it("persists the marked ID", async () => {
      const dedupe = new PersistentDedupe({ filePath: testFile })
      await dedupe.load()

      await dedupe.checkAndMark("persistent-id")

      const dedupe2 = new PersistentDedupe({ filePath: testFile })
      await dedupe2.load()
      expect(dedupe2.isDuplicate("persistent-id")).toBe(true)
    })
  })

  describe("remove", () => {
    it("removes an ID from the store", async () => {
      const dedupe = new PersistentDedupe({ filePath: testFile })
      await dedupe.load()
      await dedupe.markAsSeen("to-remove")

      await dedupe.remove("to-remove")

      expect(dedupe.isDuplicate("to-remove")).toBe(false)
    })

    it("persists the removal", async () => {
      const dedupe = new PersistentDedupe({ filePath: testFile })
      await dedupe.load()
      await dedupe.markAsSeen("to-remove")
      await dedupe.remove("to-remove")

      const dedupe2 = new PersistentDedupe({ filePath: testFile })
      await dedupe2.load()
      expect(dedupe2.isDuplicate("to-remove")).toBe(false)
    })
  })

  describe("clear", () => {
    it("removes all IDs", async () => {
      const dedupe = new PersistentDedupe({ filePath: testFile })
      await dedupe.load()
      await dedupe.markAsSeen("id1")
      await dedupe.markAsSeen("id2")
      await dedupe.markAsSeen("id3")

      await dedupe.clear()

      expect(dedupe.size).toBe(0)
      expect(dedupe.isDuplicate("id1")).toBe(false)
    })
  })

  describe("cleanup", () => {
    it("removes expired entries", async () => {
      const now = Date.now()
      await writeFile(
        testFile,
        JSON.stringify([
          { id: "fresh1", timestamp: now - 1000 },
          { id: "expired1", timestamp: now - 100000 }, // 100 seconds old
          { id: "fresh2", timestamp: now - 2000 },
          { id: "expired2", timestamp: now - 200000 }, // 200 seconds old
        ]),
      )

      const dedupe = new PersistentDedupe({
        filePath: testFile,
        maxAgeMs: 50000, // 50 seconds
      })
      await dedupe.load()

      const stats = await dedupe.cleanup()

      expect(stats.expiredCount).toBe(2)
      expect(dedupe.isDuplicate("fresh1")).toBe(true)
      expect(dedupe.isDuplicate("fresh2")).toBe(true)
      expect(dedupe.isDuplicate("expired1")).toBe(false)
      expect(dedupe.isDuplicate("expired2")).toBe(false)
    })

    it("enforces maxEntries limit", async () => {
      const now = Date.now()
      const entries = Array.from({ length: 150 }, (_, i) => ({
        id: `msg${i}`,
        timestamp: now - i * 1000,
      }))

      await writeFile(testFile, JSON.stringify(entries))

      const dedupe = new PersistentDedupe({
        filePath: testFile,
        maxEntries: 100,
      })
      await dedupe.load()

      const stats = await dedupe.cleanup()

      expect(stats.prunedCount).toBe(50)
      expect(dedupe.size).toBe(100)
    })

    it("returns accurate statistics", async () => {
      const now = Date.now()
      await writeFile(
        testFile,
        JSON.stringify([
          { id: "msg1", timestamp: now - 1000 },
          { id: "msg2", timestamp: now - 2000 },
        ]),
      )

      const dedupe = new PersistentDedupe({ filePath: testFile })
      await dedupe.load()

      const stats = await dedupe.cleanup()

      expect(stats.count).toBe(2)
      expect(stats.expiredCount).toBe(0)
      expect(stats.prunedCount).toBe(0)
      expect(stats.oldestTimestamp).toBe(now - 2000)
      expect(stats.newestTimestamp).toBe(now - 1000)
    })
  })

  describe("getStats", () => {
    it("returns current statistics", async () => {
      const now = Date.now()
      await writeFile(
        testFile,
        JSON.stringify([
          { id: "msg1", timestamp: now - 1000 },
          { id: "msg2", timestamp: now - 5000 },
          { id: "msg3", timestamp: now - 3000 },
        ]),
      )

      const dedupe = new PersistentDedupe({ filePath: testFile })
      await dedupe.load()

      const stats = dedupe.getStats()

      expect(stats.count).toBe(3)
      expect(stats.oldestTimestamp).toBe(now - 5000)
      expect(stats.newestTimestamp).toBe(now - 1000)
    })

    it("returns null timestamps for empty store", async () => {
      const dedupe = new PersistentDedupe({ filePath: testFile })
      await dedupe.load()

      const stats = dedupe.getStats()

      expect(stats.count).toBe(0)
      expect(stats.oldestTimestamp).toBe(null)
      expect(stats.newestTimestamp).toBe(null)
    })
  })

  describe("size getter", () => {
    it("returns current entry count", async () => {
      const dedupe = new PersistentDedupe({ filePath: testFile })
      await dedupe.load()

      expect(dedupe.size).toBe(0)

      await dedupe.markAsSeen("id1")
      expect(dedupe.size).toBe(1)

      await dedupe.markAsSeen("id2")
      expect(dedupe.size).toBe(2)
    })
  })

  describe("auto-expiry on load", () => {
    it("filters out expired entries when loading", async () => {
      const now = Date.now()
      await writeFile(
        testFile,
        JSON.stringify([
          { id: "fresh", timestamp: now - 1000 },
          { id: "expired", timestamp: now - 100000 },
        ]),
      )

      const dedupe = new PersistentDedupe({
        filePath: testFile,
        maxAgeMs: 50000,
      })
      await dedupe.load()

      expect(dedupe.size).toBe(1)
      expect(dedupe.isDuplicate("fresh")).toBe(true)
      expect(dedupe.isDuplicate("expired")).toBe(false)
    })
  })
})

describe("InMemoryDedupe", () => {
  describe("checkAndMark", () => {
    it("returns false for new IDs", () => {
      const dedupe = new InMemoryDedupe(100)
      expect(dedupe.checkAndMark("new-id")).toBe(false)
    })

    it("returns true for duplicate IDs", () => {
      const dedupe = new InMemoryDedupe(100)
      dedupe.checkAndMark("id")
      expect(dedupe.checkAndMark("id")).toBe(true)
    })

    it("enforces maxEntries limit", () => {
      const dedupe = new InMemoryDedupe(10)

      // Add 15 entries
      for (let i = 0; i < 15; i++) {
        dedupe.checkAndMark(`id${i}`)
      }

      expect(dedupe.size).toBeLessThanOrEqual(10)
    })

    it("clears oldest entries when full", () => {
      const dedupe = new InMemoryDedupe(5)

      // Add 5 entries
      for (let i = 0; i < 5; i++) {
        dedupe.checkAndMark(`id${i}`)
      }

      // Add one more to trigger cleanup
      dedupe.checkAndMark("id5")

      // Should have removed some old entries
      expect(dedupe.size).toBeLessThanOrEqual(5)
    })
  })

  describe("isDuplicate", () => {
    it("returns false for unseen IDs", () => {
      const dedupe = new InMemoryDedupe(100)
      expect(dedupe.isDuplicate("new-id")).toBe(false)
    })

    it("returns true for seen IDs", () => {
      const dedupe = new InMemoryDedupe(100)
      dedupe.mark("seen-id")
      expect(dedupe.isDuplicate("seen-id")).toBe(true)
    })
  })

  describe("clear", () => {
    it("removes all entries", () => {
      const dedupe = new InMemoryDedupe(100)
      dedupe.mark("id1")
      dedupe.mark("id2")
      dedupe.clear()
      expect(dedupe.size).toBe(0)
    })
  })

  describe("size getter", () => {
    it("returns current count", () => {
      const dedupe = new InMemoryDedupe(100)
      expect(dedupe.size).toBe(0)
      dedupe.mark("id1")
      expect(dedupe.size).toBe(1)
    })
  })
})
