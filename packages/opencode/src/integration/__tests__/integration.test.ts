import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import { OpenFangHttpClient } from "../client"
import { mapCapabilities, convertOpenFangAgentToOpenCode } from "../capability-mapper"
import { OpenFangErrorHandler, OpenFangErrors } from "../error-handler"
import { AvailableHands, HandsManager } from "../hands"
import type { OpenFangAgentInfo } from "../types"

describe("OpenFang Integration", () => {
  describe("Capability Mapper", () => {
    test("should map OpenFang tools to OpenCode capabilities", () => {
      const caps = {
        tools: ["file_read", "web_search", "memory_store"],
        network: ["*"],
        memory_read: ["*"],
        memory_write: ["self.*"],
        shell: [],
      }

      const result = mapCapabilities(caps)

      expect(result).toContain("file:read")
      expect(result).toContain("web:search")
      expect(result).toContain("memory:write")
      expect(result).toContain("network:*")
    })

    test("should convert OpenFang agent to OpenCode format", () => {
      const openfangAgent: OpenFangAgentInfo = {
        id: "test-agent-123",
        name: "Test Agent",
        module: "builtin:chat",
        state: "idle",
        capabilities: {
          tools: ["file_read", "web_search"],
          network: ["api.example.com"],
          memory_read: ["*"],
          memory_write: ["self.*"],
          shell: ["cargo *"],
        },
        model: {
          provider: "anthropic",
          model: "claude-3-5-sonnet",
          max_tokens: 8192,
        },
        resources: {
          max_llm_tokens_per_hour: 200000,
          max_concurrent_tools: 10,
        },
        created_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      }

      const result = convertOpenFangAgentToOpenCode(openfangAgent)

      expect(result.id).toBe("test-agent-123")
      expect(result.name).toBe("Test Agent")
      expect(result.type).toBe("general")
      expect(result.capabilities.length).toBeGreaterThan(0)
      expect(result.config.model.providerID).toBe("anthropic")
    })

    test("should map custom module to custom type", () => {
      const agent: OpenFangAgentInfo = {
        id: "test",
        name: "Test",
        module: "custom:module",
        state: "idle",
        capabilities: {
          tools: [],
          network: [],
          memory_read: [],
          memory_write: [],
          shell: [],
        },
        model: {
          provider: "openai",
          model: "gpt-4",
          max_tokens: 4096,
        },
        resources: {
          max_llm_tokens_per_hour: 100000,
          max_concurrent_tools: 5,
        },
        created_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      }

      const result = convertOpenFangAgentToOpenCode(agent)
      expect(result.type).toBe("custom")
    })
  })

  describe("Error Handler", () => {
    test("should retry on transient errors", async () => {
      const handler = new OpenFangErrorHandler()
      let attempts = 0

      const result = await handler.withRetry(() => {
        attempts++
        if (attempts < 3) {
          throw new Error("503 Service Unavailable")
        }
        return Promise.resolve("success")
      }, "test operation")

      expect(result).toBe("success")
      expect(attempts).toBe(3)
    })

    test("should not retry on 404 errors", async () => {
      const handler = new OpenFangErrorHandler()
      let attempts = 0

      await expect(
        handler.withRetry(() => {
          attempts++
          throw new Error("404 Not Found")
        }, "test operation"),
      ).rejects.toThrow()

      expect(attempts).toBe(1)
    })

    test("should not retry on auth errors", async () => {
      const handler = new OpenFangErrorHandler()
      let attempts = 0

      await expect(
        handler.withRetry(() => {
          attempts++
          throw new Error("401 Unauthorized")
        }, "test operation"),
      ).rejects.toThrow()

      expect(attempts).toBe(1)
    })

    test("should respect max retries", async () => {
      const handler = new OpenFangErrorHandler()

      await expect(
        handler.withRetry(() => {
          throw new Error("500 Internal Server Error")
        }, "test operation"),
      ).rejects.toThrow("failed after 3 retries")
    })
  })

  describe("Hands Registry", () => {
    test("should have 4 available hands", () => {
      const hands = Object.keys(AvailableHands)
      expect(hands).toHaveLength(4)
      expect(hands).toContain("collector")
      expect(hands).toContain("researcher")
      expect(hands).toContain("browser")
      expect(hands).toContain("infisical-sync")
    })

    test("collector hand should have required tools", () => {
      const collector = AvailableHands.collector
      expect(collector.tools).toContain("knowledge_add_entity")
      expect(collector.tools).toContain("memory_store")
      expect(collector.tools).toContain("event_publish")
    })

    test("researcher hand should have research tools", () => {
      const researcher = AvailableHands.researcher
      expect(researcher.tools).toContain("web_search")
      expect(researcher.tools).toContain("web_fetch")
    })

    test("browser hand should have guardrails", () => {
      const browser = AvailableHands.browser
      expect(browser.guardrails).toContain("purchase_approval_required")
    })

    test("infisical-sync should have vault tools", () => {
      const infisical = AvailableHands["infisical-sync"]
      expect(infisical.tools).toContain("vault_set")
      expect(infisical.tools).toContain("vault_get")
      expect(infisical.requirements).toContain("INFISICAL_URL")
    })
  })

  describe("HTTP Client", () => {
    let client: OpenFangHttpClient

    beforeEach(() => {
      client = new OpenFangHttpClient({
        baseUrl: "http://localhost:4200",
        apiKey: "test-key",
      })
    })

    test("should construct with base URL and API key", () => {
      expect(client).toBeDefined()
    })

    test("should handle health check endpoint", async () => {
      // Mock fetch
      const mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: "ok", agents: 2, version: "0.3.30" }),
        }),
      )

      global.fetch = mockFetch as any

      const result = await client.health()

      expect(result.status).toBe("ok")
      expect(result.agents).toBe(2)
      expect(result.version).toBe("0.3.30")
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    test("should handle API errors", async () => {
      const mockFetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Internal server error"),
        }),
      )

      global.fetch = mockFetch as any

      await expect(client.health()).rejects.toThrow("OpenFang API error: 500")
    })
  })
})

describe("OpenFang Config Types", () => {
  test("should validate OpenFang config", () => {
    const { OpenFangConfig } = require("../types")

    const validConfig = {
      enabled: true,
      base_url: "http://localhost:4200",
      api_key: "test-key",
      wasm_enabled: false,
    }

    const result = OpenFangConfig.safeParse(validConfig)
    expect(result.success).toBe(true)
  })

  test("should accept optional fields", () => {
    const { OpenFangConfig } = require("../types")

    const minimalConfig = {
      enabled: false,
      base_url: "http://localhost:4200",
    }

    const result = OpenFangConfig.safeParse(minimalConfig)
    expect(result.success).toBe(true)
  })
})
