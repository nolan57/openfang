import { Discovery } from "../skill/discovery"
import { Skill } from "../skill/skill"
import { Log } from "../util/log"

const log = Log.create({ service: "learning-installer" })

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
      try {
        const result = await this.installSkill(item)
        results.push(result)
      } catch (e) {
        log.error("install failed", { item: item.title, error: String(e) })
        results.push({
          success: false,
          type: "none",
          error: String(e),
        })
      }
    }

    return results
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
