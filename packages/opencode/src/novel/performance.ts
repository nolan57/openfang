type AnyFunction = (...args: unknown[]) => unknown

const memoCache = new Map<string, { value: unknown; timestamp: number }>()

export interface MemoOptions {
  ttlMs?: number
  keyGenerator?: (...args: unknown[]) => string
}

export function memoize<T extends (...args: any[]) => any>(fn: T, options: MemoOptions = {}): T {
  const { ttlMs, keyGenerator } = options

  return ((...args: Parameters<T>) => {
    const key = keyGenerator ? keyGenerator(...args) : JSON.stringify(args)

    const cached = memoCache.get(key)

    if (cached) {
      if (ttlMs && Date.now() - cached.timestamp > ttlMs) {
        memoCache.delete(key)
      } else {
        return cached.value as ReturnType<T>
      }
    }

    const result = fn(...args)

    if (result && typeof result === "object" && "then" in result && typeof result.then === "function") {
      return result.then((value: unknown) => {
        memoCache.set(key, { value, timestamp: Date.now() })
        return value
      }) as ReturnType<T>
    }

    memoCache.set(key, { value: result, timestamp: Date.now() })
    return result
  }) as T
}

export function clearMemoCache(): void {
  memoCache.clear()
}

export function deleteMemoKey(key: string): boolean {
  return memoCache.delete(key)
}

export function getMemoStats(): { size: number; keys: string[] } {
  return {
    size: memoCache.size,
    keys: Array.from(memoCache.keys()),
  }
}

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()

export interface RateLimitConfig {
  maxCalls: number
  windowMs: number
}

export function rateLimit<T extends (...args: any[]) => any>(fn: T, config: RateLimitConfig): T {
  return ((...args: Parameters<T>) => {
    const key = fn.name || "anonymous"
    const now = Date.now()

    const bucket = rateLimitBuckets.get(key)

    if (bucket && now < bucket.resetAt) {
      if (bucket.count >= config.maxCalls) {
        throw new Error(`Rate limit exceeded for ${key}`)
      }
      bucket.count++
    } else {
      rateLimitBuckets.set(key, {
        count: 1,
        resetAt: now + config.windowMs,
      })
    }

    return fn(...args) as ReturnType<T>
  }) as T
}

export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delayMs: number,
): T & { cancel: () => void; flush: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null

  const debounced = ((...args: Parameters<T>) => {
    lastArgs = args
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      if (lastArgs) {
        fn(...lastArgs)
      }
      timeoutId = null
      lastArgs = null
    }, delayMs)
  }) as T & { cancel: () => void; flush: () => void }

  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    lastArgs = null
  }

  debounced.flush = () => {
    if (timeoutId && lastArgs) {
      clearTimeout(timeoutId)
      fn(...lastArgs)
      timeoutId = null
      lastArgs = null
    }
  }

  return debounced
}

export function throttle<T extends (...args: any[]) => any>(fn: T, intervalMs: number): T {
  let lastCall = 0
  let pending = false
  let lastArgs: Parameters<T> | null = null

  return ((...args: Parameters<T>) => {
    lastArgs = args
    const now = Date.now()

    if (now - lastCall >= intervalMs) {
      lastCall = now
      pending = false
      return fn(...args) as ReturnType<T>
    }

    if (!pending) {
      pending = true
      setTimeout(
        () => {
          if (lastArgs) {
            lastCall = Date.now()
            fn(...lastArgs)
          }
          pending = false
        },
        intervalMs - (now - lastCall),
      )
    }

    return undefined as ReturnType<T>
  }) as T
}

export function batch<T, R>(
  fn: (items: T[]) => R[] | Promise<R[]>,
  config: { maxSize: number; maxWaitMs: number },
): (item: T) => Promise<R> {
  let batchItems: T[] = []
  let resolvers: Array<(result: R) => void> = []
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const flush = async () => {
    const currentBatch = batchItems
    const currentResolvers = resolvers
    batchItems = []
    resolvers = []
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }

    const results = await fn(currentBatch)
    results.forEach((result, i) => {
      currentResolvers[i]?.(result)
    })
  }

  return (item: T): Promise<R> => {
    return new Promise((resolve) => {
      batchItems.push(item)
      resolvers.push(resolve)

      if (batchItems.length >= config.maxSize) {
        flush()
      } else if (!timeoutId) {
        timeoutId = setTimeout(flush, config.maxWaitMs)
      }
    })
  }
}

export function lazy<T>(factory: () => T): () => T {
  let instance: T | undefined
  let initialized = false

  return () => {
    if (!initialized) {
      instance = factory()
      initialized = true
    }
    return instance as T
  }
}
