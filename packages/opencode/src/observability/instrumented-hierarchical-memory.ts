import { type Span, SpanStatusCode, trace, context } from "@opentelemetry/api"
import { Log } from "../util/log"
import {
  memorySpans,
  spanUtils,
} from "./spans"
import { getSharedVectorStore, type IVectorStore } from "../learning/vector-store"

const log = Log.create({ service: "hierarchical-memory.instrumented" })

const LINEAGE_TRACKING_KEY = "memory.lineage.enabled"

export interface HierarchicalMemoryInput {
  operationType: "WRITE" | "READ" | "SEARCH" | "DELETE"
  memoryType: "session" | "evolution" | "project"
  vectorSpace: string
  sessionId?: string
  taskId?: string
}

export interface WriteInput extends HierarchicalMemoryInput {
  operationType: "WRITE"
  key: string
  value: string
  context?: string
}

export interface ReadInput extends HierarchicalMemoryInput {
  operationType: "READ"
  memoryId: string
}

export interface SearchInput extends HierarchicalMemoryInput {
  operationType: "SEARCH"
  query: string
  limit?: number
  filters?: {
    memoryType?: string[]
    dateRange?: { start: number; end: number }
  }
}

export interface HierarchicalMemoryOutput {
  success: boolean
  results?: Array<{
    id: string
    key: string
    value: string
    similarity: number
    lineage?: {
      sourceSpanId?: string
      sourceTraceId?: string
    }
  }>
  memory?: {
    id: string
    key: string
    value: string
    lineage?: {
      sourceSpanId?: string
      sourceTraceId?: string
    }
  }
  lineage?: {
    sourceSpanId?: string
    sourceTraceId?: string
  }
  latencyMs?: number
  error?: string
}

export class InstrumentedHierarchicalMemory {
  private tracer: ReturnType<typeof trace.getTracer>
  private vectorStore: IVectorStore | null = null

  constructor() {
    this.tracer = trace.getTracer("agent.memory.operation")
  }

  private async getVectorStore(): Promise<IVectorStore> {
    if (!this.vectorStore) {
      this.vectorStore = await getSharedVectorStore()
    }
    return this.vectorStore
  }

  async write(input: WriteInput): Promise<HierarchicalMemoryOutput> {
    const activeSpan = trace.getSpan(context.active())
    const sourceSpanId = activeSpan?.spanContext().spanId
    const sourceTraceId = activeSpan?.spanContext().traceId

    const span = this.tracer.startSpan("agent.memory.operation", {
      attributes: {
        "operation.type": input.operationType,
        "memory.type": input.memoryType,
        "vector.space": input.vectorSpace,
        "key.length": input.key.length,
        "value.length": input.value.length,
        ...(input.sessionId && { "context.sessionId": input.sessionId }),
        ...(input.taskId && { "context.taskId": input.taskId }),
        ...(sourceSpanId && { "memory.source_span_id": sourceSpanId }),
        ...(sourceTraceId && { "memory.source_trace_id": sourceTraceId }),
      },
    })

    const startTime = Date.now()

    try {
      const vs = await this.getVectorStore()

      const contentHash = this.simpleHash(`${input.key}:${input.value}`)
      memorySpans.addWrittenContent(span, contentHash)

      await vs.store({
        node_type: input.memoryType,
        node_id: `memory_${Date.now()}`,
        entity_title: `${input.key}: ${input.value}`,
        vector_type: input.vectorSpace as import("../learning/vector-store-interface").VectorType,
        metadata: {
          key: input.key,
          value: input.value,
          context: input.context,
        },
      })

      const latencyMs = Date.now() - startTime
      memorySpans.addSearchLatency(span, latencyMs)

      span.setAttribute("latency.ms", latencyMs)
      span.setStatus({ code: SpanStatusCode.OK })

      log.info("memory_write_completed", {
        key: input.key,
        memoryType: input.memoryType,
        latencyMs,
      })

      return {
        success: true,
        latencyMs,
        memory: {
          id: contentHash,
          key: input.key,
          value: input.value,
        },
        lineage: {
          sourceSpanId,
          sourceTraceId,
        },
      }
    } catch (error) {
      const err = error as Error
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
      span.recordException(err)

      log.error("memory_write_failed", { error: err.message })

      return {
        success: false,
        error: err.message,
        latencyMs: Date.now() - startTime,
      }
    } finally {
      span.end()
    }
  }

