# X-Ray Real-time Tracing Page - Detailed Design Document

## 1. Overview

### 1.1 Goals

Add an X-Ray page to OpenCode Web to implement:

- Real-time visualization of trace data flow (similar to flowcharts)
- Display Prompt names used in sessions
- Display LLM call information (model, tokens, latency)
- Display Embedding call information
- Display Memory, Critic, Sandbox, Refactor operations

### 1.2 Tech Stack

| Layer        | Technology                 |
| ------------ | -------------------------- |
| Frontend     | SolidJS                    |
| Flow Diagram | React Flow (@xyflow/solid) |
| Charts       | Recharts                   |
| Real-time    | Server-Sent Events (SSE)   |
| Backend      | Hono (OpenCode Server)     |
| Data Source  | Jaeger API                 |

---

## 2. Architecture Design

### 2.1 System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              OpenCode Web                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        /xray/* Routes                                │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │   /live      │  │  /trace/:id  │  │  /services   │              │   │
│  │  │  Live Stream │  │  Trace Detail│  │Service List  │              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  │                                                                       │   │
│  │  ┌──────────────────────────────────────────────────────────────┐    │   │
│  │  │              DataFlowDiagram (React Flow)                     │    │   │
│  │  │  • Nodes: Prompt / LLM / Embedding / Memory / Critic        │    │   │
│  │  │  • Edges: Call relationships                                 │    │   │
│  │  │  • Animation: Data flow effects                              │    │   │
│  │  └──────────────────────────────────────────────────────────────┘    │   │
│  │                                                                       │   │
│  │  ┌──────────────────────────────────────────────────────────────┐    │   │
│  │  │              StatsPanel (Statistics Panel)                    │    │   │
│  │  │  • QPS / Error Rate / Latency / Tokens / Cost               │    │   │
│  │  └──────────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │ SSE / HTTP
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OpenCode Server (Hono)                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    /api/traces/* Routes                             │   │
│  │                                                                       │   │
│  │  GET /api/traces           - Get traces list (pagination + filters) │   │
│  │  GET /api/traces/:id       - Get single trace                       │   │
│  │  GET /api/traces/services  - Get services list                      │   │
│  │  GET /api/traces/stats     - Get aggregated statistics              │   │
│  │  GET /api/traces/stream    - SSE real-time push                     │   │
│  │                                                                       │   │
│  │  ┌─────────────────────────────────────────────────────────────┐    │   │
│  │  │              TraceTransformer                                │    │   │
│  │  │  • Jaeger API → Frontend format                             │    │   │
│  │  │  • Span classification (prompt/llm/embedding/memory/...)    │    │   │
│  │  │  • FlowNode / FlowEdge generation                           │    │   │
│  │  └─────────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │ HTTP
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Jaeger                                         │
│  • URL: http://localhost:16686 (port mapping)                               │
│  • API: /api/traces, /api/services                                          │
│  • Retention: 2 days                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
User Request
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  OpenCode Agent                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ OpenTelemetry SDK                                    │   │
│  │ • Create Spans (prompt, llm, embedding, memory...) │   │
│  │ • Add Attributes (template_id, model, tokens...)   │   │
│  │ • Batch export (every 5s or 512 items)             │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────┘
                             │ OTLP HTTP
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  OTel Collector (:4318)                                      │
│  • Batch processing                                          │
│  • Forward to Jaeger                                         │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Jaeger                                                      │
│  • Store Traces                                              │
│  • Provide Query API                                         │
└────────────────────────────┬────────────────────────────────┘
                             │
                             │ (poll every 2s)
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  OpenCode Server                                             │
│  • Poll Jaeger API                                           │
│  • Transform format                                          │
│  • SSE push to frontend                                      │
└────────────────────────────┬────────────────────────────────┘
                             │
                             │ SSE
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  React Flow Frontend                                         │
│  • Receive new traces                                        │
│  • Animated display                                          │
│  • Update statistics panel                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Server API Design

### 3.1 Route Definition

```typescript
// packages/opencode/src/server/routes/traces.ts
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"

export const TracesRoutes = () =>
  new Hono()
    // ========== Query APIs ==========

    // GET /api/traces
    // Get traces list
    .get(
      "/",
      describeRoute({
        summary: "List traces",
        description: "Get a list of traces with pagination and filters",
        operationId: "traces.list",
      }),
      validator("query", TracesQuerySchema),
      async (c) => {
        const query = c.req.valid("query")
        const traces = await fetchJaegerTraces({
          service: query.service,
          start: query.start,
          end: query.end,
          limit: query.limit ?? 20,
          operation: query.operation,
        })
        return c.json(transformTraces(traces))
      },
    )

    // GET /api/traces/:traceId
    // Get single trace detail
    .get(
      "/:traceId",
      describeRoute({
        summary: "Get trace by ID",
        description: "Get detailed trace information",
        operationId: "traces.get",
      }),
      async (c) => {
        const traceId = c.req.param("traceId")
        const trace = await fetchJaegerTrace(traceId)
        return c.json(transformTrace(trace))
      },
    )

    // GET /api/traces/services
    // Get services list
    .get(
      "/services",
      describeRoute({
        summary: "List services",
        description: "Get list of services with traces",
        operationId: "traces.services",
      }),
      async (c) => {
        const services = await fetchJaegerServices()
        return c.json(services)
      },
    )

    // GET /api/traces/stats
    // Get aggregated statistics
    .get(
      "/stats",
      describeRoute({
        summary: "Get trace statistics",
        description: "Get aggregated statistics for traces",
        operationId: "traces.stats",
      }),
      validator("query", StatsQuerySchema),
      async (c) => {
        const query = c.req.valid("query")
        const stats = await fetchJaegerStats({
          service: query.service,
          start: query.start,
          end: query.end,
        })
        return c.json(transformStats(stats))
      },
    )

    // ========== Real-time Push ==========

    // GET /api/traces/stream
    // SSE real-time push
    .get(
      "/stream",
      describeRoute({
        summary: "Stream traces",
        description: "Server-Sent Events for real-time trace updates",
        operationId: "traces.stream",
      }),
      validator("query", StreamQuerySchema),
      async (c) => {
        const query = c.req.valid("query")

        c.header("Content-Type", "text/event-stream")
        c.header("Cache-Control", "no-cache")
        c.header("X-Accel-Buffering", "no")

        return streamSSE(c, async (stream) => {
          // 1. Send connection confirmation
          await stream.writeSSE({
            event: "connected",
            data: JSON.stringify({
              timestamp: Date.now(),
              service: query.service,
            }),
          })

          // 2. Poll Jaeger
          let lastTimestamp = Date.now() - 60000 // Default: last 1 minute

          const poll = setInterval(async () => {
            try {
              const newTraces = await fetchJaegerTraces({
                service: query.service,
                start: lastTimestamp,
                limit: 10,
              })

              if (newTraces.length > 0) {
                lastTimestamp = Math.max(...newTraces.map((t) => t.startTime))

                await stream.writeSSE({
                  event: "new-traces",
                  data: JSON.stringify(transformTraces(newTraces)),
                })
              }
            } catch (error) {
              await stream.writeSSE({
                event: "error",
                data: JSON.stringify({ message: String(error) }),
              })
            }
          }, query.interval ?? 2000)

          // 3. Cleanup
          stream.onAbort(() => {
            clearInterval(poll)
          })
        })
      },
    )
```

### 3.2 Schema Definition

```typescript
// packages/opencode/src/server/routes/traces/schema.ts
import { z } from "zod"

export const TracesQuerySchema = z.object({
  service: z.string().optional(),
  operation: z.string().optional(),
  start: z.coerce.number().optional(),
  end: z.coerce.number().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(["ok", "error", "all"]).optional(),
})

export const StatsQuerySchema = z.object({
  service: z.string(),
  start: z.coerce.number().optional(),
  end: z.coerce.number().optional(),
})

export const StreamQuerySchema = z.object({
  service: z.string().default("opencode-agent"),
  interval: z.coerce.number().min(1000).max(10000).default(2000),
})
```

### 3.3 Jaeger API Proxy

```typescript
// packages/opencode/src/server/routes/traces/jaeger.ts
import { Log } from "@/util/log"

const log = Log.create({ service: "traces.jaeger" })

const JAEGER_URL = process.env.JAEGER_URL || "http://localhost:16686"

interface JaegerTrace {
  traceID: string
  spans: JaegerSpan[]
  processes: Record<string, JaegerProcess>
}

interface JaegerSpan {
  spanID: string
  traceID: string
  operationName: string
  startTime: number
  duration: number
  statusCode: number
  tags: JaegerTag[]
  logs: JaegerLog[]
  references: JaegerReference[]
}

export async function fetchJaegerTraces(params: {
  service?: string
  start?: number
  end?: number
  limit?: number
  operation?: string
}): Promise<JaegerTrace[]> {
  const query = new URLSearchParams()

  if (params.service) query.set("service", params.service)
  if (params.start) query.set("start", String(params.start))
  if (params.end) query.set("end", String(params.end))
  if (params.limit) query.set("limit", String(params.limit))
  if (params.operation) query.set("operation", params.operation)

  const url = `${JAEGER_URL}/api/traces?${query}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Jaeger API error: ${response.status}`)
  }

  const data = await response.json()
  return data.data || []
}

export async function fetchJaegerTrace(traceId: string): Promise<JaegerTrace | null> {
  const url = `${JAEGER_URL}/api/traces/${traceId}`

  const response = await fetch(url)
  if (!response.ok) {
    if (response.status === 404) return null
    throw new Error(`Jaeger API error: ${response.status}`)
  }

  const data = await response.json()
  return data.data?.[0] || null
}

export async function fetchJaegerServices(): Promise<string[]> {
  const url = `${JAEGER_URL}/api/services`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Jaeger API error: ${response.status}`)
  }

  const data = await response.json()
  return data.data || []
}
```

---

## 4. Data Transformation Layer

### 4.1 Type Definitions

```typescript
// packages/opencode/src/server/routes/traces/types.ts

/** Node type enumeration */
export type NodeType =
  | "prompt" // Prompt build/switch
  | "llm" // LLM call (streamText/generateText)
  | "embedding" // Embedding generation
  | "memory" // Memory operation (search/write)
  | "critic" // Critic evaluation
  | "sandbox" // Sandbox execution
  | "refactor" // Refactor
  | "scheduler" // Scheduler
  | "agent" // Agent main flow
  | "http" // HTTP request
  | "unknown" // Unknown

