import { glob } from "glob"
import { readFile, writeFile, mkdir, access } from "fs/promises"
import { resolve, relative, dirname } from "path"
import { getSharedVectorStore, type IVectorStore } from "./vector-store"
import { Provider } from "../provider/provider"
import { generateText } from "ai"
import { Log } from "../util/log"
import { withSpan, spanAttrs } from "./tracing"

const log = Log.create({ service: "hierarchical-memory" })

export interface ModuleSummary {
  module: string
  file: string
  purpose: string
  keyFunctions: Array<{
    name: string
    signature: string
    purpose: string
  }>
  dependencies: string[]
  lastUpdated: number
  embeddingId?: string
}

export interface ProjectOverview {
  projectDir: string
  techStack: string[]
  keyCapabilities: string[]
  knownGaps: string[]
  lastUpdated: number
}

const SUMMARIES_DIR = ".opencode/memory/summaries"
const OVERVIEW_FILE = ".opencode/memory/project-overview.json"

const SUMMARY_PROMPT = `Analyze this TypeScript file and provide a JSON summary with:
- purpose: 1-2 sentence description of what this file/module does
- keyFunctions: array of {name, signature, purpose} for main functions/classes
- dependencies: array of imported module names

Respond ONLY with valid JSON.

File: {filename}
Content:
{content}`

const OVERVIEW_PROMPT = `Analyze this project and provide a JSON summary with:
- techStack: array of technologies used (languages, frameworks, key libraries)
- keyCapabilities: array of main capabilities/features
- knownGaps: array of areas that could be improved

Respond ONLY with valid JSON.

Project structure:
{structure}

Root package.json:
{packageJson}`

/**
 * Hierarchical Memory System for module-level code understanding
 */
export class HierarchicalMemory {
  private projectDir: string
  private summariesDir: string
  private vectorStore: IVectorStore | null = null

  constructor(projectDir: string) {
    this.projectDir = projectDir
    this.summariesDir = resolve(projectDir, SUMMARIES_DIR)
  }

  private async getVectorStore(): Promise<IVectorStore> {
    if (!this.vectorStore) {
      this.vectorStore = await getSharedVectorStore()
    }
    return this.vectorStore
  }

  /**
   * Initialize summaries directory
   */
  private async ensureDir(): Promise<void> {
    try {
      await access(this.summariesDir)
    } catch {
      await mkdir(this.summariesDir, { recursive: true })
    }
  }

  /**
   * Generate module summary using LLM
   */
  async generateModuleSummary(filePath: string, content: string): Promise<ModuleSummary | null> {
    return withSpan(
      "learning.hierarchical_memory.generate_summary",
      async (span) => {
        span.setAttributes({
          ...spanAttrs.file(filePath),
          "content.length": content.length,
        })
        try {
          const modelInfo = await Provider.defaultModel()
          const model = await Provider.getModel(modelInfo.providerID, modelInfo.modelID)
          const languageModel = await Provider.getLanguage(model)

          const prompt = SUMMARY_PROMPT.replace("{filename}", relative(this.projectDir, filePath)).replace(
            "{content}",
            content.slice(0, 8000),
          )

          const result = await generateText({
            model: languageModel,
            system: "You are a code analysis assistant that extracts structured summaries from code.",
            prompt,
          })

          const text = result.text.trim()
          const jsonMatch = text.match(/\{[\s\S]*\}/)
          if (!jsonMatch) {
            log.warn("no_json_in_summary_response", { file: filePath })
            return null
          }

          const parsed = JSON.parse(jsonMatch[0])
          const summary: ModuleSummary = {
            module: parsed.module || relative(this.projectDir, filePath).replace(/\.[^.]+$/, ""),
            file: relative(this.projectDir, filePath),
            purpose: parsed.purpose || "",
            keyFunctions: Array.isArray(parsed.keyFunctions) ? parsed.keyFunctions : [],
            dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies : [],
            lastUpdated: Date.now(),
          }

          // Store embedding
          const vs = await this.getVectorStore()
          const embeddingId = await vs.store({
            node_type: "module_summary",
            node_id: summary.file,
            entity_title: `${summary.module}: ${summary.purpose}`,
            vector_type: "code",
            metadata: summary as unknown as Record<string, unknown>,
          })
          summary.embeddingId = embeddingId

          span.setAttributes({
            ...spanAttrs.success(true),
            "summary.module": summary.module,
            "summary.functions_count": summary.keyFunctions.length,
          })
          return summary
        } catch (error) {
          log.error("failed_to_generate_summary", { file: filePath, error: String(error) })
          span.setAttributes({ ...spanAttrs.success(false), "error.message": String(error) })
          return null
        }
      },
    )
  }

