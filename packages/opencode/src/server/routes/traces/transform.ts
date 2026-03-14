import type { JaegerSpan, JaegerTrace } from "./jaeger"
import type {
  TransformedTrace,
  TransformedSpan,
  FlowNode,
  FlowEdge,
  SpanClassification,
  TraceStats,
  AggregatedStats,
  NodeType,
} from "./types"

const NODE_TYPE_PATTERNS: Record<NodeType, RegExp[]> = {
  prompt: [/prompt\./, /prompt\./, /systemPrompt/],
  llm: [/ai\.streamText/, /ai\.generateText/, /llm\./, /model\.generate/],
  embedding: [/embedding/, /embedWithDimensions/, /text-embedding/],
  memory: [/memory\./, /vector\.store/, /vector\.search/],
  critic: [/critic/, /evaluate/],
  sandbox: [/sandbox/, /execute/],
  refactor: [/refactor/, /self-refactor/],
  scheduler: [/scheduler/, /cron/],
  agent: [/agent\./, /agent\.run/],
  http: [/http\./, /fetch/],
  unknown: [],
}

const NODE_LABELS: Record<string, string> = {
  prompt: "📝 Prompt",
  llm: "🤖 LLM",
  embedding: "🔢 Embedding",
  memory: "🧠 Memory",
  critic: "🔍 Critic",
  sandbox: "🛡️ Sandbox",
  refactor: "🔧 Refactor",
  scheduler: "⏰ Scheduler",
  agent: "⚡ Agent",
  http: "🌐 HTTP",
}

const X_POSITIONS: Record<NodeType, number> = {
  prompt: 0,
  llm: 200,
  embedding: 200,
  memory: 200,
  critic: 400,
  sandbox: 400,
  refactor: 400,
  scheduler: 600,
  agent: 0,
  http: 100,
  unknown: 800,
}

export function classifySpan(name: string, attributes: Record<string, unknown>): SpanClassification {
  const lowerName = name.toLowerCase()

  for (const [type, patterns] of Object.entries(NODE_TYPE_PATTERNS)) {
    if (type === "unknown") continue

    for (const pattern of patterns) {
      if (pattern.test(lowerName)) {
        const label = getSpanLabel(name, attributes)
        return { type: type as NodeType, label, details: extractDetails(attributes) }
      }
    }
  }

  return { type: "unknown", label: name, details: {} }
}

function getSpanLabel(name: string, attributes: Record<string, unknown>): string {
  if (attributes["prompt.template_id"]) {
    return `${NODE_LABELS.prompt}: ${attributes["prompt.template_id"]}`
  }

  if (attributes["llm.model"]) {
    return `${NODE_LABELS.llm}: ${attributes["llm.model"]}`
  }

  if (attributes["embedding.model"]) {
    return `${NODE_LABELS.embedding}: ${attributes["embedding.model"]}`
  }

  if (attributes["operation.type"]) {
    return `${NODE_LABELS.memory}: ${attributes["operation.type"]}`
  }

  if (attributes["decision.outcome"]) {
    return `${NODE_LABELS.critic}: ${attributes["decision.outcome"]}`
  }

  return name
}

function extractDetails(attributes: Record<string, unknown>): Record<string, unknown> {
  const details: Record<string, unknown> = {}

  if (attributes["llm.input_tokens"]) {
    details["inputTokens"] = attributes["llm.input_tokens"]
    details["outputTokens"] = attributes["llm.output_tokens"]
    details["latencyMs"] = attributes["llm.latency.ms"]
    details["totalTokens"] = (attributes["llm.input_tokens"] as number) + (attributes["llm.output_tokens"] as number)
  }

  if (attributes["embedding.provider"]) {
    details["provider"] = attributes["embedding.provider"]
    details["model"] = attributes["embedding.model"]
    details["dimensions"] = attributes["embedding.dimensions"]
    details["latencyMs"] = attributes["embedding.latency_ms"]
  }

  if (attributes["operation.type"]) {
    details["operation"] = attributes["operation.type"]
    details["resultsCount"] = attributes["results.count"]
    details["latencyMs"] = attributes["latency.ms"]
  }

  if (attributes["decision.outcome"]) {
    details["decision"] = attributes["decision.outcome"]
    details["score"] = attributes["score.value"]
    details["threshold"] = attributes["score.threshold"]
  }

  if (attributes["sandbox.type"]) {
    details["sandboxType"] = attributes["sandbox.type"]
    details["exitCode"] = attributes["exit.code"]
    details["status"] = attributes["execution.status"]
  }

  return details
}

function extractAttributes(tags: { key: string; value: unknown }[]): Record<string, unknown> {
  const attrs: Record<string, unknown> = {}

  for (const tag of tags) {
    const key = tag.key.replace(/\./g, "_")
    attrs[key] = tag.value
  }

  return attrs
}

