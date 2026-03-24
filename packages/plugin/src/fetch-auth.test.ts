import { describe, it, expect, beforeEach } from "bun:test"
import {
  fetchWithBearerAuthScopeFallback,
  createAuthFetch,
  MultiProviderTokenProvider,
  TokenCache,
  isAuthFailureStatus,
  type ScopeTokenProvider,
} from "./fetch-auth"

describe("isAuthFailureStatus", () => {
  it("returns true for 401", () => {
    expect(isAuthFailureStatus(401)).toBe(true)
  })

  it("returns true for 403", () => {
    expect(isAuthFailureStatus(403)).toBe(true)
  })

  it("returns false for other statuses", () => {
    expect(isAuthFailureStatus(200)).toBe(false)
    expect(isAuthFailureStatus(400)).toBe(false)
    expect(isAuthFailureStatus(404)).toBe(false)
    expect(isAuthFailureStatus(500)).toBe(false)
  })
})

describe("fetchWithBearerAuthScopeFallback", () => {
  describe("basic functionality", () => {
    it("returns successful response without auth", async () => {
      const mockFetch = () => Promise.resolve(new Response("ok", { status: 200 }))

      const response = await fetchWithBearerAuthScopeFallback({
        url: "https://api.example.com/data",
        scopes: ["read:data"],
        fetchFn: mockFetch as typeof fetch,
      })

      expect(response.ok).toBe(true)
      await expect(response.text()).resolves.toBe("ok")
    })

    it("retries with auth on 401", async () => {
      let callCount = 0
      const mockFetch = () => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve(new Response("unauthorized", { status: 401 }))
        }
        return Promise.resolve(new Response("ok", { status: 200 }))
      }

      const mockTokenProvider: ScopeTokenProvider = {
        getAccessToken: async (scope) => {
          expect(scope).toBe("read:data")
          return "mock-token"
        },
      }

      const response = await fetchWithBearerAuthScopeFallback({
        url: "https://api.example.com/data",
        scopes: ["read:data"],
        tokenProvider: mockTokenProvider,
        fetchFn: mockFetch as typeof fetch,
      })

      expect(callCount).toBe(2)
      expect(response.ok).toBe(true)
    })

    it("retries with auth on 403", async () => {
      let callCount = 0
      const mockFetch = () => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve(new Response("forbidden", { status: 403 }))
        }
        return Promise.resolve(new Response("ok", { status: 200 }))
      }

      const response = await fetchWithBearerAuthScopeFallback({
        url: "https://api.example.com/data",
        scopes: ["read:data"],
        tokenProvider: { getAccessToken: async () => "token" },
        fetchFn: mockFetch as typeof fetch,
      })

      expect(callCount).toBe(2)
      expect(response.ok).toBe(true)
    })

    it("returns original response if no token provider", async () => {
      const mockFetch = () =>
        Promise.resolve(new Response("unauthorized", { status: 401 }))

      const response = await fetchWithBearerAuthScopeFallback({
        url: "https://api.example.com/data",
        scopes: ["read:data"],
        fetchFn: mockFetch as typeof fetch,
      })

      expect(response.status).toBe(401)
    })
  })

  describe("scope fallback", () => {
    it("tries scopes in order until success", async () => {
      let callCount = 0
      const mockFetch = () => {
        callCount++
        if (callCount <= 2) {
          return Promise.resolve(new Response("unauthorized", { status: 401 }))
        }
        return Promise.resolve(new Response("ok", { status: 200 }))
      }

      const scopesTried: string[] = []
      const mockTokenProvider: ScopeTokenProvider = {
        getAccessToken: async (scope) => {
          scopesTried.push(scope)
          return "token"
        },
      }

      const response = await fetchWithBearerAuthScopeFallback({
        url: "https://api.example.com/data",
        scopes: ["read:admin", "read:data", "read:public"],
        tokenProvider: mockTokenProvider,
        fetchFn: mockFetch as typeof fetch,
      })

      expect(response.ok).toBe(true)
      expect(scopesTried).toEqual(["read:admin", "read:data"])
    })

    it("returns original response if all scopes fail", async () => {
      const mockFetch = () =>
        Promise.resolve(new Response("unauthorized", { status: 401 }))

      const mockTokenProvider: ScopeTokenProvider = {
        getAccessToken: async () => "token",
      }

      const response = await fetchWithBearerAuthScopeFallback({
        url: "https://api.example.com/data",
        scopes: ["scope1", "scope2"],
        tokenProvider: mockTokenProvider,
        fetchFn: mockFetch as typeof fetch,
      })

      expect(response.status).toBe(401)
    })
  })

  describe("HTTPS requirement", () => {
    it("rejects HTTP URLs by default", async () => {
      await expect(
        fetchWithBearerAuthScopeFallback({
          url: "http://api.example.com/data",
          scopes: ["read:data"],
        }),
      ).rejects.toThrow("URL must use HTTPS")
    })

    it("allows HTTP when requireHttps is false", async () => {
      const mockFetch = () => Promise.resolve(new Response("ok", { status: 200 }))

      const response = await fetchWithBearerAuthScopeFallback({
        url: "http://api.example.com/data",
        scopes: ["read:data"],
        requireHttps: false,
        fetchFn: mockFetch as typeof fetch,
      })

      expect(response.ok).toBe(true)
    })
  })

  describe("custom options", () => {
    it("uses custom shouldRetry function", async () => {
      let callCount = 0
      const mockFetch = () => {
        callCount++
        return Promise.resolve(new Response("rate limited", { status: 429 }))
      }

      const response = await fetchWithBearerAuthScopeFallback({
        url: "https://api.example.com/data",
        scopes: ["read:data"],
        tokenProvider: { getAccessToken: async () => "token" },
        shouldRetry: (res) => res.status === 429, // Retry on rate limit
        fetchFn: mockFetch as typeof fetch,
      })

      // Should retry once with auth
      expect(callCount).toBe(2)
      expect(response.status).toBe(429)
    })

    it("uses custom shouldAttachAuth function", async () => {
      const mockFetch = () =>
        Promise.resolve(new Response("unauthorized", { status: 401 }))

      const response = await fetchWithBearerAuthScopeFallback({
        url: "https://public-api.example.com/data",
        scopes: ["read:data"],
        tokenProvider: { getAccessToken: async () => "token" },
        shouldAttachAuth: (url) => !url.includes("public"),
        fetchFn: mockFetch as typeof fetch,
      })

      // Should not retry because shouldAttachAuth returns false
      expect(response.status).toBe(401)
    })

    it("passes requestInit to fetch", async () => {
      let capturedInit: RequestInit | undefined
      const mockFetch = (_url: string, init?: RequestInit) => {
        capturedInit = init
        return Promise.resolve(new Response("ok", { status: 200 }))
      }

      await fetchWithBearerAuthScopeFallback({
        url: "https://api.example.com/data",
        scopes: ["read:data"],
        requestInit: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ test: true }),
        },
        fetchFn: mockFetch as typeof fetch,
      })

      expect(capturedInit?.method).toBe("POST")
      expect(capturedInit?.headers).toMatchObject({ "Content-Type": "application/json" })
    })

    it("adds Authorization header on retry", async () => {
      let authHeader: string | undefined
      const mockFetch = (_url: string, init?: RequestInit) => {
        if (init?.headers) {
          const headers = init.headers as Headers
          authHeader = headers.get("Authorization") || undefined
        }
        return Promise.resolve(new Response("ok", { status: 200 }))
      }

      await fetchWithBearerAuthScopeFallback({
        url: "https://api.example.com/data",
        scopes: ["read:data"],
        tokenProvider: { getAccessToken: async () => "test-token-123" },
        fetchFn: mockFetch as typeof fetch,
      })

      expect(authHeader).toBe("Bearer test-token-123")
    })
  })

  describe("error handling", () => {
    it("throws on invalid URL", async () => {
      await expect(
        fetchWithBearerAuthScopeFallback({
          url: "not-a-valid-url",
          scopes: ["read:data"],
        }),
      ).rejects.toThrow("Invalid URL")
    })

    it("ignores token provider errors and tries next scope", async () => {
      let callCount = 0
      const mockFetch = () => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve(new Response("unauthorized", { status: 401 }))
        }
        return Promise.resolve(new Response("ok", { status: 200 }))
      }

      const mockTokenProvider: ScopeTokenProvider = {
        getAccessToken: async (scope) => {
          if (scope === "scope1") {
            throw new Error("Token acquisition failed")
          }
          return "token"
        },
      }

      const response = await fetchWithBearerAuthScopeFallback({
        url: "https://api.example.com/data",
        scopes: ["scope1", "scope2"],
        tokenProvider: mockTokenProvider,
        fetchFn: mockFetch as typeof fetch,
      })

      expect(response.ok).toBe(true)
    })
  })
})

