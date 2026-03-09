import { Deployer, type DeploymentTask, type DeploymentStatus } from "./deployer"
import { KnowledgeGraph, type KnowledgeNode } from "./knowledge-graph"
import { Safety } from "./safety"
import { getClient } from "../zeroclaw/client"
import { Log } from "../util/log"

const log = Log.create({ service: "evolution-executor" })

export interface ExecutionResult {
  task_id: string
  success: boolean
  output: string
  duration_ms: number
  rolled_back: boolean
}

export class EvolutionExecutor {
  private deployer: Deployer
  private graph: KnowledgeGraph
  private safety: Safety
  private max_retries: number
  private health_check_url: string

  constructor(options?: { max_retries?: number; health_check_url?: string; tasksDir?: string }) {
    this.deployer = new Deployer(options?.tasksDir ?? "docs/learning/tasks")
    this.graph = new KnowledgeGraph()
    this.safety = new Safety()
    this.max_retries = options?.max_retries ?? 2
    this.health_check_url = options?.health_check_url ?? "http://127.0.0.1:3000/health"
  }

  async executeNext(): Promise<ExecutionResult | null> {
    const pending = await this.deployer.getPendingTasks()

    if (pending.length === 0) {
      log.info("no_pending_tasks")
      return null
    }

    const task = pending[0]
    return this.executeTask(task)
  }

  async executeTask(task: DeploymentTask): Promise<ExecutionResult> {
    const startTime = Date.now()
    const result: ExecutionResult = {
      task_id: task.id,
      success: false,
      output: "",
      duration_ms: 0,
      rolled_back: false,
    }

    try {
      log.info("executing_task", { task_id: task.id, type: task.type })

      await this.deployer.updateTaskStatus(task.id, "executing")

      const state = await this.createPreExecutionSnapshot(task)

      let attempts = 0
      let lastError: string | undefined

      while (attempts < this.max_retries) {
        attempts++

        try {
          const execResult = await this.executeCommands(task.commands)

          if (execResult.success) {
            result.success = true
            result.output = execResult.output
            break
          } else {
            lastError = execResult.output
          }
        } catch (error) {
          lastError = String(error)
        }

        if (attempts < this.max_retries) {
          const delay = Math.pow(2, attempts) * 1000
          log.info("retry_after_delay", { task_id: task.id, delay, attempt: attempts })
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }

      if (!result.success && lastError) {
        log.error("task_execution_failed", { task_id: task.id, error: lastError })

        const shouldRollback = await this.shouldRollback(task, lastError)
        if (shouldRollback) {
          const rolledBack = await this.rollback(state)
          result.rolled_back = rolledBack
          await this.deployer.updateTaskStatus(task.id, "rolled_back", lastError)
        } else {
          await this.deployer.updateTaskStatus(task.id, "failed", lastError)
        }
      } else {
        await this.deployer.updateTaskStatus(task.id, "completed")
      }

      await this.recordExecution(task, result)
    } catch (error) {
      const errorMsg = String(error)
      log.error("task_execution_error", { task_id: task.id, error: errorMsg })
      await this.deployer.updateTaskStatus(task.id, "failed", errorMsg)
      result.output = errorMsg
    }

    result.duration_ms = Date.now() - startTime

    log.info("task_completed", {
      task_id: task.id,
      success: result.success,
      duration_ms: result.duration_ms,
      rolled_back: result.rolled_back,
    })

    return result
  }

  private async executeCommands(commands: string[]): Promise<{ success: boolean; output: string }> {
    const zeroclaw = await getClient()

    if (!zeroclaw) {
      return { success: false, output: "ZeroClaw not available" }
    }

    const command = commands.join(" && ")

    try {
      const result = await zeroclaw.executeTool({
        name: "shell",
        args: { command },
        securityPolicy: "supervised",
      })

      return {
        success: result.exitCode === 0,
        output: result.output,
      }
    } catch (error) {
      return { success: false, output: String(error) }
    }
  }

  private async createPreExecutionSnapshot(task: DeploymentTask): Promise<string> {
    const currentState = {
      skills: [] as string[],
      config: {} as Record<string, unknown>,
      memories: [] as string[],
    }

    const skills = await this.graph.findNodesByType("skill")
    currentState.skills = skills.map((s) => s.entity_id)

    return await this.safety.createGoldenSnapshot(currentState)
  }

  private async shouldRollback(task: DeploymentTask, error: string): Promise<boolean> {
    if (task.type === "code_change" && task.changes.files.length > 5) {
      return true
    }

    if (error.includes("build failed") || error.includes("syntax error")) {
      return true
    }

    return false
  }

  private async rollback(snapshotId: string): Promise<boolean> {
    const state = await this.safety.rollbackToSafeState()
    if (state) {
      log.info("rollback_successful", { snapshot_id: snapshotId })
      return true
    }
    return false
  }

  private async recordExecution(task: DeploymentTask, result: ExecutionResult): Promise<void> {
    await this.graph.addNode({
      type: "agenda",
      entity_type: "execution",
      entity_id: task.id,
      title: task.title,
      content: `Executed at ${new Date().toISOString()}, success: ${result.success}`,
      metadata: {
        success: result.success,
        duration_ms: result.duration_ms,
        rolled_back: result.rolled_back,
        task_type: task.type,
      },
    })
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(this.health_check_url, { signal: AbortSignal.timeout(5000) })
      return response.ok
    } catch {
      return false
    }
  }

  async executeAll(): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = []

    while (true) {
      const result = await this.executeNext()
      if (!result) break
      results.push(result)

      if (!result.success && result.rolled_back) {
        log.warn("stopping_execution_due_to_rollback")
        break
      }
    }

    return results
  }
}