  async read(input: ReadInput): Promise<HierarchicalMemoryOutput> {
    const span = this.tracer.startSpan("agent.memory.operation", {
      attributes: {
        "operation.type": input.operationType,
        "memory.type": input.memoryType,
        "vector.space": input.vectorSpace,
        "memory.id": input.memoryId,
        ...(input.sessionId && { "context.sessionId": input.sessionId }),
        ...(input.taskId && { "context.taskId": input.taskId }),
      },
    })

    const startTime = Date.now()

    try {
      const vs = await this.getVectorStore()

      // Use search with the memoryId as query since searchByNodeId doesn't exist
      const results = await vs.search(input.memoryId, {
        limit: 1,
        node_type: input.memoryType,
      })

      const sourceSpanIds = results
        .map((r) => (r.metadata as Record<string, unknown>)?.source_span_id as string | undefined)
        .filter(Boolean)
      if (sourceSpanIds.length > 0) {
        span.setAttribute("memory.retrieved_source_span_ids", sourceSpanIds.join(","))
      }

      const latencyMs = Date.now() - startTime
      memorySpans.addSearchLatency(span, latencyMs)
      memorySpans.addResults(span, results.map((r) => r.node_id), results.length)

      span.setAttribute("latency.ms", latencyMs)
      span.setStatus({ code: SpanStatusCode.OK })

      return {
        success: true,
        results: results.map((r) => ({
          id: r.node_id,
          key: (r.metadata as Record<string, unknown>)?.key as string || "",
          value: (r.metadata as Record<string, unknown>)?.value as string || "",
          similarity: r.similarity || 0,
          lineage: {
            sourceSpanId: (r.metadata as Record<string, unknown>)?.source_span_id as string | undefined,
            sourceTraceId: (r.metadata as Record<string, unknown>)?.source_trace_id as string | undefined,
          },
        })),
        latencyMs,
      }
    } catch (error) {
      const err = error as Error
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
      span.recordException(err)

      return {
        success: false,
        error: err.message,
        latencyMs: Date.now() - startTime,
      }
    } finally {
      span.end()
    }
  }

  async search(input: SearchInput): Promise<HierarchicalMemoryOutput> {
    const span = this.tracer.startSpan("agent.memory.operation", {
      attributes: {
        "operation.type": input.operationType,
        "memory.type": input.memoryType,
        "vector.space": input.vectorSpace,
        "query.length": input.query.length,
        "limit": input.limit || 10,
        ...(input.sessionId && { "context.sessionId": input.sessionId }),
        ...(input.taskId && { "context.taskId": input.taskId }),
      },
    })

    const startTime = Date.now()

    try {
      const vs = await this.getVectorStore()

      const embeddingHash = this.simpleHash(input.query)
      memorySpans.addQueryEmbedding(span, embeddingHash)

      const results = await vs.search(input.query, {
        limit: input.limit || 10,
        node_type: input.memoryType,
      })

      const latencyMs = Date.now() - startTime
      memorySpans.addSearchLatency(span, latencyMs)
      memorySpans.addResults(span, results.map((r) => r.node_id), results.length)

      const sourceSpanIds = results
        .map((r) => (r.metadata as Record<string, unknown>)?.source_span_id as string | undefined)
        .filter(Boolean)
      if (sourceSpanIds.length > 0) {
        span.setAttribute("memory.retrieved_source_span_ids", sourceSpanIds.join(","))
      }

      span.setAttribute("latency.ms", latencyMs)
      span.setAttribute("results.count", results.length)

      if (input.filters?.memoryType) {
        span.setAttribute("filters.memoryTypes", input.filters.memoryType.join(","))
      }

      span.setStatus({ code: SpanStatusCode.OK })

      log.info("memory_search_completed", {
        queryLength: input.query.length,
        resultsCount: results.length,
        latencyMs,
      })

      return {
        success: true,
        results: results.map((r) => ({
          id: r.node_id,
          key: (r.metadata as Record<string, unknown>)?.key as string || "",
          value: (r.metadata as Record<string, unknown>)?.value as string || "",
          similarity: r.similarity || 0,
          lineage: {
            sourceSpanId: (r.metadata as Record<string, unknown>)?.source_span_id as string | undefined,
            sourceTraceId: (r.metadata as Record<string, unknown>)?.source_trace_id as string | undefined,
          },
        })),
        latencyMs,
      }
    } catch (error) {
      const err = error as Error
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
      span.recordException(err)

      log.error("memory_search_failed", { error: err.message })

      return {
        success: false,
        error: err.message,
        latencyMs: Date.now() - startTime,
      }
    } finally {
      span.end()
    }
  }

  async generateModuleSummary(modulePath: string, codeContent: string): Promise<string> {
    const span = this.tracer.startSpan("agent.memory.module_summary", {
      attributes: {
        "operation.type": "GENERATE_SUMMARY",
        "module.path": modulePath,
        "code.length": codeContent.length,
      },
    })

    const startTime = Date.now()

    try {
      const { generateText } = await import("ai")
      const { Provider } = await import("../provider/provider")

      const model = await Provider.getModel("openai", "gpt-4")
      const languageModel = await Provider.getLanguage(model)

      const prompt = `Generate a concise summary of this code module (2-3 sentences):

${codeContent.slice(0, 3000)}`

      const result = await generateText({
        model: languageModel,
        system: "You are a code summarization assistant.",
        prompt,
      })

      const latencyMs = Date.now() - startTime
      span.setAttribute("latency.ms", latencyMs)
      spanUtils.addLLMContext(span, {
        provider: "openai",
        model: "gpt-4",
        inputTokens: result.usage?.inputTokens || 0,
        outputTokens: result.usage?.outputTokens || 0,
        latency: latencyMs,
      })

      span.setStatus({ code: SpanStatusCode.OK })

      return result.text.trim()
    } catch (error) {
      const err = error as Error
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
      span.recordException(err)

      return "Summary generation failed"
    } finally {
      span.end()
    }
  }

  private simpleHash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(36)
  }
}

export const hierarchicalMemory = new InstrumentedHierarchicalMemory()