describe("createAuthFetch", () => {
  it("creates a fetch wrapper with default scopes", async () => {
    let capturedAuthHeader: string | undefined
    const mockFetch = () => {
      return Promise.resolve(
        new Response("ok", {
          status: 200,
          headers: capturedAuthHeader ? {} : { "www-authenticate": "Bearer" },
        }),
      )
    }

    const authFetch = createAuthFetch(
      ["read:data"],
      { getAccessToken: async () => "my-token" },
      { fetchFn: mockFetch as typeof fetch },
    )

    const response = await authFetch("https://api.example.com/data")
    expect(response.ok).toBe(true)
  })

  it("passes through url and init", async () => {
    let capturedUrl: string | undefined
    let capturedInit: RequestInit | undefined

    const mockFetch = (url: string, init?: RequestInit) => {
      capturedUrl = url
      capturedInit = init
      return Promise.resolve(new Response("ok", { status: 200 }))
    }

    const authFetch = createAuthFetch(
      ["read:data"],
      { getAccessToken: async () => "token" },
      { fetchFn: mockFetch as typeof fetch },
    )

    await authFetch("https://api.example.com/data", {
      method: "DELETE",
      headers: { "X-Custom": "value" },
    })

    expect(capturedUrl).toBe("https://api.example.com/data")
    expect(capturedInit?.method).toBe("DELETE")
  })
})

