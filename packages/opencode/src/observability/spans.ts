import type { Span } from "@opentelemetry/api"
import { SpanStatusCode, context, trace } from "@opentelemetry/api"
import { Log } from "../util/log.js"
import * as crypto from "crypto"
import { observability, traceUtils } from "./init.js"

const log = Log.create({ service: "observability.spans" })

export const SPAN_CONFIG = {
  MAX_EVENT_PAYLOAD_SIZE: parseInt(process.env.OTEL_MAX_EVENT_PAYLOAD_SIZE || "5000", 10),
  TRUNCATE_PREFIX_LENGTH: 500,
  TRUNCATE_SUFFIX_LENGTH: 200,
  DEFAULT_HASH_ALGORITHM: "sha256",
}

export function computeContentHash(content: string, algorithm = SPAN_CONFIG.DEFAULT_HASH_ALGORITHM): string {
  return crypto.createHash(algorithm).update(content).digest("hex")
}

export function smartTruncate(
  content: string,
  maxSize = SPAN_CONFIG.MAX_EVENT_PAYLOAD_SIZE,
  prefixLength = SPAN_CONFIG.TRUNCATE_PREFIX_LENGTH,
  suffixLength = SPAN_CONFIG.TRUNCATE_SUFFIX_LENGTH,
): { truncated: string; wasTruncated: boolean; hash?: string } {
  if (content.length <= maxSize) {
    return { truncated: content, wasTruncated: false }
  }

  const hash = computeContentHash(content)
  const middleLength = maxSize - prefixLength - suffixLength - 15

  if (middleLength <= 0) {
    return {
      truncated: content.slice(0, maxSize - 15) + "... [truncated]",
      wasTruncated: true,
      hash,
    }
  }

  return {
    truncated: content.slice(0, prefixLength) + `\n... [${middleLength} chars, hash: ${hash.slice(0, 12)}] ...\n` + content.slice(-suffixLength),
    wasTruncated: true,
    hash,
  }
}

export function storeContentExternal(content: string, prefix: string): { stored: boolean; contentUrl?: string; contentFilePath?: string; hash?: string } {
  const hash = computeContentHash(content)
  const filename = `${prefix}_${hash.slice(0, 16)}.txt`
  const filePath = `/tmp/otel_content/${filename}`

  try {
    const fs = require("fs")
    const dir = "/tmp/otel_content"
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, content, "utf-8")
    log.debug("content_stored_externally", { filePath, hash: hash.slice(0, 12) })
    return { stored: true, contentFilePath: filePath, hash }
  } catch (error) {
    log.warn("failed_to_store_content_externally", { error: String(error) })
    return { stored: false, hash }
  }
}

export interface SpanOptions {
  name: string
  attributes?: Record<string, string | number | boolean>
  events?: Array<{ name: string; attributes?: Record<string, string | number | boolean> }>
  startTime?: number
}

export interface CriticSpanAttributes {
  "decision.outcome": "PASS" | "FAIL" | "MODIFY" | "PENDING"
  "score.value": number
  "score.threshold": number
  "risk.level": "low" | "medium" | "high" | "critical"
  "critic.type": string
  "target.module": string
  "prompt.length": number
  "context.sessionId"?: string
  "context.taskId"?: string
}

export interface RefactorSpanAttributes {
  "target.module": string
  "target.path": string
  "complexity.score": number
  "changes.count": number
  "changes.additions": number
  "changes.deletions": number
  "validation.passed": boolean
  "rollback.triggered": boolean
  "parent.taskId"?: string
  "trigger.source": "scheduler" | "manual" | "critic"
}

export interface SandboxSpanAttributes {
  "sandbox.id": string
  "sandbox.type": "skill" | "code" | "agent"
  "resource.cpu.limit": number
  "resource.memory.limit": number
  "resource.timeout.ms": number
  "security.policy": string
  "security.intercepted": boolean
  "execution.status": "success" | "failure" | "timeout" | "intercepted"
  "code.hash": string
  "exit.code": number
}

export interface MemorySpanAttributes {
  "operation.type": "WRITE" | "READ" | "SEARCH" | "DELETE"
  "vector.space": string
  "results.count": number
  "query.embedding.hash": string
  "retrieved.ids": string
  "memory.type": "session" | "evolution" | "project"
  "latency.ms": number
}

export interface EvolutionSpanAttributes {
  "evolution.phase": "collect" | "analyze" | "plan" | "execute" | "validate"
  "evolution.taskId": string
  "evolution.parentTaskId"?: string
  "evolution.skillId"?: string
  "iteration.count": number
  "confidence.score": number
}

const SENSITIVE_KEYS = [
  "api_key",
  "secret",
  "password",
  "token",
  "authorization",
  "credential",
  "private_key",
  "access_token",
  "refresh_token",
]

