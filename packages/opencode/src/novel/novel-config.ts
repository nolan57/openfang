import { z } from "zod"
import { Log } from "../util/log"
import { mkdir, writeFile, readFile } from "fs/promises"
import { resolve, dirname, join } from "path"
import { Instance } from "../project/instance"

const log = Log.create({ service: "novel-config" })

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
  return join(getNovelDataDir(), "config", "novel-config.json")
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

  constructor(config?: Partial<NovelEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 从文件加载配置
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
      log.info("novel_config_loaded", {
        difficulty: this.config.difficulty,
        storyType: this.config.storyType,
      })

      return this.config
    } catch (error) {
      log.debug("novel_config_load_failed_using_default", { error: String(error) })
      this.loaded = true
      return this.config
    }
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

export const novelConfigManager = new NovelConfigManager()
