import { z } from "zod"
import { Log } from "../util/log"
import { mkdir, writeFile, readFile } from "fs/promises"
import { resolve, dirname, join } from "path"
import { fileURLToPath } from "url"
import { Instance } from "../project/instance"

const log = Log.create({ service: "novel-config" })

/**
 * Get the default config directory (source code config directory).
 * Uses the directory where this module is located + "/config"
 */
export function getDefaultConfigDir(): string {
  let moduleDir: string
  try {
    const url = import.meta.url
    if (url && !url.startsWith("file://")) {
      throw new Error("Invalid URL")
    }
    moduleDir = dirname(fileURLToPath(url))
  } catch {
    // Fallback: use process.cwd() + relative path
    moduleDir = resolve(process.cwd(), "src", "novel")
  }
  return join(moduleDir, "config")
}

/**
 * Get the novel data directory - always uses git root (.opencode/novel/)
 * This ensures consistent storage location regardless of where command is executed
 */
export function getNovelDataDir(): string {
  try {
    // Instance.worktree is the git root directory (where .git is located)
    // Falls back to Instance.directory if not in a git repo
    const root = Instance.worktree !== "/" ? Instance.worktree : Instance.directory
    return join(root, ".opencode", "novel")
  } catch {
    // Fallback for tests or when Instance context is not available
    return join(process.cwd(), ".opencode", "novel")
  }
}

/**
 * Path getters for all novel data files
 * All paths are relative to git root/.opencode/novel/
 */
export function getStoryBiblePath(): string {
  return join(getNovelDataDir(), "state", "story_bible.json")
}

export function getDynamicPatternsPath(): string {
  return join(getNovelDataDir(), "patterns", "dynamic-patterns.json")
}

export function getSkillsPath(): string {
  return join(getNovelDataDir(), "skills")
}

export function getSummariesPath(): string {
  return join(getNovelDataDir(), "summaries")
}

export function getPanelsPath(): string {
  return join(getNovelDataDir(), "panels")
}

export function getReflectionsPath(): string {
  return join(getNovelDataDir(), "reflections")
}

export function getNarrativeSkeletonPath(): string {
  return join(getNovelDataDir(), "narrative_skeleton.json")
}

export function getNovelConfigPath(): string {
  return join(getDefaultConfigDir(), "novel-config.json")
}

export function getStoryMemoryDbPath(): string {
  return join(getNovelDataDir(), "data", "story-memory.db")
}

export function getStoryGraphDbPath(): string {
  return join(getNovelDataDir(), "data", "story-graph.db")
}

export function getBranchStorageDbPath(): string {
  return join(getNovelDataDir(), "data", "branches.db")
}

export function getPatternVectorDbPath(): string {
  return join(getNovelDataDir(), "data", "pattern-vectors.db")
}

export function getProceduralWorldDbPath(): string {
  return join(getNovelDataDir(), "data", "procedural-world.db")
}

export function getMotifTrackingPath(): string {
  return join(getNovelDataDir(), "motif-tracking")
}

export function getPatternsDirPath(): string {
  return join(getNovelDataDir(), "patterns")
}

/**
 * 难度等级配置
 */
export const DifficultyPresetSchema = z.object({
  stressThresholds: z.object({
    critical: z.number().min(0).max(100),
    high: z.number().min(0).max(100),
  }),
  branchConfig: z.object({
    maxBranches: z.number().min(1).max(100),
    minQualityThreshold: z.number().min(1).max(10),
  }),
  chaosModifier: z.number().min(-3).max(3),
  traumaFrequency: z.number().min(0).max(2),
  skillAwardFrequency: z.number().min(0).max(2),
})

export type DifficultyPreset = z.infer<typeof DifficultyPresetSchema>

/**
 * 故事类型评分权重
 */
export const StoryTypeWeightsSchema = z.object({
  narrativeQuality: z.number().min(0).max(1),
  tensionLevel: z.number().min(0).max(1),
  characterDevelopment: z.number().min(0).max(1),
  plotProgression: z.number().min(0).max(1),
  characterGrowth: z.number().min(0).max(1),
  riskReward: z.number().min(0).max(1),
  thematicRelevance: z.number().min(0).max(1),
})

export type StoryTypeWeights = z.infer<typeof StoryTypeWeightsSchema>

