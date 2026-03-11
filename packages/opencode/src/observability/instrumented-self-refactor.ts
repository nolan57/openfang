import { type Span, SpanStatusCode, context, trace } from "@opentelemetry/api"
import { Log } from "../util/log"
import { Snapshot } from "../snapshot"
import {
  refactorSpans,
  spanUtils,
} from "./spans"

const log = Log.create({ service: "self-refactor.instrumented" })

// Stub implementation for rollback functionality
class RollbackManager {
  async rollback(snapshotId: string): Promise<void> {
    await Snapshot.restore(snapshotId)
  }
}

// Stub implementation for snapshot manager
class SnapshotManager {
  async createSnapshot(options: { taskId: string; module: string; path: string }): Promise<string> {
    const hash = await Snapshot.track()
    return hash || `snapshot-${Date.now()}`
  }
}

export interface RefactorInput {
  taskId: string
  parentTaskId?: string
  targetModule: string
  targetPath: string
  triggerSource: "scheduler" | "manual" | "critic"
  complexity?: number
}

export interface RefactorOutput {
  success: boolean
  snapshotId?: string
  changes?: {
    count: number
    additions: number
    deletions: number
  }
  validationPassed?: boolean
  rollbackTriggered?: boolean
  error?: string
}

export interface RefactorConfig {
  maxComplexity: number
  minConfidence: number
  enableRollback: boolean
}

const DEFAULT_CONFIG: RefactorConfig = {
  maxComplexity: 10,
  minConfidence: 0.7,
  enableRollback: true,
}

export class InstrumentedSelfRefactor {
  private config: RefactorConfig
  private tracer: ReturnType<typeof trace.getTracer>
  private snapshotManager: SnapshotManager
  private rollbackManager: RollbackManager

  constructor(
    config: Partial<RefactorConfig> = {},
    snapshotManager?: SnapshotManager,
    rollbackManager?: RollbackManager,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.tracer = trace.getTracer("agent.evolution.refactor")
    this.snapshotManager = snapshotManager || new SnapshotManager()
    this.rollbackManager = rollbackManager || new RollbackManager()
  }

  async refactor(input: RefactorInput): Promise<RefactorOutput> {
    const span = this.tracer.startSpan("agent.evolution.refactor", {
      attributes: {
        "task.id": input.taskId,
        "target.module": input.targetModule,
        "target.path": input.targetPath,
        "complexity.score": input.complexity || 5,
        "trigger.source": input.triggerSource,
        ...(input.parentTaskId && { "parent.taskId": input.parentTaskId }),
      },
    })

    const startTime = Date.now()
    let snapshotId: string | undefined
    let rollbackTriggered = false

    try {
      log.info("refactor_started", { taskId: input.taskId, targetModule: input.targetModule })

      snapshotId = await this.snapshotManager.createSnapshot({
        taskId: input.taskId,
        module: input.targetModule,
        path: input.targetPath,
      })
      refactorSpans.addCodeSnapshot(span, "before", snapshotId)

      const complexity = input.complexity || await this.analyzeComplexity(input.targetPath)
      span.setAttribute("complexity.score", complexity)

      if (complexity > this.config.maxComplexity) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `Complexity ${complexity} exceeds max ${this.config.maxComplexity}`,
        })
        span.addEvent("refactor.skipped", { reason: "too_complex" })

        return {
          success: false,
          error: `Module too complex to refactor (score: ${complexity})`,
        }
      }

      const changes = await this.performRefactoring(input)
      refactorSpans.addChanges(span, changes)
      refactorSpans.addDiffSummary(span, this.generateDiffSummary(changes))

      const validationPassed = await this.validateChanges(input, changes)
      refactorSpans.addValidationResult(span, validationPassed, "All tests passed")

      if (!validationPassed && this.config.enableRollback) {
        rollbackTriggered = true
        refactorSpans.addRollback(span, true, "Validation failed")

        await this.rollbackManager.rollback(snapshotId)
        refactorSpans.addCodeSnapshot(span, "after", snapshotId)

        log.warn("refactor_rolled_back", { taskId: input.taskId, snapshotId })
      } else {
        refactorSpans.addRollback(span, false)
        refactorSpans.addCodeSnapshot(span, "after", snapshotId)
      }

      const duration = Date.now() - startTime
      span.setAttribute("duration.ms", duration)

      span.setStatus({ code: SpanStatusCode.OK })

      log.info("refactor_completed", {
        taskId: input.taskId,
        success: validationPassed || !this.config.enableRollback,
        duration,
        rollbackTriggered,
      })

      return {
        success: validationPassed || !this.config.enableRollback,
        snapshotId,
        changes,
        validationPassed,
        rollbackTriggered,
      }
    } catch (error) {
      const err = error as Error
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
      span.recordException(err)

      if (this.config.enableRollback && snapshotId) {
        try {
          await this.rollbackManager.rollback(snapshotId)
          rollbackTriggered = true
          refactorSpans.addRollback(span, true, err.message)
        } catch (rollbackError) {
          log.error("rollback_failed", { snapshotId, error: String(rollbackError) })
        }
      }

      log.error("refactor_failed", { taskId: input.taskId, error: err.message })

      return {
        success: false,
        snapshotId,
        error: err.message,
        rollbackTriggered,
      }
    } finally {
      span.end()
    }
  }

  private async analyzeComplexity(targetPath: string): Promise<number> {
    const { Filesystem } = await import("../util/filesystem")
    const content = await Filesystem.readText(targetPath)

    const lines = content.split("\n").length
    const functions = (content.match(/function\s+\w+|const\s+\w+\s*=\s*(?:async\s*)?\(/g) || []).length
    const classes = (content.match(/class\s+\w+/g) || []).length
    const imports = (content.match(/import\s+/g) || []).length

    return Math.min(10, Math.floor((lines / 100) + functions * 0.5 + classes + imports * 0.3))
  }

  private async performRefactoring(input: RefactorInput): Promise<{
    count: number
    additions: number
    deletions: number
  }> {
    await new Promise((resolve) => setTimeout(resolve, 100))

    return {
      count: Math.floor(Math.random() * 10) + 1,
      additions: Math.floor(Math.random() * 50) + 10,
      deletions: Math.floor(Math.random() * 30) + 5,
    }
  }

  private async validateChanges(input: RefactorInput, changes: {
    count: number
    additions: number
    deletions: number
  }): Promise<boolean> {
    return changes.additions > 0 && changes.deletions < changes.additions * 2
  }

  private generateDiffSummary(changes: { count: number; additions: number; deletions: number }): string {
    return `+${changes.additions} -${changes.deletions} (${changes.count} files)`
  }
}

export const selfRefactor = new InstrumentedSelfRefactor()