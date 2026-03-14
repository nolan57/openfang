import { Component, For, Show } from "solid-js"
import type { TransformedTrace } from "../types"

interface LiveFeedProps {
  traces: TransformedTrace[]
  selectedId?: string
  onSelect: (trace: TransformedTrace) => void
}

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp / 1000) // Jaeger uses microseconds
  return date.toLocaleTimeString()
}

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

export const LiveFeed: Component<LiveFeedProps> = (props) => {
  return (
    <div class="h-full overflow-auto bg-zinc-900 border-l border-zinc-800">
      <div class="p-3 border-b border-zinc-800">
        <h2 class="text-sm font-semibold text-zinc-300">Live Traces</h2>
        <div class="text-xs text-zinc-500 mt-1">{props.traces.length} traces</div>
      </div>

      <Show
        when={props.traces.length > 0}
        fallback={
          <div class="p-4 text-center text-zinc-500 text-sm">No traces yet. Waiting for data...</div>
        }
      >
        <div class="divide-y divide-zinc-800">
          <For each={props.traces}>
            {(trace) => (
              <button
                class="w-full p-3 text-left hover:bg-zinc-800 transition-colors"
                classList={{
                  "bg-zinc-800": props.selectedId === trace.traceId,
                  "border-l-2 border-l-blue-500": props.selectedId === trace.traceId,
                }}
                onClick={() => props.onSelect(trace)}
              >
                <div class="flex items-center justify-between mb-1">
                  <span class="text-xs font-mono text-zinc-400">
                    {trace.traceId.slice(0, 8)}...
                  </span>
                  <span
                    class="text-xs px-1.5 py-0.5 rounded"
                    classList={{
                      "bg-green-900/50 text-green-400": trace.status === "ok",
                      "bg-red-900/50 text-red-400": trace.status === "error",
                    }}
                  >
                    {trace.status}
                  </span>
                </div>

                <div class="flex items-center gap-2 text-xs text-zinc-300">
                  <span class="font-medium">{trace.serviceName}</span>
                  <span class="text-zinc-500">•</span>
                  <span>{trace.spanCount} spans</span>
                  <span class="text-zinc-500">•</span>
                  <span>{formatDuration(trace.duration)}</span>
                </div>

                <div class="text-xs text-zinc-500 mt-1">{formatTime(trace.startTime)}</div>

                <Show when={trace.stats.llmCalls > 0}>
                  <div class="flex gap-2 mt-2">
                    <span class="text-xs bg-purple-900/30 text-purple-300 px-1.5 py-0.5 rounded">
                      LLM: {trace.stats.llmCalls}
                    </span>
                    <Show when={trace.stats.llmTokens > 0}>
                      <span class="text-xs bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded">
                        {trace.stats.llmTokens} tokens
                      </span>
                    </Show>
                  </div>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
