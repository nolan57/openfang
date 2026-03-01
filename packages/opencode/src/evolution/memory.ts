import { saveMemory, getMemories } from "./store"
import { Provider } from "../provider/provider"
import { generateText } from "ai"
import { Log } from "../util/log"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"
import { readFile } from "fs/promises"
import { resolve } from "path"

const log = Log.create({ service: "evolution.memory" })

export interface MemorySuggestion {
  key: string
  value: string
  relevance: number
}

export interface ExtractedMemory {
  key: string
  value: string
}

interface MemoryPatternConfig {
  keywords: string[]
  key: string
  value: string
}

interface MemoryPatternsFile {
  patterns: MemoryPatternConfig[]
}

let memoryPatterns: MemoryPatternConfig[] = []

async function loadMemoryPatterns(): Promise<MemoryPatternConfig[]> {
  if (memoryPatterns.length > 0) return memoryPatterns

  try {
    const configPath = resolve(__dirname, "memory-patterns.json")
    const content = await readFile(configPath, "utf-8")
    const config: MemoryPatternsFile = JSON.parse(content)
    memoryPatterns = config.patterns
    log.info("Loaded memory patterns", { count: memoryPatterns.length })
  } catch (e) {
    log.warn("Failed to load memory patterns config, using defaults", { error: String(e) })
    memoryPatterns = [
      {
        keywords: ["typescript", "tsconfig", "type annotation"],
        key: "typescript-tips",
        value: "Use explicit type annotations",
      },
      { keywords: ["test", "testing", "jest", "vitest"], key: "testing-approach", value: "Write tests first (TDD)" },
      {
        keywords: ["refactor", "clean", "improve"],
        key: "refactoring-guidance",
        value: "Make small, incremental changes",
      },
      {
        keywords: ["error", "bug", "fix", "issue"],
        key: "debugging-tips",
        value: "Start with minimal reproduction case",
      },
    ]
  }
  return memoryPatterns
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

const MEMORY_EXTRACTION_PROMPT = `Extract 0-3 key learnings from this task that would help with future similar tasks.
Return a JSON array with objects containing:
- key: short descriptive key in kebab-case (e.g., "typescript-tips")
- value: actionable advice in 1-2 sentences

Respond ONLY with valid JSON array, no other text.

Task: {task}
Tool calls: {toolCalls}
Outcome: {outcome}`

export async function extractMemoriesWithLLM(
  projectDir: string,
  sessionID: string,
  task: string,
  toolCalls: string[],
  outcome: string,
  modelProviderID: string,
  modelID: string,
): Promise<ExtractedMemory[]> {
  const memories: ExtractedMemory[] = []

  try {
    const model = await Provider.getModel(modelProviderID, modelID)
    const languageModel = await Provider.getLanguage(model)

    const prompt = MEMORY_EXTRACTION_PROMPT.replace("{task}", task.slice(0, 500))
      .replace("{toolCalls}", toolCalls.slice(0, 20).join(", "))
      .replace("{outcome}", outcome)

    const result = await generateText({
      model: languageModel,
      system: "You are a helpful assistant that extracts key learnings from development tasks.",
      prompt,
    })

    const text = result.text.trim()
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item.key && item.value) {
            memories.push({
              key: item.key,
              value: item.value,
            })
          }
        }
      }
    }
  } catch (error) {
    log.error("Failed to extract memories with LLM", { error: String(error) })
  }

  if (memories.length > 0) {
    log.info("Extracted memories", { count: memories.length, keys: memories.map((m) => m.key) })
    try {
      Bus.publish(TuiEvent.MemoryConfirm, { sessionID, memories })
    } catch (e) {
      log.warn("Failed to publish memory confirm event", { error: String(e) })
    }
  }

  return memories
}

export async function extractMemories(
  projectDir: string,
  sessionID: string,
  task: string,
  toolCalls: string[],
  _outcome: string,
): Promise<void> {
  const patterns = await loadMemoryPatterns()
  const existingMemories = await getMemories(projectDir)
  const matchedPatterns: string[] = []

  const combinedText = `${task} ${toolCalls.join(" ")}`.toLowerCase()

  for (const pattern of patterns) {
    const keywordRegex = new RegExp(pattern.keywords.join("|"), "i")
    if (keywordRegex.test(combinedText)) {
      matchedPatterns.push(pattern.key)
      const existing = existingMemories.find((m) => m.key === pattern.key)

      if (existing) {
        if (!existing.sessionIDs.includes(sessionID)) {
          existing.sessionIDs.push(sessionID)
          log.info("Memory already exists, updated sessionIDs", { key: pattern.key, sessionID })
        }
      } else {
        await saveMemory(projectDir, {
          key: pattern.key,
          value: pattern.value,
          context: task,
          sessionIDs: [sessionID],
        })
        log.info("Saved new memory from pattern", { key: pattern.key })
      }
    }
  }

  if (matchedPatterns.length > 0) {
    log.info("Memory extraction completed", { matchedPatterns, taskLength: task.length })
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