/** Span classification result */
export interface SpanClassification {
  type: NodeType
  label: string
  details: Record<string, unknown>
}

/** Transformed Trace */
export interface TransformedTrace {
  traceId: string
  serviceName: string
  startTime: number
  endTime: number
  duration: number
  status: "ok" | "error"
  spanCount: number
  spans: TransformedSpan[]

  // Flow diagram specific
  flowNodes: FlowNode[]
  flowEdges: FlowEdge[]

  // Statistics
  stats: TraceStats
}

/** Transformed Span */
export interface TransformedSpan {
  id: string
  traceId: string
  parentId?: string
  name: string
  classification: SpanClassification
  startTime: number
  endTime: number
  duration: number
  status: "ok" | "error"
  attributes: Record<string, unknown>
  events: SpanEvent[]
}

/** Flow Node */
export interface FlowNode {
  id: string
  type: NodeType
  label: string
  status: "running" | "ok" | "error"
  duration: number
  details: Record<string, unknown>
  // React Flow specific
  position?: { x: number; y: number }
}

/** Flow Edge */
export interface FlowEdge {
  id: string
  source: string
  target: string
  type: "sync" | "async"
  animated?: boolean
}

/** Trace Statistics */
export interface TraceStats {
  llmCalls: number
  llmTokens: number
  llmLatency: number
  embeddingCalls: number
  memoryOps: number
  criticDecisions: number
}

