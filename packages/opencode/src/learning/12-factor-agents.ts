import { Log } from "../util/log"

const log = Log.create({ service: "12-factor-agents" })

export const TWELVE_FACTOR_AGENTS = {
  FACTOR_1: {
    name: "Natural Language to Tool Calls",
    description: "LLM outputs decisions as structured tool calls, not direct execution",
    implementation: "Use typed tool definitions, validate outputs before execution",
  },
  FACTOR_2: {
    name: "Own Your Prompts",
    description: "Version control prompts separately, treat them as code",
    implementation: "Store prompts in dedicated files, use template variables",
  },
  FACTOR_3: {
    name: "Own Your Context Window",
    description: "Manage what enters context - traces, errors, summaries",
    implementation: "Compress tool responses, summarize conversations, use context budget",
  },
  FACTOR_4: {
    name: "Tools Are Just Structured Outputs",
    description: "Tools are typed JSON, validate and sanitize all inputs",
    implementation: "Schema validation, type-safe tool definitions",
  },
  FACTOR_5: {
    name: "Unify Execution and Business State",
    description: "Persist state so restarts are idempotent",
    implementation: "Store execution state with business data, enable resume",
  },
  FACTOR_6: {
    name: "Launch/Pause/Resume with Simple APIs",
    description: "Expose endpoints for agent lifecycle control",
    implementation: "Start, pause, resume, checkpoint endpoints",
  },
  FACTOR_7: {
    name: "Contact Humans with Tool Calls",
    description: "Human-in-the-loop as first-class operation",
    implementation: "Define human handoff as tool, route high-stakes decisions",
  },
  FACTOR_8: {
    name: "Own Your Control Flow",
    description: "Deterministic control flow with LLM decision points",
    implementation: "Define workflow steps, use LLM only at decision points",
  },
  FACTOR_9: {
    name: "Compact Errors into Context Window",
    description: "Summarize errors to fit in context for self-healing",
    implementation: "Error compression, retry context, failure summaries",
  },
  FACTOR_10: {
    name: "Small, Focused Agents",
    description: "Build agents with clear interfaces, compose as needed",
    implementation: "Single-responsibility agents, clear input/output contracts",
  },
  FACTOR_11: {
    name: "Trigger from Anywhere",
    description: "Support webhook, scheduler, API triggers",
    implementation: "Event-driven architecture, stateless agent functions",
  },
  FACTOR_12: {
    name: "Stateless Reducer",
    description: "Agents as pure functions: input state → output state",
    implementation: "No side effects, deterministic transformations",
  },
} as const

export type FactorKey = keyof typeof TWELVE_FACTOR_AGENTS

export class TwelveFactorAgents {
  private enabledFactors: Set<FactorKey>

  constructor(factors: FactorKey[] = []) {
    this.enabledFactors = new Set(factors)
    if (factors.length === 0) {
      this.enabledFactors = new Set(Object.keys(TWELVE_FACTOR_AGENTS) as FactorKey[])
    }
  }

  isEnabled(factor: FactorKey): boolean {
    return this.enabledFactors.has(factor)
  }

  getFactor(factor: FactorKey) {
    return TWELVE_FACTOR_AGENTS[factor]
  }

  getAllEnabledFactors() {
    return Array.from(this.enabledFactors).map((f) => ({
      key: f,
      ...TWELVE_FACTOR_AGENTS[f],
    }))
  }

  validateContextBudget(tokens: number, maxTokens: number): { valid: boolean; compressionNeeded: number } {
    const usage = tokens / maxTokens
    if (usage > 0.9) {
      return { valid: false, compressionNeeded: Math.ceil(tokens - maxTokens * 0.7) }
    }
    if (usage > 0.7) {
      return { valid: true, compressionNeeded: Math.ceil(tokens - maxTokens * 0.5) }
    }
    return { valid: true, compressionNeeded: 0 }
  }

  compressToolResponse(response: string, maxTokens: number = 500): string {
    const lines = response.split("\n")
    if (lines.length <= maxTokens / 10) {
      return response
    }
    const kept = lines.slice(0, Math.floor(lines.length * 0.3))
    const summary = `[... ${lines.length - kept.length} lines summarized ...]`
    const last = lines.slice(-Math.floor(lines.length * 0.2))
    return [...kept, summary, ...last].join("\n")
  }

  shouldContactHuman(risk: string, threshold: string = "high"): boolean {
    const riskLevels = ["low", "medium", "high", "critical"]
    const riskIndex = riskLevels.indexOf(risk)
    const thresholdIndex = riskLevels.indexOf(threshold)
    return riskIndex >= thresholdIndex
  }
}

export function createTwelveFactorAgents(config?: { factors?: FactorKey[] }): TwelveFactorAgents {
  return new TwelveFactorAgents(config?.factors)
}