function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase()
  return SENSITIVE_KEYS.some((sensitive) => lowerKey.includes(sensitive))
}

function sanitizeValue(value: unknown): string {
  if (typeof value === "string") {
    if (value.length > 1000) {
      return value.slice(0, 1000) + "...[truncated]"
    }
    return value
  }
  return String(value)
}

function sanitizeAttributes(attributes: Record<string, unknown>): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (isSensitiveKey(key)) {
      sanitized[key] = "[REDACTED]"
    } else {
      sanitized[key] = sanitizeValue(value) as string | number | boolean
    }
  }
  return sanitized
}

export const criticSpans = {
  startEvaluateSpan(
    span: Span,
    options: {
      criticType: string
      targetModule: string
      sessionId?: string
      taskId?: string
      promptLength: number
    },
  ): void {
    span.updateName("agent.critic.evaluate")
    span.setAttribute("critic.type", options.criticType)
    span.setAttribute("target.module", options.targetModule)
    span.setAttribute("prompt.length", options.promptLength)
    if (options.sessionId) span.setAttribute("context.sessionId", options.sessionId)
    if (options.taskId) span.setAttribute("context.taskId", options.taskId)
  },

  addDecision(span: Span, decision: "PASS" | "FAIL" | "MODIFY", score: number, threshold: number): void {
    span.setAttribute("decision.outcome", decision)
    span.setAttribute("score.value", score)
    span.setAttribute("score.threshold", threshold)
    span.setAttribute("risk.level", score >= threshold * 0.8 ? "low" : score >= threshold * 0.5 ? "medium" : "high")
  },

  addPromptInput(span: Span, prompt: string): void {
    const truncated = smartTruncate(prompt, SPAN_CONFIG.MAX_EVENT_PAYLOAD_SIZE)
    const attributes: Record<string, string | number | boolean> = {
      "prompt.length": prompt.length,
      "prompt.truncated": truncated.wasTruncated,
    }
    if (truncated.hash) {
      attributes["prompt.hash"] = truncated.hash
    }
    span.addEvent("prompt.input", {
      ...attributes,
      "prompt.preview": truncated.truncated.slice(0, 1000),
    })
  },

  addReasoningSteps(span: Span, steps: string[]): void {
    const summary = steps.join(" → ")
    const truncated = smartTruncate(summary, Math.min(2000, SPAN_CONFIG.MAX_EVENT_PAYLOAD_SIZE))
    span.addEvent("reasoning.steps", {
      "steps.count": steps.length,
      "steps.summary": truncated.truncated.slice(0, 500),
      "steps.truncated": truncated.wasTruncated,
    })
  },

  addSuggestionDiff(span: Span, diff: string): void {
    const truncated = smartTruncate(diff, SPAN_CONFIG.MAX_EVENT_PAYLOAD_SIZE)
    const attributes: Record<string, string | number | boolean> = {
      "diff.length": diff.length,
      "diff.truncated": truncated.wasTruncated,
    }
    if (truncated.hash) {
      attributes["diff.hash"] = truncated.hash
    }
    span.addEvent("suggestion.diff", {
      ...attributes,
      "diff.preview": truncated.truncated.slice(0, 1000),
    })
  },

  addPromptInputLarge(span: Span, prompt: string): void {
    const stored = storeContentExternal(prompt, "critic_prompt")
    const truncated = smartTruncate(prompt, SPAN_CONFIG.MAX_EVENT_PAYLOAD_SIZE)
    const attributes: Record<string, string | number | boolean> = {
      "prompt.length": prompt.length,
      "prompt.stored_externally": stored.stored,
    }
    if (stored.contentFilePath) {
      attributes["prompt.content_file_path"] = stored.contentFilePath
    }
    if (stored.hash) {
      attributes["prompt.hash"] = stored.hash
    }
    span.addEvent("prompt.input", {
      ...attributes,
      "prompt.preview": truncated.truncated.slice(0, 500),
    })
  },

  addSuggestionDiffLarge(span: Span, diff: string): void {
    const stored = storeContentExternal(diff, "critic_diff")
    const truncated = smartTruncate(diff, SPAN_CONFIG.MAX_EVENT_PAYLOAD_SIZE)
    const attributes: Record<string, string | number | boolean> = {
      "diff.length": diff.length,
      "diff.stored_externally": stored.stored,
    }
    if (stored.contentFilePath) {
      attributes["diff.content_file_path"] = stored.contentFilePath
    }
    if (stored.hash) {
      attributes["diff.hash"] = stored.hash
    }
    span.addEvent("suggestion.diff", {
      ...attributes,
      "diff.preview": truncated.truncated.slice(0, 500),
    })
  },

  addEvaluationResult(
    span: Span,
    result: {
      approved: boolean
      score: number
      feedback: string
      risks: string[]
    },
  ): void {
    span.setAttribute("evaluation.approved", result.approved)
    span.setAttribute("evaluation.feedback.length", result.feedback.length)
    span.setAttribute("evaluation.risks.count", result.risks.length)
    if (result.risks.length > 0) {
      span.addEvent("evaluation.risks", { "risks.list": result.risks.join("; ") })
    }
  },
}

