import { Log } from "../util/log"
import * as fs from "fs"
import * as path from "path"

const log = Log.create({ service: "learning-reporter" })

export interface LearningReport {
  id: string
  timestamp: string
  status: "success" | "partial" | "failed"
  summary: {
    collected: number
    analyzed: number
    installed: number
    suggestions: number
  }
  items: {
    title: string
    action: string
    status: string
  }[]
  errors: string[]
  suggestions: string[]
}

export class Reporter {
  private reportsDir: string

  constructor(reportsDir = "docs/learning/reports") {
    this.reportsDir = reportsDir
    this.ensureDir()
  }

  private ensureDir() {
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true })
    }
  }

  async generateReport(data: {
    collected: number
    analyzed: number
    installed: number
    suggestions: number
    items: { title: string; action: string; status: string }[]
    errors: string[]
  }): Promise<string> {
    const id = crypto.randomUUID().slice(0, 8)
    const timestamp = new Date().toISOString()

    const report: LearningReport = {
      id,
      timestamp,
      status: data.errors.length > 0 ? "partial" : "success",
      summary: {
        collected: data.collected,
        analyzed: data.analyzed,
        installed: data.installed,
        suggestions: data.suggestions,
      },
      items: data.items,
      errors: data.errors,
      suggestions: this.generateSuggestions(data),
    }

    const filename = `learning-${new Date().toISOString().split("T")[0]}-${id}.json`
    const filepath = path.join(this.reportsDir, filename)

    fs.writeFileSync(filepath, JSON.stringify(report, null, 2))

    log.info("report_generated", { filepath, id, status: report.status })

    return filepath
  }

  private generateSuggestions(data: { errors: string[]; installed: number }): string[] {
    const suggestions: string[] = []

    if (data.errors.length > 0) {
      suggestions.push("Check negative memory for repeated failures")
      suggestions.push("Review error logs for pattern analysis")
    }

    if (data.installed === 0) {
      suggestions.push("No skills installed - verify skill sources are accessible")
    }

    if (data.installed > 0) {
      suggestions.push("Review installed skills for proper configuration")
    }

    suggestions.push("Run /learn again to continue improvement")

    return suggestions
  }

  async getLatestReport(): Promise<LearningReport | null> {
    if (!fs.existsSync(this.reportsDir)) {
      return null
    }

    const files = fs
      .readdirSync(this.reportsDir)
      .filter((f) => f.startsWith("learning-") && f.endsWith(".json"))
      .sort()
      .reverse()

    if (files.length === 0) {
      return null
    }

    const latest = files[0]
    const content = fs.readFileSync(path.join(this.reportsDir, latest), "utf-8")
    return JSON.parse(content)
  }

  formatReportForDisplay(report: LearningReport): string {
    const lines = [
      "═".repeat(50),
      `📊 Learning Report - ${report.timestamp.split("T")[0]}`,
      "═".repeat(50),
      "",
      `Status: ${report.status === "success" ? "✅ 成功" : report.status === "partial" ? "⚠️ 部分成功" : "❌ 失败"}`,
      "",
      "📈 Summary:",
      `  - Collected: ${report.summary.collected}`,
      `  - Analyzed: ${report.summary.analyzed}`,
      `  - Installed: ${report.summary.installed}`,
      `  - Suggestions: ${report.summary.suggestions}`,
      "",
    ]

    if (report.errors.length > 0) {
      lines.push("❌ Errors:")
      for (const err of report.errors) {
        lines.push(`  - ${err}`)
      }
      lines.push("")
    }

    if (report.suggestions.length > 0) {
      lines.push("💡 Suggestions:")
      for (const s of report.suggestions) {
        lines.push(`  - ${s}`)
      }
    }

    lines.push("")
    lines.push("═".repeat(50))

    return lines.join("\n")
  }
}
