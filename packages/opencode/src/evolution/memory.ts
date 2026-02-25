import { saveMemory, getMemories, incrementMemoryUsage } from "./store"

export interface MemorySuggestion {
  key: string
  value: string
  relevance: number
}

const MEMORY_PATTERNS = [
  {
    pattern: /typescript|tsconfig|type annotation/i,
    key: "typescript-tips",
    value: "Use explicit type annotations for better clarity",
  },
  { pattern: /test|testing|jest|vitest/i, key: "testing-approach", value: "Write tests first (TDD) for better design" },
  { pattern: /refactor|clean|improve/i, key: "refactoring-guidance", value: "Make small, incremental changes" },
  { pattern: /error|bug|fix|issue/i, key: "debugging-tips", value: "Start with minimal reproduction case" },
]

export async function extractMemories(
  projectDir: string,
  sessionID: string,
  task: string,
  toolCalls: string[],
  _outcome: string,
): Promise<void> {
  const existingMemories = await getMemories(projectDir)

  for (const { pattern, key, value } of MEMORY_PATTERNS) {
    if (pattern.test(task) || toolCalls.some((c) => pattern.test(c))) {
      const existing = existingMemories.find((m) => m.key === key)

      if (existing) {
        if (!existing.sessionIDs.includes(sessionID)) {
          existing.sessionIDs.push(sessionID)
        }
      } else {
        await saveMemory(projectDir, {
          key,
          value,
          context: task,
          sessionIDs: [sessionID],
        })
      }
    }
  }
}

export async function getRelevantMemories(projectDir: string, currentTask: string): Promise<MemorySuggestion[]> {
  const allMemories = await getMemories(projectDir)

  if (allMemories.length === 0) return []

  const taskWords = currentTask.toLowerCase().split(/\s+/)

  return allMemories
    .map((memory) => {
      const relevance = taskWords.filter(
        (word) => memory.key.toLowerCase().includes(word) || memory.value.toLowerCase().includes(word),
      ).length

      return {
        key: memory.key,
        value: memory.value,
        relevance,
      }
    })
    .filter((m) => m.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 5)
}