export const refactorSpans = {
  startRefactorSpan(
    span: Span,
    options: {
      targetModule: string
      targetPath: string
      complexity: number
      parentTaskId?: string
      triggerSource: "scheduler" | "manual" | "critic"
    },
  ): void {
    span.updateName("agent.evolution.refactor")
    span.setAttribute("target.module", options.targetModule)
    span.setAttribute("target.path", options.targetPath)
    span.setAttribute("complexity.score", options.complexity)
    if (options.parentTaskId) span.setAttribute("parent.taskId", options.parentTaskId)
    span.setAttribute("trigger.source", options.triggerSource)
  },

  addCodeSnapshot(span: Span, phase: "before" | "after", snapshotId: string): void {
    span.addEvent(`code.${phase}`, {
      "snapshot.id": snapshotId,
      "phase": phase,
    })
  },

  addChanges(span: Span, changes: { count: number; additions: number; deletions: number }): void {
    span.setAttribute("changes.count", changes.count)
    span.setAttribute("changes.additions", changes.additions)
    span.setAttribute("changes.deletions", changes.deletions)
  },

  addDiffSummary(span: Span, summary: string): void {
    span.addEvent("diff.summary", {
      "diff.summary": summary.slice(0, 1000),
    })
  },

  addValidationResult(span: Span, passed: boolean, details?: string): void {
    span.setAttribute("validation.passed", passed)
    if (details) {
      span.addEvent("validation.details", { "validation.details": details.slice(0, 500) })
    }
  },

  addRollback(span: Span, triggered: boolean, reason?: string): void {
    span.setAttribute("rollback.triggered", triggered)
    if (triggered && reason) {
      span.addEvent("rollback.reason", { "rollback.reason": reason.slice(0, 500) })
    }
  },
}

export const sandboxSpans = {
  startExecuteSpan(
    span: Span,
    options: {
      sandboxId: string
      sandboxType: "skill" | "code" | "agent"
      resourceLimits: {
        cpu: number
        memory: number
        timeout: number
      }
      securityPolicy: string
      codeHash: string
    },
  ): void {
    span.updateName("agent.sandbox.execute")
    span.setAttribute("sandbox.id", options.sandboxId)
    span.setAttribute("sandbox.type", options.sandboxType)
    span.setAttribute("resource.cpu.limit", options.resourceLimits.cpu)
    span.setAttribute("resource.memory.limit", options.resourceLimits.memory)
    span.setAttribute("resource.timeout.ms", options.resourceLimits.timeout)
    span.setAttribute("security.policy", options.securityPolicy)
    span.setAttribute("code.hash", options.codeHash)
  },

  addCodeExecution(span: Span, code: string): void {
    const truncated = smartTruncate(code, SPAN_CONFIG.MAX_EVENT_PAYLOAD_SIZE)
    const attributes: Record<string, string | number | boolean> = {
      "code.length": code.length,
      "code.truncated": truncated.wasTruncated,
    }
    if (truncated.hash) {
      attributes["code.hash"] = truncated.hash
    }
    span.addEvent("code.executed", {
      ...attributes,
      "code.preview": truncated.truncated.slice(0, 1000),
    })
  },

  addCodeExecutionLarge(span: Span, code: string): void {
    const stored = storeContentExternal(code, "sandbox_code")
    const truncated = smartTruncate(code, SPAN_CONFIG.MAX_EVENT_PAYLOAD_SIZE)
    const attributes: Record<string, string | number | boolean> = {
      "code.length": code.length,
      "code.stored_externally": stored.stored,
    }
    if (stored.contentFilePath) {
      attributes["code.content_file_path"] = stored.contentFilePath
    }
    if (stored.hash) {
      attributes["code.hash"] = stored.hash
    }
    span.addEvent("code.executed", {
      ...attributes,
      "code.preview": truncated.truncated.slice(0, 500),
    })
  },

  addStdout(span: Span, stdout: string): void {
    span.addEvent("stdout.stream", {
      "stdout.length": stdout.length,
      "stdout.preview": stdout.slice(0, 500),
    })
  },

  addStderr(span: Span, stderr: string): void {
    span.addEvent("stderr.stream", {
      "stderr.length": stderr.length,
      "stderr.preview": stderr.slice(0, 500),
    })
  },

  addSecurityInterception(span: Span, intercepted: boolean, reason?: string): void {
    span.setAttribute("security.intercepted", intercepted)
    if (intercepted && reason) {
      span.addEvent("security.interception", { "security.reason": reason.slice(0, 500) })
    }
  },

  addExitCode(span: Span, exitCode: number): void {
    span.setAttribute("exit.code", exitCode)
    span.setAttribute("execution.status", exitCode === 0 ? "success" : "failure")
  },

  addExecutionMetrics(span: Span, metrics: {
    cpuUsage: number
    memoryUsage: number
    duration: number
  }): void {
    span.setAttribute("metrics.cpu.usage", metrics.cpuUsage)
    span.setAttribute("metrics.memory.usage", metrics.memoryUsage)
    span.setAttribute("metrics.duration.ms", metrics.duration)
  },
}

