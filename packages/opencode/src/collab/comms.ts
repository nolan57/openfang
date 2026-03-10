import type {
  AgentMessage,
  TaskMessage,
  ResultMessage,
  BroadcastMessage,
  MemoryShareMessage,
  QueryMessage,
} from "./types"

type MessageHandler = (msg: AgentMessage) => void

const subscriptions = new Map<string, Set<MessageHandler>>()
const messageQueue: AgentMessage[] = []

export class AgentComms {
  send(message: AgentMessage): void {
    messageQueue.push(message)
    this.deliver(message)
  }

  broadcast(message: BroadcastMessage): void {
    const handlers = subscriptions.get("broadcast") ?? new Set()
    handlers.forEach((handler) => {
      try {
        handler(message)
      } catch (e) {
        console.error("Broadcast handler error:", e)
      }
    })

    if (message.scope === "all") {
      subscriptions.forEach((handlers, agentId) => {
        if (agentId !== message.from) {
          handlers.forEach((handler) => {
            try {
              handler(message)
            } catch (e) {
              console.error(`Handler error for ${agentId}:`, e)
            }
          })
        }
      })
    } else if (typeof message.scope === "string" && message.scope.startsWith("role:")) {
      const role = message.scope.slice(5)
      subscriptions.forEach((handlers, agentId) => {
        if (agentId !== message.from && agentId.startsWith(`role:${role}:`)) {
          handlers.forEach((handler) => handler(message))
        }
      })
    } else if (typeof message.scope === "string" && message.scope.startsWith("type:")) {
      const type = message.scope.slice(5)
      subscriptions.forEach((handlers, agentId) => {
        if (agentId !== message.from && agentId.startsWith(`type:${type}:`)) {
          handlers.forEach((handler) => handler(message))
        }
      })
    } else if (Array.isArray(message.scope)) {
      message.scope.forEach((agentId) => {
        const handlers = subscriptions.get(agentId)
        if (handlers) {
          handlers.forEach((handler) => handler(message))
        }
      })
    }
  }

  subscribe(agentId: string, handler: MessageHandler): () => void {
    if (!subscriptions.has(agentId)) {
      subscriptions.set(agentId, new Set())
    }
    subscriptions.get(agentId)!.add(handler)

    return () => {
      const handlers = subscriptions.get(agentId)
      if (handlers) {
        handlers.delete(handler)
        if (handlers.size === 0) {
          subscriptions.delete(agentId)
        }
      }
    }
  }

  unsubscribe(agentId: string): void {
    subscriptions.delete(agentId)
  }

  private deliver(message: AgentMessage): void {
    if (message.type === "task" || message.type === "result" || message.type === "query") {
      const targetId = "to" in message ? message.to : null
      if (targetId) {
        const handlers = subscriptions.get(targetId)
        if (handlers) {
          handlers.forEach((handler) => {
            try {
              handler(message)
            } catch (e) {
              console.error(`Handler error for ${targetId}:`, e)
            }
          })
        }
      }
    }
  }

  getQueue(): AgentMessage[] {
    return [...messageQueue]
  }

  clearQueue(): void {
    messageQueue.length = 0
  }

  getSubscribers(): string[] {
    return Array.from(subscriptions.keys())
  }
}

export const Comms = new AgentComms()

export function createTaskMessage(
  from: string,
  to: string,
  taskId: string,
  action: string,
  payload: unknown,
  priority?: "low" | "normal" | "high",
): TaskMessage {
  return {
    id: crypto.randomUUID(),
    type: "task",
    from,
    to,
    timestamp: new Date().toISOString(),
    task: {
      id: taskId,
      action,
      payload,
      priority,
    },
  }
}

export function createResultMessage(
  from: string,
  to: string,
  taskId: string,
  success: boolean,
  payload: unknown,
  error?: string,
): ResultMessage {
  return {
    id: crypto.randomUUID(),
    type: "result",
    from,
    to,
    timestamp: new Date().toISOString(),
    taskId,
    success,
    payload,
    error,
  }
}

export function createBroadcastMessage(
  from: string,
  content: string,
  scope: "all" | string | string[],
): BroadcastMessage {
  return {
    id: crypto.randomUUID(),
    type: "broadcast",
    from,
    timestamp: new Date().toISOString(),
    content,
    scope,
  }
}

export function createMemoryShareMessage(
  from: string,
  memories: Array<{ id: string; type: "session" | "evolution" | "project"; content: string }>,
): MemoryShareMessage {
  return {
    id: crypto.randomUUID(),
    type: "memory_share",
    from,
    timestamp: new Date().toISOString(),
    memories,
  }
}

export function createQueryMessage(
  from: string,
  query: string,
  sources: Array<"session" | "evolution" | "project">,
  responseTo?: string,
): QueryMessage {
  return {
    id: crypto.randomUUID(),
    type: "query",
    from,
    timestamp: new Date().toISOString(),
    query,
    sources,
    responseTo,
  }
}