function transformEvent(log: { timestamp: number; fields: { key: string; value: unknown }[] }): {
  name: string
  time: number
  attributes: Record<string, unknown>
} {
  return {
    name: (log.fields.find((f) => f.key === "event")?.value as string) || "event",
    time: log.timestamp,
    attributes: extractAttributes(log.fields),
  }
}

export function transformTrace(jaegerTrace: JaegerTrace): TransformedTrace {
  const spans = jaegerTrace.spans.map(transformSpan)

  const { flowNodes, flowEdges } = buildFlowGraph(spans)

  const stats = calculateTraceStats(spans)

  const hasError = spans.some((s) => s.status === "error")

  const startTime = Math.min(...spans.map((s) => s.startTime))
  const endTime = Math.max(...spans.map((s) => s.endTime))

  const serviceName = Object.values(jaegerTrace.processes)[0]?.serviceName || "unknown"

  return {
    traceId: jaegerTrace.traceID,
    serviceName,
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

function buildFlowGraph(spans: TransformedSpan[]): { flowNodes: FlowNode[]; flowEdges: FlowEdge[] } {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []

  const spanMap = new Map<string, TransformedSpan>()
  spans.forEach((span) => spanMap.set(span.id, span))

  const typeGroups = new Map<NodeType, TransformedSpan[]>()
  spans.forEach((span) => {
    const type = span.classification.type
    if (!typeGroups.has(type)) {
      typeGroups.set(type, [])
    }
    typeGroups.get(type)!.push(span)
  })

  const nodeIds = new Set<string>()
  const typeOrder: NodeType[] = [
    "prompt",
    "llm",
    "embedding",
    "memory",
    "critic",
    "sandbox",
    "refactor",
    "scheduler",
    "agent",
    "http",
  ]

  let currentY = 0

  typeOrder.forEach((type) => {
    const groupSpans = typeGroups.get(type) || []
    const sortedSpans = groupSpans.sort((a, b) => a.startTime - b.startTime)

    sortedSpans.forEach((span, index) => {
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
          x: X_POSITIONS[type],
          y: currentY * 70 + index * 30,
        },
      })
    })

    if (groupSpans.length > 0) {
      currentY++
    }
  })

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
        stats.llmTokens += (span.attributes["llm_input_tokens"] as number) || 0
        stats.llmTokens += (span.attributes["llm_output_tokens"] as number) || 0
        stats.llmLatency += (span.attributes["llm_latency_ms"] as number) || 0
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

export function transformTraces(jaegerTraces: JaegerTrace[]): TransformedTrace[] {
  return jaegerTraces.map(transformTrace)
}

export function calculateAggregatedStats(traces: TransformedTrace[]): AggregatedStats {
  if (traces.length === 0) {
    return {
      totalTraces: 0,
      errorTraces: 0,
      errorRate: 0,
      avgDuration: 0,
      p50Duration: 0,
      p95Duration: 0,
      p99Duration: 0,
      totalTokens: 0,
      estimatedCost: 0,
      byType: {
        prompt: 0,
        llm: 0,
        embedding: 0,
        memory: 0,
        critic: 0,
        sandbox: 0,
        refactor: 0,
        scheduler: 0,
        agent: 0,
        http: 0,
        unknown: 0,
      } as Record<NodeType, number>,
    }
  }

  const durations = traces.map((t) => t.duration).sort((a, b) => a - b)
  const totalTokens = traces.reduce((sum, t) => sum + t.stats.llmTokens, 0)

  const byType = {
    prompt: 0,
    llm: 0,
    embedding: 0,
    memory: 0,
    critic: 0,
    sandbox: 0,
    refactor: 0,
    scheduler: 0,
    agent: 0,
    http: 0,
    unknown: 0,
  } as Record<NodeType, number>

  traces.forEach((trace) => {
    trace.spans.forEach((span) => {
      const type = span.classification.type
      byType[type] = (byType[type] || 0) + 1
    })
  })

  const tokenCostPer1K = 0.003
  const estimatedCost = (totalTokens / 1000) * tokenCostPer1K

  return {
    totalTraces: traces.length,
    errorTraces: traces.filter((t) => t.status === "error").length,
    errorRate: traces.filter((t) => t.status === "error").length / traces.length,
    avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
    p50Duration: durations[Math.floor(durations.length * 0.5)] || 0,
    p95Duration: durations[Math.floor(durations.length * 0.95)] || 0,
    p99Duration: durations[Math.floor(durations.length * 0.99)] || 0,
    totalTokens,
    estimatedCost,
    byType,
  }
}
