import type { MessageV2 } from "@/session/message-v2"
import { reflectOnSession } from "./prompt"
import { analyzeTaskForSkill } from "./skill"
import { extractMemories } from "./memory"

export async function runSessionEvolution(
  projectDir: string,
  sessionID: string,
  sessionTitle: string,
  messages: MessageV2.WithParts[],
): Promise<void> {
  const toolCalls = extractToolCalls(messages)
  const success = checkSuccess(messages)

  await reflectOnSession(projectDir, sessionID, {
    task: sessionTitle,
    success,
    issues: [],
    messages,
  })

  await analyzeTaskForSkill(projectDir, sessionID, sessionTitle, toolCalls, success)

  await extractMemories(projectDir, sessionID, sessionTitle, toolCalls, success ? "completed" : "failed")
}

function extractToolCalls(messages: MessageV2.WithParts[]): string[] {
  const calls: string[] = []
  for (const msg of messages) {
    if (msg.info.role !== "assistant") continue
    for (const part of msg.parts) {
      if (part.type === "tool") {
        calls.push(part.tool)
      }
    }
  }
  return calls
}

function checkSuccess(messages: MessageV2.WithParts[]): boolean {
  const lastMsg = messages.at(-1)
  if (!lastMsg) return false
  return lastMsg.info.role === "assistant"
}
