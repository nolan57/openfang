import { Component, JSX } from "solid-js"
import { A } from "@solidjs/router"

interface XRayLayoutProps {
  children?: JSX.Element
}

export const XRayLayout: Component<XRayLayoutProps> = (props) => {
  return (
    <div class="h-full flex flex-col">
      {/* Navigation */}
      <nav class="flex items-center gap-4 px-4 py-2 bg-zinc-900 border-b border-zinc-800">
        <A
          href="/xray"
          class="text-lg font-semibold text-zinc-200 hover:text-white"
        >
          X-Ray
        </A>
        <div class="flex gap-2">
          <A
            href="/xray/live"
            class="px-3 py-1 text-sm rounded transition-colors"
            activeClass="bg-zinc-700 text-white"
            inactiveClass="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          >
            Live
          </A>
          <A
            href="/xray/services"
            class="px-3 py-1 text-sm rounded transition-colors"
            activeClass="bg-zinc-700 text-white"
            inactiveClass="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          >
            Services
          </A>
        </div>
        <div class="flex-1" />
        <a
          href="http://localhost:16686"
          target="_blank"
          rel="noopener noreferrer"
          class="text-xs text-zinc-500 hover:text-zinc-300"
        >
          Open in Jaeger →
        </a>
      </nav>

      {/* Content */}
      <div class="flex-1 overflow-hidden">
        {props.children}
      </div>
    </div>
  )
}