/** Aggregated Statistics */
export interface AggregatedStats {
  totalTraces: number
  errorTraces: number
  errorRate: number
  avgDuration: number
  p50Duration: number
  p95Duration: number
  p99Duration: number
  totalTokens: number
  estimatedCost: number
  byType: Record<NodeType, number>
}
```

### 4.2 Transformation Functions

```typescript
// packages/opencode/src/server/routes/traces/transform.ts
import type { JaegerTrace, JaegerSpan } from "./jaeger"
import type {
  TransformedTrace,
  TransformedSpan,
  FlowNode,
  FlowEdge,
  SpanClassification,
  TraceStats,
  NodeType,
} from "./types"

// Node type mapping
const NODE_TYPE_PATTERNS: Record<NodeType, RegExp[]> = {
  prompt: [/prompt\.(build|switch|assemble)/, /prompt\./],
  llm: [/ai\.streamText/, /ai\.generateText/, /llm\./],
  embedding: [/embedding\./, /embedWithDimensions/, /text-embedding/],
  memory: [/memory\./, /memory\./, /vector\./],
  critic: [/critic\./, /evaluate/],
  sandbox: [/sandbox\./, /execute/],
  refactor: [/refactor\./, /self-refactor/],
  scheduler: [/scheduler\./, /cron/],
  agent: [/agent\./, /agent\.run/],
  http: [/http\./, /fetch/],
  unknown: [],
}

// Classify Span
export function classifySpan(name: string, attributes: Record<string, unknown>): SpanClassification {
  for (const [type, patterns] of Object.entries(NODE_TYPE_PATTERNS)) {
    if (type === "unknown") continue

    for (const pattern of patterns) {
      if (pattern.test(name)) {
        const label = getSpanLabel(name, attributes)
        return { type: type as NodeType, label, details: extractDetails(name, attributes) }
      }
    }
  }

  return { type: "unknown", label: name, details: {} }
}

function getSpanLabel(name: string, attributes: Record<string, unknown>): string {
  // Prompt name
  if (attributes["prompt.template_id"]) {
    return `Prompt: ${attributes["prompt.template_id"]}`
  }

  // LLM model
  if (attributes["llm.model"]) {
    return `LLM: ${attributes["llm.model"]}`
  }

  // Embedding
  if (attributes["embedding.model"]) {
    return `Embedding: ${attributes["embedding.model"]}`
  }

  // Memory operation
  if (attributes["operation.type"]) {
    return `Memory: ${attributes["operation.type"]}`
  }

  // Critic decision
  if (attributes["decision.outcome"]) {
    return `Critic: ${attributes["decision.outcome"]}`
  }

  return name
}

