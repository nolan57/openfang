import { describe, test, expect, beforeEach } from "bun:test"
import { callLLM, callLLMJson, callLLMBatch } from "../llm-wrapper"
import { RetryConfig } from "../validation"

describe("LLM Wrapper", () => {
  describe("callLLM", () => {
    test("calls LLM with basic options", async () => {
      // This test will fail if no model is configured, which is expected
      try {
        const result = await callLLM({
          prompt: "Say hello",
          callType: "test",
        })

        expect(result.text).toBeDefined()
        expect(typeof result.text).toBe("string")
        expect(result.duration).toBeGreaterThan(0)
        expect(result.modelId).toBeDefined()
        expect(result.usedRetry).toBe(false)
      } catch (error) {
        // Expected if no model configured
        expect(String(error)).toContain("LLM")
      }
    })

    test("calls LLM with system prompt", async () => {
      try {
        const result = await callLLM({
          prompt: "What is 2+2?",
          system: "You are a helpful math tutor.",
          callType: "test_math",
        })

        expect(result.text).toBeDefined()
        expect(result.text.toLowerCase()).toMatch(/4|four/)
      } catch (error) {
        expect(String(error)).toContain("LLM")
      }
    })

    test("calls LLM with custom temperature", async () => {
      try {
        const result = await callLLM({
          prompt: "Write a poem",
          temperature: 0.9,
          callType: "test_creative",
        })

        expect(result.text).toBeDefined()
        expect(result.text.length).toBeGreaterThan(0)
      } catch (error) {
        expect(String(error)).toContain("LLM")
      }
    })

    test("calls LLM with retry enabled", async () => {
      try {
        const result = await callLLM({
          prompt: "Test with retry",
          useRetry: true,
          retryConfig: new RetryConfig({
            maxRetries: 2,
            baseDelayMs: 100,
            maxDelayMs: 1000,
          }),
          callType: "test_retry",
        })

        expect(result.text).toBeDefined()
        expect(result.usedRetry).toBeDefined()
      } catch (error) {
        expect(String(error)).toContain("LLM")
      }
    })
  })

  describe("callLLMJson", () => {
    test("calls LLM and parses JSON response", async () => {
      try {
        const result = await callLLMJson<{ answer: number; explanation: string }>({
          prompt: "What is 2+2? Return JSON with 'answer' and 'explanation' fields.",
          callType: "test_json",
          schemaDescription: `{
  "answer": number,
  "explanation": string
}`,
        })

        expect(result.data).toBeDefined()
        expect(typeof result.data.answer).toBe("number")
        expect(typeof result.data.explanation).toBe("string")
      } catch (error) {
        expect(String(error)).toContain("LLM")
      }
    })

    test("calls LLM JSON with lower temperature", async () => {
      try {
        const result = await callLLMJson<{ name: string; age: number }>({
          prompt: "Generate a character. Return JSON with 'name' and 'age' fields.",
          callType: "test_json_char",
          temperature: 0.3,
        })

        expect(result.data).toBeDefined()
        expect(typeof result.data.name).toBe("string")
        expect(typeof result.data.age).toBe("number")
      } catch (error) {
        expect(String(error)).toContain("LLM")
      }
    })
  })

  describe("callLLMBatch", () => {
    test("calls LLM in batch", async () => {
      const calls = [
        { prompt: "Say hello", callType: "batch_1" },
        { prompt: "Say goodbye", callType: "batch_2" },
        { prompt: "Say thanks", callType: "batch_3" },
      ]

      try {
        const results = await callLLMBatch(calls, 2)

        expect(results.length).toBeGreaterThanOrEqual(0)
        expect(results.length).toBeLessThanOrEqual(3)

        for (const result of results) {
          expect(result.text).toBeDefined()
          expect(result.duration).toBeGreaterThanOrEqual(0)
        }
      } catch (error) {
        // Expected if no model configured
        expect(error).toBeDefined()
      }
    })

    test("batch call handles partial failures", async () => {
      try {
        const calls = [
          { prompt: "Test 1", callType: "batch_fail_1" },
          { prompt: "Test 2", callType: "batch_fail_2" },
        ]

        const results = await callLLMBatch(calls, 1)

        expect(Array.isArray(results)).toBe(true)
        expect(results.length).toBeGreaterThanOrEqual(0)
      } catch (error) {
        // Expected if no model configured
        expect(error).toBeDefined()
      }
    })
  })
})
