import type { LearningConfig } from "./config"
import { defaultLearningConfig } from "./config"
import { LearningScheduler } from "./scheduler"
import { Collector } from "./collector"
import { Analyzer } from "./analyzer"
import { NoteGenerator } from "./notes"
import { KnowledgeStore } from "./store"
import { Installer } from "./installer"
import { CodeSuggester, type CodeSuggestion } from "./suggester"
import { Archive, type ArchiveState } from "./archive"
import { Log } from "../util/log"
import { readFile, writeFile, mkdir } from "fs/promises"
import { resolve, dirname } from "path"
import { generateText } from "ai"
import { Provider } from "../provider/provider"

const log = Log.create({ service: "learning-command" })

export interface LearningResult {
  success: boolean
  collected: number
  notes: number
  installs: number
  suggestions: number
  error?: string
}

interface GeneratedFile {
  path: string
  content: string
  description: string
  summary: string
  type?: "code" | "config"
}

const SPEC_IMPLEMENTATION_PROMPT = `You are an expert TypeScript developer. Given the following specification document, generate the implementation.

Output Type Decision:
- If implementing code logic/commands/handlers → generate TypeScript files (type: "code")
- If implementing data/config/templates/patterns → generate JSON/YAML files (type: "config")

JSON config files support hot reload - they will be automatically loaded without restart.
Config directory: ~/.opencode/commands/ (or use "config:" prefix in path)

Specification:
{spec}

Respond with a JSON object containing:
{
  "files": [
    {
      "path": "relative/path/to/file.ts",
      "content": "complete file content",
      "description": "what this file does",
      "summary": "brief summary of changes",
      "type": "code" | "config"
    }
  ]
}

Respond ONLY with valid JSON.`

const PROTECTED_PATHS = ["bin/", "src/index.ts", "src/bootstrap.ts"]

const ALLOWED_CODE_PATHS = ["src/evolution/", "src/cli/cmd/", "src/skill/", "src/config/"]

const CONFIG_COMMANDS_DIR = () => {
  const home = process.env.HOME || process.env.USERPROFILE || "."
  return resolve(home, ".opencode", "commands")
}

function isPathAllowed(filePath: string): boolean {
  const isAllowed = ALLOWED_CODE_PATHS.some((p: string) => filePath.startsWith(p))
  const isProtected = PROTECTED_PATHS.some((p: string) => filePath.startsWith(p))
  return isAllowed && !isProtected
}

function isConfigPath(filePath: string): boolean {
  return filePath.startsWith("config:") || filePath.endsWith(".json") || filePath.endsWith(".yaml")
}

function resolveConfigPath(filePath: string): string {
  const commandsDir = CONFIG_COMMANDS_DIR()
  let relativePath = filePath.replace(/^config:/, "")
  if (!relativePath.endsWith(".json")) {
    relativePath += ".json"
  }
  return resolve(commandsDir, relativePath)
}

async function testInSandbox(code: string): Promise<boolean> {
  const { writeFile, rm } = await import("fs/promises")
  const { execSync } = await import("child_process")
  const tempFile = `.temp_sandbox_${Date.now()}.ts`

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

async function runSpecImplementation(specFilePath: string): Promise<LearningResult> {
  try {
    log.info("starting spec implementation", { specFilePath })

    const specContent = await readFile(specFilePath, "utf-8")
    const defaultModel = await Provider.defaultModel()
    log.info("using model", { providerID: defaultModel.providerID, modelID: defaultModel.modelID })
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    const languageModel = await Provider.getLanguage(model)

    const prompt = SPEC_IMPLEMENTATION_PROMPT.replace("{spec}", specContent)

    const result = await generateText({
      model: languageModel,
      system: "You are an expert TypeScript developer that generates code from specifications.",
      prompt,
    })

    const text = result.text.trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return {
        success: false,
        collected: 0,
        notes: 0,
        installs: 0,
        suggestions: 0,
        error: "Failed to parse LLM response",
      }
    }

    const parsed = JSON.parse(jsonMatch[0])
    const generated = parsed.files as GeneratedFile[]

    if (!generated || generated.length === 0) {
      return { success: false, collected: 0, notes: 0, installs: 0, suggestions: 0, error: "No files generated" }
    }

    log.info("generated files", { count: generated.length })

    const baseDir = process.cwd()
    let writtenCount = 0
    let configWrittenCount = 0

    for (const file of generated) {
      const fileType = file.type || (isConfigPath(file.path) ? "config" : "code")

      if (fileType === "config") {
        const configPath = resolveConfigPath(file.path)
        const configDir = dirname(configPath)

        try {
          await mkdir(configDir, { recursive: true })
          await writeFile(configPath, file.content)
          log.info("wrote config file (hot reload supported)", { path: configPath })
          configWrittenCount++
        } catch (err) {
          log.warn("failed to write config file", { path: configPath, error: String(err) })
        }
        continue
      }

      if (!isPathAllowed(file.path)) {
        log.warn("path not allowed, skipping", { path: file.path })
        continue
      }

      const filePath = resolve(baseDir, file.path)
      const dir = dirname(filePath)

      const isSafe = await testInSandbox(file.content)
      if (!isSafe) {
        log.warn("generated code failed typecheck, skipping", { path: file.path })
        continue
      }

      await mkdir(dir, { recursive: true })
      await writeFile(filePath, file.content)
      log.info("wrote file", { path: file.path })
      writtenCount++
    }

    if (configWrittenCount > 0) {
      log.info("config files written - hot reload will pick up changes automatically", { count: configWrittenCount })
    }

    return { success: true, collected: 0, notes: 0, installs: 0, suggestions: writtenCount + configWrittenCount }
  } catch (error) {
    log.error("spec implementation failed", { error: String(error) })
    return { success: false, collected: 0, notes: 0, installs: 0, suggestions: 0, error: String(error) }
  }
}