function extractDetails(name: string, attributes: Record<string, unknown>): Record<string, unknown> {
  const details: Record<string, unknown> = {}

  // LLM related
  if (attributes["llm.input_tokens"]) {
    details["inputTokens"] = attributes["llm.input_tokens"]
    details["outputTokens"] = attributes["llm.output_tokens"]
    details["latencyMs"] = attributes["llm.latency.ms"]
  }

  // Embedding related
  if (attributes["embedding.provider"]) {
    details["provider"] = attributes["embedding.provider"]
    details["model"] = attributes["embedding.model"]
    details["dimensions"] = attributes["embedding.dimensions"]
    details["latencyMs"] = attributes["embedding.latency_ms"]
  }

  // Memory related
  if (attributes["operation.type"]) {
    details["operation"] = attributes["operation.type"]
    details["resultsCount"] = attributes["results.count"]
    details["latencyMs"] = attributes["latency.ms"]
  }

  // Critic related
  if (attributes["decision.outcome"]) {
    details["decision"] = attributes["decision.outcome"]
    details["score"] = attributes["score.value"]
    details["threshold"] = attributes["score.threshold"]
  }

  return details
}

// Transform Trace
export function transformTrace(jaegerTrace: JaegerTrace): TransformedTrace {
  const spans = jaegerTrace.spans.map(transformSpan)

  // Build flow graph nodes and edges
  const { flowNodes, flowEdges } = buildFlowGraph(spans)

  // Calculate statistics
  const stats = calculateTraceStats(spans)

  // Determine overall status
  const hasError = spans.some((s) => s.status === "error")

  const startTime = Math.min(...spans.map((s) => s.startTime))
  const endTime = Math.max(...spans.map((s) => s.endTime))

  return {
    traceId: jaegerTrace.traceID,
    serviceName: Object.values(jaegerTrace.processes)[0]?.serviceName || "unknown",
    startTime,
    endTime,
    duration: endTime - startTime,
    status: hasError ? "error" : "ok",
    spanCount: spans.length,
    spans,
    flowNodes,
    flowEdges,
    stats,
  }
}

// Transform Span
export function transformSpan(jaegerSpan: JaegerSpan): TransformedSpan {
  const attributes = extractAttributes(jaegerSpan.tags)
  const classification = classifySpan(jaegerSpan.operationName, attributes)

  return {
    id: jaegerSpan.spanID,
    traceId: jaegerSpan.traceID,
    parentId: jaegerSpan.references?.[0]?.spanID,
    name: jaegerSpan.operationName,
    classification,
    startTime: jaegerSpan.startTime,
    endTime: jaegerSpan.startTime + jaegerSpan.duration,
    duration: jaegerSpan.duration,
    status: jaegerSpan.statusCode === 0 ? "ok" : "error",
    attributes,
    events: jaegerSpan.logs.map(transformEvent),
  }
}

// Build flow graph
function buildFlowGraph(spans: TransformedSpan[]): { flowNodes: FlowNode[]; flowEdges: FlowEdge[] } {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []

  // Organize nodes by level
  const spanMap = new Map<string, TransformedSpan>()
  const childrenMap = new Map<string, TransformedSpan[]>()

  spans.forEach((span) => {
    spanMap.set(span.id, span)
    if (!span.parentId) return

    if (!childrenMap.has(span.parentId)) {
      childrenMap.set(span.parentId, [])
    }
    childrenMap.get(span.parentId)!.push(span)
  })

  // Generate nodes and edges (simplified: by time order)
  let yOffset = 0
  const xPositions = {
    prompt: 0,
    llm: 200,
    embedding: 200,
    memory: 200,
    critic: 400,
    sandbox: 400,
    refactor: 400,
    agent: 600,
  }

  // Group by type
  const typeGroups = new Map<NodeType, TransformedSpan[]>()
  spans.forEach((span) => {
    const type = span.classification.type
    if (!typeGroups.has(type)) {
      typeGroups.set(type, [])
    }
    typeGroups.get(type)!.push(span)
  })

  // Generate nodes
  const nodeIds = new Set<string>()

  // By execution order: prompt -> llm -> embedding -> memory -> critic -> sandbox -> refactor
  const typeOrder: NodeType[] = ["prompt", "llm", "embedding", "memory", "critic", "sandbox", "refactor", "agent"]

  typeOrder.forEach((type) => {
    const groupSpans = typeGroups.get(type) || []
    groupSpans.forEach((span, index) => {
      if (nodeIds.has(span.id)) return
      nodeIds.add(span.id)

      nodes.push({
        id: span.id,
        type,
        label: span.classification.label,
        status: span.status,
        duration: span.duration,
        details: span.classification.details,
        position: {
          x: xPositions[type] ?? 800,
          y: yOffset * 80 + index * 30,
        },
      })
    })

    if (groupSpans.length > 0) {
      yOffset++
    }
  })

  // Generate edges (parent-child relationships)
  spans.forEach((span) => {
    if (span.parentId && spanMap.has(span.parentId)) {
      edges.push({
        id: `${span.parentId}-${span.id}`,
        source: span.parentId,
        target: span.id,
        type: "sync",
        animated: span.status === "ok",
      })
    }
  })

  return { flowNodes: nodes, flowEdges: edges }
}

