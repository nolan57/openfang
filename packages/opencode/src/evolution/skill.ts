import { mkdir, writeFile, access } from "fs/promises"
import { resolve } from "path"
import { saveSkillEvolution, getSkillEvolutions, updateSkillStatus } from "./store"
import type { SkillEvolution } from "./types"

export interface SkillPattern {
  name: string
  description: string
  triggerPatterns: string[]
  template: string
}

function generateSkillContent(task: string, tools: string[]): string {
  return `# ${task.slice(0, 50)}

## Description

Auto-generated skill for: ${task}

## Triggers

This skill activates when:
${tools.map((t) => `- Working with ${t} operations`).join("\n")}

## Actions

1. Analyze the task requirements
2. Execute relevant tool calls
3. Verify results

## Notes

Generated from session analysis on ${new Date().toISOString().split("T")[0]}
`
}

function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3)

  return [...new Set(words)].slice(0, 5)
}

export async function analyzeTaskForSkill(
  projectDir: string,
  sessionID: string,
  task: string,
  toolCalls: string[],
  success: boolean,
): Promise<{ shouldCreate: boolean; skill?: SkillEvolution }> {
  if (!success) return { shouldCreate: false }

  const toolFrequency = toolCalls.reduce(
    (acc, call) => {
      const toolName = call.split(" ")[0]
      acc[toolName] = (acc[toolName] || 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )

  const repeatedTools = Object.entries(toolFrequency).filter(([_, count]) => count >= 3)

  if (repeatedTools.length === 0) {
    return { shouldCreate: false }
  }

  const skillName = `auto-${repeatedTools[0][0].toLowerCase()}-task`
  const skillContent = generateSkillContent(
    task,
    repeatedTools.map(([tool]) => tool),
  )

  const skillData = {
    name: skillName,
    description: `Auto-generated skill for ${task.slice(0, 100)}`,
    content: skillContent,
    triggerPatterns: extractKeywords(task),
    sessionID,
  }

  const saved = await saveSkillEvolution(projectDir, skillData)

  return {
    shouldCreate: true,
    skill: saved,
  }
}

export async function approveSkill(projectDir: string, skillID: string): Promise<string | null> {
  await updateSkillStatus(projectDir, skillID, "approved")

  const skills = await getSkillEvolutions(projectDir, "approved")
  const skill = skills.find((s) => s.id === skillID)

  if (!skill) return null

  const skillDir = resolve(projectDir, ".opencode/skills", skill.name)

  try {
    await access(skillDir)
  } catch {
    await mkdir(skillDir, { recursive: true })
  }

  const skillFile = resolve(skillDir, "SKILL.md")
  await writeFile(skillFile, skill.content)

  return skillDir
}

export async function rejectSkill(projectDir: string, skillID: string): Promise<void> {
  await updateSkillStatus(projectDir, skillID, "rejected")
}

export async function getPendingSkills(projectDir: string) {
  return getSkillEvolutions(projectDir, "draft")
}
