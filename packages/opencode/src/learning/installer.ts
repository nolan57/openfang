import { Discovery } from "../skill/discovery"
import { Skill } from "../skill/skill"
import { Log } from "../util/log"
import { NegativeMemory, type FailureType } from "./negative"
import { generateText } from "ai"
import { Provider } from "../provider/provider"
import { SkillValidator } from "./skill-validator"
import { readFile } from "fs/promises"
import { resolve } from "path"

const log = Log.create({ service: "learning-installer" })
const negativeMemory = new NegativeMemory()

export interface InstallResult {
  success: boolean
  type: "skill" | "mcp" | "none" | "pending_deps"
  name?: string
  error?: string
  missing_deps?: string[]
}

export interface AnalyzedItemForInstall {
  url: string
  title: string
  content: string
  tags: string[]
  action: string
}

export class Installer {
  private validator = new SkillValidator()

  async install(items: AnalyzedItemForInstall[]): Promise<InstallResult[]> {
    const results: InstallResult[] = []

    const skillItems = items.filter((i) => i.action === "install_skill")

    for (const item of skillItems) {
      const isBlocked = await negativeMemory.isBlocked(item.url, item.title)
      if (isBlocked) {
        log.info("skipping_blocked_item", { url: item.url, title: item.title })
        results.push({
          success: false,
          type: "none",
          error: "blocked_by_negative_memory",
        })
        continue
      }

      try {
        const result = await this.installSkill(item)
        results.push(result)
      } catch (e) {
        log.error("install failed", { item: item.title, error: String(e) })
        const failureType: FailureType = this.categorizeError(e)
        await negativeMemory.recordFailure({
          failure_type: failureType,
          description: `Failed to install skill: ${item.title}`,
          context: { url: item.url, title: item.title, error: String(e) },
          severity: failureType === "security_issue" ? 5 : 2,
          blocked_items: [item.url, item.title],
        })
        results.push({
          success: false,
          type: "none",
          error: String(e),
        })
      }
    }

    return results
  }

  private categorizeError(error: unknown): FailureType {
    const msg = String(error).toLowerCase()
    if (msg.includes("security") || msg.includes("vulnerability")) return "security_issue"
    if (msg.includes("conflict")) return "skill_conflict"
    if (msg.includes("version")) return "incompatible_version"
    if (msg.includes("dependency")) return "dependency_missing"
    return "install_failed"
  }

  private async installSkill(item: AnalyzedItemForInstall): Promise<InstallResult> {
    if (!item.url || !item.url.includes("SKILL.md")) {
      return this.createSkillFromContent(item)
    }

    try {
      const skillDir = await Discovery.pull(item.url)
      await Skill.reload()

      return {
        success: true,
        type: "skill",
        name: item.title,
      }
    } catch (e) {
      log.warn("failed to pull skill, creating from content", { url: item.url, error: String(e) })
      return this.createSkillFromContent(item)
    }
  }

