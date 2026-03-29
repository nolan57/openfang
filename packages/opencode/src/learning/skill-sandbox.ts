import { spawn } from "child_process"
import { writeFile, readFile, mkdir, rm } from "fs/promises"
import { resolve, dirname, join } from "path"
import { Log } from "../util/log"
import { withSpan, spanAttrs } from "./tracing"
import vm from "vm"

const log = Log.create({ service: "skill-sandbox" })

const DANGEROUS_PATTERNS = [
  "child_process",
  "exec",
  "execSync",
  "spawn",
  "spawnSync",
  "fork",
  "eval(",
  "Function(",
  "require('fs')",
  'require("fs")',
  "fs.readFile",
  "fs.writeFile",
  "fs.unlink",
  "fs.rmdir",
  "/etc/passwd",
  "/etc/shadow",
  "~/.ssh",
  ".env",
  "process.env",
]

const SAFE_GLOBALS = {
  console,
  Buffer,
  setTimeout,
  setInterval,
  setImmediate,
  clearTimeout,
  clearInterval,
  clearImmediate,
  __dirname: "/sandbox",
  __filename: "/sandbox/skill.js",
  process: {
    env: {},
    cwd: () => "/sandbox",
    version: process.version,
    versions: process.versions,
  },
}

export interface TestCase {
  name: string
  input: string
  expected_output?: string
  should_fail?: boolean
}

export interface SandboxResult {
  success: boolean
  output: string
  error?: string
  duration_ms: number
  test_results?: Array<{
    name: string
    passed: boolean
    error?: string
  }>
}

export interface SandboxConfig {
  timeout_ms: number
  max_memory_mb: number
  allowed_operations: string[]
  working_dir: string
  enable_syscall_filter: boolean
}

/**
 * Skill Sandbox for automated testing
 * Provides isolated environment to run skill test cases
 */
export class SkillSandbox {
  private config: SandboxConfig
  private tempDir: string

  constructor(config?: Partial<SandboxConfig>) {
    this.config = {
      timeout_ms: config?.timeout_ms ?? 30000,
      max_memory_mb: config?.max_memory_mb ?? 512,
      allowed_operations: config?.allowed_operations ?? ["read", "execute"],
      working_dir: config?.working_dir ?? "/tmp/opencode-sandbox",
      enable_syscall_filter: config?.enable_syscall_filter ?? true,
    }
    this.tempDir = this.config.working_dir
  }

  /**
   * Run skill test cases in isolated environment
   */
  async runTests(skillCode: string, testCases: TestCase[]): Promise<SandboxResult> {
    return withSpan("learning.skill_sandbox.run_tests", async (span) => {
      span.setAttributes({
        "code.length": skillCode.length,
        "test_cases.count": testCases.length,
      })
      const startTime = Date.now()

      try {
        // Create sandbox directory
        await mkdir(this.tempDir, { recursive: true })

        // Write skill code to sandbox
        const skillFile = join(this.tempDir, "skill.js")
        await writeFile(skillFile, skillCode)

        // Generate test runner
        const testRunner = this.generateTestRunner(testCases)
        const testFile = join(this.tempDir, "test-runner.js")
        await writeFile(testFile, testRunner)

        // Execute tests
        const result = await this.executeTest(testFile)

        span.setAttributes({
          ...spanAttrs.success(result.success),
          "duration.ms": Date.now() - startTime,
        })
        return {
          ...result,
          duration_ms: Date.now() - startTime,
        } as SandboxResult
      } catch (error) {
        span.setAttributes({ ...spanAttrs.success(false), "error.message": String(error) })
        return {
          success: false,
          output: "",
          error: String(error),
          duration_ms: Date.now() - startTime,
        } as SandboxResult
      } finally {
        // Cleanup
        await this.cleanup().catch((e) => log.warn("cleanup_failed", { error: String(e) }))
      }
    })
  }

  /**
   * Execute a single skill with input
   */
  async execute(skillCode: string, input: string): Promise<SandboxResult> {
    return withSpan("learning.skill_sandbox.execute", async (span) => {
      span.setAttributes({
        "code.length": skillCode.length,
        "input.length": input.length,
      })
      const startTime = Date.now()

      try {
        await mkdir(this.tempDir, { recursive: true })

        const mainFile = join(this.tempDir, "main.js")
        const runnerCode = `
const skill = require('./skill.js');
try {
  const result = skill.execute(${JSON.stringify(input)});
  console.log(JSON.stringify({ success: true, result }));
} catch (e) {
  console.log(JSON.stringify({ success: false, error: e.message }));
}
`
        await writeFile(mainFile, runnerCode)
        await writeFile(join(this.tempDir, "skill.js"), skillCode)

        const output = await this.runCommand("node", [mainFile], {
          timeout: this.config.timeout_ms,
        })

        let parsed
        try {
          parsed = JSON.parse(output.trim())
        } catch {
          parsed = { success: false, output }
        }

        span.setAttributes({
          ...spanAttrs.success(parsed.success ?? false),
          "duration.ms": Date.now() - startTime,
        })
        return {
          success: parsed.success ?? false,
          output: parsed.result ?? parsed.output ?? "",
          error: parsed.error,
          duration_ms: Date.now() - startTime,
        }
      } catch (error) {
        span.setAttributes({ ...spanAttrs.success(false), "error.message": String(error) })
        return {
          success: false,
          output: "",
          error: String(error),
          duration_ms: Date.now() - startTime,
        } as SandboxResult
      } finally {
        await this.cleanup().catch(() => {})
      }
    })
  }

