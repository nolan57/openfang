import { NodeSDK } from "@opentelemetry/sdk-node"
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler, AlwaysOnSampler, AlwaysOffSampler } from "@opentelemetry/sdk-trace-base"
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http"
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express"
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node"
import { BunyanInstrumentation } from "@opentelemetry/instrumentation-bunyan"
import {
  CompositePropagator,
  W3CTraceContextPropagator,
  W3CBaggagePropagator,
} from "@opentelemetry/core"
import { trace, context, type Span, SpanStatusCode, diag, DiagLogLevel, propagation } from "@opentelemetry/api"
import { Resource } from "@opentelemetry/resources"
import * as os from "os"
import { Log } from "../util/log.js"

// Semantic convention constants
const ATTR_SERVICE_NAME = "service.name"
const ATTR_SERVICE_VERSION = "service.version"

const log = Log.create({ service: "observability" })

export interface ObservabilityConfig {
  serviceName: string
  serviceVersion: string
  enabled: boolean
  exporterEndpoint: string
  sampleRate: number
  environment: "development" | "production"
  maxEventPayloadSize: number
}

const DEFAULT_CONFIG: ObservabilityConfig = {
  serviceName: "opencode-agent",
  serviceVersion: "1.0.0",
  enabled: process.env.OTEL_ENABLED !== "false",
  exporterEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318/v1/traces",
  sampleRate: parseFloat(process.env.OTEL_SAMPLE_RATE || (process.env.NODE_ENV === "production" ? "0.01" : "1.0")),
  environment: (process.env.NODE_ENV as "development" | "production") || "development",
  maxEventPayloadSize: parseInt(process.env.OTEL_MAX_EVENT_PAYLOAD_SIZE || "5000", 10),
}

class ObservabilitySDK {
  private sdk: NodeSDK | null = null
  private config: ObservabilityConfig
  private initialized = false

  constructor(config: Partial<ObservabilityConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  start(): void {
    if (!this.config.enabled) {
      log.info("observability_disabled")
      return
    }

    if (this.initialized) {
      log.warn("observability_already_initialized")
      return
    }

    // Configure diagnostic logging only if debug is needed
    if (process.env.OTEL_DEBUG === "true") {
      diag.setLogger({
        verbose: (message: string) => log.debug(message),
        debug: (message: string) => log.debug(message),
        info: (message: string) => log.info(message),
        warn: (message: string) => log.warn(message),
        error: (message: string) => log.error(message),
      }, DiagLogLevel.DEBUG)
    }

    const exporter = new OTLPTraceExporter({
      url: this.config.exporterEndpoint,
      headers: {
        "Content-Type": "application/json",
      },
    })

    const spanProcessor = new BatchSpanProcessor(exporter, {
      maxQueueSize: 2048,
      maxExportBatchSize: 512,
      exportTimeoutMillis: 30000,
      scheduledDelayMillis: 5000,
    })

    const instrumentations = [
      new RuntimeNodeInstrumentation(),
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new BunyanInstrumentation(),
      ...getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-net": { enabled: false },
      }),
    ]

    this.sdk = new NodeSDK({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: this.config.serviceName,
        [ATTR_SERVICE_VERSION]: this.config.serviceVersion,
        "host.name": os.hostname(),
        "process.pid": process.pid,
        "process.command": process.argv.join(" "),
        "environment": this.config.environment,
      }),
      spanProcessor,
      instrumentations,
      textMapPropagator: new CompositePropagator({
        propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
      }),
      sampler: this.createSampler(),
    })

    this.sdk.start()
    this.initialized = true

    log.info("observability_started", {
      serviceName: this.config.serviceName,
      environment: this.config.environment,
      sampleRate: this.config.sampleRate,
      exporterEndpoint: this.config.exporterEndpoint,
    })

    process.on("SIGTERM", () => {
      this.shutdown()
    })
  }

  private createSampler() {
    if (this.config.environment === "development") {
      return new AlwaysOnSampler()
    }

    if (this.config.sampleRate >= 1.0) {
      return new AlwaysOnSampler()
    }

    if (this.config.sampleRate <= 0) {
      return new AlwaysOffSampler()
    }

    return new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(this.config.sampleRate),
      remoteParentSampled: new AlwaysOnSampler(),
      remoteParentNotSampled: new AlwaysOffSampler(),
      localParentSampled: new AlwaysOnSampler(),
      localParentNotSampled: new AlwaysOffSampler(),
    })
  }

  async shutdown(): Promise<void> {
    if (this.sdk) {
      await this.sdk.shutdown()
      this.initialized = false
      log.info("observability_shutdown")
    }
  }

  getTracer(name?: string): import("@opentelemetry/api").Tracer {
    return trace.getTracer(name || this.config.serviceName, this.config.serviceVersion)
  }

  isInitialized(): boolean {
    return this.initialized
  }

  getConfig(): ObservabilityConfig {
    return { ...this.config }
  }

  getMaxEventPayloadSize(): number {
    return this.config.maxEventPayloadSize
  }
}