// Calculate Trace statistics
function calculateTraceStats(spans: TransformedSpan[]): TraceStats {
  const stats: TraceStats = {
    llmCalls: 0,
    llmTokens: 0,
    llmLatency: 0,
    embeddingCalls: 0,
    memoryOps: 0,
    criticDecisions: 0,
  }

  spans.forEach((span) => {
    switch (span.classification.type) {
      case "llm":
        stats.llmCalls++
        stats.llmTokens += (span.attributes["llm.input_tokens"] as number) || 0
        stats.llmTokens += (span.attributes["llm.output_tokens"] as number) || 0
        stats.llmLatency += (span.attributes["llm.latency.ms"] as number) || 0
        break
      case "embedding":
        stats.embeddingCalls++
        break
      case "memory":
        stats.memoryOps++
        break
      case "critic":
        stats.criticDecisions++
        break
    }
  })

  return stats
}
```

---

## 5. Frontend Design

### 5.1 Route Configuration

```typescript
// packages/app/src/app.tsx

// Add X-Ray routes
<Route path="/xray" component={XRayLayout}>
  <Route path="/" redirect="/xray/live" />
  <Route path="/live" component={XRayLivePage} />
  <Route path="/trace/:id" component={XRayTracePage} />
  <Route path="/services" component={XRayServicesPage} />
</Route>
```

### 5.2 Page Structure

```
packages/app/src/pages/xray/
├── xray-layout.tsx           # Layout container
│                              # Left: Navigation bar
│                              # Right: Content area
├── xray-live.tsx             # Real-time tracing main page
│                              # Top: StatsPanel (statistics)
│                              # Middle: DataFlowDiagram (flow diagram)
│                              # Bottom: LiveFeed (real-time stream list)
├── xray-trace.tsx            # Trace detail page
│                              # Top: Trace overview
│                              # Middle: Span tree view
│                              # Right: Span detail panel
├── xray-services.tsx         # Services list page
│                              # Services list
│                              # Service details
└── components/
    ├── stats-panel.tsx        # Statistics panel
    ├── data-flow-diagram.tsx  # ⭐ Core: React Flow diagram
    ├── live-feed.tsx          # Real-time stream list
    ├── span-tree.tsx          # Span tree view
    ├── span-detail.tsx        # Span detail panel
    ├── filter-bar.tsx         # Filter bar
    └── service-selector.tsx   # Service selector
```

### 5.3 Core Component: DataFlowDiagram

```typescript
// packages/app/src/pages/xray/components/data-flow-diagram.tsx
import { Component, createSignal, createEffect, onCleanup, For, Show } from "solid-js"
import {
  SolidFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "@xyflow/solid"
import "@xyflow/solid/dist/style.css"
import { FlowNode } from "./flow-node"
import { FlowEdge } from "./flow-edge"

// Node type registration
const nodeTypes = {
  prompt: FlowNode,
  llm: FlowNode,
  embedding: FlowNode,
  memory: FlowNode,
  critic: FlowNode,
  sandbox: FlowNode,
  refactor: FlowNode,
  scheduler: FlowNode,
  agent: FlowNode,
  http: FlowNode,
  unknown: FlowNode,
}

// Node color configuration
const NODE_COLORS: Record<string, string> = {
  prompt: "#3b82f6",      // Blue
  llm: "#8b5cf6",         // Purple
  embedding: "#06b6d4",   // Cyan
  memory: "#ec4899",      // Pink
  critic: "#f59e0b",      // Orange
  sandbox: "#ef4444",     // Red
  refactor: "#10b981",    // Green
  scheduler: "#6b7280",   // Gray
  agent: "#000000",       // Black
  http: "#64748b",        // Slate
  unknown: "#9ca3af",     // Light gray
}

interface DataFlowDiagramProps {
  nodes: FlowNode[]
  edges: FlowEdge[]
  onNodeClick?: (node: FlowNode) => void
  onEdgeClick?: (edge: FlowEdge) => void
}

export const DataFlowDiagram: Component<DataFlowDiagramProps> = (props) => {
  // Transform node format
  const flowNodes = (): Node[] =>
    props.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position ?? { x: 0, y: 0 },
      data: {
        label: node.label,
        status: node.status,
        duration: node.duration,
        details: node.details,
        color: NODE_COLORS[node.type] || NODE_COLORS.unknown,
      },
      style: {
        background: NODE_COLORS[node.type] || NODE_COLORS.unknown,
        border: node.status === "error" ? "2px solid #ef4444" : "none",
        borderRadius: "8px",
        padding: "8px 12px",
        color: "white",
        fontSize: "12px",
      },
    }))

  // Transform edge format
  const flowEdges = (): Edge[] =>
    props.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      animated: edge.animated,
      style: { stroke: "#9ca3af" },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "#9ca3af",
      },
    }))

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes())
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges())

  // Respond to node changes
  createEffect(() => {
    setNodes(flowNodes())
    setEdges(flowEdges())
  })

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <SolidFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
      >
        <Background color="#f3f4f6" gap={20} />
        <Controls />
        <MiniMap
          nodeColor={(node) => NODE_COLORS[node.type || "unknown"]}
          maskColor="rgba(240, 242, 245, 0.8)"
        />
      </SolidFlow>
    </div>
  )
}
```

### 5.4 Node Component

```typescript
// packages/app/src/pages/xray/components/flow-node.tsx
import { Component, Show } from "solid-js"
import { Handle, Position, type NodeProps } from "@xyflow/solid"

