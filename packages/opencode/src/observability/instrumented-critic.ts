import { type Span, SpanStatusCode, context, trace } from "@opentelemetry/api"
import { generateText } from "ai"
import { Provider } from "../provider/provider"
import { Log } from "../util/log"
import {
  criticSpans,
  spanUtils,
  SPAN_CONFIG,
} from "./spans"
import type { CriticSpanAttributes } from "./spans"
import { NamedError } from "@opencode-ai/util/error"

const log = Log.create({ service: "critic.instrumented" })

export interface CriticEvaluationInput {
  taskId: string
  sessionId?: string
  targetModule: string
  prompt: string
  context: {
    code?: string
    history?: string[]
    memories?: string[]
  }
}

export interface CriticEvaluationOutput {
  decision: "PASS" | "FAIL" | "MODIFY"
  score: number
  threshold: number
  feedback: string
  risks: string[]
  suggestions?: Array<{
    type: "code" | "test" | "docs"
    description: string
    diff?: string
  }>
}

export interface CriticConfig {
  providerID: string
  modelID: string
  threshold: number
  maxRetries: number
}

const DEFAULT_CONFIG: CriticConfig = {
  providerID: "openai",
  modelID: "gpt-4",
  threshold: 7.0,
  maxRetries: 2,
}

const CRITIC_SYSTEM_PROMPT = `You are an expert code critic agent. Your role is to evaluate code changes and provide constructive feedback.

You must evaluate based on:
1. Code quality (readability, maintainability)
2. Security considerations
3. Performance implications
4. Test coverage
5. Documentation

Provide a score from 0-10 and clearly indicate PASS, FAIL, or MODIFY.`

const CRITIC_EVALUATION_PROMPT = `Please evaluate the following code change for the task:

Task: {task}
Target Module: {targetModule}

Code Context:
{context}

Your Task:
{prompt}

Provide your evaluation in the following JSON format:
{
  "decision": "PASS|FAIL|MODIFY",
  "score": <number 0-10>,
  "feedback": "<detailed feedback>",
  "risks": ["<risk1>", "<risk2>"],
  "suggestions": [
    {
      "type": "code|test|docs",
      "description": "<description>",
      "diff": "<optional diff>"
    }
  ]
}`

export class InstrumentedCritic {
  protected config: CriticConfig
  protected tracer: ReturnType<typeof trace.getTracer>

  constructor(config: Partial<CriticConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.tracer = trace.getTracer("agent.critic")
  }

  async evaluate(input: CriticEvaluationInput): Promise<CriticEvaluationOutput> {
    const span = this.tracer.startSpan("agent.critic.evaluate", {
      attributes: {
        "task.id": input.taskId,
        "target.module": input.targetModule,
        "critic.type": "code",
        "prompt.length": input.prompt.length,
        ...(input.sessionId && { "context.sessionId": input.sessionId }),
      },
    })

    try {
      const contextStr = this.buildContextString(input.context)
      const evaluationPrompt = CRITIC_EVALUATION_PROMPT.replace("{task}", input.prompt)
        .replace("{targetModule}", input.targetModule)
        .replace("{context}", contextStr)
        .replace("{prompt}", input.prompt)

      if (evaluationPrompt.length > SPAN_CONFIG.MAX_EVENT_PAYLOAD_SIZE) {
        criticSpans.addPromptInputLarge(span, evaluationPrompt)
      } else {
        criticSpans.addPromptInput(span, evaluationPrompt)
      }

      const startTime = Date.now()
      const model = await Provider.getModel(this.config.providerID, this.config.modelID)
      const languageModel = await Provider.getLanguage(model)

      const result = await generateText({
        model: languageModel,
        system: CRITIC_SYSTEM_PROMPT,
        prompt: evaluationPrompt,
      })

      const latency = Date.now() - startTime
      span.setAttribute("llm.latency.ms", latency)

      const parsed = this.parseEvaluationResult(result.text)
      const decision = this.determineDecision(parsed.score, this.config.threshold)

      criticSpans.addDecision(span, decision, parsed.score, this.config.threshold)
      criticSpans.addReasoningSteps(span, parsed.reasoningSteps || [])
      criticSpans.addEvaluationResult(span, {
        approved: decision === "PASS",
        score: parsed.score,
        feedback: parsed.feedback,
        risks: parsed.risks,
      })

      if (parsed.suggestions && parsed.suggestions.length > 0) {
        const diff = parsed.suggestions.map((s) => s.diff || s.description).join("\n")
        if (diff.length > SPAN_CONFIG.MAX_EVENT_PAYLOAD_SIZE) {
          criticSpans.addSuggestionDiffLarge(span, diff)
        } else {
          criticSpans.addSuggestionDiff(span, diff)
        }
      }

      spanUtils.addLLMContext(span, {
        provider: this.config.providerID,
        model: this.config.modelID,
        inputTokens: result.usage?.inputTokens || 0,
        outputTokens: result.usage?.outputTokens || 0,
        latency,
      })

      span.setStatus({ code: SpanStatusCode.OK })
      log.info("critic_evaluation_completed", {
        taskId: input.taskId,
        decision,
        score: parsed.score,
        threshold: this.config.threshold,
      })

      return {
        decision,
        score: parsed.score,
        threshold: this.config.threshold,
        feedback: parsed.feedback,
        risks: parsed.risks,
        suggestions: parsed.suggestions,
      }
    } catch (error) {
      const err = error as Error
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
      span.recordException(err)

      log.error("critic_evaluation_failed", {
        taskId: input.taskId,
        error: err.message,
      })

      return {
        decision: "FAIL",
        score: 0,
        threshold: this.config.threshold,
        feedback: `Evaluation failed: ${err.message}`,
        risks: ["Evaluation system error"],
      }
    } finally {
      span.end()
    }
  }

