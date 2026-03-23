export type NodeType =
  | "prompt"
  | "llm"
  | "embedding"
  | "memory"
  | "critic"
  | "sandbox"
  | "refactor"
  | "scheduler"
  | "agent"
  | "http"
  | "unknown"

export interface SpanClassification {
  type: NodeType
  label: string
  details: Record<string, unknown>
}

export interface TransformedTrace {
  traceId: string
  serviceName: string
  startTime: number
  endTime: number
  duration: number
  status: "ok" | "error"
  spanCount: number
  spans: TransformedSpan[]
  flowNodes: FlowNode[]
  flowEdges: FlowEdge[]
  stats: TraceStats
}

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

export interface SpanEvent {
  name: string
  time: number
  attributes: Record<string, unknown>
}

export interface FlowNode {
  id: string
  type: NodeType
  label: string
  status: "running" | "ok" | "error"
  duration: number
  details: Record<string, unknown>
  position: { x: number; y: number }
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  type: "sync" | "async"
  animated?: boolean
}

export interface TraceStats {
  llmCalls: number
  llmTokens: number
  llmLatency: number
  embeddingCalls: number
  memoryOps: number
  criticDecisions: number
}

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

export interface ServiceInfo {
  name: string
  spanCount: number
  errorCount: number
}