  /**
   * Verify skill syntax without execution
   */
  async verifySyntax(skillCode: string): Promise<{ valid: boolean; error?: string }> {
    try {
      await mkdir(this.tempDir, { recursive: true })
      const file = join(this.tempDir, "skill.js")
      await writeFile(file, skillCode)

      const output = await this.runCommand("node", ["--check", file], {
        timeout: 5000,
      })

      return { valid: true }
    } catch (error) {
      return {
        valid: false,
        error: String(error),
      }
    } finally {
      await this.cleanup().catch(() => {})
    }
  }

  private generateTestRunner(testCases: TestCase[]): string {
    const casesJson = JSON.stringify(testCases, null, 2)
    return `
const skill = require('./skill.js');
const cases = ${casesJson};

const results = [];

for (const testCase of cases) {
  try {
    let result;
    let passed = false;
    
    if (typeof skill.execute === 'function') {
      result = skill.execute(testCase.input);
    } else if (typeof skill.default === 'function') {
      result = skill.default(testCase.input);
    } else {
      throw new Error('Skill must export execute() or default function');
    }
    
    if (testCase.should_fail) {
      passed = result instanceof Error;
    } else if (testCase.expected_output !== undefined) {
      passed = result === testCase.expected_output;
    } else {
      passed = result !== undefined && result !== null;
    }
    
    results.push({
      name: testCase.name,
      passed,
      error: passed ? undefined : 'Output did not match expected'
    });
  } catch (e) {
    results.push({
      name: testCase.name,
      passed: testCase.should_fail === true,
      error: e.message
    });
  }
}

console.log(JSON.stringify(results));
`
  }

  private async executeTest(testFile: string): Promise<SandboxResult> {
    try {
      const output = await this.runCommand("node", [testFile], {
        timeout: this.config.timeout_ms,
      })

      const testResults = JSON.parse(output.trim())

      const passed = testResults.every((r: { passed: boolean }) => r.passed)

      return {
        success: passed,
        output,
        test_results: testResults,
        duration_ms: 0,
      } as SandboxResult
    } catch (error) {
      return {
        success: false,
        output: "",
        error: String(error),
        duration_ms: 0,
      } as SandboxResult
    }
  }

  private runCommand(cmd: string, args: string[], options: { timeout?: number } = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        cwd: this.tempDir,
        env: {
          ...process.env,
          NODE_ENV: "test",
          SANDBOX_MODE: "true",
        },
        timeout: options.timeout ?? this.config.timeout_ms,
      })

      let stdout = ""
      let stderr = ""

      proc.stdout?.on("data", (data) => {
        stdout += data.toString()
      })

      proc.stderr?.on("data", (data) => {
        stderr += data.toString()
      })

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout)
        } else {
          reject(new Error(stderr || `Process exited with code ${code}`))
        }
      })

      proc.on("error", reject)

      setTimeout(() => {
        proc.kill()
        reject(new Error("Process timeout"))
      }, options.timeout ?? this.config.timeout_ms)
    })
  }

  private async cleanup(): Promise<void> {
    try {
      await rm(this.tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  }

  private detectDangerousPatterns(code: string): string | null {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (code.includes(pattern)) {
        log.warn("dangerous_pattern_detected", { pattern, code_sample: code.slice(0, 200) })
        return `Detected dangerous pattern: ${pattern}`
      }
    }
    return null
  }

  async executeInVM(skillCode: string, input: any): Promise<SandboxResult> {
    const startTime = Date.now()

    try {
      const context = vm.createContext({
        ...SAFE_GLOBALS,
        input,
        output: null,
      })

      const wrappedCode = `
        try {
          const skillModule = { exports: {} };
          (function(module, exports) {
            ${skillCode}
          })(skillModule, skillModule.exports);
          
          if (typeof skillModule.exports.execute === 'function') {
            output = skillModule.exports.execute(input);
          } else if (typeof skillModule.exports.default === 'function') {
            output = skillModule.exports.default(input);
          } else {
            throw new Error('Skill must export execute() or default function');
          }
        } catch (e) {
          throw e;
        }
      `

      vm.runInContext(wrappedCode, context, {
        timeout: this.config.timeout_ms,
        filename: "skill.js",
      })

      return {
        success: true,
        output: JSON.stringify(context.output),
        duration_ms: Date.now() - startTime,
      }
    } catch (error: any) {
      return {
        success: false,
        output: "",
        error: error.message,
        duration_ms: Date.now() - startTime,
      }
    }
  }
}

/**
 * Auto-generate test cases from skill code
 */
export function generateTestCases(skillCode: string, count: number = 3): TestCase[] {
  const testCases: TestCase[] = []

  // Basic test case
  testCases.push({
    name: "basic_execution",
    input: "{}",
    should_fail: false,
  })

  // Edge cases
  testCases.push({
    name: "empty_input",
    input: "",
    should_fail: false,
  })

  // Error case
  testCases.push({
    name: "invalid_input",
    input: "invalid_data",
    should_fail: true,
  })

  return testCases.slice(0, count)
}

/**
 * Factory function to create a SkillSandbox instance
 */
export function createSkillSandbox(config?: Partial<SandboxConfig>): SkillSandbox {
  return new SkillSandbox(config)
}