/**
 * 提示词风格配置
 */
export const PromptStyleSchema = z.object({
  verbosity: z.enum(["concise", "balanced", "detailed"]),
  creativity: z.number().min(0).max(1),
  structureStrictness: z.number().min(0).max(1),
  allowDeviation: z.boolean(),
})

export type PromptStyle = z.infer<typeof PromptStyleSchema>

/**
 * 自定义创伤标签配置
 */
export const CustomTraumaTagsSchema = z.record(z.string(), z.string())

export type CustomTraumaTags = z.infer<typeof CustomTraumaTagsSchema>

/**
 * 自定义技能类别配置
 */
export const CustomSkillCategoriesSchema = z.record(z.string(), z.string())

export type CustomSkillCategories = z.infer<typeof CustomSkillCategoriesSchema>

/**
 * 自定义目标类型配置
 */
export const CustomGoalTypesSchema = z.record(z.string(), z.string())

export type CustomGoalTypes = z.infer<typeof CustomGoalTypesSchema>

/**
 * 自定义情绪类型配置
 */
export const CustomEmotionTypesSchema = z.record(z.string(), z.string())

export type CustomEmotionTypes = z.infer<typeof CustomEmotionTypesSchema>

/**
 * 自定义角色状态配置
 */
export const CustomCharacterStatusSchema = z.record(z.string(), z.string())

export type CustomCharacterStatus = z.infer<typeof CustomCharacterStatusSchema>

/**
 * 完整的新小说配置
 */
export const NovelEngineConfigSchema = z.object({
  difficulty: z.enum(["easy", "normal", "hard", "nightmare"]),
  storyType: z.enum(["action", "character", "theme", "balanced", "custom"]),
  promptStyle: PromptStyleSchema,
  customWeights: StoryTypeWeightsSchema.optional(),
  customDifficulty: DifficultyPresetSchema.optional(),
  // 新增可配置项
  thematicReflectionInterval: z.number().min(1).max(20).optional(),
  customTraumaTags: CustomTraumaTagsSchema.optional(),
  customSkillCategories: CustomSkillCategoriesSchema.optional(),
  customGoalTypes: CustomGoalTypesSchema.optional(),
  customEmotionTypes: CustomEmotionTypesSchema.optional(),
  customCharacterStatus: CustomCharacterStatusSchema.optional(),
})

export type NovelEngineConfig = z.infer<typeof NovelEngineConfigSchema>

/**
 * 预配置的难度等级
 */
export const DIFFICULTY_PRESETS: Record<string, DifficultyPreset> = {
  easy: {
    stressThresholds: { critical: 100, high: 85 },
    branchConfig: { maxBranches: 30, minQualityThreshold: 2 },
    chaosModifier: 1,
    traumaFrequency: 0.5,
    skillAwardFrequency: 1.5,
  },
  normal: {
    stressThresholds: { critical: 90, high: 70 },
    branchConfig: { maxBranches: 20, minQualityThreshold: 3 },
    chaosModifier: 0,
    traumaFrequency: 1.0,
    skillAwardFrequency: 1.0,
  },
  hard: {
    stressThresholds: { critical: 80, high: 60 },
    branchConfig: { maxBranches: 10, minQualityThreshold: 5 },
    chaosModifier: -1,
    traumaFrequency: 1.5,
    skillAwardFrequency: 0.7,
  },
  nightmare: {
    stressThresholds: { critical: 70, high: 50 },
    branchConfig: { maxBranches: 5, minQualityThreshold: 7 },
    chaosModifier: -2,
    traumaFrequency: 2.0,
    skillAwardFrequency: 0.5,
  },
}

/**
 * 预配置的故事类型权重
 */
export const STORY_TYPE_WEIGHTS: Record<string, StoryTypeWeights> = {
  action: {
    narrativeQuality: 0.2,
    tensionLevel: 0.3,
    characterDevelopment: 0.15,
    plotProgression: 0.2,
    characterGrowth: 0.05,
    riskReward: 0.05,
    thematicRelevance: 0.05,
  },
  character: {
    narrativeQuality: 0.2,
    tensionLevel: 0.1,
    characterDevelopment: 0.35,
    plotProgression: 0.1,
    characterGrowth: 0.15,
    riskReward: 0.05,
    thematicRelevance: 0.05,
  },
  theme: {
    narrativeQuality: 0.2,
    tensionLevel: 0.1,
    characterDevelopment: 0.15,
    plotProgression: 0.1,
    characterGrowth: 0.1,
    riskReward: 0.05,
    thematicRelevance: 0.3,
  },
  balanced: {
    narrativeQuality: 0.25,
    tensionLevel: 0.15,
    characterDevelopment: 0.2,
    plotProgression: 0.15,
    characterGrowth: 0.1,
    riskReward: 0.05,
    thematicRelevance: 0.1,
  },
}

