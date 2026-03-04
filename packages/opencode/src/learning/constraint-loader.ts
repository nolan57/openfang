import { KnowledgeGraph, type KnowledgeNode } from "./knowledge-graph"
import { Log } from "../util/log"
import * as fs from "fs"
import * as path from "path"

const log = Log.create({ service: "constraint-loader" })

export interface Constraint {
  id: string
  name: string
  type: "architecture" | "security" | "performance" | "style" | "business"
  description: string
  rules: string[]
  source_file: string
  loaded_at: number
}

export class ConstraintLoader {
  private graph: KnowledgeGraph
  private constraintCache: Map<string, Constraint>
  private defaultSearchPaths: string[]

  constructor() {
    this.graph = new KnowledgeGraph()
    this.constraintCache = new Map()
    this.defaultSearchPaths = []
  }

  setSearchPaths(paths: string[]): void {
    this.defaultSearchPaths = paths
  }

  async loadFromProject(rootDir: string): Promise<Constraint[]> {
    const constraints: Constraint[] = []

    const archPath = path.join(rootDir, "ARCHITECTURE.md")
    if (fs.existsSync(archPath)) {
      const constraint = await this.loadConstraint(archPath, "architecture")
      constraints.push(constraint)
    }

    const stylePath = path.join(rootDir, ".opencode", "style-guide.md")
    if (fs.existsSync(stylePath)) {
      const constraint = await this.loadConstraint(stylePath, "style")
      constraints.push(constraint)
    }

    const securityPaths = [path.join(rootDir, "SECURITY.md"), path.join(rootDir, ".opencode", "security.md")]
    for (const sp of securityPaths) {
      if (fs.existsSync(sp)) {
        const constraint = await this.loadConstraint(sp, "security")
        constraints.push(constraint)
      }
    }

    const globalsPath = path.join(rootDir, "AGENTS.md")
    if (fs.existsSync(globalsPath)) {
      const constraint = await this.loadConstraint(globalsPath, "business")
      constraints.push(constraint)
    }

    const searchDirs = [rootDir, ...this.defaultSearchPaths]
    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue

      const docsDir = path.join(dir, "docs")
      if (fs.existsSync(docsDir)) {
        const docFiles = fs.readdirSync(docsDir).filter((f) => f.endsWith(".md"))
        for (const docFile of docFiles) {
          const docPath = path.join(docsDir, docFile)
          const content = fs.readFileSync(docPath, "utf-8")
          if (content.toLowerCase().includes("constraint") || content.toLowerCase().includes("rule")) {
            const constraint = await this.loadConstraint(docPath, "business")
            constraints.push(constraint)
          }
        }
      }
    }

    log.info("constraints_loaded", {
      count: constraints.length,
      types: [...new Set(constraints.map((c) => c.type))],
    })

    return constraints
  }

  private async loadConstraint(filePath: string, type: Constraint["type"]): Promise<Constraint> {
    const cached = this.constraintCache.get(filePath)
    if (cached) return cached

    const content = fs.readFileSync(filePath, "utf-8")
    const rules = this.extractRules(content)
    const name = path.basename(filePath, path.extname(filePath))

    const constraint: Constraint = {
      id: crypto.randomUUID(),
      name,
      type,
      description: this.extractDescription(content),
      rules,
      source_file: filePath,
      loaded_at: Date.now(),
    }

    this.constraintCache.set(filePath, constraint)

    await this.graph.addNode({
      type: "constraint",
      entity_type: type,
      entity_id: filePath,
      title: constraint.name,
      content: content.slice(0, 5000),
      metadata: {
        rules_count: rules.length,
        loaded_at: constraint.loaded_at,
      },
    })

    return constraint
  }

  private extractDescription(content: string): string {
    const lines = content.split("\n")
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const line = lines[i].trim()
      if (line && !line.startsWith("#") && !line.startsWith("```")) {
        return line.slice(0, 200)
      }
    }
    return ""
  }

  private extractRules(content: string): string[] {
    const rules: string[] = []
    const lines = content.split("\n")

    let inList = false
    for (const line of lines) {
      const trimmed = line.trim()

      if (trimmed.match(/^#{1,3}\s/)) {
        if (trimmed.toLowerCase().includes("rule")) {
          inList = true
        }
        continue
      }

      if (inList && (trimmed.startsWith("-") || trimmed.startsWith("*") || trimmed.startsWith("1."))) {
        const rule = trimmed.replace(/^[-*\d.]\s*/, "").trim()
        if (rule && rule.length > 10) {
          rules.push(rule)
        }
      }

      if (trimmed === "" && inList) {
        break
      }
    }

    return rules
  }

  async validateAgainstConstraints(
    content: string,
    filePath: string,
  ): Promise<{ valid: boolean; violations: string[] }> {
    const violations: string[] = []

    for (const [, constraint] of this.constraintCache) {
      if (constraint.type === "security") {
        const securityRules = constraint.rules.filter(
          (r) => r.toLowerCase().includes("must not") || r.toLowerCase().includes("never"),
        )
        for (const rule of securityRules) {
          if (this.violatesRule(content, rule)) {
            violations.push(`Security: ${rule}`)
          }
        }
      }

      if (constraint.type === "style") {
        const styleRules = constraint.rules.slice(0, 10)
        for (const rule of styleRules) {
          if (this.violatesRule(content, rule)) {
            violations.push(`Style: ${rule}`)
          }
        }
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    }
  }

  private violatesRule(content: string, rule: string): boolean {
    const ruleLower = rule.toLowerCase()
    const contentLower = content.toLowerCase()

    if (ruleLower.includes("must not") || ruleLower.includes("never")) {
      const forbidden = ruleLower.replace(/.*(must not|never)\s+/, "")
      return contentLower.includes(forbidden)
    }

    return false
  }

  getConstraint(type?: Constraint["type"]): Constraint[] {
    const all = [...this.constraintCache.values()]
    if (type) {
      return all.filter((c) => c.type === type)
    }
    return all
  }

  clearCache(): void {
    this.constraintCache.clear()
    log.info("constraint_cache_cleared")
  }
}
