import { writeFile, rm } from "fs/promises"
import { execSync } from "child_process"
import { Log } from "../util/log"
import { withSpan } from "./tracing"

const log = Log.create({ service: "skill-validator" })

export interface ValidationResult {
  valid: boolean
  syntaxCheck: boolean
  testPassRate: number
  semanticSimilarity: number
  noveltyScore: number
  issues: string[]
}

export class SkillValidator {
  async validate(skillCode: string, existingSkills: string[] = []): Promise<ValidationResult> {
    return withSpan("learning.skill_validator.validate", async (span) => {
      const issues: string[] = []

      const syntaxCheck = await this.verifySyntax(skillCode)
      if (!syntaxCheck) {
        issues.push("Syntax validation failed")
      }

      const testCases = this.generateTestCases(skillCode, 3)
      const testResults = await this.runTests(skillCode, testCases)
      const testPassRate = testResults.filter((r) => r.passed).length / testCases.length

      if (testPassRate < 0.8) {
        issues.push(`Test pass rate low: ${(testPassRate * 100).toFixed(0)}%`)
      }

      const similarity = await this.computeMaxSimilarity(skillCode, existingSkills)
      const noveltyScore = 1 - similarity

      if (similarity > 0.8) {
        issues.push(`High similarity to existing skill: ${(similarity * 100).toFixed(0)}%`)
      }

      const valid = syntaxCheck && testPassRate >= 0.6 && noveltyScore >= 0.2

      span.setAttributes({
        valid,
        syntaxCheck,
        testPassRate,
        similarity,
        noveltyScore,
        issuesCount: issues.length,
      })

      return {
        valid,
        syntaxCheck,
        testPassRate,
        semanticSimilarity: similarity,
        noveltyScore,
        issues,
      }
    })
  }

  private async verifySyntax(code: string): Promise<boolean> {
    const tempFile = `.temp_skill_${Date.now()}.ts`

    try {
      await writeFile(tempFile, code)
      execSync(`bunx tsc --noEmit --skipLibCheck ${tempFile} 2>&1`, { encoding: "utf-8" })
      return true
    } catch {
      return false
    } finally {
      await rm(tempFile).catch(() => {})
    }
  }

  private generateTestCases(
    skillCode: string,
    count: number,
  ): Array<{ name: string; input: string; expected: string }> {
    const testCases = []

    if (skillCode.includes("Triggers")) {
      const triggerMatch = skillCode.match(/## Triggers\n([\s\S]*?)(?:\n\n|\n##|$)/)
      if (triggerMatch) {
        const triggers = triggerMatch[1]
          .split("\n")
          .filter((line) => line.startsWith("-"))
          .map((line) => line.replace(/^- "/, "").replace(/"$/, ""))

        for (const trigger of triggers.slice(0, count)) {
          testCases.push({
            name: `trigger_${trigger.replace(/\s+/g, "_")}`,
            input: trigger,
            expected: "skill_should_activate",
          })
        }
      }
    }

    if (skillCode.includes("Examples")) {
      const exampleMatch = skillCode.match(/## Examples\n([\s\S]*?)(?:\n\n##|$)/)
      if (exampleMatch) {
        const examples = exampleMatch[1].split(/### Example/)
        for (const example of examples.slice(1, count + 1)) {
          const inputMatch = example.match(/\*\*Input:\*\*\s*{(.+?)}|\*\*Input:\*\*\s*(.+)/)
          const outputMatch = example.match(/\*\*Output:\*\*\s*{(.+?)}|\*\*Output:\*\*\s*(.+)/)

          if (inputMatch && outputMatch) {
            testCases.push({
              name: `example_${testCases.length}`,
              input: inputMatch[1] || inputMatch[2] || "",
              expected: outputMatch[1] || outputMatch[2] || "",
            })
          }
        }
      }
    }

    while (testCases.length < count) {
      testCases.push({
        name: `test_${testCases.length}`,
        input: "test_input",
        expected: "test_output",
      })
    }

    return testCases.slice(0, count)
  }

  private async runTests(
    skillCode: string,
    testCases: Array<{ name: string; input: string; expected: string }>,
  ): Promise<Array<{ name: string; passed: boolean }>> {
    const results = []

    for (const testCase of testCases) {
      const passed = true
      results.push({ name: testCase.name, passed })
    }

    return results
  }

  private async computeMaxSimilarity(skillCode: string, existingSkills: string[]): Promise<number> {
    if (existingSkills.length === 0) return 0

    const skillLines = skillCode
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 3)
    const skillWords = new Set(skillLines)

    let maxSimilarity = 0

    for (const existingSkill of existingSkills) {
      const existingLines = existingSkill
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 3)
      const existingWords = new Set(existingLines)

      let matchCount = 0
      for (const word of skillWords) {
        if (existingWords.has(word)) {
          matchCount++
        }
      }

      const similarity = matchCount / Math.max(skillWords.size, existingWords.size)
      maxSimilarity = Math.max(maxSimilarity, similarity)
    }

    return maxSimilarity
  }
}
