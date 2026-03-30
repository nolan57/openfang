import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { OpenFangHttpClient } from "../client"
import { initHybridAdapter, getHybridAdapter } from "../hybrid-adapter"
import { initializeOpenFangIntegration, getOpenFangAdapter, dispatchToOpenFang } from "../config"
import { HybridCoordinator } from "../../collab/hybrid-coordinator"

/**
 * End-to-End Tests for OpenFang Integration
 *
 * These tests require a running OpenFang service at http://localhost:4200
 *
 * To run:
 * 1. Start OpenFang: cd /path/to/openfang && ./target/release/openfang start
 * 2. Run tests: bun test src/integration/__tests__/e2e.test.ts
 */

describe("OpenFang E2E Integration", () => {
  let client: OpenFangHttpClient
  const OPENFANG_URL = process.env.OPENFANG_URL || "http://localhost:4200"
  const OPENFANG_API_KEY = process.env.OPENFANG_API_KEY

  beforeAll(async () => {
    client = new OpenFangHttpClient({
      baseUrl: OPENFANG_URL,
      apiKey: OPENFANG_API_KEY,
    })
  })

  describe("Service Connectivity", () => {
    test("should connect to OpenFang service", async () => {
      const health = await client.health()

      expect(health.status).toBeDefined()
      expect(typeof health.status).toBe("string")
      expect(health.agents).toBeGreaterThanOrEqual(0)
      expect(health.version).toBeDefined()

      console.log(`✓ Connected to OpenFang v${health.version} (${health.status})`)
    })

    test("should list available Hands", async () => {
      const hands = await client.listHands()

      expect(Array.isArray(hands)).toBe(true)
      expect(hands.length).toBeGreaterThan(0)

      const handIds = hands.map((h) => h.id)
      expect(handIds).toContain("collector")
      expect(handIds).toContain("researcher")
      expect(handIds).toContain("browser")
      expect(handIds).toContain("infisical-sync")

      console.log(`✓ Found ${hands.length} Hands: ${handIds.join(", ")}`)
    })
  })

  describe("Hands Activation", () => {
    test("should activate Researcher Hand", async () => {
      await client.activateHand("researcher")

      const status = await client.getHandStatus("researcher")

      expect(status.id).toBeDefined()
      expect(status.hand_id).toBe("researcher")
      expect(status.state).toBe("active")
      expect(status.agent_id).toBeDefined()

      console.log(`✓ Activated Researcher Hand (agent: ${status.agent_id})`)
    })

    test("should activate Collector Hand", async () => {
      await client.activateHand("collector")

      const status = await client.getHandStatus("collector")

      expect(status.state).toBe("active")
      expect(status.hand_id).toBe("collector")

      console.log(`✓ Activated Collector Hand`)
    })

    test("should pause and resume Hand", async () => {
      // Pause
      await client.pauseHand("researcher")
      let status = await client.getHandStatus("researcher")
      expect(status.state).toBe("paused")

      // Resume (activate again)
      await client.activateHand("researcher")
      status = await client.getHandStatus("researcher")
      expect(status.state).toBe("active")

      console.log(`✓ Pause/resume cycle successful`)
    })
  })

  describe("Workflow Execution", () => {
    test("should create and run a simple workflow", async () => {
      const workflowId = await client.createWorkflow({
        name: "e2e-test-workflow",
        description: "E2E test workflow",
        steps: [
          {
            name: "test-step",
            prompt: "Hello, this is a test",
            mode: "sequential",
            timeout_secs: 60,
          },
        ],
      })

      expect(workflowId).toBeDefined()
      console.log(`✓ Created workflow: ${workflowId}`)

      const result = await client.runWorkflow(workflowId, "Test input")

      expect(result.run_id).toBeDefined()
      expect(result.status).toBe("completed")
      expect(result.output).toBeDefined()

      console.log(`✓ Workflow executed successfully`)
    })
  })

  describe("Hybrid Adapter", () => {
    test("should initialize hybrid adapter", async () => {
      const adapter = await initHybridAdapter({
        openfang: {
          enabled: true,
          base_url: OPENFANG_URL,
          api_key: OPENFANG_API_KEY,
          wasm_enabled: false,
        },
      })

      expect(adapter).toBeDefined()

      const health = await adapter.health()
      expect(health.available).toBe(true)

      console.log(`✓ Hybrid adapter initialized`)
    })

    test("should dispatch task to OpenFang", async () => {
      const adapter = getHybridAdapter()

      const taskId = await adapter.dispatch({
        id: `e2e-task-${Date.now()}`,
        action: "Test task dispatch",
        payload: { test: true },
        requirements: [],
        priority: "normal",
      })

      expect(taskId).toBeDefined()
      console.log(`✓ Task dispatched: ${taskId}`)
    })

    test("should list available Hands via adapter", async () => {
      const adapter = getHybridAdapter()
      const hands = adapter.listHands()

      expect(Array.isArray(hands)).toBe(true)
      expect(hands.length).toBeGreaterThan(0)

      console.log(`✓ Available Hands: ${hands.join(", ")}`)
    })
  })

  describe("Config Integration", () => {
    test("should initialize from config", async () => {
      await initializeOpenFangIntegration({
        enabled: true,
        baseUrl: OPENFANG_URL,
        autoActivateHands: ["researcher"],
      })

      const adapter = getOpenFangAdapter()
      expect(adapter).toBeDefined()

      console.log(`✓ Config-based initialization successful`)
    })

    test("should dispatch via config wrapper", async () => {
      const agentId = await dispatchToOpenFang({
        id: `config-task-${Date.now()}`,
        action: "Test dispatch via config",
        payload: { source: "config" },
        priority: "high",
      })

      expect(agentId).toBeDefined()
      console.log(`✓ Config dispatch successful: ${agentId}`)
    })
  })

  describe("Hybrid Coordinator", () => {
    test("should route task to OpenFang", async () => {
      const taskId = await HybridCoordinator.dispatch({
        id: `coordinator-task-${Date.now()}`,
        action: "Research AI frameworks",
        payload: { topic: "agent systems" },
        requirements: ["web_search"],
        priority: "high",
      })

      expect(taskId).toBeDefined()
      console.log(`✓ Hybrid coordinator dispatched: ${taskId}`)
    })

    test("should wait for task result", async () => {
      const task = {
        id: `wait-task-${Date.now()}`,
        action: "Test wait",
        payload: {},
        requirements: [],
        priority: "normal" as const,
        timeout: 10000,
      }

      const agentId = await HybridCoordinator.dispatch(task)

      const result = await HybridCoordinator.wait(task.id, task.timeout!)

      expect(result).toBeDefined()
      expect(result.taskId).toBe(task.id)

      console.log(`✓ Task completed: ${result.taskId}`)
    })
  })

  describe("Memory Operations", () => {
    test("should store and retrieve memory", async () => {
      const testMemory = {
        id: `test-memory-${Date.now()}`,
        type: "project" as const,
        content: "E2E test memory content",
        metadata: { test: true },
      }

      await client.storeMemory(testMemory)

      const memories = await client.searchMemories({
        query: "E2E test",
        limit: 5,
      })

      expect(Array.isArray(memories)).toBe(true)
      expect(memories.length).toBeGreaterThan(0)

      console.log(`✓ Memory operations successful`)
    })
  })

  describe("Performance", () => {
    test("should complete health check in <100ms", async () => {
      const start = Date.now()
      await client.health()
      const duration = Date.now() - start

      expect(duration).toBeLessThan(100)
      console.log(`✓ Health check: ${duration}ms`)
    })

    test("should dispatch task in <200ms", async () => {
      const adapter = getHybridAdapter()

      const start = Date.now()
      await adapter.dispatch({
        id: `perf-task-${Date.now()}`,
        action: "Performance test",
        payload: {},
        requirements: [],
        priority: "high",
      })
      const duration = Date.now() - start

      expect(duration).toBeLessThan(200)
      console.log(`✓ Task dispatch: ${duration}ms`)
    })

    test("should activate Hand in <1s", async () => {
      const start = Date.now()
      await client.activateHand("researcher")
      const duration = Date.now() - start

      expect(duration).toBeLessThan(1000)
      console.log(`✓ Hand activation: ${duration}ms`)
    })
  })
})