  private buildContextString(context: CriticEvaluationInput["context"]): string {
    const parts: string[] = []

    if (context.code) {
      parts.push(`Code:\n${context.code.slice(0, 2000)}`)
    }

    if (context.history && context.history.length > 0) {
      parts.push(`History:\n${context.history.slice(0, 5).join("\n")}`)
    }

    if (context.memories && context.memories.length > 0) {
      parts.push(`Relevant Memories:\n${context.memories.slice(0, 3).join("\n")}`)
    }

    return parts.join("\n\n") || "No additional context"
  }

  protected parseEvaluationResult(text: string): {
    score: number
    feedback: string
    risks: string[]
    suggestions: Array<{ type: "code" | "test" | "docs"; description: string; diff?: string }>
    reasoningSteps?: string[]
  } {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error("No JSON found in response")
      }

      const parsed = JSON.parse(jsonMatch[0])
      const validTypes = ["code", "test", "docs"] as const

      return {
        score: typeof parsed.score === "number" ? Math.min(10, Math.max(0, parsed.score)) : 5,
        feedback: parsed.feedback || "",
        risks: Array.isArray(parsed.risks) ? parsed.risks : [],
        suggestions: Array.isArray(parsed.suggestions)
          ? parsed.suggestions.map((s: { type: string; description: string; diff?: string }) => ({
              type: validTypes.includes(s.type as typeof validTypes[number])
                ? (s.type as "code" | "test" | "docs")
                : "code",
              description: s.description || "",
              diff: s.diff,
            }))
          : [],
        reasoningSteps: Array.isArray(parsed.reasoningSteps) ? parsed.reasoningSteps : undefined,
      }
    } catch (error) {
      log.warn("critic_parse_failed", { text: text.slice(0, 200) })

      return {
        score: 5,
        feedback: "Failed to parse evaluation result",
        risks: ["Parse error"],
        suggestions: [],
      }
    }
  }

  protected determineDecision(score: number, threshold: number): "PASS" | "FAIL" | "MODIFY" {
    if (score >= threshold) {
      return "PASS"
    } else if (score >= threshold * 0.5) {
      return "MODIFY"
    } else {
      return "FAIL"
    }
  }
}

export class InstrumentedMemoryCritic extends InstrumentedCritic {
  constructor(config: Partial<CriticConfig> = {}) {
    super({ ...config, threshold: config.threshold || 6.0 })
  }

  async evaluateMemory(
    input: CriticEvaluationInput & {
      memory: {
        key: string
        value: string
        context: string
      }
    },
  ): Promise<CriticEvaluationOutput> {
    const span = this.tracer.startSpan("agent.critic.evaluate", {
      attributes: {
        "task.id": input.taskId,
        "target.module": "memory",
        "critic.type": "memory",
        "memory.key": input.memory.key,
        "memory.value.length": input.memory.value.length,
        ...(input.sessionId && { "context.sessionId": input.sessionId }),
      },
    })

    try {
      const prompt = `Evaluate this memory for quality and relevance:

Memory Key: {key}
Memory Value: {value}
Context: {context}

Task: {task}

Rate from 0-10 and decide if this memory should be stored.`

      const evaluationPrompt = prompt
        .replace("{key}", input.memory.key)
        .replace("{value}", input.memory.value)
        .replace("{context}", input.memory.context)
        .replace("{task}", input.prompt)

      if (evaluationPrompt.length > SPAN_CONFIG.MAX_EVENT_PAYLOAD_SIZE) {
        criticSpans.addPromptInputLarge(span, evaluationPrompt)
      } else {
        criticSpans.addPromptInput(span, evaluationPrompt)
      }

      const startTime = Date.now()
      const model = await Provider.getModel(this.config.providerID, this.config.modelID)
      const languageModel = await Provider.getLanguage(model)

      const result = await generateText({
        model: languageModel,
        system: "You are a memory quality critic. Evaluate if memories are worth storing.",
        prompt: evaluationPrompt,
      })

      const latency = Date.now() - startTime
      span.setAttribute("llm.latency.ms", latency)

      const parsed = this.parseEvaluationResult(result.text)
      const decision = this.determineDecision(parsed.score, this.config.threshold)

      criticSpans.addDecision(span, decision, parsed.score, this.config.threshold)
      criticSpans.addEvaluationResult(span, {
        approved: decision === "PASS",
        score: parsed.score,
        feedback: parsed.feedback,
        risks: parsed.risks,
      })

      span.setStatus({ code: SpanStatusCode.OK })

      return {
        decision,
        score: parsed.score,
        threshold: this.config.threshold,
        feedback: parsed.feedback,
        risks: parsed.risks,
        suggestions: parsed.suggestions,
      }
    } catch (error) {
      const err = error as Error
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
      span.recordException(err)
      span.end()

      return {
        decision: "FAIL",
        score: 0,
        threshold: this.config.threshold,
        feedback: `Memory evaluation failed: ${err.message}`,
        risks: ["Evaluation system error"],
      }
    } finally {
      span.end()
    }
  }
}

export const critic = new InstrumentedCritic()
export const memoryCritic = new InstrumentedMemoryCritic()