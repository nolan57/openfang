import { Component, createSignal, createEffect, onCleanup, Show } from "solid-js"
import { ServiceSelector } from "./components/service-selector"
import { StatsPanel } from "./components/stats-panel"
import { DataFlowDiagram } from "./components/data-flow-diagram"
import { LiveFeed } from "./components/live-feed"
import type { TransformedTrace, AggregatedStats } from "./types"

export const XRayLivePage: Component = () => {
  const [service, setService] = createSignal("opencode-agent")
  const [traces, setTraces] = createSignal<TransformedTrace[]>([])
  const [stats, setStats] = createSignal<AggregatedStats | null>(null)
  const [selectedTrace, setSelectedTrace] = createSignal<TransformedTrace | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [connected, setConnected] = createSignal(false)

  let eventSource: EventSource | null = null

  const connectSSE = () => {
    if (eventSource) {
      eventSource.close()
    }

    setLoading(true)
    setError(null)
    setConnected(false)

    const url = `/api/traces/stream?service=${service()}`
    eventSource = new EventSource(url)

    eventSource.addEventListener("connected", () => {
      console.log("SSE connected")
      setLoading(false)
      setError(null)
      setConnected(true)
    })

    eventSource.addEventListener("new-traces", (e) => {
      const event = e as MessageEvent
      const newTraces = JSON.parse(event.data) as TransformedTrace[]
      setTraces((prev) => [...newTraces, ...prev].slice(0, 100))

      // Update selected trace if it was updated
      const selected = selectedTrace()
      if (selected) {
        const updated = newTraces.find((t) => t.traceId === selected.traceId)
        if (updated) setSelectedTrace(updated)
      }
    })

    eventSource.addEventListener("error", (e) => {
      try {
        const event = e as MessageEvent
        const data = JSON.parse(event.data)
        setError(data.message)
      } catch {
        setError("Connection error")
      }
    })

    eventSource.onerror = () => {
      setError("SSE connection failed. Retrying...")
      setConnected(false)
    }
  }

  const loadStats = async () => {
    try {
      const res = await fetch(`/api/traces/stats?service=${service()}`)
      if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`)
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

    // Refresh stats periodically
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
    <div class="h-full flex flex-col bg-zinc-950">
      {/* Header: Service selector + Stats */}
      <div class="border-b border-zinc-800">
        <div class="p-3 flex items-center gap-4">
          <ServiceSelector value={service()} onChange={setService} />
          <Show when={connected()}>
            <span class="text-xs text-green-400 flex items-center gap-1">
              <span class="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              Connected
            </span>
          </Show>
          <Show when={!connected() && !loading()}>
            <span class="text-xs text-red-400">Disconnected</span>
          </Show>
        </div>
        <StatsPanel stats={stats()} loading={loading()} />
      </div>

      {/* Main content: Flow diagram + Live feed */}
      <div class="flex-1 flex overflow-hidden">
        {/* Left: Flow diagram */}
        <div class="flex-1 overflow-hidden">
          <DataFlowDiagram
            nodes={selectedTrace()?.flowNodes ?? []}
            edges={selectedTrace()?.flowEdges ?? []}
            onNodeClick={(node) => console.log("Node clicked:", node)}
          />
        </div>

        {/* Right: Live feed */}
        <div class="w-80 flex-shrink-0">
          <LiveFeed
            traces={traces()}
            selectedId={selectedTrace()?.traceId}
            onSelect={setSelectedTrace}
          />
        </div>
      </div>

      {/* Error toast */}
      <Show when={error()}>
        <div class="absolute bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 p-3 bg-red-900/90 border border-red-700 rounded-lg text-red-200 text-sm">
          {error()}
        </div>
      </Show>
    </div>
  )
}
