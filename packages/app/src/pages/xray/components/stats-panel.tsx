import { Component, Show } from "solid-js"
import type { AggregatedStats } from "../types"

interface StatsPanelProps {
  stats: AggregatedStats | null
  loading?: boolean
}

const formatNumber = (n: number): string => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toFixed(0)
}

const formatCost = (dollars: number): string => {
  if (dollars < 0.01) return `$${(dollars * 1000).toFixed(2)}m`
  return `$${dollars.toFixed(4)}`
}

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

export const StatsPanel: Component<StatsPanelProps> = (props) => {
  return (
    <div class="grid grid-cols-4 md:grid-cols-8 gap-2 p-3 bg-zinc-900 border-b border-zinc-800">
      {/* Total Traces */}
      <div class="bg-zinc-800 rounded-lg p-2">
        <div class="text-xs text-zinc-400">Traces</div>
        <div class="text-lg font-semibold">
          <Show when={!props.loading} fallback="--">
            {props.stats?.totalTraces ?? 0}
          </Show>
        </div>
      </div>

      {/* Error Rate */}
      <div class="bg-zinc-800 rounded-lg p-2">
        <div class="text-xs text-zinc-400">Error Rate</div>
        <div
          class="text-lg font-semibold"
          classList={{
            "text-red-400": (props.stats?.errorRate ?? 0) > 0.1,
            "text-green-400": (props.stats?.errorRate ?? 0) <= 0.05,
          }}
        >
          <Show when={!props.loading} fallback="--">
            {((props.stats?.errorRate ?? 0) * 100).toFixed(1)}%
          </Show>
        </div>
      </div>

      {/* Avg Duration */}
      <div class="bg-zinc-800 rounded-lg p-2">
        <div class="text-xs text-zinc-400">Avg Latency</div>
        <div class="text-lg font-semibold">
          <Show when={!props.loading} fallback="--">
            {formatDuration(props.stats?.avgDuration ?? 0)}
          </Show>
        </div>
      </div>

      {/* Tokens */}
      <div class="bg-zinc-800 rounded-lg p-2">
        <div class="text-xs text-zinc-400">Tokens</div>
        <div class="text-lg font-semibold">
          <Show when={!props.loading} fallback="--">
            {formatNumber(props.stats?.totalTokens ?? 0)}
          </Show>
        </div>
      </div>

      {/* Cost */}
      <div class="bg-zinc-800 rounded-lg p-2">
        <div class="text-xs text-zinc-400">Est. Cost</div>
        <div class="text-lg font-semibold text-green-400">
          <Show when={!props.loading} fallback="--">
            {formatCost(props.stats?.estimatedCost ?? 0)}
          </Show>
        </div>
      </div>

      {/* LLM Calls */}
      <div class="bg-zinc-800 rounded-lg p-2">
        <div class="text-xs text-zinc-400">LLM Calls</div>
        <div class="text-lg font-semibold text-purple-400">
          <Show when={!props.loading} fallback="--">
            {props.stats?.byType?.llm ?? 0}
          </Show>
        </div>
      </div>

      {/* Embedding Calls */}
      <div class="bg-zinc-800 rounded-lg p-2">
        <div class="text-xs text-zinc-400">Embedding</div>
        <div class="text-lg font-semibold text-cyan-400">
          <Show when={!props.loading} fallback="--">
            {props.stats?.byType?.embedding ?? 0}
          </Show>
        </div>
      </div>

      {/* Memory Ops */}
      <div class="bg-zinc-800 rounded-lg p-2">
        <div class="text-xs text-zinc-400">Memory</div>
        <div class="text-lg font-semibold text-pink-400">
          <Show when={!props.loading} fallback="--">
            {props.stats?.byType?.memory ?? 0}
          </Show>
        </div>
      </div>
    </div>
  )
}
