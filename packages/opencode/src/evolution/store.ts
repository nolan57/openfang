import { mkdir, writeFile, readFile, access } from "fs/promises"
import { resolve } from "path"
import { PromptEvolution, SkillEvolution, MemoryEntry } from "./types"
import { z } from "zod"

const EVOLUTION_DIR = ".opencode/evolution"
const PROMPTS_FILE = "prompts.json"
const SKILLS_FILE = "skills.json"
const MEMORIES_FILE = "memories.json"

function getEvolutionDir(projectDir: string): string {
  return resolve(projectDir, EVOLUTION_DIR)
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
  } catch (e) {
    console.error(`Failed to read ${filePath}:`, e)
    return []
  }
}

async function writeJsonFile<T>(filePath: string, data: T[]): Promise<void> {
  try {
    await writeFile(filePath, JSON.stringify(data, null, 2))
  } catch (e) {
    console.error(`Failed to write ${filePath}:`, e)
    throw e
  }
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

  const memories = await readJsonFile(`${dir}/${MEMORIES_FILE}`, MemoryEntry)
  const newMemory: MemoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    usageCount: 0,
  }
  memories.push(newMemory)
  await writeJsonFile(`${dir}/${MEMORIES_FILE}`, memories)
  return newMemory
}

export async function getMemories(projectDir: string, filter?: string): Promise<MemoryEntry[]> {
  const dir = getEvolutionDir(projectDir)
  const memories = await readJsonFile(`${dir}/${MEMORIES_FILE}`, MemoryEntry)
  return filter ? memories.filter((m) => m.key.includes(filter)) : memories
}

export async function incrementMemoryUsage(projectDir: string, memoryID: string): Promise<void> {
  const dir = getEvolutionDir(projectDir)
  const memories = await readJsonFile(`${dir}/${MEMORIES_FILE}`, MemoryEntry)
  const idx = memories.findIndex((m) => m.id === memoryID)
  if (idx >= 0) {
    memories[idx].usageCount++
    memories[idx].lastUsedAt = Date.now()
    await writeJsonFile(`${dir}/${MEMORIES_FILE}`, memories)
  }
}