interface FlowNodeData {
  label: string
  status: "running" | "ok" | "error"
  duration: number
  details: Record<string, unknown>
  color: string
}

export const FlowNode: Component<NodeProps> = (props) => {
  const data = () => props.data as FlowNodeData

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}m`
  }

  const getIcon = (type: string): string => {
    const icons: Record<string, string> = {
      prompt: "📝",
      llm: "🤖",
      embedding: "🔢",
      memory: "🧠",
      critic: "🔍",
      sandbox: "🛡️",
      refactor: "🔧",
      scheduler: "⏰",
      agent: "⚡",
      http: "🌐",
    }
    return icons[type] || "❓"
  }

  return (
    <div
      style={{
        background: data().color,
        border: data().status === "error"
          ? "2px solid #ef4444"
          : data().status === "running"
          ? "2px solid #fbbf24"
          : "none",
        "border-radius": "8px",
        padding: "8px 12px",
        color: "white",
        "min-width": "120px",
        "box-shadow": "0 2px 4px rgba(0,0,0,0.1)",
      }}
    >
      <Handle type="target" position={Position.Left} />

      <div style={{ "font-weight": "500", "font-size": "12px" }}>
        {getIcon(props.type)} {data().label}
      </div>

      <div style={{ "font-size": "10px", opacity: 0.8, "margin-top": "4px" }}>
        {formatDuration(data().duration)}
      </div>

      <Show when={data().details && Object.keys(data().details).length > 0}>
        <div style={{ "font-size": "9px", "margin-top": "4px", opacity: 0.7 }}>
          <Show when={data().details["inputTokens"]}>
            🔤 {data().details["inputTokens"]} + {data().details["outputTokens"]} tokens
          </Show>
          <Show when={data().details["decision"]}>
            {data().details["decision"]} (score: {data().details["score"]})
          </Show>
        </div>
      </Show>

      <Handle type="source" position={Position.Right} />
    </div>
  )
}
```

### 5.5 Statistics Panel

```typescript
// packages/app/src/pages/xray/components/stats-panel.tsx
import { Component, createSignal, createEffect, For, Show } from "solid-js"
import { Card } from "@opencode-ai/ui/card"
import { Badge } from "@opencode-ai/ui/badge"

interface StatsPanelProps {
  stats: AggregatedStats | null
  loading?: boolean
}

export const StatsPanel: Component<StatsPanelProps> = (props) => {
  const formatNumber = (n: number): string => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
    return n.toFixed(0)
  }

  const formatCost = (dollars: number): string => {
    if (dollars < 0.01) return `$${(dollars * 1000).toFixed(2)}¢`
    return `$${dollars.toFixed(4)}`
  }

  return (
    <div style={{
      display: "grid",
      "grid-template-columns": "repeat(auto-fit, minmax(150px, 1fr))",
      gap: "12px",
      padding: "12px",
      background: "#f9fafb",
    }}>
      {/* QPS */}
      <Card>
        <div style={{ "font-size": "12px", color: "#6b7280" }}>QPS</div>
        <div style={{ "font-size": "24px", "font-weight": "600" }}>
          <Show when={!props.loading} fallback="--">
            {props.stats?.totalTraces || 0}
          </Show>
        </div>
      </Card>

      {/* Error Rate */}
      <Card>
        <div style={{ "font-size": "12px", color: "#6b7280" }}>Error Rate</div>
        <div style={{ "font-size": "24px", "font-weight": "600", color:
          (props.stats?.errorRate ?? 0) > 0.1 ? "#ef4444" : "#10b981"
        }}>
          <Show when={!props.loading} fallback="--">
            {((props.stats?.errorRate ?? 0) * 100).toFixed(1)}%
          </Show>
        </div>
      </Card>

      {/* Avg Latency */}
      <Card>
        <div style={{ "font-size": "12px", color: "#6b7280" }}>Avg Latency</div>
        <div style={{ "font-size": "24px", "font-weight": "600" }}>
          <Show when={!props.loading} fallback="--">
            {props.stats?.avgDuration ? `${(props.stats.avgDuration / 1000).toFixed(1)}s` : "--"}
          </Show>
        </div>
      </Card>

      {/* Tokens */}
      <Card>
        <div style={{ "font-size": "12px", color: "#6b7280" }}>Tokens</div>
        <div style={{ "font-size": "24px", "font-weight": "600" }}>
          <Show when={!props.loading} fallback="--">
            {formatNumber(props.stats?.totalTokens ?? 0)}
          </Show>
        </div>
      </Card>

      {/* Cost */}
      <Card>
        <div style={{ "font-size": "12px", color: "#6b7280" }}>Est. Cost</div>
        <div style={{ "font-size": "24px", "font-weight": "600", color: "#10b981" }}>
          <Show when={!props.loading} fallback="--">
            {formatCost(props.stats?.estimatedCost ?? 0)}
          </Show>
        </div>
      </Card>

      {/* LLM Calls */}
      <Card>
        <div style={{ "font-size": "12px", color: "#6b7280" }}>LLM Calls</div>
        <div style={{ "font-size": "24px", "font-weight": "600" }}>
          <Show when={!props.loading} fallback="--">
            {props.stats?.byType?.llm ?? 0}
          </Show>
        </div>
      </Card>

      {/* Embedding Calls */}
      <Card>
        <div style={{ "font-size": "12px", color: "#6b7280" }}>Embedding</div>
        <div style={{ "font-size": "24px", "font-weight": "600" }}>
          <Show when={!props.loading} fallback="--">
            {props.stats?.byType?.embedding ?? 0}
          </Show>
        </div>
      </Card>

      {/* Memory Ops */}
      <Card>
        <div style={{ "font-size": "12px", color: "#6b7280" }}>Memory</div>
        <div style={{ "font-size": "24px", "font-weight": "600" }}>
          <Show when={!props.loading} fallback="--">
            {props.stats?.byType?.memory ?? 0}
          </Show>
        </div>
      </Card>
    </div>
  )
}
```

