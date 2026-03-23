import { mkdir, writeFile, readFile, access, readdir, unlink } from "fs/promises"
import { resolve } from "path"
import { PromptEvolution, SkillEvolution, MemoryEntry, type SaveMemoryOptions, type SaveMemoryInput } from "./types"
import { z } from "zod"
import { Log } from "../util/log"
import { encrypt, decrypt, isEncryptionAvailable } from "../util/encryption"
import { Provider } from "../provider/provider"
import { generateText } from "ai"
import { Instance } from "../project/instance"
import { EvolutionLearningBridge, DEFAULT_EVOLUTION_BRIDGE_CONFIG } from "../adapt/evolution-learning-bridge"

const log = Log.create({ service: "evolution.store" })

const EVOLUTION_DIR = ".opencode/evolution"
const PROMPTS_FILE = "prompts.json"
const SKILLS_FILE = "skills.json"
const MEMORIES_PREFIX = "memories"

// Evolution learning bridge instance
let evolutionBridge: EvolutionLearningBridge | null = null
let bridgeInitialized = false

/**
 * Initialize evolution learning bridge
 */
async function initBridge(): Promise<EvolutionLearningBridge | null> {
  if (bridgeInitialized) return evolutionBridge

  try {
    evolutionBridge = new EvolutionLearningBridge(undefined, undefined, undefined, {
      ...DEFAULT_EVOLUTION_BRIDGE_CONFIG,
      enabled: true,
      syncToKnowledgeGraph: true,
      useVectorSearch: true,
      trackEvolutionHistory: true,
      autoIndexSkills: true,
    })
    await evolutionBridge.initialize()
    bridgeInitialized = true
    log.info("evolution_learning_bridge_initialized")
    return evolutionBridge
  } catch (error) {
    log.warn("evolution_learning_bridge_init_failed", { error: String(error) })
    evolutionBridge = null
    bridgeInitialized = true
    return null
  }
}

/**
 * Get evolution learning bridge (lazy initialization)
 */
async function getBridge(): Promise<EvolutionLearningBridge | null> {
  if (!bridgeInitialized) {
    await initBridge()
  }
  return evolutionBridge
}

function getEvolutionDir(projectDir: string): string {
  return resolve(projectDir, EVOLUTION_DIR)
}

