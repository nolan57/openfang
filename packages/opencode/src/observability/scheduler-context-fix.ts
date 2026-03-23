import { trace, context, propagation, SpanStatusCode } from "@opentelemetry/api"
import { traceUtils } from "./init"

export interface SchedulerTaskContext {
  taskId: string
  parentTraceId?: string
  parentSpanId?: string
  taskType: "refactor" | "skill-generation" | "memory-consolidation"
}

export class SchedulerContextManager {
  private static instance: SchedulerContextManager

  static getInstance(): SchedulerContextManager {
    if (!SchedulerContextManager.instance) {
      SchedulerContextManager.instance = new SchedulerContextManager()
    }
    return SchedulerContextManager.instance
  }

  captureCurrentContext(): Record<string, string> {
    return traceUtils.injectContext()
  }

  extractContext(carrier: Record<string, string>) {
    return traceUtils.extractContext(carrier)
  }

  scheduleBackgroundTask<T>(
    taskName: string,
    taskContext: SchedulerTaskContext,
    taskFn: (ctx: SchedulerTaskContext) => Promise<T>,
  ): Promise<T> {
    const carrier = this.captureCurrentContext()

    return new Promise((resolve, reject) => {
      setImmediate(async () => {
        try {
          const result = await traceUtils.runWithContext(async () => {
            return traceUtils.startBackgroundTask(`scheduler.${taskName}`, async (span) => {
              span.setAttribute("scheduler.task_id", taskContext.taskId)
              span.setAttribute("scheduler.task_type", taskContext.taskType)
              if (taskContext.parentTraceId) {
                span.setAttribute("scheduler.parent_trace_id", taskContext.parentTraceId)
              }
              if (taskContext.parentSpanId) {
                span.setAttribute("scheduler.parent_span_id", taskContext.parentSpanId)
              }

              span.addEvent("scheduler.task.started", {
                taskId: taskContext.taskId,
                taskType: taskContext.taskType,
              })

              try {
                const result = await taskFn(taskContext)
                span.addEvent("scheduler.task.completed", {
                  taskId: taskContext.taskId,
                })
                return result
              } catch (error) {
                span.addEvent("scheduler.task.failed", {
                  taskId: taskContext.taskId,
                  error: String(error),
                })
                throw error
              }
            })
          })
          resolve(result)
        } catch (error) {
          reject(error)
        }
      })
    })
  }

  scheduleDelayedTask<T>(
    taskName: string,
    taskContext: SchedulerTaskContext,
    delayMs: number,
    taskFn: (ctx: SchedulerTaskContext) => Promise<T>,
  ): Promise<T> {
    const carrier = this.captureCurrentContext()

    return new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          const result = await traceUtils.runWithTimeoutContext(async () => {
            return traceUtils.startBackgroundTask(`scheduler.${taskName}.delayed`, async (span) => {
              span.setAttribute("scheduler.task_id", taskContext.taskId)
              span.setAttribute("scheduler.task_type", taskContext.taskType)
              span.setAttribute("scheduler.delay_ms", delayMs)
              return taskFn(taskContext)
            })
          }, 60000)
          resolve(result)
        } catch (error) {
          reject(error)
        }
      }, delayMs)
    })
  }

  bindEventEmitterCallback<T extends (...args: unknown[]) => void>(fn: T): T {
    return traceUtils.bindCallback(fn)
  }

  wrapPromise<T>(promise: Promise<T>): Promise<T> {
    return traceUtils.bindPromise(promise)
  }
}

export function createSchedulerMiddleware() {
  const manager = SchedulerContextManager.getInstance()

  return {
    captureContext: () => manager.captureCurrentContext(),

    extractContext: (carrier: Record<string, string>) => manager.extractContext(carrier),

    scheduleTask<T>(
      taskName: string,
      taskContext: SchedulerTaskContext,
      taskFn: (ctx: SchedulerTaskContext) => Promise<T>,
    ): Promise<T> {
      return manager.scheduleBackgroundTask(taskName, taskContext, taskFn)
    },

    scheduleDelayed<T>(
      taskName: string,
      taskContext: SchedulerTaskContext,
      delayMs: number,
      taskFn: (ctx: SchedulerTaskContext) => Promise<T>,
    ): Promise<T> {
      return manager.scheduleDelayedTask(taskName, taskContext, delayMs, taskFn)
    },
  }
}

export function createChildTraceFromParent(
  parentTaskId: string,
  operationName: string,
): { carrier: Record<string, string>; parentSpanId?: string } {
  const activeSpan = trace.getSpan(context.active())
  const parentSpanId = activeSpan?.spanContext().spanId
  const parentTraceId = activeSpan?.spanContext().traceId

  const carrier = traceUtils.injectContext()

  return {
    carrier,
    parentSpanId,
  }
}

export async function executeWithTracedBackgroundTask<T>(
  taskName: string,
  taskFn: () => Promise<T>,
): Promise<T> {
  const activeSpan = trace.getSpan(context.active())
  const parentSpanId = activeSpan?.spanContext().spanId
  const parentTraceId = activeSpan?.spanContext().traceId

  return traceUtils.startBackgroundTask(taskName, async (span) => {
    if (parentSpanId) {
      span.setAttribute("background.parent_span_id", parentSpanId)
    }
    if (parentTraceId) {
      span.setAttribute("background.parent_trace_id", parentTraceId)
    }

    try {
      const result = await taskFn()
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
      span.recordException(error as Error)
      throw error
    }
  })
}