### 5.6 Real-time Stream Page

```typescript
// packages/app/src/pages/xray/xray-live.tsx
import { Component, createSignal, createEffect, onCleanup, Show, For } from "solid-js"
import { ServiceSelector } from "./components/service-selector"
import { StatsPanel } from "./components/stats-panel"
import { DataFlowDiagram } from "./components/data-flow-diagram"
import { LiveFeed } from "./components/live-feed"
import type { TransformedTrace, AggregatedStats } from "@/server/routes/traces/types"

export const XRayLivePage: Component = () => {
  const [service, setService] = createSignal("opencode-agent")
  const [traces, setTraces] = createSignal<TransformedTrace[]>([])
  const [stats, setStats] = createSignal<AggregatedStats | null>(null)
  const [selectedTrace, setSelectedTrace] = createSignal<TransformedTrace | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  let eventSource: EventSource | null = null

  // SSE connection
  const connectSSE = () => {
    if (eventSource) {
      eventSource.close()
    }

    const url = `/api/traces/stream?service=${service()}`
    eventSource = new EventSource(url)

    eventSource.addEventListener("connected", () => {
      console.log("SSE connected")
      setLoading(false)
      setError(null)
    })

    eventSource.addEventListener("new-traces", (e) => {
      const newTraces = JSON.parse(e.data) as TransformedTrace[]
      setTraces(prev => [...newTraces, ...prev].slice(0, 100))

      // Update selected trace
      const selected = selectedTrace()
      if (selected) {
        const updated = newTraces.find(t => t.traceId === selected.traceId)
        if (updated) setSelectedTrace(updated)
      }
    })

    eventSource.addEventListener("error", (e) => {
      setError(JSON.parse(e.data).message)
    })
  }

  // Load statistics
  const loadStats = async () => {
    try {
      const res = await fetch(`/api/traces/stats?service=${service()}`)
      const data = await res.json()
      setStats(data)
    } catch (err) {
      console.error("Failed to load stats:", err)
    }
  }

  // Initialize
  createEffect(() => {
    connectSSE()
    loadStats()

    // Periodically refresh statistics
    const interval = setInterval(loadStats, 5000)

    onCleanup(() => {
      eventSource?.close()
      clearInterval(interval)
    })
  })

  // Reconnect when service changes
  createEffect(() => {
    const s = service()
    if (s) {
      connectSSE()
      loadStats()
    }
  })

  return (
    <div style={{ height: "100%", display: "flex", "flex-direction": "column" }}>
      {/* Top: Service selector + Statistics */}
      <div style={{ "border-bottom": "1px solid #e5e7eb" }}>
        <div style={{ padding: "12px", display: "flex", gap: "12px", "align-items": "center" }}>
          <ServiceSelector value={service()} onChange={setService} />
        </div>
        <StatsPanel stats={stats()} loading={loading()} />
      </div>

      {/* Middle: Flow diagram + Real-time stream */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: Flow diagram (main area) */}
        <div style={{ flex: 2, "border-right": "1px solid #e5e7eb", overflow: "auto" }}>
          <Show when={selectedTrace()} fallback={
            <div style={{
              height: "100%",
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              color: "#9ca3af"
            }}>
              Select a trace to view the flow diagram
            </div>
          }>
            <DataFlowDiagram
              nodes={selectedTrace()!.flowNodes}
              edges={selectedTrace()!.flowEdges}
              onNodeClick={(node) => console.log("Node clicked:", node)}
            />
          </Show>
        </div>

        {/* Right: Real-time stream list */}
        <div style={{ flex: 1, overflow: "auto", "max-width": "400px" }}>
          <LiveFeed
            traces={traces()}
            selectedId={selectedTrace()?.traceId}
            onSelect={(trace) => setSelectedTrace(trace)}
          />
        </div>
      </div>

      {/* Error message */}
      <Show when={error()}>
        <div style={{
          padding: "8px 12px",
          background: "#fef2f2",
          color: "#ef4444",
          "font-size": "12px"
        }}>
          Error: {error()}
        </div>
      </Show>
    </div>
  )
}
```

