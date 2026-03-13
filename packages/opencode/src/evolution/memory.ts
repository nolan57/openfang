import { saveMemory, getMemories, incrementMemoryUsage } from "./store"
import { Provider } from "../provider/provider"
import { generateText } from "ai"
import { Log } from "../util/log"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"
import { readFile } from "fs/promises"
import { resolve } from "path"
import { getSharedVectorStore, type IVectorStore } from "../learning/vector-store"

const log = Log.create({ service: "evolution.memory" })

// Shared VectorStore instance for memory embeddings
let vectorStore: IVectorStore | null = null

async function getVectorStore(): Promise<IVectorStore> {
  if (!vectorStore) {
    vectorStore = await getSharedVectorStore()
  }
  return vectorStore
}

/**
 * Store memory embedding for semantic search
 */
async function storeMemoryEmbedding(memoryId: string, key: string, value: string): Promise<void> {
  try {
    const vs = await getVectorStore()
    await vs.store({
      node_type: "memory",
      node_id: memoryId,
      entity_title: `${key}: ${value}`,
      vector_type: "content",
      metadata: { key, value },
    })
    log.info("memory_embedding_stored", { memoryId, key })
  } catch (error) {
    log.warn("failed_to_store_embedding", { memoryId, error: String(error) })
  }
}

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
            // Save to store and get the ID
            const newMemory = await saveMemory(projectDir, {
              key: item.key,
              value: item.value,
              context: task,
              sessionIDs: [sessionID],
            })
            // Store embedding for semantic search
            const vs = await getVectorStore()
            await vs.store({
              node_type: "memory",
              node_id: newMemory.id,
              entity_title: `${item.key}: ${item.value}`,
              vector_type: "content",
              metadata: { key: item.key, value: item.value },
            })

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
        const newMemory = await saveMemory(projectDir, {
          key: pattern.key,
          value: pattern.value,
          context: task,
          sessionIDs: [sessionID],
        })
        // Store embedding for semantic search
        await storeMemoryEmbedding(newMemory.id, pattern.key, pattern.value)
        log.info("Saved new memory from pattern", { key: pattern.key })
      }
    }
  }

  if (matchedPatterns.length > 0) {
    log.info("Memory extraction completed", { matchedPatterns, taskLength: task.length })
  }
}

// Temporal decay factor (lambda for exponential decay)
const TEMPORAL_DECAY_LAMBDA = 0.00001 // ~1% per day
// MMR (Maximal Marginal Relevance) lambda for re-ranking
const MMR_LAMBDA = 0.5

/**
 * Calculate temporal decay score based on last used time
 */
function calculateTemporalDecay(lastUsedAt: number): number {
  const age = Date.now() - lastUsedAt
  return Math.exp(-TEMPORAL_DECAY_LAMBDA * age)
}

/**
 * MMR re-ranking to ensure diversity in results
 */
function mmrReRank(
  items: Array<{ key: string; value: string; score: number }>,
  lambda: number = MMR_LAMBDA,
): Array<{ key: string; value: string; relevance: number }> {
  if (items.length <= 1) {
    return items.map((i) => ({ key: i.key, value: i.value, relevance: i.score }))
  }

  const selected: Array<{ key: string; value: string; relevance: number }> = []
  const remaining = [...items]

  // Select first item with highest score
  remaining.sort((a, b) => b.score - a.score)
  const first = remaining.shift()!
  selected.push({ key: first.key, value: first.value, relevance: first.score })

  // Select remaining items using MMR
  while (remaining.length > 0) {
    let bestIdx = -1
    let bestMmr = -Infinity

    for (let i = 0; i < remaining.length; i++) {
      const item = remaining[i]

      // Calculate similarity to selected items (using simple keyword overlap)
      let maxSimilarity = 0
      for (const sel of selected) {
        const selWords = new Set(sel.key.toLowerCase().split(/\W+/))
        const itemWords = new Set(item.key.toLowerCase().split(/\W+/))
        const intersection = [...selWords].filter((w) => itemWords.has(w) && w.length > 2).length
        const union = selWords.size + itemWords.size - intersection
        const similarity = union > 0 ? intersection / union : 0
        maxSimilarity = Math.max(maxSimilarity, similarity)
      }

      // MMR formula: lambda * score - (1 - lambda) * similarity
      const mmr = lambda * item.score - (1 - lambda) * maxSimilarity

      if (mmr > bestMmr) {
        bestMmr = mmr
        bestIdx = i
      }
    }

    if (bestIdx >= 0) {
      const selectedItem = remaining.splice(bestIdx, 1)[0]
      selected.push({ key: selectedItem.key, value: selectedItem.value, relevance: selectedItem.score })
    }
  }

  return selected
}

/**
 * Hybrid search: combines vector similarity with keyword matching
 */
export async function getRelevantMemories(projectDir: string, currentTask: string): Promise<MemorySuggestion[]> {
  const allMemories = await getMemories(projectDir)

  if (allMemories.length === 0) return []

  const taskWords = currentTask.toLowerCase().split(/\s+/).filter((w) => w.length > 2)

  // Try vector search first
  let vectorResults: Array<{ key: string; value: string; score: number }> = []
  try {
    const vs = await getVectorStore()
    const vecSearchResults = await vs.search(currentTask, {
      limit: 20,
      min_similarity: 0.1,
    })

    // Map vector results to memory format
    for (const r of vecSearchResults) {
      const memory = allMemories.find((m) => m.id === r.id || m.key === r.entity_title)
      if (memory) {
        vectorResults.push({
          key: memory.key,
          value: memory.value,
          score: r.similarity,
        })
      }
    }
  } catch (error) {
    log.warn("vector_search_failed", { error: String(error) })
  }

  // Fallback to keyword matching
  const keywordResults = allMemories.map((memory) => {
    const keywordMatches = taskWords.filter(
      (word) => memory.key.toLowerCase().includes(word) || memory.value.toLowerCase().includes(word),
    ).length

    // Boost by usage count and recency
    const temporalScore = calculateTemporalDecay(memory.lastUsedAt)
    const usageBoost = Math.log10(memory.usageCount + 1) * 0.1

    return {
      key: memory.key,
      value: memory.value,
      score: keywordMatches * temporalScore + usageBoost,
    }
  }).filter((m) => m.score > 0)

  // Merge results: combine vector and keyword results
  const mergedMap = new Map<string, { key: string; value: string; score: number }>()

  // Add vector results with higher weight
  for (const r of vectorResults) {
    mergedMap.set(r.key, { ...r, score: r.score * 1.5 }) // Boost vector results
  }

  // Add keyword results, keep higher score if duplicate
  for (const r of keywordResults) {
    const existing = mergedMap.get(r.key)
    if (!existing || r.score > existing.score) {
      mergedMap.set(r.key, r)
    }
  }

  const mergedResults = Array.from(mergedMap.values()).sort((a, b) => b.score - a.score)

  // Apply MMR re-ranking for diversity
  const diverseResults = mmrReRank(mergedResults, MMR_LAMBDA)

  // Update usage stats for returned memories
  for (const result of diverseResults.slice(0, 5)) {
    const memory = allMemories.find((m) => m.key === result.key)
    if (memory) {
      incrementMemoryUsage(projectDir, memory.id).catch((e) =>
        log.warn("failed_to_increment_usage", { error: String(e) }),
      )
    }
  }

  return diverseResults.slice(0, 5)
}