function getMemoryFilePrefix(): string {
  const now = new Date()
  return `${MEMORIES_PREFIX}-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function getMemoryFileName(month?: string): string {
  const prefix = month ? `${MEMORIES_PREFIX}-${month}` : getMemoryFilePrefix()
  return `${prefix}.json`
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await access(dir)
  } catch {
    await mkdir(dir, { recursive: true })
  }
}

async function readJsonFile<T>(filePath: string, schema: z.ZodType<T>): Promise<T[]> {
  try {
    const content = await readFile(filePath, "utf-8")
    return schema.array().parse(JSON.parse(content))
  } catch (e: any) {
    if (e?.code === "ENOENT") return []
    log.error(`Failed to read ${filePath}`, { error: String(e) })
    return []
  }
}

async function writeJsonFile<T>(filePath: string, data: T[]): Promise<void> {
  try {
    await writeFile(filePath, JSON.stringify(data, null, 2))
  } catch (e) {
    log.error(`Failed to write ${filePath}`, { error: String(e) })
    throw e
  }
}

async function findMemoryFileForEntry(projectDir: string, memoryID: string): Promise<string | null> {
  const dir = getEvolutionDir(projectDir)
  try {
    const files = await readdir(dir)
    const memoryFiles = files.filter((f) => f.startsWith(MEMORIES_PREFIX) && f.endsWith(".json"))
    for (const file of memoryFiles) {
      const memories = await readJsonFile(resolve(dir, file), MemoryEntry)
      if (memories.some((m) => m.id === memoryID)) {
        return resolve(dir, file)
      }
    }
  } catch (e) {
    // Directory doesn't exist yet
  }
  return null
}

export async function savePromptEvolution(
  projectDir: string,
  evolution: Omit<PromptEvolution, "id" | "createdAt" | "usageCount">,
): Promise<PromptEvolution> {
  const dir = getEvolutionDir(projectDir)
  await ensureDir(dir)

  const prompts = await readJsonFile(`${dir}/${PROMPTS_FILE}`, PromptEvolution)
  const newEvolution: PromptEvolution = {
    ...evolution,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    usageCount: 0,
  }
  prompts.push(newEvolution)
  await writeJsonFile(`${dir}/${PROMPTS_FILE}`, prompts)
  return newEvolution
}

export async function getPromptEvolutions(projectDir: string): Promise<PromptEvolution[]> {
  const dir = getEvolutionDir(projectDir)
  return readJsonFile(`${dir}/${PROMPTS_FILE}`, PromptEvolution)
}

export async function saveSkillEvolution(
  projectDir: string,
  skill: Omit<SkillEvolution, "id" | "createdAt" | "status">,
): Promise<SkillEvolution> {
  const dir = getEvolutionDir(projectDir)
  await ensureDir(dir)

  const skills = await readJsonFile(`${dir}/${SKILLS_FILE}`, SkillEvolution)
  const newSkill: SkillEvolution = {
    ...skill,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    status: "draft",
  }
  skills.push(newSkill)
  await writeJsonFile(`${dir}/${SKILLS_FILE}`, skills)

  // Sync to learning bridge
  const bridge = await getBridge()
  if (bridge) {
    try {
      await bridge.syncSkill(newSkill)
      log.debug("skill_synced_to_bridge", { skillId: newSkill.id })
    } catch (error) {
      log.warn("skill_bridge_sync_failed", { skillId: newSkill.id, error: String(error) })
    }
  }

  return newSkill
}

export async function getSkillEvolutions(
  projectDir: string,
  status?: SkillEvolution["status"],
): Promise<SkillEvolution[]> {
  const dir = getEvolutionDir(projectDir)
  const skills = await readJsonFile(`${dir}/${SKILLS_FILE}`, SkillEvolution)
  return status ? skills.filter((s) => s.status === status) : skills
}

export async function updateSkillStatus(
  projectDir: string,
  skillID: string,
  status: SkillEvolution["status"],
): Promise<void> {
  const dir = getEvolutionDir(projectDir)
  const skills = await readJsonFile(`${dir}/${SKILLS_FILE}`, SkillEvolution)
  const idx = skills.findIndex((s) => s.id === skillID)
  if (idx >= 0) {
    skills[idx].status = status
    await writeJsonFile(`${dir}/${SKILLS_FILE}`, skills)
  }
}

export async function saveMemory(
  projectDir: string,
  entry: SaveMemoryInput,
  options?: SaveMemoryOptions,
): Promise<MemoryEntry> {
  const dir = getEvolutionDir(projectDir)
  await ensureDir(dir)

  const currentFile = getMemoryFileName()
  const memories = await readJsonFile(`${dir}/${currentFile}`, MemoryEntry)

  // [ENH] Target 4a: Handle sensitive content
  let value = entry.value
  let encrypted = false
  const sensitive = options?.sensitive ?? false

  if (sensitive) {
    const canEncrypt = await isEncryptionAvailable()
    if (canEncrypt) {
      try {
        value = await encrypt(entry.value)
        encrypted = true
        log.info("sensitive_memory_encrypted", { key: entry.key })
      } catch (error) {
        log.error("failed_to_encrypt_sensitive_memory", {
          key: entry.key,
          error: String(error),
          hint: "Set MEMORY_ENCRYPTION_KEY environment variable",
        })
        throw new Error(
          "Failed to encrypt sensitive memory. " +
            "Set MEMORY_ENCRYPTION_KEY environment variable with: " +
            "openssl rand -base64 32",
        )
      }
    } else {
      throw new Error(
        "Sensitive memory storage requires MEMORY_ENCRYPTION_KEY. " + "Generate a key with: openssl rand -base64 32",
      )
    }
  }

  const newMemory: MemoryEntry = {
    ...entry,
    value,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    usageCount: 0,
    sensitive,
    encrypted,
    // [ENH] Target 4b: Memory compression defaults
    archived: false,
  }

  memories.push(newMemory)
  await writeJsonFile(`${dir}/${currentFile}`, memories)

  // Sync to learning bridge
  const bridge = await getBridge()
  if (bridge) {
    try {
      await bridge.syncMemory(newMemory)
      log.debug("memory_synced_to_bridge", { memoryId: newMemory.id })
    } catch (error) {
      log.warn("memory_bridge_sync_failed", { memoryId: newMemory.id, error: String(error) })
    }
  }

  return newMemory
}

export async function getMemories(projectDir: string, filter?: string): Promise<MemoryEntry[]> {
  const dir = getEvolutionDir(projectDir)

  try {
    const files = await readdir(dir)
    const memoryFiles = files.filter((f) => f.startsWith(MEMORIES_PREFIX) && f.endsWith(".json"))

    if (memoryFiles.length === 0) return []

    const allMemories: MemoryEntry[] = []
    for (const file of memoryFiles) {
      const memories = await readJsonFile(resolve(dir, file), MemoryEntry)
      // [ENH] Target 4a: Decrypt sensitive memories
      for (const memory of memories) {
        if (memory.encrypted && memory.sensitive) {
          try {
            memory.value = await decrypt(memory.value)
          } catch (error) {
            log.warn("failed_to_decrypt_memory", {
              id: memory.id,
              key: memory.key,
              error: String(error),
            })
            // Keep encrypted value, mark as undecryptable
            memory.context = "[Decryption failed - " + memory.context + "]"
          }
        }
      }
      allMemories.push(...memories)
    }

    return filter ? allMemories.filter((m) => m.key.includes(filter)) : allMemories
  } catch (e) {
    return []
  }
}

export async function incrementMemoryUsage(projectDir: string, memoryID: string): Promise<void> {
  const filePath = await findMemoryFileForEntry(projectDir, memoryID)
  if (!filePath) return

  const memories = await readJsonFile(filePath, MemoryEntry)
  const idx = memories.findIndex((m) => m.id === memoryID)
  if (idx >= 0) {
    memories[idx].usageCount++
    memories[idx].lastUsedAt = Date.now()
    await writeJsonFile(filePath, memories)
  }
}

export async function deleteMemory(projectDir: string, memoryID: string): Promise<boolean> {
  const filePath = await findMemoryFileForEntry(projectDir, memoryID)
  if (!filePath) return false

  const memories = await readJsonFile(filePath, MemoryEntry)
  const filtered = memories.filter((m) => m.id !== memoryID)
  if (filtered.length === 0) {
    await unlink(filePath)
  } else {
    await writeJsonFile(filePath, filtered)
  }
  return true
}

// [ENH] Target 4b: Memory compression functions

/**
 * Get statistics about memory storage, grouped by key similarity
 */
export async function getMemoryStats(projectDir: string): Promise<{
  totalMemories: number
  activeMemories: number
  archivedMemories: number
  keyGroups: Map<string, number>
  potentialCompressions: Array<{ key: string; count: number; memoryIds: string[] }>
}> {
  const memories = await getMemories(projectDir)
  const activeMemories = memories.filter((m) => !m.archived)
  const archivedMemories = memories.filter((m) => m.archived)

  // Group by key (exact match for simplicity)
  const keyGroups = new Map<string, number>()
  const keyMemoryIds = new Map<string, string[]>()

  for (const memory of activeMemories) {
    const count = keyGroups.get(memory.key) ?? 0
    keyGroups.set(memory.key, count + 1)

    const ids = keyMemoryIds.get(memory.key) ?? []
    ids.push(memory.id)
    keyMemoryIds.set(memory.key, ids)
  }

  // Find potential compressions (keys with multiple memories)
  const potentialCompressions: Array<{ key: string; count: number; memoryIds: string[] }> = []
  for (const [key, count] of keyGroups) {
    if (count >= 3) {
      // Threshold for compression
      potentialCompressions.push({
        key,
        count,
        memoryIds: keyMemoryIds.get(key) ?? [],
      })
    }
  }

  return {
    totalMemories: memories.length,
    activeMemories: activeMemories.length,
    archivedMemories: archivedMemories.length,
    keyGroups,
    potentialCompressions,
  }
}

/**
 * Archive a memory (mark as archived, not deleted)
 */
export async function archiveMemory(
  projectDir: string,
  memoryID: string,
  reason: "compressed" | "expired" | "manual" = "compressed",
): Promise<boolean> {
  const filePath = await findMemoryFileForEntry(projectDir, memoryID)
  if (!filePath) return false

  const memories = await readJsonFile(filePath, MemoryEntry)
  const idx = memories.findIndex((m) => m.id === memoryID)
  if (idx >= 0) {
    memories[idx].archived = true
    memories[idx].archivedAt = Date.now()
    memories[idx].archivedReason = reason
    await writeJsonFile(filePath, memories)
    log.info("memory_archived", { id: memoryID, reason })
    return true
  }
  return false
}

const MEMORY_SUMMARY_PROMPT = `Summarize the following related memories into a single, concise memory entry.
Each memory has a key and value. Create a unified value that captures the essential information.

Memories:
{memories}

Respond ONLY with valid JSON object:
{
  "key": "unified-key-name",
  "value": "consolidated value capturing all essential information",
  "context": "brief context of what was summarized"
}`

/**
 * Compress similar memories into a single summary memory
 * Uses LLM to generate a consolidated summary
 */
export async function summarizeSimilarMemories(
  projectDir: string,
  key: string,
  options?: {
    threshold?: number
    archiveOriginals?: boolean
  },
): Promise<{ summaryId: string; archivedCount: number } | null> {
  const threshold = options?.threshold ?? 3
  const archiveOriginals = options?.archiveOriginals ?? true

  const stats = await getMemoryStats(projectDir)
  const potential = stats.potentialCompressions.find((p) => p.key === key)

  if (!potential || potential.count < threshold) {
    log.info("no_compression_needed", { key, count: potential?.count ?? 0, threshold })
    return null
  }

  // Get the actual memories
  const memories = await getMemories(projectDir)
  const toCompress = memories.filter((m) => potential.memoryIds.includes(m.id) && !m.archived && !m.sensitive)

  if (toCompress.length < threshold) {
    log.info("insufficient_memories_to_compress", { key, available: toCompress.length })
    return null
  }

  // Prepare content for LLM
  const memoriesContent = toCompress.map((m, i) => `${i + 1}. [${m.key}]: ${m.value}`).join("\n")

  try {
    // Get LLM
    const modelInfo = await Provider.defaultModel()
    const model = await Provider.getModel(modelInfo.providerID, modelInfo.modelID)
    const languageModel = await Provider.getLanguage(model)

    const prompt = MEMORY_SUMMARY_PROMPT.replace("{memories}", memoriesContent)

    const result = await generateText({
      model: languageModel,
      system: "You are a helpful assistant that consolidates related memories.",
      prompt,
    })

    const text = result.text.trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      log.warn("failed_to_parse_summary", { key, response: text.slice(0, 100) })
      return null
    }

    const parsed = JSON.parse(jsonMatch[0])

    if (!parsed.key || !parsed.value) {
      log.warn("invalid_summary_format", { key, parsed })
      return null
    }

    // Save the summary memory
    const summaryMemory = await saveMemory(projectDir, {
      key: parsed.key,
      value: parsed.value,
      context: parsed.context ?? `Summary of ${toCompress.length} memories`,
      sessionIDs: [...new Set(toCompress.flatMap((m) => m.sessionIDs))],
    })

    // Mark summary with original IDs
    const summaryFilePath = await findMemoryFileForEntry(projectDir, summaryMemory.id)
    if (summaryFilePath) {
      const allMemories = await readJsonFile(summaryFilePath, MemoryEntry)
      const summaryIdx = allMemories.findIndex((m) => m.id === summaryMemory.id)
      if (summaryIdx >= 0) {
        allMemories[summaryIdx].summaryFor = toCompress.map((m) => m.id)
        await writeJsonFile(summaryFilePath, allMemories)
      }
    }

    // Archive originals if requested
    let archivedCount = 0
    if (archiveOriginals) {
      for (const memory of toCompress) {
        const archived = await archiveMemory(projectDir, memory.id, "compressed")
        if (archived) archivedCount++
      }
    }

    log.info("memories_compressed", {
      key,
      originalCount: toCompress.length,
      summaryId: summaryMemory.id,
      archivedCount,
    })

    return { summaryId: summaryMemory.id, archivedCount }
  } catch (error) {
    log.error("compression_failed", { key, error: String(error) })
    return null
  }
}

/**
 * Run compression for all keys that exceed threshold
 * Uses queueMicrotask to avoid blocking
 */
export async function runMemoryCompression(
  projectDir?: string,
  options?: {
    threshold?: number
    archiveOriginals?: boolean
    onProgress?: (key: string, result: { summaryId: string; archivedCount: number } | null) => void
  },
): Promise<{
  keysProcessed: number
  summariesCreated: number
  totalArchived: number
}> {
  const dir = projectDir ?? Instance.directory
  const threshold = options?.threshold ?? 3

  const stats = await getMemoryStats(dir)
  const candidates = stats.potentialCompressions.filter((p) => p.count >= threshold)

  if (candidates.length === 0) {
    log.info("no_compression_candidates", { threshold })
    return { keysProcessed: 0, summariesCreated: 0, totalArchived: 0 }
  }

  let summariesCreated = 0
  let totalArchived = 0

  for (const candidate of candidates) {
    const result = await summarizeSimilarMemories(dir, candidate.key, {
      threshold,
      archiveOriginals: options?.archiveOriginals,
    })

    options?.onProgress?.(candidate.key, result)

    if (result) {
      summariesCreated++
      totalArchived += result.archivedCount
    }
  }

  log.info("memory_compression_complete", {
    keysProcessed: candidates.length,
    summariesCreated,
    totalArchived,
  })

  return {
    keysProcessed: candidates.length,
    summariesCreated,
    totalArchived,
  }
}