/**
 * 提示词风格预设
 */
export const PROMPT_STYLE_PRESETS: Record<string, PromptStyle> = {
  concise: {
    verbosity: "concise",
    creativity: 0.5,
    structureStrictness: 0.8,
    allowDeviation: false,
  },
  balanced: {
    verbosity: "balanced",
    creativity: 0.7,
    structureStrictness: 0.5,
    allowDeviation: true,
  },
  creative: {
    verbosity: "detailed",
    creativity: 0.9,
    structureStrictness: 0.3,
    allowDeviation: true,
  },
}

/**
 * 默认配置
 */
export const DEFAULT_CONFIG: NovelEngineConfig = {
  difficulty: "normal",
  storyType: "balanced",
  promptStyle: PROMPT_STYLE_PRESETS.balanced,
}

function getConfigPath(): string {
  return getNovelConfigPath()
}

/**
 * 新小说配置管理器
 */
export class NovelConfigManager {
  private config: NovelEngineConfig
  private loaded: boolean = false
  private configSource: string = "default" // Track where config came from

  constructor(config?: Partial<NovelEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Get the source of the current config
   */
  getConfigSource(): string {
    return this.configSource
  }

  /**
   * Load config from a specific path (highest priority)
   */
  async loadFromPath(configPath: string): Promise<NovelEngineConfig> {
    try {
      const content = await readFile(configPath, "utf-8")
      const parsed = JSON.parse(content)

      this.config = NovelEngineConfigSchema.parse({
        ...DEFAULT_CONFIG,
        ...parsed,
      })

      this.loaded = true
      this.configSource = `explicit:${configPath}`
      log.info("novel_config_loaded_from_path", {
        path: configPath,
        difficulty: this.config.difficulty,
        storyType: this.config.storyType,
      })

      return this.config
    } catch (error) {
      log.warn("novel_config_load_from_path_failed", { path: configPath, error: String(error) })
      throw error
    }
  }

  /**
   * 从默认文件加载配置
   */
  async load(): Promise<NovelEngineConfig> {
    try {
      const configPath = getConfigPath()
      const content = await readFile(configPath, "utf-8")
      const parsed = JSON.parse(content)

      this.config = NovelEngineConfigSchema.parse({
        ...DEFAULT_CONFIG,
        ...parsed,
      })

      this.loaded = true
      this.configSource = "default_file"
      log.info("novel_config_loaded", {
        difficulty: this.config.difficulty,
        storyType: this.config.storyType,
      })

      return this.config
    } catch (error) {
      log.debug("novel_config_load_failed_using_default", { error: String(error) })
      this.loaded = true
      this.configSource = "embedded_default"
      return this.config
    }
  }

  /**
   * Merge overlay config on top of current config
   * Used for embedding config from story prompt
   */
  mergeConfig(overlay: Partial<NovelEngineConfig>): NovelEngineConfig {
    this.config = {
      ...this.config,
      ...overlay,
      // Deep merge nested objects
      promptStyle: { ...this.config.promptStyle, ...overlay.promptStyle },
      customDifficulty: overlay.customDifficulty
        ? { ...this.config.customDifficulty, ...overlay.customDifficulty }
        : this.config.customDifficulty,
      customWeights: overlay.customWeights
        ? { ...this.config.customWeights, ...overlay.customWeights }
        : this.config.customWeights,
      // Merge custom type arrays
      customTraumaTags: {
        ...this.config.customTraumaTags,
        ...overlay.customTraumaTags,
      },
      customSkillCategories: {
        ...this.config.customSkillCategories,
        ...overlay.customSkillCategories,
      },
      customGoalTypes: {
        ...this.config.customGoalTypes,
        ...overlay.customGoalTypes,
      },
      customEmotionTypes: {
        ...this.config.customEmotionTypes,
        ...overlay.customEmotionTypes,
      },
      customCharacterStatus: {
        ...this.config.customCharacterStatus,
        ...overlay.customCharacterStatus,
      },
    }
    this.configSource = this.configSource === "default_file" ? "default_file+prompt" : "prompt_embedded"
    log.info("novel_config_merged", { source: this.configSource })
    return this.config
  }

  /**
   * 保存配置到文件
   */
  async save(): Promise<void> {
    try {
      const configPath = getConfigPath()
      await mkdir(dirname(configPath), { recursive: true })
      await writeFile(configPath, JSON.stringify(this.config, null, 2))
      log.info("novel_config_saved", { path: configPath })
    } catch (error) {
      log.error("novel_config_save_failed", { error: String(error) })
      throw error
    }
  }

  /**
   * 获取当前难度配置
   */
  getDifficultyPreset(): DifficultyPreset {
    const preset = DIFFICULTY_PRESETS[this.config.difficulty]
    return this.config.customDifficulty || preset
  }

  /**
   * 获取当前故事类型权重
   */
  getStoryTypeWeights(): StoryTypeWeights {
    const preset = STORY_TYPE_WEIGHTS[this.config.storyType]
    return this.config.customWeights || preset
  }

  /**
   * 获取提示词风格
   */
  getPromptStyle(): PromptStyle {
    return this.config.promptStyle
  }

  /**
   * 获取主题反思间隔
   */
  getThematicReflectionInterval(): number {
    return this.config.thematicReflectionInterval ?? 5
  }

  /**
   * 获取自定义创伤标签
   */
  getCustomTraumaTags(): CustomTraumaTags | undefined {
    return this.config.customTraumaTags
  }

  /**
   * 获取自定义技能类别
   */
  getCustomSkillCategories(): CustomSkillCategories | undefined {
    return this.config.customSkillCategories
  }

  /**
   * 获取自定义目标类型
   */
  getCustomGoalTypes(): CustomGoalTypes | undefined {
    return this.config.customGoalTypes
  }

  /**
   * 获取自定义情绪类型
   */
  getCustomEmotionTypes(): CustomEmotionTypes | undefined {
    return this.config.customEmotionTypes
  }

  /**
   * 获取自定义角色状态
   */
  getCustomCharacterStatus(): CustomCharacterStatus | undefined {
    return this.config.customCharacterStatus
  }

  /**
   * 更新配置
   */
  update(partial: Partial<NovelEngineConfig>): void {
    this.config = { ...this.config, ...partial }
    log.info("novel_config_updated", partial)
  }

  /**
   * 获取完整配置
   */
  getConfig(): NovelEngineConfig {
    return { ...this.config }
  }

  /**
   * 重置为默认
   */
  reset(): void {
    this.config = { ...DEFAULT_CONFIG }
    log.info("novel_config_reset")
  }

  /**
   * 验证配置
   */
  validate(): boolean {
    try {
      NovelEngineConfigSchema.parse(this.config)
      return true
    } catch (error) {
      log.error("novel_config_validation_failed", { error: String(error) })
      return false
    }
  }

  /**
   * 导出为 JSON
   */
  exportToJson(): string {
    return JSON.stringify(this.config, null, 2)
  }

  /**
   * 从 JSON 导入
   */
  importFromJson(json: string): boolean {
    try {
      const parsed = JSON.parse(json)
      this.config = NovelEngineConfigSchema.parse(parsed)
      this.loaded = true
      log.info("novel_config_imported")
      return true
    } catch (error) {
      log.error("novel_config_import_failed", { error: String(error) })
      return false
    }
  }
}

/**
 * Extract config from story prompt YAML front matter
 *
 * Front matter format:
 * ---
 * title: Story Title
 * config:
 *   difficulty: normal
 *   storyType: character
 *   thematicReflectionInterval: 3
 *   customTraumaTags:
 *     GUILT: Psychological_Guilt
 * ---
 *
 * Returns { config, promptContent } where promptContent is the story prompt without front matter
 */
export function extractConfigFromPrompt(content: string): {
  config: Partial<NovelEngineConfig> | null
  promptContent: string
  metadata: Record<string, any>
} {
  const frontMatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?/
  const match = content.match(frontMatterRegex)

  if (!match) {
    return { config: null, promptContent: content, metadata: {} }
  }

  const frontMatter = match[1]
  const promptContent = content.slice(match[0].length)

  try {
    // Simple YAML-like parsing for front matter
    const metadata: Record<string, any> = {}
    const lines = frontMatter.split("\n")
    let currentKey = ""
    let currentObj: Record<string, any> | null = null
    let inConfig = false

    for (const line of lines) {
      const trimmed = line.trimEnd()
      if (!trimmed || trimmed.startsWith("#")) continue

      // Check for nested object start (e.g., "config:")
      const nestedMatch = trimmed.match(/^(\w+):\s*$/)
      if (nestedMatch) {
        currentKey = nestedMatch[1]
        if (currentKey === "config") {
          inConfig = true
          metadata.config = {}
          currentObj = metadata.config
        } else {
          inConfig = false
          currentObj = null
        }
        continue
      }

      // Check for key-value pair at root level
      const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/)
      if (kvMatch && !inConfig) {
        const [, key, value] = kvMatch
        metadata[key] = parseYamlValue(value)
        continue
      }

      // Check for nested key-value pair (indented)
      const nestedKvMatch = trimmed.match(/^\s+(\w+):\s*(.*)$/)
      if (nestedKvMatch && inConfig && currentObj) {
        const [, key, value] = nestedKvMatch
        if (value === "") {
          // This is a nested object start (e.g., "customTraumaTags:")
          currentObj[key] = {}
          currentObj = currentObj[key] as Record<string, any>
        } else {
          currentObj[key] = parseYamlValue(value)
        }
        continue
      }

      // Check for deeply nested key-value (e.g., inside customTraumaTags)
      const deepKvMatch = trimmed.match(/^\s{2,}(\w+):\s*(.*)$/)
      if (deepKvMatch && currentObj) {
        const [, key, value] = deepKvMatch
        currentObj[key] = parseYamlValue(value)
      }
    }

    const config = metadata.config ? validatePartialConfig(metadata.config) : null

    log.info("config_extracted_from_prompt", {
      hasConfig: !!config,
      metadataKeys: Object.keys(metadata).filter((k) => k !== "config"),
    })

    return { config, promptContent, metadata }
  } catch (error) {
    log.warn("front_matter_parse_failed", { error: String(error) })
    return { config: null, promptContent: content, metadata: {} }
  }
}

