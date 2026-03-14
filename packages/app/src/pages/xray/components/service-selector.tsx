import { Component, For, createSignal, createEffect, onCleanup, Show } from "solid-js"

interface ServiceSelectorProps {
  value: string
  onChange: (service: string) => void
}

export const ServiceSelector: Component<ServiceSelectorProps> = (props) => {
  const [services, setServices] = createSignal<string[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  const fetchServices = async () => {
    try {
      const res = await fetch("/api/traces/services")
      if (!res.ok) throw new Error(`Failed to fetch services: ${res.status}`)
      const data = await res.json()
      setServices(data)
      setError(null)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  createEffect(() => {
    fetchServices()
  })

  return (
    <div class="flex items-center gap-2">
      <label class="text-sm text-zinc-400">Service:</label>
      <Show when={loading()}>
        <span class="text-sm text-zinc-500">Loading...</span>
      </Show>
      <Show when={!loading() && error()}>
        <span class="text-sm text-red-400">Error loading services</span>
      </Show>
      <Show when={!loading() && !error()}>
        <select
          class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
          value={props.value}
          onChange={(e) => props.onChange(e.currentTarget.value)}
        >
          <For each={services()}>
            {(service) => <option value={service}>{service}</option>}
          </For>
          <Show when={services().length === 0}>
            <option value="opencode-agent">opencode-agent</option>
          </Show>
        </select>
      </Show>
    </div>
  )
}