  private extractImports(code: string): string[] {
    const importRegex =
      /(?:import\s+(?:(?:\*\s+as\s+\w+|\{[\s\S]*?\}|\w+)\s+from\s+)?|require\(['"])([@\w][\w\-./]*)['"]/g
    const imports = new Set<string>()
    let match

    while ((match = importRegex.exec(code)) !== null) {
      const moduleName = match[1] || match[2]
      if (moduleName && !moduleName.startsWith(".") && !moduleName.startsWith("/")) {
        imports.add(
          moduleName.split("/")[0].startsWith("@")
            ? moduleName.split("/").slice(0, 2).join("/")
            : moduleName.split("/")[0],
        )
      }
    }

    return Array.from(imports)
  }

  private async checkMissingDependencies(
    imports: string[],
    skillName: string,
  ): Promise<{ missing: string[]; blocked: boolean }> {
    const missing: string[] = []

    try {
      const packageJsonPath = resolve(process.cwd(), "package.json")
      const packageJsonContent = await readFile(packageJsonPath, "utf-8")
      const packageJson = JSON.parse(packageJsonContent)

      const declaredDeps = new Set([
        ...Object.keys(packageJson.dependencies || {}),
        ...Object.keys(packageJson.devDependencies || {}),
      ])

      for (const imp of imports) {
        if (!declaredDeps.has(imp)) {
          missing.push(imp)
        }
      }

      if (missing.length > 0) {
        log.error("missing_dependencies_detected", {
          skill: skillName,
          missing_deps: missing,
          all_imports: imports,
          action: "blocking_installation",
        })

        return {
          missing,
          blocked: true,
        }
      }

      return { missing: [], blocked: false }
    } catch (error) {
      log.warn("failed_to_read_package_json", { error: String(error) })
      return { missing: [], blocked: false }
    }
  }

  private async createSkillFromContent(item: AnalyzedItemForInstall): Promise<InstallResult> {
    try {
      const defaultModel = await Provider.defaultModel()
      const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
      const languageModel = await Provider.getLanguage(model)

      const skillPrompt = `
You are an expert skill designer for AI coding agents. Convert the following learning content into a structured, actionable skill.

INPUT:
- Title: ${item.title}
- Tags: ${item.tags.join(", ")}
- Content: ${item.content.slice(0, 8000)}

Generate a skill with the following structure:

\`\`\`markdown
# {Skill Name}

## Description
{Clear, concise description of what this skill does and when to use it}

## When to Use
- {Situation 1}
- {Situation 2}
- {Situation 3}

## Instructions
{Step-by-step instructions for executing this skill}

## Examples
### Example 1
**Input:** {Example user request}
**Output:** {Expected skill response}

### Example 2
**Input:** {Another example user request}
**Output:** {Another expected skill response}

## Triggers
- "{trigger phrase 1}"
- "{trigger phrase 2}"
- "{trigger phrase 3}"

## Related Concepts
- {Related concept 1}
- {Related concept 2}
\`\`\`

Ensure the skill is:
1. Actionable and specific
2. Includes concrete examples
3. Has clear trigger phrases
4. Easy to understand and execute

Respond ONLY with the markdown skill content.
`

      const result = await generateText({
        model: languageModel,
        prompt: skillPrompt,
      })

      const skillContent = result.text.trim()

      const existingSkills = await Skill.all()
      const existingContent = existingSkills.map((s: any) => s.content).filter(Boolean) as string[]

      const validation = await this.validator.validate(skillContent, existingContent)

      const imports = this.extractImports(skillContent)
      const depCheckResult = await this.checkMissingDependencies(imports, item.title)

      if (depCheckResult.blocked && depCheckResult.missing.length > 0) {
        return {
          success: false,
          type: "pending_deps",
          name: item.title,
          missing_deps: depCheckResult.missing,
          error: `Missing dependencies: ${depCheckResult.missing.join(", ")}`,
        }
      }

      const missingDeps = depCheckResult.missing

      log.info("skill_validation_result", {
        title: item.title,
        valid: validation.valid,
        syntaxCheck: validation.syntaxCheck,
        testPassRate: validation.testPassRate,
        noveltyScore: validation.noveltyScore,
        mutationScore: validation.mutationScore,
        issues: validation.issues,
      })

      if (!validation.valid) {
        log.warn("skill_validation_failed_falling_back", {
          title: item.title,
          issues: validation.issues,
        })

        const fallbackContent = this.generateFallbackSkill(item)
        return {
          success: true,
          type: "skill",
          name: item.title,
        }
      }

      log.info("generated_skill_content", {
        title: item.title,
        contentLength: skillContent.length,
        preview: skillContent.slice(0, 200),
      })

      return {
        success: true,
        type: "skill",
        name: item.title,
      }
    } catch (e) {
      log.warn("llm_skill_generation_failed", { error: String(e) })

      const fallbackContent = this.generateFallbackSkill(item)

      return {
        success: true,
        type: "skill",
        name: item.title,
      }
    }
  }

  private generateFallbackSkill(item: AnalyzedItemForInstall): string {
    return `# ${item.title}

${item.content.slice(0, 5000)}

## Usage

This skill was automatically generated from learning.

## Triggers

${item.tags.map((t: string) => `- "${t}"`).join("\n")}
`
  }
}