/**
 * Parse a YAML value string to appropriate type
 */
function parseYamlValue(value: string): any {
  if (!value) return null

  const trimmed = value.trim()

  // Boolean
  if (trimmed === "true") return true
  if (trimmed === "false") return false

  // Number
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10)
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed)

  // Quoted string - remove quotes
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }

  // Plain string
  return trimmed
}

/**
 * Validate partial config from front matter
 */
function validatePartialConfig(partial: Record<string, any>): Partial<NovelEngineConfig> | null {
  try {
    // Only validate the fields that are present
    const result: Partial<NovelEngineConfig> = {}

    if (partial.difficulty && ["easy", "normal", "hard", "nightmare"].includes(partial.difficulty)) {
      result.difficulty = partial.difficulty
    }

    if (partial.storyType && ["action", "character", "theme", "balanced", "custom"].includes(partial.storyType)) {
      result.storyType = partial.storyType
    }

    if (typeof partial.thematicReflectionInterval === "number") {
      result.thematicReflectionInterval = Math.max(1, Math.min(20, partial.thematicReflectionInterval))
    }

    // Copy custom type configurations
    if (partial.customTraumaTags && typeof partial.customTraumaTags === "object") {
      result.customTraumaTags = partial.customTraumaTags
    }
    if (partial.customSkillCategories && typeof partial.customSkillCategories === "object") {
      result.customSkillCategories = partial.customSkillCategories
    }
    if (partial.customGoalTypes && typeof partial.customGoalTypes === "object") {
      result.customGoalTypes = partial.customGoalTypes
    }
    if (partial.customEmotionTypes && typeof partial.customEmotionTypes === "object") {
      result.customEmotionTypes = partial.customEmotionTypes
    }
    if (partial.customCharacterStatus && typeof partial.customCharacterStatus === "object") {
      result.customCharacterStatus = partial.customCharacterStatus
    }

    // Copy prompt style if present
    if (partial.promptStyle && typeof partial.promptStyle === "object") {
      result.promptStyle = {
        verbosity: partial.promptStyle.verbosity || "balanced",
        creativity: typeof partial.promptStyle.creativity === "number" ? partial.promptStyle.creativity : 0.7,
        structureStrictness:
          typeof partial.promptStyle.structureStrictness === "number" ? partial.promptStyle.structureStrictness : 0.5,
        allowDeviation: partial.promptStyle.allowDeviation !== false,
      }
    }

    return Object.keys(result).length > 0 ? result : null
  } catch (error) {
    log.warn("partial_config_validation_failed", { error: String(error) })
    return null
  }
}

