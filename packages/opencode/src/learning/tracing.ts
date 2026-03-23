/**
 * OpenTelemetry tracing utilities for learning module
 * Adds distributed tracing to key learning operations
 */
import { trace, type Span, SpanStatusCode } from "@opentelemetry/api"

const TRACER_NAME = "opencode.learning"

/**
 * Get the tracer instance for learning operations
 */
export function getTracer() {
  return trace.getTracer(TRACER_NAME)
}

/**
 * Wrap an async function with a span
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  const tracer = getTracer()
  const span = tracer.startSpan(name, { attributes })

  try {
    const result = await fn(span)
    span.setStatus({ code: SpanStatusCode.OK })
    return result
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    })
    span.recordException(error instanceof Error ? error : new Error(String(error)))
    throw error
  } finally {
    span.end()
  }
}

/**
 * Create a child span from a parent span
 */
export function startChildSpan(parentSpan: Span, name: string, attributes?: Record<string, string | number | boolean>): Span {
  const tracer = getTracer()
  return tracer.startSpan(name, {
    attributes,
  })
}

/**
 * Add event to span with safe payload handling
 */
export function addSpanEvent(span: Span, name: string, payload?: unknown): void {
  if (payload !== undefined) {
    const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload)
    if (payloadStr.length <= 5000) {
      span.addEvent(name, { payload: payloadStr })
    } else {
      span.addEvent(name, { payload_length: payloadStr.length, truncated: true })
    }
  } else {
    span.addEvent(name)
  }
}

/**
 * Span attribute helpers for common patterns
 */
export const spanAttrs = {
  module: (name: string) => ({ "module.name": name }),
  file: (path: string) => ({ "file.path": path }),
  taskId: (id: string) => ({ "task.id": id }),
  sessionId: (id: string) => ({ "session.id": id }),
  operation: (op: string) => ({ "operation.type": op }),
  duration: (ms: number) => ({ "duration.ms": ms }),
  success: (val: boolean) => ({ "success": val }),
  count: (n: number) => ({ "count": n }),
}
