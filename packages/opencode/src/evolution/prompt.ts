import type { MessageV2 } from "@/session/message-v2"
import { getPromptEvolutions } from "./store"

const MESSAGE_LIMIT = 10

function buildReflectionPrompt(input: { task: string; success: boolean; issues: string[]; messages: string }): string {
  return `You are an expert at analyzing agent interactions and optimizing system prompts.

Analyze the following session interaction and provide improved system prompts if needed.

Session Summary:
- Task: ${input.task}
- Success: ${input.success ? "Yes" : "No"}
- Issues: ${input.issues.join(", ") || "None"}

Recent Messages:
${input.messages}

Based on this analysis:
1. What prompt improvements would help the agent perform better?
2. What specific instructions were missing?
3. What worked well that should be emphasized?

Respond in JSON format:
{
  "shouldOptimize": boolean,
  "optimizedPrompt": string (if shouldOptimize is true),
  "reason": string (explain why this optimization would help)
}`
}

export interface ReflectionInput {
  task: string
  success: boolean
  issues: string[]
  messages: MessageV2.WithParts[]
}

export async function reflectOnSession(
  projectDir: string,
  sessionID: string,
  input: ReflectionInput,
): Promise<{ shouldOptimize: boolean; optimizedPrompt?: string; reason?: string }> {
  const messageTexts = input.messages
    .slice(-MESSAGE_LIMIT)
    .map((m) => `[${m.info.role}]: ${m.parts.map((p) => ("text" in p ? p.text : "")).join(" ")}`)
    .join("\n\n")

  const prompt = buildReflectionPrompt({
    task: input.task,
    success: input.success,
    issues: input.issues,
    messages: messageTexts,
  })

  return {
    shouldOptimize: false,
    reason: "Self-reflection disabled for initial implementation",
  }
}

export async function suggestPromptOptimization(
  projectDir: string,
  agentName: string,
  currentPrompt: string,
  taskContext: string,
): Promise<string | null> {
  try {
    const evolutions = await getPromptEvolutions(projectDir)

    const relevant = evolutions.filter(
      (e) =>
        e.originalPrompt.includes(agentName) ||
        e.originalPrompt.split("\n")[0].toLowerCase().includes(agentName.toLowerCase()),
    )

    if (relevant.length === 0) return null

    return relevant.sort((a, b) => b.usageCount - a.usageCount)[0]?.optimizedPrompt ?? null
  } catch {
    return null
  }
}
