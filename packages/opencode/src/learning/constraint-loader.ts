import { readFile, access, readdir } from "fs/promises"
import { resolve, join, relative } from "path"
import { Log } from "../util/log"

const log = Log.create({ service: "constraint-loader" })

export interface Constraint {
  id: string
  type: "allow" | "deny"
  pattern: string
  reason: string
  severity: "low" | "medium" | "high" | "critical"
}

export interface ArchitectureConstraint {
  version: string
  lastUpdated: number
  description: string
  allowedModifications: string[]
  deniedModifications: string[]
  selfRefactorRules: Constraint[]
  filePatterns: {
    canModify: string[]
    cannotModify: string[]
    reviewRequired: string[]
  }
}

/**
 * Load and manage architecture constraints for self-modification
 */
export class ConstraintLoader {
  private constraints: ArchitectureConstraint | null = null
  private projectDir: string

  constructor(projectDir: string = ".") {
    this.projectDir = projectDir
  }

  /**
   * Load constraints from architecture.md
   */
  async load(): Promise<ArchitectureConstraint> {
    if (this.constraints) return this.constraints

    const constraintPath = resolve(this.projectDir, "constraints/architecture.md")

    try {
      const content = await readFile(constraintPath, "utf-8")
      this.constraints = this.parseConstraints(content)
      log.info("constraints_loaded", { path: constraintPath })
    } catch (error) {
      // Use default constraints if file doesn't exist
      log.warn("using_default_constraints", { error: String(error) })
      this.constraints = this.getDefaultConstraints()
    }

    return this.constraints
  }

  /**
   * Check if a modification is allowed
   */
  async canModify(filePath: string): Promise<{ allowed: boolean; reason?: string; requiresReview: boolean }> {
    const constraints = await this.load()
    const relPath = relative(this.projectDir, filePath)

    // Check denied patterns first
    for (const deny of constraints.deniedModifications) {
      if (this.matchPattern(relPath, deny)) {
        return { allowed: false, reason: `Matches denied pattern: ${deny}`, requiresReview: false }
      }
    }

    // Check allowed patterns
    for (const allow of constraints.allowedModifications) {
      if (this.matchPattern(relPath, allow)) {
        // Check if review is required
        const requiresReview = constraints.filePatterns.reviewRequired.some((p) =>
          this.matchPattern(relPath, p),
        )
        return { allowed: true, requiresReview }
      }
    }

    // Default: require review for unknown files
    return { allowed: false, reason: "File not in allowed modification list", requiresReview: true }
  }

  /**
   * Validate a proposed self-modification
   */
  async validateModification(
    filePath: string,
    changeType: "add" | "modify" | "delete",
  ): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
    const errors: string[] = []
    const warnings: string[] = []

    const constraints = await this.load()
    const canModify = await this.canModify(filePath)

    if (!canModify.allowed) {
      errors.push(canModify.reason || "Modification not allowed")
    }

    if (canModify.requiresReview) {
      warnings.push("This modification requires human review")
    }

    // Check specific rules
    for (const rule of constraints.selfRefactorRules) {
      if (rule.type === "deny" && this.matchPattern(filePath, rule.pattern)) {
        errors.push(`Violates constraint: ${rule.reason}`)
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * Get files that can be safely auto-modified
   */
  async getAutoModifiableFiles(): Promise<string[]> {
    const constraints = await this.load()
    return constraints.filePatterns.canModify
  }

  /**
   * Get files that require human review
   */
  async getReviewRequiredFiles(): Promise<string[]> {
    const constraints = await this.load()
    return constraints.filePatterns.reviewRequired
  }

  /**
   * Validate content against constraints (for consistency checker)
   */
  async validateAgainstConstraints(content: string, _entityId: string): Promise<{ valid: boolean; violations: string[] }> {
    const constraints = await this.load()
    const violations: string[] = []

    // Check for denied patterns in content
    for (const rule of constraints.selfRefactorRules) {
      if (rule.type === "deny") {
        if (content.includes(rule.pattern)) {
          violations.push(`Content violates constraint: ${rule.reason}`)
        }
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    }
  }

  private matchPattern(path: string, pattern: string): boolean {
    // Simple glob-like matching
    if (pattern === "*") return true

    const regex = new RegExp(
      "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
      "i",
    )

    return regex.test(path)
  }

  private parseConstraints(content: string): ArchitectureConstraint {
    // Simple markdown parsing
    const lines = content.split("\n")
    const constraints: ArchitectureConstraint = {
      version: "1.0",
      lastUpdated: Date.now(),
      description: "",
      allowedModifications: [],
      deniedModifications: [],
      selfRefactorRules: [],
      filePatterns: {
        canModify: [],
        cannotModify: [],
        reviewRequired: [],
      },
    }

    let section = ""
    for (const line of lines) {
      const trimmed = line.trim()

      if (trimmed.startsWith("# ")) {
        constraints.description = trimmed.slice(2)
      } else if (trimmed.startsWith("## ")) {
        section = trimmed.slice(3).toLowerCase()
      } else if (trimmed.startsWith("- ")) {
        const item = trimmed.slice(2).replace(/\[.*\]$/, "").trim()

        switch (section) {
          case "allowed modifications":
            constraints.allowedModifications.push(item)
            constraints.filePatterns.canModify.push(item)
            break
          case "denied modifications":
            constraints.deniedModifications.push(item)
            constraints.filePatterns.cannotModify.push(item)
            break
          case "review required":
            constraints.filePatterns.reviewRequired.push(item)
            break
        }
      }
    }

    return constraints
  }

  private getDefaultConstraints(): ArchitectureConstraint {
    return {
      version: "1.0",
      lastUpdated: Date.now(),
      description: "Default architecture constraints",
      allowedModifications: [
        "packages/opencode/src/**/*.ts",
        "packages/opencode/test/**/*.ts",
      ],
      deniedModifications: [
        "packages/opencode/src/cli/cmd/*.ts",
        "packages/opencode/src/index.ts",
        "packages/opencode/package.json",
      ],
      selfRefactorRules: [
        {
          id: "no-delete-core",
          type: "deny",
          pattern: "**/index.ts",
          reason: "Cannot delete core entry points",
          severity: "critical",
        },
        {
          id: "no-modify-package",
          type: "deny",
          pattern: "**/package.json",
          reason: "Cannot modify package.json without human approval",
          severity: "high",
        },
      ],
      filePatterns: {
        canModify: ["packages/opencode/src/**/*.ts", "packages/opencode/test/**/*.ts"],
        cannotModify: ["packages/opencode/src/cli/cmd/*.ts", "packages/opencode/src/index.ts"],
        reviewRequired: ["packages/opencode/src/**/*.ts"],
      },
    }
  }
}

/**
 * Create constraint loader for project
 */
export function createConstraintLoader(projectDir: string): ConstraintLoader {
  return new ConstraintLoader(projectDir)
}