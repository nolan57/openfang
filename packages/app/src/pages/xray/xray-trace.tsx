import { Component, createSignal, createEffect, Show, For } from "solid-js"
import { useParams } from "@solidjs/router"
import { DataFlowDiagram } from "./components/data-flow-diagram"
import type { TransformedTrace, TransformedSpan, NodeType } from "./types"

const NODE_COLORS: Record<NodeType, string> = {
  prompt: "bg-blue-500",
  llm: "bg-purple-500",
  embedding: "bg-cyan-500",
  memory: "bg-pink-500",
  critic: "bg-orange-500",
  sandbox: "bg-red-500",
  refactor: "bg-green-500",
  scheduler: "bg-gray-500",
  agent: "bg-gray-800",
  http: "bg-slate-500",
  unknown: "bg-gray-400",
}

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

const formatTime = (timestamp: number): string => {
  return new Date(timestamp / 1000).toLocaleString()
}

export const XRayTracePage: Component = () => {
  const params = useParams()
  const [trace, setTrace] = createSignal<TransformedTrace | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [selectedSpan, setSelectedSpan] = createSignal<TransformedSpan | null>(null)

  createEffect(() => {
    const traceId = params.id
    if (!traceId) return

    setLoading(true)
    setError(null)

    fetch(`/api/traces/${traceId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch trace: ${res.status}`)
        return res.json()
      })
      .then((data) => {
        setTrace(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(String(err))
        setLoading(false)
      })
  })

  return (
    <div class="h-full flex flex-col bg-zinc-950">
      {/* Header */}
      <div class="border-b border-zinc-800 p-4">
        <Show when={loading()}>
          <div class="text-zinc-400">Loading trace...</div>
        </Show>
        <Show when={error()}>
          <div class="text-red-400">Error: {error()}</div>
        </Show>
        <Show when={!loading() && trace()}>
          <div class="flex items-center gap-4">
            <h1 class="text-lg font-semibold text-zinc-200">
              Trace: {trace()!.traceId.slice(0, 16)}...
            </h1>
            <span
              class="px-2 py-0.5 rounded text-xs font-medium"
              classList={{
                "bg-green-900/50 text-green-400": trace()!.status === "ok",
                "bg-red-900/50 text-red-400": trace()!.status === "error",
              }}
            >
              {trace()!.status}
            </span>
          </div>
          <div class="flex gap-4 mt-2 text-sm text-zinc-400">
            <span>Service: {trace()!.serviceName}</span>
            <span>Duration: {formatDuration(trace()!.duration)}</span>
            <span>Spans: {trace()!.spanCount}</span>
            <span>Started: {formatTime(trace()!.startTime)}</span>
          </div>
        </Show>
      </div>

      {/* Main content */}
      <Show when={!loading() && trace()}>
        <div class="flex-1 flex overflow-hidden">
          {/* Left: Flow diagram */}
          <div class="flex-1 overflow-hidden border-r border-zinc-800">
            <DataFlowDiagram
              nodes={trace()!.flowNodes}
              edges={trace()!.flowEdges}
              onNodeClick={(node) => {
                const span = trace()!.spans.find((s) => s.id === node.id)
                setSelectedSpan(span ?? null)
              }}
            />
          </div>

          {/* Right: Span details */}
          <div class="w-96 overflow-auto">
            <Show
              when={selectedSpan()}
              fallback={
                <div class="p-4 text-zinc-500 text-sm">
                  Click a node to see span details
                </div>
              }
            >
              <div class="p-4">
                <h2 class="text-sm font-semibold text-zinc-300 mb-3">Span Details</h2>

                <div class="space-y-3">
                  <div>
                    <div class="text-xs text-zinc-500">Name</div>
                    <div class="text-sm text-zinc-200 font-mono">{selectedSpan()!.name}</div>
                  </div>

                  <div class="flex gap-4">
                    <div>
                      <div class="text-xs text-zinc-500">Type</div>
                      <span
                        class={`text-xs px-1.5 py-0.5 rounded ${NODE_COLORS[selectedSpan()!.classification.type]}`}
                      >
                        {selectedSpan()!.classification.type}
                      </span>
                    </div>
                    <div>
                      <div class="text-xs text-zinc-500">Status</div>
                      <span
                        class="text-xs px-1.5 py-0.5 rounded"
                        classList={{
                          "bg-green-900/50 text-green-400": selectedSpan()!.status === "ok",
                          "bg-red-900/50 text-red-400": selectedSpan()!.status === "error",
                        }}
                      >
                        {selectedSpan()!.status}
                      </span>
                    </div>
                    <div>
                      <div class="text-xs text-zinc-500">Duration</div>
                      <div class="text-sm text-zinc-200">
                        {formatDuration(selectedSpan()!.duration)}
                      </div>
                    </div>
                  </div>

                  <Show when={Object.keys(selectedSpan()!.attributes).length > 0}>
                    <div>
                      <div class="text-xs text-zinc-500 mb-1">Attributes</div>
                      <div class="bg-zinc-900 rounded p-2 text-xs font-mono">
                        <For each={Object.entries(selectedSpan()!.attributes)}>
                          {([key, value]) => (
                            <div class="flex gap-2">
                              <span class="text-zinc-400">{key}:</span>
                              <span class="text-zinc-200">{JSON.stringify(value)}</span>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  <Show when={selectedSpan()!.events.length > 0}>
                    <div>
                      <div class="text-xs text-zinc-500 mb-1">Events ({selectedSpan()!.events.length})</div>
                      <div class="space-y-1">
                        <For each={selectedSpan()!.events}>
                          {(event) => (
                            <div class="bg-zinc-900 rounded p-2 text-xs">
                              <div class="text-zinc-300">{event.name}</div>
                              <div class="text-zinc-500 text-[10px]">
                                {formatTime(event.time)}
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
