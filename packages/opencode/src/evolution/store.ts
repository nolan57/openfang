import { mkdir, writeFile, readFile, access, readdir, unlink } from "fs/promises"
import { resolve } from "path"
import { PromptEvolution, SkillEvolution, MemoryEntry } from "./types"
import { z } from "zod"
import { Log } from "../util/log"

const log = Log.create({ service: "evolution.store" })

const EVOLUTION_DIR = ".opencode/evolution"
const PROMPTS_FILE = "prompts.json"
const SKILLS_FILE = "skills.json"
const MEMORIES_PREFIX = "memories"

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
  entry: Omit<MemoryEntry, "id" | "createdAt" | "lastUsedAt" | "usageCount">,
): Promise<MemoryEntry> {
  const dir = getEvolutionDir(projectDir)
  await ensureDir(dir)

  const currentFile = getMemoryFileName()
  const memories = await readJsonFile(`${dir}/${currentFile}`, MemoryEntry)

  const newMemory: MemoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    usageCount: 0,
  }

  memories.push(newMemory)
  await writeJsonFile(`${dir}/${currentFile}`, memories)
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
