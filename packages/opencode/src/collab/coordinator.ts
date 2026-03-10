import { Registry } from "./registry"
import { Comms, createTaskMessage, createResultMessage } from "./comms"
import type { Task, TaskResult, DispatchStrategy, AgentInfo, TaskStatus } from "./types"

const pendingTasks = new Map<string, Task>()
const taskResults = new Map<string, TaskResult>()
const taskTimeouts = new Map<string, NodeJS.Timeout>()
const roundRobinIndex = new Map<string, number>()

export class TaskCoordinator {
  private defaultStrategy: DispatchStrategy = "capability_based"

  async dispatch(task: Task, strategy?: DispatchStrategy): Promise<string> {
    const dispatchStrategy = strategy ?? this.defaultStrategy
    const agentId = await this.selectAgent(task, dispatchStrategy)

    if (!agentId) {
      throw new Error("No available agent found")
    }

    pendingTasks.set(task.id, task)
    await Registry.updateState(agentId, "busy")

    const message = createTaskMessage("coordinator", agentId, task.id, task.action, task.payload, task.priority)
    Comms.send(message)

    if (task.timeout) {
      const timeout = setTimeout(() => {
        this.handleTimeout(task.id, agentId)
      }, task.timeout)
      taskTimeouts.set(task.id, timeout)
    }

    return agentId
  }

  async wait(taskId: string, timeout: number): Promise<TaskResult> {
    const start = Date.now()

    while (Date.now() - start < timeout) {
      const result = taskResults.get(taskId)
      if (result) {
        return result
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    throw new Error(`Task ${taskId} timed out after ${timeout}ms`)
  }

  async dispatchBatch(tasks: Task[], strategy?: DispatchStrategy): Promise<string[]> {
    const agentIds: string[] = []

    for (const task of tasks) {
      const agentId = await this.dispatch(task, strategy)
      agentIds.push(agentId)
    }

    return agentIds
  }

  async cancel(taskId: string): Promise<void> {
    const task = pendingTasks.get(taskId)
    if (task) {
      pendingTasks.delete(taskId)
      taskResults.set(taskId, {
        taskId,
        agentId: "",
        success: false,
        payload: null,
        duration: 0,
        error: "Task cancelled",
      })

      const timeout = taskTimeouts.get(taskId)
      if (timeout) {
        clearTimeout(timeout)
        taskTimeouts.delete(taskId)
      }
    }
  }

  async status(taskId: string): Promise<{
    state: TaskStatus
    agentId?: string
    result?: TaskResult
  }> {
    const task = pendingTasks.get(taskId)
    const result = taskResults.get(taskId)

    if (result) {
      return { state: "completed", result }
    }

    if (task) {
      return { state: "pending", agentId: "" }
    }

    return { state: "cancelled" }
  }

  handleTaskResult(result: TaskResult): void {
    const task = pendingTasks.get(result.taskId)
    if (task) {
      pendingTasks.delete(result.taskId)

      const timeout = taskTimeouts.get(result.taskId)
      if (timeout) {
        clearTimeout(timeout)
        taskTimeouts.delete(result.taskId)
      }
    }

    taskResults.set(result.taskId, result)
  }

  private async selectAgent(task: Task, strategy: DispatchStrategy): Promise<string | null> {
    const availableAgents = await Registry.getAvailableAgents(task.requirements)

    if (availableAgents.length === 0) {
      return null
    }

    switch (strategy) {
      case "round_robin":
        return this.roundRobin(task.requirements, availableAgents)
      case "capability_based":
        return this.capabilityBased(task.requirements, availableAgents)
      case "load_balanced":
        return this.loadBalanced(availableAgents)
      default:
        return availableAgents[0].id
    }
  }

  private roundRobin(requirements: string[], agents: AgentInfo[]): string {
    const key = requirements.sort().join(",")
    const current = roundRobinIndex.get(key) ?? 0
    roundRobinIndex.set(key, (current + 1) % agents.length)
    return agents[current].id
  }

  private capabilityBased(requirements: string[], agents: AgentInfo[]): string {
    if (requirements.length === 0) {
      return agents[0].id
    }

    const scored = agents.map((agent) => {
      const matchCount = requirements.filter((req) => agent.capabilities.includes(req)).length
      return { agent, score: matchCount }
    })

    scored.sort((a, b) => b.score - a.score)
    return scored[0].agent.id
  }

  private loadBalanced(agents: AgentInfo[]): string {
    return agents[0].id
  }

  private handleTimeout(taskId: string, agentId: string): void {
    taskResults.set(taskId, {
      taskId,
      agentId,
      success: false,
      payload: null,
      duration: 0,
      error: "Task timed out",
    })
    pendingTasks.delete(taskId)
    taskTimeouts.delete(taskId)
  }
}

export const Coordinator = new TaskCoordinator()