/**
 * Infer config from story prompt using LLM
 * This is called when no explicit config is provided
 */
export async function inferConfigFromPrompt(promptContent: string): Promise<Partial<NovelEngineConfig>> {
  const { getNovelLanguageModel } = await import("./model")
  const { generateText } = await import("ai")

  try {
    const model = await getNovelLanguageModel()

    const result = await generateText({
      model,
      prompt: `Analyze this story prompt and suggest optimal novel engine configuration.

Story Prompt:
${promptContent.slice(0, 3000)}${promptContent.length > 3000 ? "..." : ""}

Based on the story content, suggest configuration values. Consider:
- Story genre and tone → difficulty setting
- Character focus vs plot focus → storyType
- Psychological depth → thematicReflectionInterval
- Story-specific themes → custom trauma tags, emotions, etc.

Output JSON only, no explanation:
{
  "difficulty": "easy|normal|hard|nightmare",
  "storyType": "action|character|theme|balanced|custom",
  "thematicReflectionInterval": 3-10,
  "customTraumaTags": { "KEY": "Description" },
  "customEmotionTypes": { "KEY": "EmotionName" },
  "reasoning": "Brief explanation of choices"
}`,
    })

    const text = result.text.trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      log.warn("llm_config_inference_no_json", { text: text.slice(0, 100) })
      return {}
    }

    const parsed = JSON.parse(jsonMatch[0])
    const config = validatePartialConfig(parsed)

    log.info("llm_config_inferred", {
      config,
      reasoning: parsed.reasoning,
    })

    return config || {}
  } catch (error) {
    log.warn("llm_config_inference_failed", { error: String(error) })
    return {}
  }
}

