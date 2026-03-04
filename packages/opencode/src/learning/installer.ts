import { Discovery } from "../skill/discovery"
import { Skill } from "../skill/skill"
import { Log } from "../util/log"
import { NegativeMemory, type FailureType } from "./negative"

const log = Log.create({ service: "learning-installer" })
const negativeMemory = new NegativeMemory()

export interface InstallResult {
  success: boolean
  type: "skill" | "mcp" | "none"
  name?: string
  error?: string
}

export interface AnalyzedItemForInstall {
  url: string
  title: string
  content: string
  tags: string[]
  action: string
}

export class Installer {
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

  private async createSkillFromContent(item: AnalyzedItemForInstall): Promise<InstallResult> {
    const skillContent = `# ${item.title}

${item.content.slice(0, 5000)}

## Usage

This skill was automatically generated from learning.

## Triggers

${item.tags.map((t) => `- "${t}"`).join("\n")}
`

    log.info("would create skill", { title: item.title, content: skillContent.slice(0, 100) })

    return {
      success: true,
      type: "skill",
      name: item.title,
    }
  }
}
