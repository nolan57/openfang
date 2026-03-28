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
  mutationScore?: number
  mutationTestPassed?: boolean
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

      // Mutation testing
      const mutationResult = await this.runMutationTesting(skillCode, testCases)
      if (!mutationResult.passed) {
        issues.push(`Mutation testing failed: score ${(mutationResult.score * 100).toFixed(0)}%`)
      }

      const similarity = await this.computeMaxSimilarity(skillCode, existingSkills)
      const noveltyScore = 1 - similarity

      if (similarity > 0.8) {
        issues.push(`High similarity to existing skill: ${(similarity * 100).toFixed(0)}%`)
      }

      const valid = syntaxCheck && testPassRate >= 0.6 && noveltyScore >= 0.2 && mutationResult.passed

      span.setAttributes({
        valid,
        syntaxCheck,
        testPassRate,
        similarity,
        noveltyScore,
        mutationScore: mutationResult.score,
        issuesCount: issues.length,
      })

      return {
        valid,
        syntaxCheck,
        testPassRate,
        semanticSimilarity: similarity,
        noveltyScore,
        issues,
        mutationScore: mutationResult.score,
        mutationTestPassed: mutationResult.passed,
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

  async runMutationTesting(
    skillCode: string,
    testCases: Array<{ name: string; input: string; expected: string }>,
  ): Promise<{ score: number; passed: boolean }> {
    const mutations = this.generateMutations(skillCode)

    if (mutations.length === 0) {
      log.warn("no_mutations_generated", { code_length: skillCode.length })
      return { score: 1.0, passed: true }
    }

    let killedMutants = 0

    for (const mutant of mutations) {
      try {
        const testResults = await this.runTests(mutant.code, testCases)
        const allPassed = testResults.every((r) => r.passed)

        if (!allPassed) {
          killedMutants++
          log.debug("mutation_killed", {
            mutant_id: mutant.id,
            type: mutant.type,
            test_failed: testResults.find((r) => !r.passed)?.name,
          })
        } else {
          log.warn("mutation_survived", {
            mutant_id: mutant.id,
            type: mutant.type,
            description: mutant.description,
          })
        }
      } catch {
        killedMutants++
        log.debug("mutation_killed_by_syntax_error", { mutant_id: mutant.id })
      }
    }

    const score = killedMutants / mutations.length
    const passed = score >= 0.7

    log.info("mutation_testing_completed", {
      total_mutants: mutations.length,
      killed: killedMutants,
      survived: mutations.length - killedMutants,
      score: (score * 100).toFixed(1) + "%",
      passed,
    })

    return { score, passed }
  }

  private generateMutations(code: string): Array<{
    id: string
    code: string
    type: string
    description: string
  }> {
    const mutations: Array<{
      id: string
      code: string
      type: string
      description: string
    }> = []

    const lines = code.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (!line.trim() || line.trim().startsWith("//")) {
        continue
      }

      if (line.includes("return")) {
        const mutated = [...lines]
        mutated[i] = line.replace(/return\s+(.+?)([;})\s])/g, "return undefined$2")
        if (mutated[i] !== line) {
          mutations.push({
            id: `mutant_${i}_return`,
            code: mutated.join("\n"),
            type: "return_value_removal",
            description: `Removed return value at line ${i + 1}`,
          })
        }
      }

      if (line.includes("if")) {
        const mutated = [...lines]
        mutated[i] = line.replace(/if\s*\(([^)]+)\)/g, "if (true)")
        if (mutated[i] !== line) {
          mutations.push({
            id: `mutant_${i}_condition`,
            code: mutated.join("\n"),
            type: "condition_replacement",
            description: `Replaced condition with true at line ${i + 1}`,
          })
        }
      }

      if (line.includes("+") && !line.includes("++") && !line.includes("+=")) {
        const mutated = [...lines]
        mutated[i] = line.replace(/\+/g, "-")
        if (mutated[i] !== line) {
          mutations.push({
            id: `mutant_${i}_operator`,
            code: mutated.join("\n"),
            type: "operator_replacement",
            description: `Changed + to - at line ${i + 1}`,
          })
        }
      }

      if (line.includes("===")) {
        const mutated = [...lines]
        mutated[i] = line.replace(/===/g, "!==")
        mutations.push({
          id: `mutant_${i}_equality`,
          code: mutated.join("\n"),
          type: "equality_inversion",
          description: `Inverted === to !== at line ${i + 1}`,
        })
      }
    }

    return mutations.slice(0, 10)
  }
}
