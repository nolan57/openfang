import { Coordinator as BaseCoordinator, TaskCoordinator } from "./coordinator"
import type { Task, TaskResult, DispatchStrategy } from "./types"
import { isOpenFangInitialized, dispatchToOpenFang } from "../integration/config"
import { Log } from "../util/log"

const log = Log.create({ service: "hybrid-coordinator" })

export class HybridTaskCoordinator extends TaskCoordinator {
  private useOpenFangForHybridTasks = true

  override async dispatch(task: Task, strategy?: DispatchStrategy): Promise<string> {
    // Check if task should be dispatched to OpenFang
    if (this.shouldUseOpenFang(task)) {
      try {
        log.debug("Dispatching task to OpenFang", { taskId: task.id, action: task.action })
        const agentId = await dispatchToOpenFang(task, strategy)
        log.debug("Task dispatched to OpenFang", { taskId: task.id, agentId })
        return agentId
      } catch (error) {
        log.error("OpenFang dispatch failed, falling back to native coordinator", {
          taskId: task.id,
          error: error instanceof Error ? error.message : String(error),
        })
        // Fall through to native dispatcher
      }
    }

    // Use native OpenCode coordinator
    log.debug("Dispatching task to native coordinator", { taskId: task.id, action: task.action })
    return super.dispatch(task, strategy)
  }

  private shouldUseOpenFang(task: Task): boolean {
    if (!this.useOpenFangForHybridTasks) {
      return false
    }

    if (!isOpenFangInitialized()) {
      return false
    }

    // Check if task explicitly requests OpenFang
    if (task.payload?.useOpenFang === true) {
      return true
    }

    // Check if task requires capabilities that OpenFang provides
    const openFangCapabilities = ["web_search", "web_fetch", "memory_store", "memory_recall", "event_publish"]
    if (task.requirements?.some((req) => openFangCapabilities.some((cap) => req.includes(cap)))) {
      return true
    }

    // Check if action keywords suggest OpenFang Hand
    const handKeywords = ["research", "collect", "monitor", "browse", "navigate", "sync", "vault"]
    const actionLower = task.action.toLowerCase()
    if (handKeywords.some((keyword) => actionLower.includes(keyword))) {
      return true
    }

    return false
  }

  enableOpenFangIntegration(): void {
    this.useOpenFangForHybridTasks = true
    log.info("OpenFang integration enabled for hybrid task dispatch")
  }

  disableOpenFangIntegration(): void {
    this.useOpenFangForHybridTasks = false
    log.info("OpenFang integration disabled for hybrid task dispatch")
  }
}

// Create hybrid coordinator instance
export const HybridCoordinator = new HybridTaskCoordinator()

// Export original for backwards compatibility
export const Coordinator = BaseCoordinator
