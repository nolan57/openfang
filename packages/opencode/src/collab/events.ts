import type { AgentInfo, Task, TaskResult } from "./types"

export type AgentEventType =
  | "agent:registered"
  | "agent:unregistered"
  | "agent:state_changed"
  | "task:dispatched"
  | "task:started"
  | "task:completed"
  | "task:failed"
  | "task:cancelled"
  | "task:result_received"
  | "message:sent"
  | "message:received"
  | "memory:linked"

export interface AgentEvent {
  type: AgentEventType
  timestamp: string
  agentId?: string
  taskId?: string
  payload: unknown
}

type EventHandler = (event: AgentEvent) => void | Promise<void>

class AgentEventEmitter {
  private handlers = new Map<AgentEventType, Set<EventHandler>>()

  on(type: AgentEventType, handler: EventHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(handler)
  }

  off(type: AgentEventType, handler: EventHandler): void {
    this.handlers.get(type)?.delete(handler)
  }

  async emit(event: AgentEvent): Promise<void> {
    const handlers = this.handlers.get(event.type)
    if (handlers) {
      const promises = [...handlers].map((h) => {
        try {
          const result = h(event)
          return result instanceof Promise ? result : Promise.resolve(result)
        } catch (e) {
          console.error(e)
        }
      })
      await Promise.all(promises)
    }
  }

  onMultiple(types: AgentEventType[], handler: EventHandler): void {
    for (const type of types) {
      this.on(type, handler)
    }
  }
}

export const AgentEvents = new AgentEventEmitter()

export async function emitAgentEvent(
  type: AgentEventType,
  payload: unknown,
  agentId?: string,
  taskId?: string,
): Promise<void> {
  await AgentEvents.emit({
    type,
    timestamp: new Date().toISOString(),
    agentId,
    taskId,
    payload,
  })
}

export async function notifyAgentRegistered(agent: AgentInfo): Promise<void> {
  await emitAgentEvent("agent:registered", agent, agent.id)
}

export async function notifyAgentStateChange(agentId: string, oldState: string, newState: string): Promise<void> {
  await emitAgentEvent("agent:state_changed", { oldState, newState }, agentId)
}

export async function notifyTaskDispatched(task: Task, agentId: string): Promise<void> {
  await emitAgentEvent("task:dispatched", task, agentId, task.id)
}

export async function notifyTaskCompleted(taskId: string, result: TaskResult): Promise<void> {
  await emitAgentEvent("task:completed", result, result.agentId, taskId)
}

export async function notifyTaskFailed(taskId: string, error: string): Promise<void> {
  await emitAgentEvent("task:failed", { error }, undefined, taskId)
}

export async function notifyMemoryLinked(taskId: string, linkedIds: string[]): Promise<void> {
  await emitAgentEvent("memory:linked", { linkedIds }, undefined, taskId)
}
