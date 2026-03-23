import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { Log } from "@/util/log"
import { fetchJaegerTraces, fetchJaegerTrace, fetchJaegerServices } from "./traces/jaeger"
import { transformTrace, transformTraces, calculateAggregatedStats } from "./traces/transform"
import type { TransformedTrace, AggregatedStats } from "./traces/types"

const log = Log.create({ service: "server.routes.traces" })

const TracesQuerySchema = z.object({
  service: z.string().optional(),
  operation: z.string().optional(),
  start: z.coerce.number().optional(),
  end: z.coerce.number().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(["ok", "error", "all"]).optional(),
})

const TraceParamsSchema = z.object({
  traceId: z.string(),
})

const StatsQuerySchema = z.object({
  service: z.string(),
  start: z.coerce.number().optional(),
  end: z.coerce.number().optional(),
})

const StreamQuerySchema = z.object({
  service: z.string().default("opencode-agent"),
  interval: z.coerce.number().min(1000).max(30000).default(2000),
})

export const TracesRoutes = lazy(() => {
  const app = new Hono()

  // List traces - GET /
  app.get(
    "/",
    describeRoute({
      summary: "List traces",
      description: "Get a list of traces with pagination and filters",
      operationId: "traces.list",
      responses: {
        200: {
          description: "List of traces",
          content: {
            "application/json": {
              schema: resolver(z.array(z.any())),
            },
          },
        },
      },
    }),
    validator("query", TracesQuerySchema),
    async (c) => {
      const query = c.req.valid("query")

      const traces = await fetchJaegerTraces({
        service: query.service,
        start: query.start,
        end: query.end,
        limit: query.limit,
        operation: query.operation,
      })

      const transformed = transformTraces(traces)

      let filtered = transformed
      if (query.status && query.status !== "all") {
        filtered = transformed.filter((t) => (query.status === "error" ? t.status === "error" : t.status === "ok"))
      }

      return c.json(filtered)
    },
  )

  // List services - GET /services (must come before /:traceId)
  app.get(
    "/services",
    describeRoute({
      summary: "List services",
      description: "Get list of services with traces",
      operationId: "traces.services",
      responses: {
        200: {
          description: "List of services",
          content: {
            "application/json": {
              schema: resolver(z.array(z.string())),
            },
          },
        },
      },
    }),
    async (c) => {
      const services = await fetchJaegerServices()
      return c.json(services)
    },
  )

  // Get statistics - GET /stats (must come before /:traceId)
  app.get(
    "/stats",
    describeRoute({
      summary: "Get trace statistics",
      description: "Get aggregated statistics for traces",
      operationId: "traces.stats",
      responses: {
        200: {
          description: "Aggregated statistics",
          content: {
            "application/json": {
              schema: resolver(z.any()),
            },
          },
        },
      },
    }),
    validator("query", StatsQuerySchema),
    async (c) => {
      const query = c.req.valid("query")

      // Jaeger uses microseconds, Date.now() returns milliseconds
      // Calculate in milliseconds first to avoid JavaScript number precision issues
      const nowMillis = Date.now()
      const startMillis = query.start || nowMillis - 86400000 // 24 hours in millis
      const endMillis = query.end || nowMillis

      const traces = await fetchJaegerTraces({
        service: query.service,
        start: Math.floor(startMillis * 1000), // Convert to microseconds
        end: Math.floor(endMillis * 1000),
        limit: 100,
      })

      const transformed = transformTraces(traces)
      const stats = calculateAggregatedStats(transformed)

      return c.json(stats)
    },
  )

  // Stream traces - GET /stream (must come before /:traceId)
  app.get(
    "/stream",
    describeRoute({
      summary: "Stream traces",
      description: "Server-Sent Events for real-time trace updates",
      operationId: "traces.stream",
      responses: {
        200: {
          description: "Event stream",
          content: {
            "text/event-stream": {
              schema: resolver(z.any()),
            },
          },
        },
      },
    }),
    validator("query", StreamQuerySchema),
    async (c) => {
      const query = c.req.valid("query")

      c.header("Content-Type", "text/event-stream")
      c.header("Cache-Control", "no-cache")
      c.header("X-Accel-Buffering", "no")
      c.header("Connection", "keep-alive")

      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          event: "connected",
          data: JSON.stringify({
            timestamp: Date.now(),
            service: query.service,
          }),
        })

        let lastTimestamp = (Date.now() - 300000) * 1000 // Last 5 minutes, calculate in millis then convert to micros

        const poll = setInterval(async () => {
          try {
            const newTraces = await fetchJaegerTraces({
              service: query.service,
              start: Math.floor(lastTimestamp),
              limit: 20,
            })

            if (newTraces.length > 0) {
              lastTimestamp = Math.max(
                ...newTraces.map((t) => {
                  const firstSpan = t.spans[0]
                  return firstSpan ? firstSpan.startTime : Date.now() * 1000
                }),
              )

              const transformed = transformTraces(newTraces)

              await stream.writeSSE({
                event: "new-traces",
                data: JSON.stringify(transformed),
              })
            }

            await stream.writeSSE({
              event: "heartbeat",
              data: JSON.stringify({ timestamp: Date.now() }),
            })
          } catch (error) {
            log.error("stream_poll_error", { error: String(error) })
            await stream.writeSSE({
              event: "error",
              data: JSON.stringify({ message: String(error) }),
            })
          }
        }, query.interval)

        const cleanup = () => {
          clearInterval(poll)
          log.info("stream_disconnected", { service: query.service })
        }

        stream.onAbort(cleanup)
      })
    },
  )

  // Get trace by ID - GET /:traceId (must come after static paths)
  app.get(
    "/:traceId",
    describeRoute({
      summary: "Get trace by ID",
      description: "Get detailed trace information",
      operationId: "traces.get",
      responses: {
        200: {
          description: "Trace details",
          content: {
            "application/json": {
              schema: resolver(z.any()),
            },
          },
        },
        404: {
          description: "Trace not found",
        },
      },
    }),
    validator("param", TraceParamsSchema),
    async (c) => {
      const params = c.req.valid("param")
      const trace = await fetchJaegerTrace(params.traceId)

      if (!trace) {
        return c.json({ error: "Trace not found" }, 404)
      }

      const transformed = transformTrace(trace)
      return c.json(transformed)
    },
  )

  return app
})