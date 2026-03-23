import type { AnalyzedItem } from "./analyzer"
import { Log } from "../util/log"
import { Glob } from "../util/glob"

const log = Log.create({ service: "learning-suggester" })

export interface CodeSuggestion {
  id: string
  title: string
  description: string
  rationale: string
  affected_files: string[]
  risk: "low" | "medium" | "high"
  effort: "small" | "medium" | "large"
  suggested_changes: SuggestedChange[]
  source_item: {
    url: string
    title: string
    tags: string[]
  }
}

export interface SuggestedChange {
  file: string
  description: string
  code_snippet?: string
}

const CODE_PATTERNS: Record<string, { patterns: string[]; relevance: string }> = {
  performance: {
    patterns: ["performance", "optimization", "faster", "efficient", "speed", "cache"],
    relevance: "Performance improvement suggestions",
  },
  security: {
    patterns: ["security", "vulnerability", "sanitize", "validate", "injection"],
    relevance: "Security enhancement suggestions",
  },
  error_handling: {
    patterns: ["error handling", "exception", "try catch", "validation", "robust"],
    relevance: "Error handling improvements",
  },
  api: {
    patterns: ["api", "integration", "client", "request", "response"],
    relevance: "API integration improvements",
  },
  testing: {
    patterns: ["test", "testing", "coverage", "unit test", "integration test"],
    relevance: "Testing improvements",
  },
  ai_ml: {
    patterns: ["ai", "machine learning", "llm", "gpt", "neural", "model"],
    relevance: "AI/ML related improvements",
  },
}

export class CodeSuggester {
  async generateSuggestions(items: AnalyzedItem[]): Promise<CodeSuggestion[]> {
    const suggestions: CodeSuggestion[] = []

    const codeSuggestionItems = items.filter((i) => i.action === "code_suggestion")

    for (const item of codeSuggestionItems) {
      try {
        const suggestion = await this.analyzeForCodeImprovement(item)
        if (suggestion) {
          suggestions.push(suggestion)
        }
      } catch (e) {
        log.error("failed to generate code suggestion", { item: item.title, error: String(e) })
      }
    }

    return suggestions
  }

  private async analyzeForCodeImprovement(item: AnalyzedItem): Promise<CodeSuggestion | null> {
    const relevantPatterns = this.findRelevantPatterns(item)
    if (relevantPatterns.length === 0) return null

    const affectedFiles = await this.findAffectedFiles(item.tags)
    if (affectedFiles.length === 0) {
      affectedFiles.push("src/learning/command.ts")
    }

    const suggestion: CodeSuggestion = {
      id: crypto.randomUUID(),
      title: `Apply insights from "${item.title}"`,
      description: this.generateDescription(item, relevantPatterns),
      rationale: this.generateRationale(item, relevantPatterns),
      affected_files: affectedFiles,
      risk: this.assessRisk(item, affectedFiles),
      effort: this.assessEffort(item, affectedFiles),
      suggested_changes: this.generateChanges(item, affectedFiles, relevantPatterns),
      source_item: {
        url: item.url,
        title: item.title,
        tags: item.tags,
      },
    }

    return suggestion
  }

  private findRelevantPatterns(item: AnalyzedItem): string[] {
    const relevant: string[] = []
    const content = (item.title + " " + item.content).toLowerCase()

    for (const [category, config] of Object.entries(CODE_PATTERNS)) {
      for (const pattern of config.patterns) {
        if (content.includes(pattern.toLowerCase())) {
          relevant.push(category)
          break
        }
      }
    }

    return relevant
  }

  private async findAffectedFiles(tags: string[]): Promise<string[]> {
    const files: string[] = []

    const tagToPath: Record<string, string[]> = {
      AI: ["src/provider/", "src/session/llm.ts", "src/learning/"],
      agent: ["src/session/", "src/tool/task.ts", "src/learning/"],
      LLM: ["src/provider/", "src/session/llm.ts"],
      GPT: ["src/provider/"],
      algorithm: ["src/util/", "src/storage/"],
      framework: ["src/"],
      tool: ["src/tool/", "src/learning/"],
    }

    for (const tag of tags) {
      const paths = tagToPath[tag]
      if (paths) {
        for (const p of paths) {
          try {
            const matches = await Glob.scan("**/*.ts", {
              cwd: p.replace(/\/$/, ""),
              absolute: true,
            })
            files.push(...matches.slice(0, 3))
          } catch {
            files.push(p)
          }
        }
      }
    }

    return [...new Set(files)].slice(0, 5)
  }

  private generateDescription(item: AnalyzedItem, patterns: string[]): string {
    const patternDesc = patterns.map((p) => CODE_PATTERNS[p]?.relevance || p).join(", ")
    return `Based on analysis of "${item.title}", potential improvements in: ${patternDesc}. Consider reviewing the source for applicable techniques.`
  }

  private generateRationale(item: AnalyzedItem, patterns: string[]): string {
    const tags = item.tags.join(", ")
    return `This content covers ${tags} topics. Score: ${item.value_score}/100. Source: ${item.source}. The insights could enhance code quality in the affected areas.`
  }

  private assessRisk(item: AnalyzedItem, files: string[]): "low" | "medium" | "high" {
    if (files.length > 3) return "medium"
    if (files.some((f) => f.includes("provider") || f.includes("session"))) return "medium"
    return "low"
  }

  private assessEffort(item: AnalyzedItem, files: string[]): "small" | "medium" | "large" {
    if (files.length > 3) return "large"
    if (files.length > 1) return "medium"
    return "small"
  }

  private generateChanges(item: AnalyzedItem, files: string[], patterns: string[]): SuggestedChange[] {
    return files.slice(0, 3).map((file) => ({
      file,
      description: `Review ${patterns.join(", ")} improvements from source`,
      code_snippet: `// TODO: Review insights from ${item.title}\n// Source: ${item.url}\n// Tags: ${item.tags.join(", ")}`,
    }))
  }
}
