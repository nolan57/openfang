import { Component, createSignal, For, Show, createMemo, onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"

export interface TraceSpan {
  id: string
  traceId: string
  parentId?: string
  name: string
  kind: "server" | "client" | "internal" | "producer" | "consumer"
  status: "ok" | "error" | "unset"
  statusMessage?: string
  startTimeUnixNano: number
  endTimeUnixNano: number
  duration: number
  attributes: Record<string, string | number | boolean>
  events: Array<{
    name: string
    timeUnixNano: number
    attributes: Record<string, string | number | boolean>
  }>
  children?: TraceSpan[]
}

export interface Trace {
  traceId: string
  serviceName: string
  startTime: number
  endTime: number
  duration: number
  spans: TraceSpan[]
  rootSpans: TraceSpan[]
}

export interface TraceFilters {
  serviceName?: string
  spanName?: string
  status?: "ok" | "error" | "all"
  timeRange?: { start: number; end: number }
}

interface TraceVisualizerProps {
  traces: Trace[]
  onSpanClick?: (span: TraceSpan) => void
  onTraceClick?: (trace: Trace) => void
}

export const TraceVisualizer: Component<TraceVisualizerProps> = (props) => {
  const [selectedTraceId, setSelectedTraceId] = createSignal<string | null>(null)
  const [selectedSpan, setSelectedSpan] = createSignal<TraceSpan | null>(null)
  const [filters, setFilters] = createStore<TraceFilters>({
    status: "all",
  })
  const [viewMode, setViewMode] = createSignal<"waterfall" | "dag">("waterfall")
  const [compareMode, setCompareMode] = createSignal(false)
  const [compareTraceId, setCompareTraceId] = createSignal<string | null>(null)

  const filteredTraces = createMemo(() => {
    let result = props.traces

    if (filters.status !== "all") {
      result = result.filter((trace) =>
        trace.spans.some((span) =>
          filters.status === "error" ? span.status === "error" : span.status === "ok"
        )
      )
    }

    if (filters.spanName) {
      const query = filters.spanName.toLowerCase()
      result = result.filter((trace) =>
        trace.spans.some((span) => span.name.toLowerCase().includes(query))
      )
    }

    return result.sort((a, b) => b.startTime - a.startTime)
  })

  const selectedTrace = createMemo(() =>
    props.traces.find((t) => t.traceId === selectedTraceId())
  )

  const buildSpanTree = (spans: TraceSpan[]): TraceSpan[] => {
    const spanMap = new Map<string, TraceSpan>()
    const roots: TraceSpan[] = []

    spans.forEach((span) => {
      spanMap.set(span.id, { ...span, children: [] })
    })

    spans.forEach((span) => {
      const spanWithChildren = spanMap.get(span.id)!
      if (span.parentId && spanMap.has(span.parentId)) {
        spanMap.get(span.parentId)!.children!.push(spanWithChildren)
      } else {
        roots.push(spanWithChildren)
      }
    })

    return roots
  }

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}m`
  }

  const formatTimestamp = (unixNano: number): string => {
    const date = new Date(unixNano / 1_000_000)
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
  }

  const getStatusColor = (status: string): string => {
    switch (status) {
      case "error":
        return "#ef4444"
      case "ok":
        return "#10b981"
      default:
        return "#6b7280"
    }
  }

  const handleSpanClick = (span: TraceSpan) => {
    setSelectedSpan(span)
    props.onSpanClick?.(span)
  }

  const handleTraceClick = (trace: Trace) => {
    setSelectedTraceId(trace.traceId)
    setSelectedSpan(null)
    props.onTraceClick?.(trace)
  }

  return (
    <div class="trace-visualizer">
      <div class="trace-list-panel">
        <div class="filters">
          <input
            type="text"
            placeholder="Filter by span name..."
            value={filters.spanName || ""}
            onInput={(e) => setFilters("spanName", e.target.value || undefined)}
            class="filter-input"
          />
          <select
            value={filters.status}
            onChange={(e) => setFilters("status", e.target.value as "all" | "ok" | "error")}
            class="filter-select"
          >
            <option value="all">All Status</option>
            <option value="ok">Success</option>
            <option value="error">Error</option>
          </select>
          <div class="view-toggle">
            <button
              class={viewMode() === "waterfall" ? "active" : ""}
              onClick={() => setViewMode("waterfall")}
            >
              Waterfall
            </button>
            <button
              class={viewMode() === "dag" ? "active" : ""}
              onClick={() => setViewMode("dag")}
            >
              DAG
            </button>
          </div>
        </div>

        <div class="trace-list">
          <For each={filteredTraces()}>
            {(trace) => (
              <div
                class={`trace-item ${selectedTraceId() === trace.traceId ? "selected" : ""}`}
                onClick={() => handleTraceClick(trace)}
              >
                <div class="trace-header">
                  <span class="trace-id">{trace.traceId.slice(0, 8)}...</span>
                  <span
                    class="trace-status"
                    style={{
                      "background-color": trace.spans.some((s) => s.status === "error")
                        ? "#fee2e2"
                        : "#dcfce7",
                      color: trace.spans.some((s) => s.status === "error")
                        ? "#991b1b"
                        : "#166534",
                    }}
                  >
                    {trace.spans.some((s) => s.status === "error") ? "Error" : "Success"}
                  </span>
                </div>
                <div class="trace-meta">
                  <span class="trace-time">{formatTimestamp(trace.startTime)}</span>
                  <span class="trace-duration">{formatDuration(trace.duration)}</span>
                  <span class="trace-spans">{trace.spans.length} spans</span>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>

      <div class="trace-canvas-panel">
        <Show when={selectedTrace()} fallback={<div class="empty-state">Select a trace to view</div>}>
          <div class="canvas-header">
            <h3>Trace: {selectedTrace()!.traceId.slice(0, 16)}...</h3>
            <div class="canvas-actions">
              <button
                class={`compare-btn ${compareMode() ? "active" : ""}`}
                onClick={() => setCompareMode(!compareMode())}
              >
                Compare Mode
              </button>
            </div>
          </div>

          <Show when={viewMode() === "waterfall"}>
            <div class="waterfall-canvas">
              <For each={buildSpanTree(selectedTrace()!.spans)}>
                {(span) => (
                  <div class="span-row">
                    <SpanRow
                      span={span}
                      depth={0}
                      onClick={handleSpanClick}
                      selectedSpanId={selectedSpan()?.id}
                      formatDuration={formatDuration}
                      getStatusColor={getStatusColor}
                    />
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={viewMode() === "dag"}>
            <div class="dag-canvas">
              <DAGView
                trace={selectedTrace()!}
                onNodeClick={handleSpanClick}
                selectedNodeId={selectedSpan()?.id}
                getStatusColor={getStatusColor}
              />
            </div>
          </Show>
        </Show>
      </div>

      <Show when={selectedSpan()}>
        <div class="span-details-panel">
          <div class="details-header">
            <h3>Span Details</h3>
            <button class="close-btn" onClick={() => setSelectedSpan(null)}>
              ×
            </button>
          </div>

          <div class="details-content">
            <div class="detail-section">
              <h4>Basic Info</h4>
              <div class="detail-row">
                <span class="detail-label">Name:</span>
                <span class="detail-value">{selectedSpan()!.name}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Status:</span>
                <span
                  class="detail-value status-badge"
                  style={{ color: getStatusColor(selectedSpan()!.status) }}
                >
                  {selectedSpan()!.status.toUpperCase()}
                </span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Duration:</span>
                <span class="detail-value">{formatDuration(selectedSpan()!.duration)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Start Time:</span>
                <span class="detail-value">{formatTimestamp(selectedSpan()!.startTimeUnixNano)}</span>
              </div>
            </div>

            <div class="detail-section">
              <h4>Attributes</h4>
              <div class="attributes-grid">
                <For each={Object.entries(selectedSpan()!.attributes)}>
                  {([key, value]) => (
                    <div class="attribute-item">
                      <span class="attr-key">{key}</span>
                      <span class="attr-value">{String(value)}</span>
                    </div>
                  )}
                </For>
              </div>
            </div>

            <Show when={selectedSpan()!.events.length > 0}>
              <div class="detail-section">
                <h4>Events ({selectedSpan()!.events.length})</h4>
                <div class="events-list">
                  <For each={selectedSpan()!.events}>
                    {(event) => (
                      <div class="event-item">
                        <div class="event-header">
                          <span class="event-name">{event.name}</span>
                          <span class="event-time">
                            {formatTimestamp(event.timeUnixNano)}
                          </span>
                        </div>
                        <Show when={Object.keys(event.attributes).length > 0}>
                          <div class="event-attributes">
                            <For each={Object.entries(event.attributes)}>
                              {([key, value]) => (
                                <span class="event-attr">
                                  {key}: {String(value)}
                                </span>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <Show when={selectedSpan()!.status === "error" && selectedSpan()!.statusMessage}>
              <div class="detail-section error-section">
                <h4>Error</h4>
                <p class="error-message">{selectedSpan()!.statusMessage}</p>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}

interface SpanRowProps {
  span: TraceSpan
  depth: number
  onClick: (span: TraceSpan) => void
  selectedSpanId?: string
  formatDuration: (ms: number) => string
  getStatusColor: (status: string) => string
}

const SpanRow: Component<SpanRowProps> = (props) => {
  return (
    <div
      class={`span-row-item ${props.selectedSpanId === props.span.id ? "selected" : ""}`}
      style={{ "padding-left": `${props.depth * 20 + 10}px` }}
      onClick={() => props.onClick(props.span)}
    >
      <div class="span-info">
        <span class="span-name">{props.span.name}</span>
        <span
          class="span-status"
          style={{ "background-color": props.getStatusColor(props.span.status) }}
        />
      </div>
      <div class="span-timing">
        <span class="span-duration">{props.formatDuration(props.span.duration)}</span>
      </div>
      <For each={props.span.children}>
        {(child) => (
          <SpanRow
            span={child}
            depth={props.depth + 1}
            onClick={props.onClick}
            selectedSpanId={props.selectedSpanId}
            formatDuration={props.formatDuration}
            getStatusColor={props.getStatusColor}
          />
        )}
      </For>
    </div>
  )
}

interface DAGViewProps {
  trace: Trace
  onNodeClick: (span: TraceSpan) => void
  selectedNodeId?: string
  getStatusColor: (status: string) => string
}

const DAGView: Component<DAGViewProps> = (props) => {
  return (
    <div class="dag-view">
      <svg width="100%" height={props.trace.spans.length * 50 + 50}>
        <For each={props.trace.spans}>
          {(span, index) => {
            const y = index() * 50 + 30
            const hasParent = !!span.parentId
            const parentIndex = props.trace.spans.findIndex((s) => s.id === span.parentId)
            const parentY = parentIndex >= 0 ? parentIndex * 50 + 30 : 0

            return (
              <>
                {hasParent && (
                  <path
                    d={`M 150 ${parentY} C 200 ${parentY}, 200 ${y}, 250 ${y}`}
                    fill="none"
                    stroke="#e5e7eb"
                    stroke-width="2"
                  />
                )}
                <g
                  transform={`translate(250, ${y})`}
                  onClick={() => props.onNodeClick(span)}
                  style={{ cursor: "pointer" }}
                >
                  <circle
                    r="8"
                    fill={props.getStatusColor(span.status)}
                    opacity={props.selectedNodeId === span.id ? 1 : 0.7}
                  />
                  <text x="15" y="5" class="dag-node-label">
                    {span.name}
                  </text>
                </g>
              </>
            )
          }}
        </For>
      </svg>
    </div>
  )
}

export default TraceVisualizer
