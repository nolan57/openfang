import { Component, For, Show, createMemo } from "solid-js"
import type { FlowNode, FlowEdge, NodeType } from "../types"

interface DataFlowDiagramProps {
  nodes: FlowNode[]
  edges: FlowEdge[]
  onNodeClick?: (node: FlowNode) => void
}

const NODE_COLORS: Record<NodeType, string> = {
  prompt: "#3b82f6",
  llm: "#8b5cf6",
  embedding: "#06b6d4",
  memory: "#ec4899",
  critic: "#f59e0b",
  sandbox: "#ef4444",
  refactor: "#10b981",
  scheduler: "#6b7280",
  agent: "#1f2937",
  http: "#64748b",
  unknown: "#9ca3af",
}

const NODE_ICONS: Record<NodeType, string> = {
  prompt: "📝",
  llm: "🤖",
  embedding: "🔢",
  memory: "🧠",
  critic: "🔍",
  sandbox: "🛡️",
  refactor: "🔧",
  scheduler: "⏰",
  agent: "⚡",
  http: "🌐",
  unknown: "❓",
}

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

const NODE_WIDTH = 180
const NODE_HEIGHT = 60

export const DataFlowDiagram: Component<DataFlowDiagramProps> = (props) => {
  const viewBox = createMemo(() => {
    if (props.nodes.length === 0) return "0 0 800 400"

    const padding = 50
    const maxX = Math.max(...props.nodes.map((n) => n.position.x)) + NODE_WIDTH + padding
    const maxY = Math.max(...props.nodes.map((n) => n.position.y)) + NODE_HEIGHT + padding

    return `0 0 ${Math.max(maxX, 800)} ${Math.max(maxY, 400)}`
  })

  const getNodeCenter = (node: FlowNode) => ({
    x: node.position.x + NODE_WIDTH / 2,
    y: node.position.y + NODE_HEIGHT / 2,
  })

  const nodeMap = createMemo(() => {
    const map = new Map<string, FlowNode>()
    props.nodes.forEach((n) => map.set(n.id, n))
    return map
  })

  return (
    <div class="w-full h-full overflow-auto bg-zinc-950">
      <Show
        when={props.nodes.length > 0}
        fallback={
          <div class="h-full flex items-center justify-center text-zinc-500">
            Select a trace to view the flow diagram
          </div>
        }
      >
        <svg
          width="100%"
          height="100%"
          viewBox={viewBox()}
          class="min-w-[800px] min-h-[400px]"
        >
          {/* Edges */}
          <For each={props.edges}>
            {(edge) => {
              const source = nodeMap().get(edge.source)
              const target = nodeMap().get(edge.target)
              if (!source || !target) return null

              const sourceCenter = getNodeCenter(source)
              const targetCenter = getNodeCenter(target)

              return (
                <g>
                  <line
                    x1={sourceCenter.x}
                    y1={sourceCenter.y}
                    x2={targetCenter.x}
                    y2={targetCenter.y}
                    stroke={edge.animated ? "#6366f1" : "#4b5563"}
                    stroke-width="2"
                    stroke-dasharray={edge.animated ? "5,5" : "none"}
                    class={edge.animated ? "animate-pulse" : ""}
                  />
                  <polygon
                    points={`${targetCenter.x - 8},${targetCenter.y - 4} ${targetCenter.x},${targetCenter.y} ${targetCenter.x - 8},${targetCenter.y + 4}`}
                    fill={edge.animated ? "#6366f1" : "#4b5563"}
                    transform={`rotate(${Math.atan2(targetCenter.y - sourceCenter.y, targetCenter.x - sourceCenter.x) * (180 / Math.PI)}, ${targetCenter.x}, ${targetCenter.y})`}
                  />
                </g>
              )
            }}
          </For>

          {/* Nodes */}
          <For each={props.nodes}>
            {(node) => {
              const color = NODE_COLORS[node.type] || NODE_COLORS.unknown
              const icon = NODE_ICONS[node.type] || NODE_ICONS.unknown

              return (
                <g
                  class="cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => props.onNodeClick?.(node)}
                >
                  {/* Node background */}
                  <rect
                    x={node.position.x}
                    y={node.position.y}
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx="8"
                    fill={color}
                    classList={{
                      "stroke-2 stroke-red-500": node.status === "error",
                      "stroke-2 stroke-yellow-500": node.status === "running",
                    }}
                  />

                  {/* Icon and label */}
                  <text
                    x={node.position.x + 12}
                    y={node.position.y + 24}
                    fill="white"
                    font-size="14"
                    dominant-baseline="middle"
                  >
                    {icon}
                  </text>
                  <text
                    x={node.position.x + 32}
                    y={node.position.y + 24}
                    fill="white"
                    font-size="12"
                    font-weight="500"
                    dominant-baseline="middle"
                    class="truncate"
                  >
                    {node.label.length > 18 ? node.label.slice(0, 16) + "..." : node.label}
                  </text>

                  {/* Duration */}
                  <text
                    x={node.position.x + 12}
                    y={node.position.y + 44}
                    fill="rgba(255,255,255,0.7)"
                    font-size="10"
                    dominant-baseline="middle"
                  >
                    {formatDuration(node.duration)}
                  </text>

                  {/* Token info for LLM nodes */}
                  <Show when={node.type === "llm" && node.details.totalTokens}>
                    <text
                      x={node.position.x + 80}
                      y={node.position.y + 44}
                      fill="rgba(255,255,255,0.7)"
                      font-size="10"
                      dominant-baseline="middle"
                    >
                      {String(node.details.totalTokens)} tokens
                    </text>
                  </Show>
                </g>
              )
            }}
          </For>
        </svg>
      </Show>
    </div>
  )
}
