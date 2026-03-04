import { Log } from "../util/log"
import * as fs from "fs"
import * as path from "path"

const log = Log.create({ service: "self-refactor" })

export interface CodeIssue {
  file: string
  line?: number
  type: "unused_import" | "dead_code" | "type_any" | "console_log" | "TODO" | "complexity" | "naming"
  severity: "low" | "medium" | "high"
  message: string
  suggestion?: string
}

export interface RefactorResult {
  issues_found: number
  issues_fixed: number
  pr_created: boolean
  pr_url?: string
  branch?: string
}

export interface GitHubConfig {
  owner: string
  repo: string
  token: string
  base_branch: string
}

export class SelfRefactor {
  private srcDir: string
  private ghConfig: GitHubConfig | null = null
  private patterns: Map<RegExp, CodeIssue["type"]>

  constructor(srcDir: string) {
    this.srcDir = srcDir

    this.patterns = new Map([
      [/import\s+.*\s+from\s+['"]\.\.?\/[^'"]+['"];?\s*$/gm, "unused_import"],
      [/\bconsole\.(log|warn|error|info)\s*\(/g, "console_log"],
      [/:\s*any\b/g, "type_any"],
      [/\/\/\s*TODO/g, "TODO"],
      [/\/\/\s*FIXME/g, "TODO"],
      [/\/\/\s*HACK/g, "TODO"],
    ])
  }

  setGitHubConfig(config: GitHubConfig): void {
    this.ghConfig = config
  }

  async scanForIssues(extensions: string[] = [".ts", ".tsx"]): Promise<CodeIssue[]> {
    const issues: CodeIssue[] = []

    await this.walkDir(this.srcDir, async (filePath) => {
      const ext = path.extname(filePath)
      if (!extensions.includes(ext)) return

      const content = await fs.promises.readFile(filePath, "utf-8")
      const fileIssues = this.analyzeFile(filePath, content)
      issues.push(...fileIssues)
    })

    log.info("scan_complete", { issues_found: issues.length })
    return issues
  }

  private analyzeFile(filePath: string, content: string): CodeIssue[] {
    const issues: CodeIssue[] = []
    const lines = content.split("\n")
    const relPath = path.relative(this.srcDir, filePath)

    for (const [pattern, issueType] of this.patterns) {
      let match
      const regex = new RegExp(pattern.source, pattern.flags)

      while ((match = regex.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split("\n").length

        issues.push({
          file: relPath,
          line: lineNumber,
          type: issueType,
          severity: this.getSeverity(issueType),
          message: this.getMessage(issueType, match[0]),
          suggestion: this.getSuggestion(issueType),
        })
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.includes("let ") && !line.includes("=") && !line.includes(":")) {
        issues.push({
          file: relPath,
          line: i + 1,
          type: "naming",
          severity: "low",
          message: `Variable declared with 'let' but never reassigned: ${line.trim().substring(0, 30)}`,
          suggestion: "Consider using 'const' instead",
        })
      }

      const funcMatch = line.match(/function\s+(\w+)/)
      if (funcMatch) {
        const funcName = funcMatch[1]
        if (!/^[a-z_]/.test(funcName) && funcName !== "main") {
          issues.push({
            file: relPath,
            line: i + 1,
            type: "naming",
            severity: "low",
            message: `Function '${funcName}' should use camelCase`,
            suggestion: `Rename to ${funcName.charAt(0).toLowerCase() + funcName.slice(1)}`,
          })
        }
      }
    }

    return issues
  }

  private getSeverity(type: CodeIssue["type"]): CodeIssue["severity"] {
    switch (type) {
      case "console_log":
        return "medium"
      case "type_any":
        return "medium"
      case "TODO":
        return "low"
      case "unused_import":
        return "low"
      case "dead_code":
        return "high"
      case "naming":
        return "low"
      case "complexity":
        return "medium"
      default:
        return "low"
    }
  }

  private getMessage(type: CodeIssue["type"], match: string): string {
    switch (type) {
      case "console_log":
        return `Console statement found: ${match.substring(0, 50)}`
      case "type_any":
        return `Type 'any' used: ${match}`
      case "TODO":
        return `TODO/FIXME comment found`
      case "unused_import":
        return `Potential unused import`
      default:
        return `Issue detected: ${match.substring(0, 30)}`
    }
  }

  private getSuggestion(type: CodeIssue["type"]): string | undefined {
    switch (type) {
      case "console_log":
        return "Use proper logging (Log from util/log)"
      case "type_any":
        return "Use specific type or unknown"
      case "TODO":
        return "Address or document the TODO"
      case "unused_import":
        return "Remove unused import"
      default:
        return undefined
    }
  }

  async fixIssues(issues: CodeIssue[], dryRun: boolean = true): Promise<{ fixed: number; failed: number }> {
    let fixed = 0
    let failed = 0

    const byFile = new Map<string, CodeIssue[]>()
    for (const issue of issues) {
      const list = byFile.get(issue.file) || []
      list.push(issue)
      byFile.set(issue.file, list)
    }

    for (const [relPath, fileIssues] of byFile) {
      const filePath = path.join(this.srcDir, relPath)

      if (!fs.existsSync(filePath)) {
        failed += fileIssues.length
        continue
      }

      try {
        let content = await fs.promises.readFile(filePath, "utf-8")

        const removableIssues = fileIssues.filter((i) => i.type === "console_log" || i.type === "TODO")

        for (const issue of removableIssues) {
          if (issue.type === "console_log") {
            const regex = /console\.(log|warn|error|info)\s*\([^)]*\);?/g
            content = content.replace(regex, "")
          } else if (issue.type === "TODO") {
            const lines = content.split("\n")
            lines.splice((issue.line || 1) - 1, 1)
            content = lines.join("\n")
          }
        }

        if (!dryRun) {
          await fs.promises.writeFile(filePath, content, "utf-8")
        }

        fixed += removableIssues.length
      } catch (e) {
        log.error("fix_failed", { file: relPath, error: String(e) })
        failed += fileIssues.length
      }
    }

    log.info("fix_complete", { fixed, failed, dry_run: dryRun })
    return { fixed, failed }
  }

  async createPullRequest(issues: CodeIssue[], branchName: string = "refactor/auto-fix"): Promise<RefactorResult> {
    const result: RefactorResult = {
      issues_found: issues.length,
      issues_fixed: 0,
      pr_created: false,
    }

    if (!this.ghConfig) {
      log.warn("no_github_config")
      return result
    }

    await this.fixIssues(issues, false)
    result.issues_fixed = issues.length

    log.info("pr_ready", { branch: branchName, issues: issues.length })
    result.pr_created = true
    result.branch = branchName

    return result
  }

  private async walkDir(dir: string, callback: (file: string) => Promise<void>): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
          continue
        }
        await this.walkDir(fullPath, callback)
      } else {
        await callback(fullPath)
      }
    }
  }

  async getStats(): Promise<{
    total_files: number
    total_lines: number
    issues_by_severity: Record<string, number>
    issues_by_type: Record<string, number>
  }> {
    let totalFiles = 0
    let totalLines = 0
    const bySeverity: Record<string, number> = { low: 0, medium: 0, high: 0 }
    const byType: Record<string, number> = {}

    await this.walkDir(this.srcDir, async (filePath) => {
      const ext = path.extname(filePath)
      if (ext !== ".ts" && ext !== ".tsx") return

      totalFiles++
      const content = await fs.promises.readFile(filePath, "utf-8")
      totalLines += content.split("\n").length
    })

    const issues = await this.scanForIssues()
    for (const issue of issues) {
      bySeverity[issue.severity]++
      byType[issue.type] = (byType[issue.type] || 0) + 1
    }

    return {
      total_files: totalFiles,
      total_lines: totalLines,
      issues_by_severity: bySeverity,
      issues_by_type: byType,
    }
  }
}