describe("MultiProviderTokenProvider", () => {
  it("uses primary provider successfully", async () => {
    const primary: ScopeTokenProvider = {
      getAccessToken: async () => "primary-token",
    }

    const provider = new MultiProviderTokenProvider({ primary })
    const token = await provider.getAccessToken("read:data")

    expect(token).toBe("primary-token")
  })

  it("falls back to secondary provider on failure", async () => {
    const primary: ScopeTokenProvider = {
      getAccessToken: async () => {
        throw new Error("Primary failed")
      },
    }

    const fallback: ScopeTokenProvider = {
      getAccessToken: async () => "fallback-token",
    }

    const provider = new MultiProviderTokenProvider({
      primary,
      fallbacks: [fallback],
    })

    const token = await provider.getAccessToken("read:data")
    expect(token).toBe("fallback-token")
  })

  it("tries multiple scopes for primary", async () => {
    const scopesTried: string[] = []
    const primary: ScopeTokenProvider = {
      getAccessToken: async (scope) => {
        scopesTried.push(scope)
        if (scope === "scope2") {
          return "success-token"
        }
        throw new Error("Failed")
      },
    }

    const provider = new MultiProviderTokenProvider({
      primary,
      providerScopes: {
        primary: ["scope1", "scope2"],
      },
    })

    const token = await provider.getAccessToken("read:data")
    expect(token).toBe("success-token")
    expect(scopesTried).toEqual(["scope1", "scope2"])
  })

  it("throws when all providers fail", async () => {
    const primary: ScopeTokenProvider = {
      getAccessToken: async () => {
        throw new Error("Primary failed")
      },
    }

    const fallback: ScopeTokenProvider = {
      getAccessToken: async () => {
        throw new Error("Fallback failed")
      },
    }

    const provider = new MultiProviderTokenProvider({
      primary,
      fallbacks: [fallback],
    })

    await expect(provider.getAccessToken("read:data")).rejects.toThrow(
      "All token providers failed",
    )
  })
})

describe("TokenCache", () => {
  let mockProvider: ScopeTokenProvider
  let callCount: number

  beforeEach(() => {
    callCount = 0
    mockProvider = {
      getAccessToken: async (scope) => {
        callCount++
        return `token-${scope}-${callCount}`
      },
    }
  })

  it("caches tokens", async () => {
    const cache = new TokenCache(mockProvider)

    const token1 = await cache.getAccessToken("scope1")
    const token2 = await cache.getAccessToken("scope1")

    expect(token1).toBe(token2)
    expect(callCount).toBe(1)
  })

  it("fetches new token when scopes differ", async () => {
    const cache = new TokenCache(mockProvider)

    await cache.getAccessToken("scope1")
    await cache.getAccessToken("scope2")

    expect(callCount).toBe(2)
  })

  it("refreshes token near expiry", async () => {
    const cache = new TokenCache(mockProvider)
    cache.refreshThresholdMs = 1000 // 1 second threshold

    // Set a token that expires soon
    const now = Date.now()
    cache.setToken("scope1", "old-token", new Date(now + 500)) // Expires in 500ms

    // Wait for threshold to pass
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const token = await cache.getAccessToken("scope1")
    expect(token).not.toBe("old-token")
  })

  it("uses cached token when not near expiry", async () => {
    const cache = new TokenCache(mockProvider)
    cache.refreshThresholdMs = 1000

    const now = Date.now()
    cache.setToken("scope1", "fresh-token", new Date(now + 60 * 60 * 1000)) // Expires in 1 hour

    const token = await cache.getAccessToken("scope1")
    expect(token).toBe("fresh-token")
    expect(callCount).toBe(0)
  })

  it("invalidates specific scope", async () => {
    const cache = new TokenCache(mockProvider)

    await cache.getAccessToken("scope1")
    await cache.getAccessToken("scope2")

    cache.invalidate("scope1")

    await cache.getAccessToken("scope1") // Should fetch new token

    expect(callCount).toBe(3) // scope1 initial + scope2 + scope1 after invalidate
  })

  it("clears all tokens", async () => {
    const cache = new TokenCache(mockProvider)

    await cache.getAccessToken("scope1")
    await cache.getAccessToken("scope2")

    cache.clear()

    await cache.getAccessToken("scope1")
    await cache.getAccessToken("scope2")

    expect(callCount).toBe(4) // 2 initial + 2 after clear
  })
})