export async function runLearning(config?: Partial<LearningConfig>): Promise<LearningResult> {
  const finalConfig: LearningConfig = {
    ...defaultLearningConfig,
    ...config,
    schedule: {
      ...defaultLearningConfig.schedule,
      ...config?.schedule,
    },
  }

  // If spec_file is provided, use spec-driven mode
  if (finalConfig.spec_file) {
    return runSpecImplementation(finalConfig.spec_file)
  }

  log.info("starting learning run", { topics: finalConfig.topics })

  const scheduler = new LearningScheduler(finalConfig)
  await scheduler.setup()

  const collector = new Collector(finalConfig)
  const analyzer = new Analyzer()
  const noteGen = new NoteGenerator(finalConfig.note_output_dir)
  const store = new KnowledgeStore()
  const installer = new Installer()
  const suggester = new CodeSuggester()
  const archive = new Archive()

  const runId = await store.createRun("manual", finalConfig.topics)

  let preEvolutionSnapshot: string | null = null

  try {
    const items = await collector.collect()
    log.info("collected items", { count: items.length })

    const analyzed = await analyzer.analyze(items)
    log.info("analyzed items", { count: analyzed.length })

    await store.saveKnowledge(
      analyzed.map((i) => ({
        run_id: runId,
        source: i.source,
        url: i.url,
        title: i.title,
        summary: i.summary,
        tags: i.tags,
        value_score: i.value_score,
        action: i.action,
      })),
    )

    const notes = await noteGen.generate(
      runId,
      analyzed.map((a) => ({
        source: a.source,
        url: a.url,
        title: a.title,
        content: a.content,
      })),
    )
    log.info("generated notes", { count: notes.length })

    const hasSkillsToInstall = analyzed.some((a) => a.action === "install_skill")
    const hasSuggestions = analyzed.some((a) => a.action === "code_suggestion")

    if (hasSkillsToInstall || hasSuggestions) {
      const currentState: ArchiveState = {
        skills: [],
        config: finalConfig as Record<string, unknown>,
        memories: [],
      }
      preEvolutionSnapshot = await archive.createSnapshot(
        "pre_evolution",
        `Learning run ${runId}: ${analyzed.length} items analyzed`,
        currentState,
      )
      log.info("pre_evolution_snapshot_created", { snapshotId: preEvolutionSnapshot })
    }

    const installResults = await installer.install(analyzed)
    log.info("install results", { results: installResults })

    const suggestions = await suggester.generateSuggestions(analyzed)
    log.info("code suggestions", { count: suggestions.length })

    if (suggestions.length > 0) {
      for (const s of suggestions) {
        log.info("code suggestion", {
          id: s.id,
          title: s.title,
          risk: s.risk,
          effort: s.effort,
          files: s.affected_files,
        })
      }
    }

    await store.completeRun(runId, items.length, notes.length)

    return {
      success: true,
      collected: items.length,
      notes: notes.length,
      installs: installResults.filter((r) => r.success).length,
      suggestions: suggestions.length,
    }
  } catch (e) {
    log.error("learning run failed", { error: String(e) })

    if (preEvolutionSnapshot) {
      const rollbackState = await archive.rollback(preEvolutionSnapshot)
      if (rollbackState) {
        log.info("rolled_back_to_snapshot", { snapshotId: preEvolutionSnapshot })
      } else {
        log.error("rollback_failed", { snapshotId: preEvolutionSnapshot })
      }
    }

    return {
      success: false,
      collected: 0,
      notes: 0,
      installs: 0,
      suggestions: 0,
      error: String(e),
    }
  }
}

export { CodeSuggester, type CodeSuggestion }
