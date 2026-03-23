import { Registry } from "./registry"
import { Comms, createTaskMessage, createResultMessage, createBroadcastMessage } from "./comms"
import { Memory } from "../memory"
import type { Task, TaskResult, DispatchStrategy, AgentInfo, TaskStatus } from "./types"

const pendingTasks = new Map<string, Task>()
const taskResults = new Map<string, TaskResult>()
const taskTimeouts = new Map<string, NodeJS.Timeout>()
const roundRobinIndex = new Map<string, number>()

export interface MultiAgentDispatch {
  taskId: string
  agentIds: string[]
  results: TaskResult[]
  status: "pending" | "running" | "completed" | "failed"
}

const multiAgentDispatches = new Map<string, MultiAgentDispatch>()

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

  async dispatchMultiple(tasks: Task[], agentIds: string[], strategy?: DispatchStrategy): Promise<string[]> {
    if (tasks.length !== agentIds.length) {
      throw new Error("Number of tasks must match number of agent IDs")
    }

    const dispatchId = crypto.randomUUID()
    multiAgentDispatches.set(dispatchId, {
      taskId: dispatchId,
      agentIds: [],
      results: [],
      status: "running",
    })

    const assignedIds: string[] = []

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]
      const agentId = agentIds[i]

      pendingTasks.set(task.id, task)
      await Registry.updateState(agentId, "busy")

      const message = createTaskMessage("coordinator", agentId, task.id, task.action, task.payload, task.priority)
      Comms.send(message)
      assignedIds.push(agentId)

      if (task.timeout) {
        const timeout = setTimeout(() => {
          this.handleTimeout(task.id, agentId)
        }, task.timeout)
        taskTimeouts.set(task.id, timeout)
      }
    }

    const dispatch = multiAgentDispatches.get(dispatchId)!
    dispatch.agentIds = assignedIds

    return assignedIds
  }

  async dispatchParallel(task: Task, agentCount: number, strategy?: DispatchStrategy): Promise<string> {
    const dispatchId = crypto.randomUUID()
    const availableAgents = await Registry.getAvailableAgents(task.requirements)

    if (availableAgents.length < agentCount) {
      agentCount = availableAgents.length
    }

    const selectedAgents = availableAgents.slice(0, agentCount)
    const subTasks: Task[] = selectedAgents.map((agent, i) => ({
      ...task,
      id: `${task.id}-${i}`,
      payload: {
        ...task.payload,
        _subTaskIndex: i,
        _dispatchId: dispatchId,
      },
    }))

    multiAgentDispatches.set(dispatchId, {
      taskId: dispatchId,
      agentIds: [],
      results: [],
      status: "running",
    })

    const agentIds: string[] = []
    for (let i = 0; i < subTasks.length; i++) {
      const subTask = subTasks[i]
      const agent = selectedAgents[i]

      pendingTasks.set(subTask.id, subTask)
      await Registry.updateState(agent.id, "busy")

      const message = createTaskMessage(
        "coordinator",
        agent.id,
        subTask.id,
        subTask.action,
        subTask.payload,
        subTask.priority,
      )
      Comms.send(message)
      agentIds.push(agent.id)

      if (task.timeout) {
        const timeout = setTimeout(() => {
          this.handleTimeout(subTask.id, agent.id)
        }, task.timeout)
        taskTimeouts.set(subTask.id, timeout)
      }
    }

    const dispatch = multiAgentDispatches.get(dispatchId)!
    dispatch.agentIds = agentIds

    return dispatchId
  }

  async aggregateResults(dispatchId: string): Promise<{
    success: boolean
    results: TaskResult[]
    combinedPayload: unknown
  }> {
    const dispatch = multiAgentDispatches.get(dispatchId)
    if (!dispatch) {
      return { success: false, results: [], combinedPayload: null }
    }

    const allResults = dispatch.agentIds
      .map((agentId) => {
        const subTaskId = `${dispatch.taskId}-${dispatch.agentIds.indexOf(agentId)}`
        return taskResults.get(subTaskId)
      })
      .filter(Boolean) as TaskResult[]

    const success = allResults.length > 0 && allResults.every((r) => r.success)
    const combinedPayload = allResults.map((r) => r.payload)

    await Memory.add({
      memoryType: "session",
      content: `Multi-agent dispatch ${dispatchId} completed. ${allResults.length} results, success: ${success}`,
      metadata: { dispatchId, resultCount: allResults.length, success },
    })

    return { success, results: allResults, combinedPayload }
  }

  async broadcastToAgents(agentIds: string[], content: string, scope: "all" | string[] = "all"): Promise<void> {
    const message = createBroadcastMessage("coordinator", content, scope)
    Comms.send(message)
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

    const dispatchId = result.payload?._dispatchId as string | undefined
    if (dispatchId) {
      const dispatch = multiAgentDispatches.get(dispatchId)
      if (dispatch) {
        dispatch.results.push(result)

        if (dispatch.results.length === dispatch.agentIds.length) {
          dispatch.status = "completed"
        }
      }
    }

    taskResults.set(result.taskId, result)
  }

  async linkCrossMemory(taskId: string, content: string): Promise<void> {
    const [evolution, project] = await Promise.all([
      Memory.search({ query: content, memoryType: "evolution", limit: 5 }),
      Memory.search({ query: content, memoryType: "project", limit: 5 }),
    ])

    const memories = [...evolution, ...project]

    if (memories.length > 0) {
      await Memory.add({
        memoryType: "project",
        content: `Cross-linked from task ${taskId}: ${content.slice(0, 500)}`,
        metadata: {
          taskId,
          linkedFrom: memories.map((m) => m.id),
          linkType: "task_context",
        },
        entityRefs: memories.map((m) => m.id),
      })
    }
  }

  getDispatchStatus(dispatchId: string): MultiAgentDispatch | undefined {
    return multiAgentDispatches.get(dispatchId)
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