export const observability = new ObservabilitySDK()

export function initObservability(config?: Partial<ObservabilityConfig>): void {
  observability.start()
}

export { ObservabilitySDK }

export const traceUtils = {
  getSpan(spanName: string): Span | undefined {
    const tracer = observability.getTracer()
    return tracer.startActiveSpan(spanName, (span) => span)
  },

  addSpanAttribute(key: string, value: string | number | boolean): void {
    const span = trace.getSpan(context.active())
    if (span) {
      span.setAttribute(key, value)
    }
  },

  addSpanEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
    const span = trace.getSpan(context.active())
    if (span) {
      span.addEvent(name, attributes)
    }
  },

  setSpanStatus(code: SpanStatusCode, message?: string): void {
    const span = trace.getSpan(context.active())
    if (span) {
      span.setStatus({ code, message })
    }
  },

  endSpan(error?: Error): void {
    const span = trace.getSpan(context.active())
    if (span) {
      if (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
        span.recordException(error)
      }
      span.end()
    }
  },

  runWithSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
    const tracer = observability.getTracer()
    return tracer.startActiveSpan(name, async (span) => {
      try {
        const result = await fn(span)
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
        span.recordException(error as Error)
        throw error
      } finally {
        span.end()
      }
    })
  },

  createChildSpan(name: string, parentSpan?: Span): Span {
    const tracer = observability.getTracer()
    const parent = parentSpan || trace.getSpan(context.active())
    const ctx = parent ? trace.setSpan(context.active(), parent) : context.active()
    return tracer.startSpan(name, undefined, ctx)
  },

  setBaggage(key: string, value: string): void {
    const currentBaggage = propagation.getBaggage(context.active()) || propagation.createBaggage()
    const newBaggage = currentBaggage.setEntry(key, { value })
    const propagator = new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    })
    propagation.setGlobalPropagator(propagator)
    context.with(propagation.setBaggage(context.active(), newBaggage), () => {})
  },

  getBaggage(key: string): string | undefined {
    const baggage = propagation.getBaggage(context.active())
    return baggage?.getEntry(key)?.value
  },

  extractContext(carrier: Record<string, string>): ReturnType<typeof context.active> {
    const propagator = new W3CTraceContextPropagator()
    return propagation.extract(context.active(), carrier)
  },

  injectContext(): Record<string, string> {
    const carrier: Record<string, string> = {}
    const propagator = new W3CTraceContextPropagator()
    propagation.inject(context.active(), carrier)
    return carrier
  },

  runWithContext<T>(fn: () => Promise<T>): Promise<T> {
    const activeContext = context.active()
    const carrier = this.injectContext()

    return new Promise((resolve, reject) => {
      const extractedCtx = this.extractContext(carrier)

      const wrapped = () => context.with(extractedCtx, fn)

      setImmediate(() => {
        wrapped().then(resolve).catch(reject)
      })
    })
  },

  runWithTimeoutContext<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    const activeContext = context.active()
    const carrier = this.injectContext()
    const traceId = trace.getSpan(activeContext)?.spanContext().traceId
    const spanId = trace.getSpan(activeContext)?.spanContext().spanId

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      const extractedCtx = this.extractContext(carrier)

      context.with(extractedCtx, async () => {
        try {
          const result = await fn()
          clearTimeout(timer)
          resolve(result)
        } catch (error) {
          clearTimeout(timer)
          reject(error)
        }
      })
    })
  },

  bindCallback<T extends (...args: unknown[]) => void>(fn: T): T {
    const activeCtx = context.active()
    const carrier = this.injectContext()

    return ((...args: unknown[]) => {
      const extractedCtx = this.extractContext(carrier)
      context.with(extractedCtx, () => fn(...args))
    }) as T
  },

  bindPromise<T>(promise: Promise<T>): Promise<T> {
    const activeCtx = context.active()
    const carrier = this.injectContext()

    return promise.then((value) => {
      const extractedCtx = this.extractContext(carrier)
      return context.with(extractedCtx, () => Promise.resolve(value))
    }) as Promise<T>
  },

  startBackgroundTask<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
    const tracer = observability.getTracer()
    const parentSpan = trace.getSpan(context.active())

    return tracer.startActiveSpan(name, async (span) => {
      try {
        if (parentSpan) {
          span.setAttribute("background.task.parent_span_id", parentSpan.spanContext().spanId)
          span.setAttribute("background.task.trace_id", parentSpan.spanContext().traceId)
        }
        span.setAttribute("background.task", true)
        const result = await fn(span)
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
        span.recordException(error as Error)
        throw error
      } finally {
        span.end()
      }
    })
  },

  getCurrentTraceId(): string | undefined {
    return trace.getSpan(context.active())?.spanContext().traceId
  },

  getCurrentSpanId(): string | undefined {
    return trace.getSpan(context.active())?.spanContext().spanId
  },
}