---

## 6. Span Enhancement

### 6.1 Span Attributes to Add

To achieve fine-grained tracing, add the following Span attributes to existing code:

```typescript
// When building Prompt
span.setAttribute("prompt.template_id", templateId)
span.setAttribute("prompt.layers_applied", JSON.stringify(layers))

// When calling Embedding
span.setAttribute("embedding.provider", provider)
span.setAttribute("embedding.model", model)
span.setAttribute("embedding.dimensions", dimensions)
span.setAttribute("embedding.latency_ms", latency)

// When performing Memory operations
span.setAttribute("memory.operation", operationType)
span.setAttribute("memory.results_count", results.length)
```

### 6.2 Modification Locations

| Operation        | File                         | Attributes to Add            |
| ---------------- | ---------------------------- | ---------------------------- |
| Prompt Build     | `session/prompts/builder.ts` | template_id, layers          |
| Embedding        | `learning/embeddings.ts`     | provider, model, dimensions  |
| Memory           | `memory/service.ts`          | operation, results_count     |
| Critic           | `learning/critic.ts`         | decision, score, threshold   |

---

## 7. File List

### 7.1 New Files

#### Server (Backend)

```
packages/opencode/src/server/routes/
├── traces.ts                    # Main routes
├── traces/
│   ├── schema.ts               # Zod schemas
│   ├── jaeger.ts               # Jaeger API client
│   ├── types.ts                # Type definitions
│   └── transform.ts            # Data transformation functions
```

#### Frontend

```
packages/app/src/pages/xray/
├── xray-layout.tsx              # Layout
├── xray-live.tsx                # Real-time tracing page
├── xray-trace.tsx               # Trace detail page
├── xray-services.tsx            # Services list page
└── components/
    ├── stats-panel.tsx          # Statistics panel
    ├── data-flow-diagram.tsx    # React Flow diagram
    ├── flow-node.tsx            # Custom node
    ├── flow-edge.tsx            # Custom edge
    ├── live-feed.tsx            # Real-time stream list
    ├── span-tree.tsx            # Span tree
    ├── span-detail.tsx          # Span detail
    ├── filter-bar.tsx           # Filter bar
    └── service-selector.tsx     # Service selector
```

### 7.2 Modified Files

| File                                        | Changes                          |
| ------------------------------------------- | -------------------------------- |
| `packages/opencode/src/server/server.ts`    | Register `/api/traces` routes    |
| `packages/app/src/app.tsx`                  | Add `/xray/*` routes             |

---

## 8. Implementation Order

### Phase 1: Infrastructure (1-2 days)

1. Create Server route skeleton
2. Implement Jaeger API client
3. Implement data transformation functions
4. Register routes

### Phase 2: Frontend Basics (1-2 days)

1. Create page routes
2. Implement service selector
3. Implement statistics panel
4. Implement LiveFeed

### Phase 3: Flow Diagram (2-3 days)

1. Integrate React Flow
2. Implement DataFlowDiagram component
3. Implement FlowNode component
4. Add animation effects

### Phase 4: Real-time Push (1 day)

1. Implement SSE endpoint
2. Frontend SSE consumption
3. Auto-refresh logic

### Phase 5: Enhancement (1 day)

1. Add Span attributes
2. Improve statistics calculation
3. Bug fixes

---

## 9. Configuration

### 9.1 Environment Variables

```bash
# Server
JAEGER_URL=http://localhost:16686

# Frontend (if needed)
VITE_JAEGER_URL=http://localhost:16686
```

### 9.2 Optional Configuration

```json
// opencode.json
{
  "xray": {
    "enabled": true,
    "jaegerUrl": "http://localhost:16686",
    "refreshInterval": 2000,
    "defaultService": "opencode-agent",
    "maxTracesInMemory": 100
  }
}
```

---

## 10. Expected Results

### 10.1 Flow Diagram Display

```
                    ┌─────────────┐
                    │ 📝 Prompt   │
                    │ anthropic   │
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │   🤖 LLM    │ │  🔢 Embed  │ │    🧠      │
    │  gpt-4     │ │  embedding │ │   Memory    │
    │ 2048+512   │ │  1536 dim  │ │   Search    │
    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
           │               │               │
           └───────────────┼───────────────┘
                           ▼
                    ┌─────────────┐
                    │   Result    │
                    └─────────────┘
```

### 10.2 Statistics Panel

| Metric       | Value  |
| ------------ | ------ |
| QPS          | 0.5    |
| Error Rate   | 2.0%   |
| Avg Latency  | 1.2s   |
| Tokens       | 2.5K   |
| Est. Cost    | $0.05  |
| LLM Calls    | 3      |
| Embedding    | 2      |
| Memory       | 5      |

---

## 11. Next Steps

After confirming the above design, I can start implementing:

1. **Server API** - Implement basic query endpoints first
2. **Jaeger Proxy** - Ensure data can be retrieved correctly
3. **Frontend Basics** - Page skeleton and routes
4. **Flow Diagram** - React Flow integration

Shall I start writing the code?