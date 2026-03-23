import path from "path"
import { mkdir, writeFile } from "fs/promises"
import { Global } from "../global"
import type { CollectedItem } from "./collector"

export class NoteGenerator {
  private outputDir: string

  constructor(outputDir: string) {
    this.outputDir = outputDir
  }

  async generate(runId: string, items: CollectedItem[]): Promise<string[]> {
    const notes: string[] = []
    const dir = path.join(Global.Path.home, this.outputDir, runId)
    await mkdir(dir, { recursive: true })

    for (const item of items) {
      const filename = this.sanitizeFilename(item.title) + ".md"
      const filepath = path.join(dir, filename)
      const content = this.formatNote(item)
      await writeFile(filepath, content)
      notes.push(filepath)
    }

    const index = this.generateIndex(runId, items)
    const indexPath = path.join(dir, "index.md")
    await writeFile(indexPath, index)

    return notes
  }

  private formatNote(item: CollectedItem): string {
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19)
    return `# ${item.title}

**Source:** ${item.source}  
**URL:** ${item.url}

---

${item.content}

---

*Collected at: ${timestamp}*
`
  }

  private generateIndex(runId: string, items: CollectedItem[]): string {
    const sourceCounts = items.reduce(
      (acc, item) => {
        acc[item.source] = (acc[item.source] || 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )

    return `# Learning Notes - ${runId}

## Collected Content

${items.map((item) => `- [${item.title}](./${this.sanitizeFilename(item.title)}.md) (${item.source})`).join("\n")}

## Statistics

- Total: ${items.length}
- Source distribution: ${JSON.stringify(sourceCounts)}
`
  }

  private sanitizeFilename(title: string): string {
    return title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_").slice(0, 50)
  }
}
