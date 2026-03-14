import { Component, createSignal, createEffect, For, Show } from "solid-js"

interface ServiceInfo {
  name: string
  spanCount?: number
  errorCount?: number
}

export const XRayServicesPage: Component = () => {
  const [services, setServices] = createSignal<string[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  createEffect(() => {
    setLoading(true)
    fetch("/api/traces/services")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch services: ${res.status}`)
        return res.json()
      })
      .then((data) => {
        setServices(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(String(err))
        setLoading(false)
      })
  })

  return (
    <div class="h-full overflow-auto bg-zinc-950 p-6">
      <h1 class="text-xl font-semibold text-zinc-200 mb-4">Services</h1>

      <Show when={loading()}>
        <div class="text-zinc-400">Loading services...</div>
      </Show>

      <Show when={error()}>
        <div class="text-red-400">Error: {error()}</div>
      </Show>

      <Show when={!loading() && !error()}>
        <Show
          when={services().length > 0}
          fallback={
            <div class="text-zinc-500">
              No services found. Make sure Jaeger is running and traces are being collected.
            </div>
          }
        >
          <div class="grid gap-3">
            <For each={services()}>
              {(service) => (
                <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-4 hover:border-zinc-700 transition-colors">
                  <div class="flex items-center justify-between">
                    <span class="text-zinc-200 font-medium">{service}</span>
                    <a
                      href={`http://localhost:16686/search?service=${service}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-xs text-blue-400 hover:text-blue-300"
                    >
                      View in Jaeger →
                    </a>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <div class="mt-8 p-4 bg-zinc-900 border border-zinc-800 rounded-lg">
        <h2 class="text-sm font-semibold text-zinc-300 mb-2">How to enable tracing</h2>
        <p class="text-sm text-zinc-400 mb-3">
          X-Ray uses OpenTelemetry and Jaeger for distributed tracing. To collect traces:
        </p>
        <ol class="text-sm text-zinc-400 space-y-1 list-decimal list-inside">
          <li>Set <code class="bg-zinc-800 px-1 rounded">experimental.openTelemetry: true</code> in opencode.json</li>
          <li>Start the observability stack: <code class="bg-zinc-800 px-1 rounded">docker-compose up -d</code></li>
          <li>Run OpenCode - traces will be collected automatically</li>
          <li>Refresh this page to see traces</li>
        </ol>
      </div>
    </div>
  )
}
