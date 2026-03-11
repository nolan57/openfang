import type { Span } from "@opentelemetry/api"
import { SpanStatusCode, trace } from "@opentelemetry/api"
import { Log } from "../util/log"
import {
  sandboxSpans,
  spanUtils,
  SPAN_CONFIG,
  type SandboxSpanAttributes,
} from "./spans"

const log = Log.create({ service: "skill-sandbox.instrumented" })

export interface SandboxExecutionInput {
  sandboxId: string
  sandboxType: "skill" | "code" | "agent"
  code: string
  resourceLimits: {
    cpu: number
    memory: number
    timeout: number
  }
  securityPolicy: string
  context?: {
    taskId?: string
    sessionId?: string
    skillId?: string
  }
}

export interface SandboxExecutionOutput {
  success: boolean
  exitCode: number
  stdout: string
  stderr: string
  executionTime: number
  securityIntercepted: boolean
  interceptReason?: string
  metrics?: {
    cpuUsage: number
    memoryUsage: number
  }
}

export interface SandboxConfig {
  maxCpuPercent: number
  maxMemoryMB: number
  defaultTimeout: number
  enableSecurityInterception: boolean
}

const DEFAULT_CONFIG: SandboxConfig = {
  maxCpuPercent: 80,
  maxMemoryMB: 512,
  defaultTimeout: 30000,
  enableSecurityInterception: true,
}

const SECURITY_BLOCK_PATTERNS = [
  /process\.exit/,
  /require\s*\(\s*['"]child_process['"]\)/,
  /require\s*\(\s*['"]fs['"]\)\.writeFile/,
  /eval\s*\(/,
  /Function\s*\(/,
  /\bexec\s*\(/,
  /\bspawn\s*\(/,
  /DELETE\s+FROM/i,
  /DROP\s+TABLE/i,
]

export class InstrumentedSkillSandbox {
  private config: SandboxConfig
  private tracer: ReturnType<typeof trace.getTracer>

  constructor(config: Partial<SandboxConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.tracer = trace.getTracer("agent.sandbox.execute")
  }

  async execute(input: SandboxExecutionInput): Promise<SandboxExecutionOutput> {
    const codeHash = this.hashCode(input.code)
    const span = this.tracer.startSpan("agent.sandbox.execute", {
      attributes: {
        "sandbox.id": input.sandboxId,
        "sandbox.type": input.sandboxType,
        "resource.cpu.limit": input.resourceLimits.cpu,
        "resource.memory.limit": input.resourceLimits.memory,
        "resource.timeout.ms": input.resourceLimits.timeout,
        "security.policy": input.securityPolicy,
        "code.hash": codeHash,
        ...(input.context?.taskId && { "context.taskId": input.context.taskId }),
        ...(input.context?.sessionId && { "context.sessionId": input.context.sessionId }),
        ...(input.context?.skillId && { "context.skillId": input.context.skillId }),
      },
    })

    const startTime = Date.now()
    let securityIntercepted = false
    let interceptReason: string | undefined

    try {
      if (this.config.enableSecurityInterception) {
        const interception = this.checkSecurity(input.code)
        if (interception.blocked) {
          securityIntercepted = true
          interceptReason = interception.reason

          sandboxSpans.addSecurityInterception(span, true, interception.reason)
          if (input.code.length > SPAN_CONFIG.MAX_EVENT_PAYLOAD_SIZE) {
            sandboxSpans.addCodeExecutionLarge(span, input.code.slice(0, 500))
          } else {
            sandboxSpans.addCodeExecution(span, input.code.slice(0, 500))
          }

          span.setStatus({ code: SpanStatusCode.ERROR, message: interception.reason })
          span.setAttribute("execution.status", "intercepted")

          return {
            success: false,
            exitCode: -1,
            stdout: "",
            stderr: interception.reason || "Security interception",
            executionTime: Date.now() - startTime,
            securityIntercepted: true,
            ...(interceptReason && { interceptReason }),
          }
        }
      }

      sandboxSpans.addSecurityInterception(span, false)
      if (input.code.length > SPAN_CONFIG.MAX_EVENT_PAYLOAD_SIZE) {
        sandboxSpans.addCodeExecutionLarge(span, input.code)
      } else {
        sandboxSpans.addCodeExecution(span, input.code)
      }

      const { stdout, stderr, exitCode, metrics } = await this.runInSandbox(input)

      sandboxSpans.addStdout(span, stdout)
      sandboxSpans.addStderr(span, stderr)
      sandboxSpans.addExitCode(span, exitCode)
      sandboxSpans.addExecutionMetrics(span, {
        cpuUsage: metrics?.cpuUsage || 0,
        memoryUsage: metrics?.memoryUsage || 0,
        duration: Date.now() - startTime,
      })

      const success = exitCode === 0
      span.setStatus({ code: success ? SpanStatusCode.OK : SpanStatusCode.ERROR })

      log.info("sandbox_execution_completed", {
        sandboxId: input.sandboxId,
        success,
        exitCode,
        executionTime: Date.now() - startTime,
      })

      return {
        success,
        exitCode,
        stdout,
        stderr,
        executionTime: Date.now() - startTime,
        securityIntercepted: false,
        metrics,
      }
    } catch (error) {
      const err = error as Error
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
      span.recordException(err)

      sandboxSpans.addStderr(span, err.message)
      sandboxSpans.addExitCode(span, -1)

      log.error("sandbox_execution_failed", {
        sandboxId: input.sandboxId,
        error: err.message,
      })

      return {
        success: false,
        exitCode: -1,
        stdout: "",
        stderr: err.message,
        executionTime: Date.now() - startTime,
        securityIntercepted: false,
      }
    } finally {
      span.end()
    }
  }

  private checkSecurity(code: string): { blocked: boolean; reason?: string } {
    for (const pattern of SECURITY_BLOCK_PATTERNS) {
      if (pattern.test(code)) {
        return {
          blocked: true,
          reason: `Security policy violation: blocked pattern ${pattern.source}`,
        }
      }
    }
    return { blocked: false }
  }

  private async runInSandbox(
    input: SandboxExecutionInput,
  ): Promise<{
    stdout: string
    stderr: string
    exitCode: number
    metrics: { cpuUsage: number; memoryUsage: number }
  }> {
    await new Promise((resolve) => setTimeout(resolve, 100))

    const isDestructive = input.code.toLowerCase().includes("delete") ||
      input.code.toLowerCase().includes("drop")

    if (isDestructive && input.securityPolicy === "strict") {
      return {
        stdout: "",
        stderr: "Destructive operation blocked by security policy",
        exitCode: 1,
        metrics: { cpuUsage: 0, memoryUsage: 0 },
      }
    }

    return {
      stdout: "Execution completed",
      stderr: "",
      exitCode: 0,
      metrics: {
        cpuUsage: Math.random() * 50,
        memoryUsage: Math.random() * 200,
      },
    }
  }

  private hashCode(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(16)
  }
}

export const skillSandbox = new InstrumentedSkillSandbox()