export const memorySpans = {
  startMemoryOperationSpan(
    span: Span,
    options: {
      operationType: "WRITE" | "READ" | "SEARCH" | "DELETE"
      memoryType: "session" | "evolution" | "project"
      vectorSpace: string
      sessionId?: string
      taskId?: string
    },
  ): void {
    span.updateName("agent.memory.operation")
    span.setAttribute("operation.type", options.operationType)
    span.setAttribute("memory.type", options.memoryType)
    span.setAttribute("vector.space", options.vectorSpace)
    if (options.sessionId) span.setAttribute("context.sessionId", options.sessionId)
    if (options.taskId) span.setAttribute("context.taskId", options.taskId)
  },

  addQueryEmbedding(span: Span, embeddingHash: string): void {
    span.setAttribute("query.embedding.hash", embeddingHash)
  },

  addResults(span: Span, resultIds: string[], count: number): void {
    span.setAttribute("results.count", count)
    span.setAttribute("retrieved.ids", resultIds.slice(0, 100).join(","))
    if (resultIds.length > 100) {
      span.addEvent("results.truncated", { "results.truncated": true, "results.total": resultIds.length })
    }
  },

  addWrittenContent(span: Span, contentHash: string): void {
    span.addEvent("written.content", { "content.hash": contentHash })
  },

  addSearchLatency(span: Span, latencyMs: number): void {
    span.setAttribute("latency.ms", latencyMs)
  },
}

export const evolutionSpans = {
  startEvolutionSpan(
    span: Span,
    options: {
      taskId: string
      parentTaskId?: string
      phase: "collect" | "analyze" | "plan" | "execute" | "validate"
    },
  ): void {
    span.updateName("agent.evolution")
    span.setAttribute("evolution.taskId", options.taskId)
    span.setAttribute("evolution.phase", options.phase)
    if (options.parentTaskId) span.setAttribute("evolution.parentTaskId", options.parentTaskId)
  },

  addIteration(span: Span, iteration: number): void {
    span.setAttribute("iteration.count", iteration)
  },

  addConfidence(span: Span, confidence: number): void {
    span.setAttribute("confidence.score", confidence)
  },

  addSkillId(span: Span, skillId: string): void {
    span.setAttribute("evolution.skillId", skillId)
  },

  addPhaseChange(span: Span, fromPhase: string, toPhase: string): void {
    span.addEvent("phase.change", { "phase.from": fromPhase, "phase.to": toPhase })
  },
}

export const spanUtils = {
  createSpan<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    return traceUtils.runWithSpan(name, async (span: Span) => {
      for (const [key, value] of Object.entries(attributes)) {
        span.setAttribute(key, value)
      }
      return fn(span)
    })
  },

  createChildSpan(name: string, parentSpan?: Span): Span {
    const tracer = observability.getTracer()
    const activeSpan = trace.getSpan(context.active())
    const parent = parentSpan || activeSpan
    return tracer.startSpan(name, undefined, parent ? trace.setSpan(context.active(), parent) : undefined)
  },

  recordException(span: Span, error: Error): void {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
    span.recordException(error)
    log.error("span_exception", { error: error.message, stack: error.stack })
  },

  addUserContext(span: Span, userId: string, sessionId: string): void {
    span.setAttribute("user.id", userId)
    span.setAttribute("context.sessionId", sessionId)
  },

  addLLMContext(
    span: Span,
    llm: {
      provider: string
      model: string
      inputTokens: number
      outputTokens: number
      latency: number
    },
  ): void {
    span.setAttribute("llm.provider", llm.provider)
    span.setAttribute("llm.model", llm.model)
    span.setAttribute("llm.input_tokens", llm.inputTokens)
    span.setAttribute("llm.output_tokens", llm.outputTokens)
    span.setAttribute("llm.latency.ms", llm.latency)
    span.setAttribute("llm.total_tokens", llm.inputTokens + llm.outputTokens)
  },

  addEvent(
    span: Span,
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    const sanitized = attributes ? sanitizeAttributes(attributes) : undefined
    span.addEvent(name, sanitized)
  },
}