/**
 * Layered config loading with priority:
 * 1. Explicit config path (--config)
 * 2. Default config file
 * 3. Story prompt embedded config
 * 4. LLM inference
 * 5. Embedded defaults
 */
export async function loadLayeredConfig(options: {
  explicitConfigPath?: string
  promptContent?: string
  enableInference?: boolean
}): Promise<NovelConfigManager> {
  const manager = new NovelConfigManager()

  // 1. Try explicit config path
  if (options.explicitConfigPath) {
    try {
      await manager.loadFromPath(options.explicitConfigPath)
      // If explicit config loaded, still check for embedded config to merge
      if (options.promptContent) {
        const { config: embeddedConfig } = extractConfigFromPrompt(options.promptContent)
        if (embeddedConfig) {
          manager.mergeConfig(embeddedConfig)
        }
      }
      return manager
    } catch (error) {
      log.warn("explicit_config_load_failed_falling_back", {
        path: options.explicitConfigPath,
        error: String(error),
      })
    }
  }

  // 2. Try default config file
  await manager.load()

  // 3. Check for embedded config in prompt
  if (options.promptContent) {
    const { config: embeddedConfig } = extractConfigFromPrompt(options.promptContent)
    if (embeddedConfig) {
      manager.mergeConfig(embeddedConfig)
      return manager
    }
  }

  // 4. Try LLM inference if enabled and no config found
  if (options.enableInference && options.promptContent && manager.getConfigSource() === "embedded_default") {
    const inferredConfig = await inferConfigFromPrompt(options.promptContent)
    if (Object.keys(inferredConfig).length > 0) {
      manager.mergeConfig(inferredConfig)
      log.info("config_inferred_from_prompt", { config: inferredConfig })
    }
  }

  // 5. Embedded defaults are already set via constructor
  return manager
}

export const novelConfigManager = new NovelConfigManager()