  /**
   * Build summaries for all TypeScript files in the project
   */
  async buildAllSummaries(extensions: string[] = [".ts", ".tsx"]): Promise<number> {
    return withSpan(
      "learning.hierarchical_memory.build_all",
      async (span) => {
        await this.ensureDir()

        const patterns = extensions.map((ext) => `**/*${ext}`)
        const files = await glob(patterns, {
          cwd: this.projectDir,
          ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
        })

        span.setAttribute("files.total", files.length)
        log.info("building_summaries", { totalFiles: files.length })

        let successCount = 0
        for (const file of files) {
          const filePath = resolve(this.projectDir, file)
          try {
            const content = await readFile(filePath, "utf-8")
            const summary = await this.generateModuleSummary(filePath, content)

            if (summary) {
              await this.saveSummary(summary)
              successCount++
            }
          } catch (error) {
            log.warn("failed_to_process_file", { file, error: String(error) })
          }
        }

        span.setAttribute("files.processed", successCount)
        log.info("summaries_built", { successCount, totalFiles: files.length })
        return successCount
      },
    )
  }

  /**
   * Save module summary to file
   */
  async saveSummary(summary: ModuleSummary): Promise<void> {
    await this.ensureDir()
    const filePath = resolve(this.summariesDir, `${summary.file}.json`)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(summary, null, 2))
  }

  /**
   * Load summary for a specific file
   */
  async getSummary(filePath: string): Promise<ModuleSummary | null> {
    const relPath = relative(this.projectDir, filePath)
    const summaryPath = resolve(this.summariesDir, `${relPath}.json`)

    try {
      const content = await readFile(summaryPath, "utf-8")
      return JSON.parse(content)
    } catch {
      return null
    }
  }

  /**
   * Search module summaries using vector similarity
   */
  async searchSummaries(query: string, limit: number = 5): Promise<ModuleSummary[]> {
    return withSpan(
      "learning.hierarchical_memory.search",
      async (span) => {
        span.setAttributes({
          "query.length": query.length,
          "limit": limit,
        })
        try {
          const vs = await this.getVectorStore()
          const results = await vs.search(query, {
            limit,
            min_similarity: 0.2,
            node_type: "module_summary",
          })

          const summaries: ModuleSummary[] = []
          for (const r of results) {
            const summary = await this.getSummary(resolve(this.projectDir, r.node_id))
            if (summary) {
              summaries.push(summary)
            }
          }

          span.setAttributes({
            ...spanAttrs.success(true),
            "results.count": summaries.length,
          })
          return summaries
        } catch (error) {
          log.error("search_summaries_failed", { error: String(error) })
          span.setAttributes({ ...spanAttrs.success(false), "error.message": String(error) })
          return []
        }
      },
    )
  }

  /**
   * Update summary for a changed file (incremental update)
   */
  async updateSummary(filePath: string, oldSummary?: ModuleSummary): Promise<ModuleSummary | null> {
    try {
      const content = await readFile(filePath, "utf-8")

      // If we have an old summary, include it in the prompt for incremental update
      const prompt = oldSummary
        ? `Update this module summary based on the changes.

Old summary:
${JSON.stringify(oldSummary, null, 2)}

New file content:
${content.slice(0, 8000)}`
        : SUMMARY_PROMPT.replace("{filename}", relative(this.projectDir, filePath)).replace(
            "{content}",
            content.slice(0, 8000),
          )

      const modelInfo = await Provider.defaultModel()
      const model = await Provider.getModel(modelInfo.providerID, modelInfo.modelID)
      const languageModel = await Provider.getLanguage(model)

      const result = await generateText({
        model: languageModel,
        system: "You are a code analysis assistant that updates module summaries.",
        prompt,
      })

      const text = result.text.trim()
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null

      const parsed = JSON.parse(jsonMatch[0])
      const summary: ModuleSummary = {
        module: parsed.module || relative(this.projectDir, filePath).replace(/\.[^.]+$/, ""),
        file: relative(this.projectDir, filePath),
        purpose: parsed.purpose || oldSummary?.purpose || "",
        keyFunctions: Array.isArray(parsed.keyFunctions) ? parsed.keyFunctions : oldSummary?.keyFunctions || [],
        dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies : oldSummary?.dependencies || [],
        lastUpdated: Date.now(),
      }

      // Update embedding
      const vs = await this.getVectorStore()
      if (oldSummary?.embeddingId) {
        await vs.deleteById(oldSummary.embeddingId)
      }
      const embeddingId = await vs.store({
        node_type: "module_summary",
        node_id: summary.file,
        entity_title: `${summary.module}: ${summary.purpose}`,
        vector_type: "code",
        metadata: summary as unknown as Record<string, unknown>,
      })
      summary.embeddingId = embeddingId

      await this.saveSummary(summary)
      return summary
    } catch (error) {
      log.error("failed_to_update_summary", { file: filePath, error: String(error) })
      return null
    }
  }

  /**
   * Generate project overview (Level 1 of hierarchical memory)
   */
  async generateProjectOverview(): Promise<ProjectOverview | null> {
    try {
      // Get project structure
      const files = await glob("**/*.{ts,tsx,json}", {
        cwd: this.projectDir,
        ignore: ["**/node_modules/**", "**/dist/**"],
      })

      const structure = files.slice(0, 50).join("\n")

      // Get package.json
      let packageJson = "{}"
      try {
        packageJson = await readFile(resolve(this.projectDir, "package.json"), "utf-8")
      } catch {
        // Ignore
      }

      const modelInfo = await Provider.defaultModel()
      const model = await Provider.getModel(modelInfo.providerID, modelInfo.modelID)
      const languageModel = await Provider.getLanguage(model)

      const prompt = OVERVIEW_PROMPT.replace("{structure}", structure).replace("{packageJson}", packageJson)

      const result = await generateText({
        model: languageModel,
        system: "You are a project analysis assistant that summarizes project structure and capabilities.",
        prompt,
      })

      const text = result.text.trim()
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null

      const parsed = JSON.parse(jsonMatch[0])
      const overview: ProjectOverview = {
        projectDir: this.projectDir,
        techStack: Array.isArray(parsed.techStack) ? parsed.techStack : [],
        keyCapabilities: Array.isArray(parsed.keyCapabilities) ? parsed.keyCapabilities : [],
        knownGaps: Array.isArray(parsed.knownGaps) ? parsed.knownGaps : [],
        lastUpdated: Date.now(),
      }

      // Save overview
      await mkdir(resolve(this.projectDir, ".opencode/memory"), { recursive: true })
      await writeFile(resolve(this.projectDir, OVERVIEW_FILE), JSON.stringify(overview, null, 2))

      return overview
    } catch (error) {
      log.error("failed_to_generate_overview", { error: String(error) })
      return null
    }
  }

  /**
   * Load project overview
   */
  async getProjectOverview(): Promise<ProjectOverview | null> {
    try {
      const content = await readFile(resolve(this.projectDir, OVERVIEW_FILE), "utf-8")
      return JSON.parse(content)
    } catch {
      return null
    }
  }
}

/**
 * Create hierarchical memory instance for a project
 */
export function createHierarchicalMemory(projectDir: string): HierarchicalMemory {
  return new HierarchicalMemory(projectDir)
}