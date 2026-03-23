import { describe, test, expect, beforeEach } from "bun:test"
import { memoize, clearMemoCache, getMemoStats, debounce, throttle, batch, lazy } from "./performance"

describe("memoize", () => {
  beforeEach(() => {
    clearMemoCache()
  })

  test("caches function results", () => {
    let callCount = 0
    const fn = memoize((x: number) => {
      callCount++
      return x * 2
    })

    expect(fn(5)).toBe(10)
    expect(callCount).toBe(1)
    expect(fn(5)).toBe(10)
    expect(callCount).toBe(1) // Not called again
    expect(fn(10)).toBe(20)
    expect(callCount).toBe(2)
  })

  test("respects TTL", async () => {
    let callCount = 0
    const fn = memoize(
      (x: number) => {
        callCount++
        return x * 2
      },
      { ttlMs: 50 },
    )

    expect(fn(5)).toBe(10)
    expect(callCount).toBe(1)

    await new Promise((r) => setTimeout(r, 100))

    expect(fn(5)).toBe(10)
    expect(callCount).toBe(2) // Called again after TTL
  })

  test("uses custom key generator", () => {
    let callCount = 0
    const fn = memoize(
      (x: number, y: number) => {
        callCount++
        return x + y
      },
      { keyGenerator: (x) => `key-${x}` },
    )

    expect(fn(1, 2)).toBe(3)
    expect(callCount).toBe(1)
    expect(fn(1, 99)).toBe(3) // Same key, different y
    expect(callCount).toBe(1)
  })
})

describe("getMemoStats", () => {
  beforeEach(() => {
    clearMemoCache()
  })

  test("returns cache statistics", () => {
    const fn = memoize((x: number) => x)
    fn(1)
    fn(2)

    const stats = getMemoStats()
    expect(stats.size).toBe(2)
    expect(stats.keys.length).toBe(2)
  })
})

describe("debounce", () => {
  test("debounces calls", async () => {
    let callCount = 0
    const fn = debounce((x: number) => {
      callCount++
    }, 50)

    fn(1)
    fn(2)
    fn(3)

    expect(callCount).toBe(0)

    await new Promise((r) => setTimeout(r, 100))

    expect(callCount).toBe(1)
  })

  test("cancel prevents call", async () => {
    let callCount = 0
    const fn = debounce((x: number) => {
      callCount++
    }, 50)

    fn(1)
    fn.cancel()

    await new Promise((r) => setTimeout(r, 100))

    expect(callCount).toBe(0)
  })

  test("flush executes immediately", async () => {
    let callCount = 0
    const fn = debounce((x: number) => {
      callCount++
    }, 50)

    fn(1)
    fn.flush()

    expect(callCount).toBe(1)
  })
})

describe("throttle", () => {
  test("throttles calls", async () => {
    let callCount = 0
    const fn = throttle((x: number) => {
      callCount++
      return x * 2
    }, 100)

    fn(1)
    fn(2)
    fn(3)

    expect(callCount).toBe(1)

    await new Promise((r) => setTimeout(r, 150))

    // The pending call should have executed
    expect(callCount).toBe(2)
  })
})

describe("batch", () => {
  test("batches items", async () => {
    const results: number[][] = []
    const batched = batch(
      async (items: number[]) => {
        results.push(items)
        return items.map((x) => x * 2)
      },
      { maxSize: 3, maxWaitMs: 100 },
    )

    const r1 = batched(1)
    const r2 = batched(2)
    const r3 = batched(3)

    expect(results.length).toBe(1)
    expect(results[0]).toEqual([1, 2, 3])

    expect(await r1).toBe(2)
    expect(await r2).toBe(4)
    expect(await r3).toBe(6)
  })

  test("flushes on maxWaitMs", async () => {
    const results: number[][] = []
    const batched = batch(
      async (items: number[]) => {
        results.push(items)
        return items.map((x) => x * 2)
      },
      { maxSize: 10, maxWaitMs: 50 },
    )

    batched(1)
    batched(2)

    expect(results.length).toBe(0)

    await new Promise((r) => setTimeout(r, 100))

    expect(results.length).toBe(1)
    expect(results[0]).toEqual([1, 2])
  })
})

describe("lazy", () => {
  test("initializes on first call", () => {
    let initialized = false
    const get = lazy(() => {
      initialized = true
      return { value: 42 }
    })

    expect(initialized).toBe(false)

    const result = get()

    expect(initialized).toBe(true)
    expect(result.value).toBe(42)
  })

  test("returns same instance", () => {
    const get = lazy(() => ({ id: Math.random() }))

    const r1 = get()
    const r2 = get()

    expect(r1).toBe(r2)
  })
})
