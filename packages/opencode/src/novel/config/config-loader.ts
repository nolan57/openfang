import { Log } from "../../util/log"
import { readFile } from "fs/promises"
import { existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { z } from "zod"

const log = Log.create({ service: "visual-config-loader" })

// ============================================================================
// CONFIG SCHEMAS (Zod)
// ============================================================================

const EmotionVisualSchema = z.object({
  expression: z.string(),
  bodyLanguage: z.string(),
  facialFeatures: z.string(),
})

const CameraSpecSchema = z.object({
  shot: z.string().optional(),
  angle: z.string().optional(),
  movement: z.string().optional(),
  depthOfField: z.string().optional(),
})

const ActionMappingSchema = z.object({
  camera: CameraSpecSchema,
  lighting: z.string(),
  composition: z.string(),
})

const StrategySchema = z.object({
  llm_threshold: z.object({
    complex_emotions: z.array(z.string()),
    complex_actions: z.array(z.string()),
    complex_style_patterns: z.array(z.string()),
    description_length_threshold: z.number(),
    use_llm_for_continuity: z.boolean(),
    min_previous_panels_for_continuity: z.number(),
  }),
})

const PromptEngineeringSchema = z.object({
  max_token_limit: z.number(),
  token_estimation_factor: z.number(),
  priority_weights: z.object({
    subject_action: z.number(),
    camera_lighting: z.number(),
    style_atmosphere: z.number(),
    background: z.number(),
  }),
  priority_keywords: z.object({
    subject_action: z.array(z.string()),
    camera_lighting: z.array(z.string()),
    style_atmosphere: z.array(z.string()),
    background: z.array(z.string()),
  }),
  quality_suffix: z.string(),
})

const LlmSchema = z.object({
  enabled: z.boolean(),
  temperature: z.number(),
  timeout_ms: z.number(),
  min_confidence_score: z.number(),
  system_prompt: z.string(),
  response_schema: z.record(z.string(), z.string()),
})

const PanelGenerationSchema = z.object({
  default_count: z.number(),
  min_count: z.number(),
  max_count: z.number(),
  sentence_split_pattern: z.string(),
  min_sentence_length: z.number(),
})

const HashSchema = z.object({
  algorithm: z.string(),
  version: z.string(),
  initial_value: z.number(),
})

const NegativePromptsSchema = z.object({
  base: z.array(z.string()),
  quality_suffix: z.string(),
  shot_specific: z.record(z.string(), z.array(z.string())),
  movement_specific: z.record(z.string(), z.array(z.string())),
  conflict_groups: z.array(z.array(z.string())).optional(), // NEW: 冲突词组定义
})

// ============================================================================
// CONTINUITY ANALYSIS SCHEMA
// ============================================================================

const ContinuityTriggersSchema = z.object({
  high_confidence: z.array(z.string()),
  low_confidence: z.array(z.string()),
})

const ContinuityLLMAnalysisSchema = z.object({
  enabled: z.boolean(),
  temperature: z.number(),
  focus_areas: z.array(z.string()),
  outfit_change_triggers: ContinuityTriggersSchema,
})

const ContinuityPromptEnhancementSchema = z.object({
  consistency_keywords: z.array(z.string()),
  max_previous_panels: z.number(),
})

const ContinuitySchema = z.object({
  llm_analysis: ContinuityLLMAnalysisSchema,
  prompt_enhancement: ContinuityPromptEnhancementSchema,
})

// ============================================================================
// NEW: STRATEGY LAYER SCHEMAS
// ============================================================================

const StrategyOverrideConditionSchema = z.object({
  story_tension: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
  active_motifs: z.array(z.string()).optional(),
})

const StrategyOverrideEffectsSchema = z.object({
  camera: z.record(z.string(), z.unknown()).optional(),
  lighting: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  composition: z.string().optional(),
  atmospheric_effects: z.array(z.string()).optional(),
  style: z.array(z.string()).optional(),
  negative_prompts_add: z.array(z.string()).optional(),
  color_scheme: z.array(z.string()).optional(),
  color_temperature: z.string().optional(),
  depth_of_field: z.string().optional(),
})

const StrategyOverrideSchema = z.object({
  name: z.string(),
  description: z.string(),
  condition: StrategyOverrideConditionSchema,
  effects: StrategyOverrideEffectsSchema,
})

const ThematicMappingSchema = z.object({
  color_scheme: z.array(z.string()).optional(),
  lighting_style: z.string().optional(),
  composition: z.string().optional(),
  color_temperature: z.string().optional(),
  depth_of_field: z.string().optional(),
  style: z.array(z.string()).optional(),
  atmospheric_effects: z.array(z.string()).optional(),
  priority_weight: z.number().optional(),
})

const StrategyLayersSchema = z.object({
  overrides: z.array(StrategyOverrideSchema),
})

const ThematicMappingsSchema = z.record(z.string(), ThematicMappingSchema)

const VisualConfigSchema = z.object({
  version: z.string(),
  metadata: z
    .object({
      description: z.string(),
      lastUpdated: z.string(),
      author: z.string(),
    })
    .optional(),
  strategy_layers: z
    .object({
      overrides: z.array(StrategyOverrideSchema),
    })
    .optional(),
  thematic_mappings: ThematicMappingsSchema.optional(),
  strategy: StrategySchema,
  prompt_engineering: PromptEngineeringSchema,
  emotions: z.record(z.string(), EmotionVisualSchema),
  actions: z.record(z.string(), ActionMappingSchema),
  action_keywords: z.record(z.string(), z.array(z.string())),
  lighting_presets: z.record(z.string(), z.string()),
  styles: z.record(z.string(), z.array(z.string())),
  style_negatives: z.record(z.string(), z.array(z.string())).optional(),
  atmospheric_effects: z.record(z.string(), z.array(z.string())),
  negative_prompts: NegativePromptsSchema,
  color_palettes: z.record(z.string(), z.array(z.string())),
  weather_palettes: z.record(z.string(), z.array(z.string())).optional(),
  llm: LlmSchema,
  panel_generation: PanelGenerationSchema,
  continuity: ContinuitySchema,
  hash: HashSchema,
  cache: z
    .object({
      max_size: z.number().int().min(64).default(256),
      ttl_ms: z.number().int().min(60000).default(30 * 60 * 1000),
    })
    .optional(),
})

// ============================================================================
// TYPES (Inferred from Schema)
// ============================================================================

export type VisualConfig = z.infer<typeof VisualConfigSchema>
export type EmotionVisual = z.infer<typeof EmotionVisualSchema>
export type ActionMapping = z.infer<typeof ActionMappingSchema>
export type CameraSpec = z.infer<typeof CameraSpecSchema>

// ============================================================================
// NEW: STRATEGY LAYER TYPES
// ============================================================================

export type StrategyOverride = z.infer<typeof StrategyOverrideSchema>
export type StrategyOverrideEffects = z.infer<typeof StrategyOverrideEffectsSchema>
export type ThematicMapping = z.infer<typeof ThematicMappingSchema>

/**
 * Visual context for dynamic strategy resolution
 */
export interface VisualContext {
  tensionLevel: number
  activeMotifs: string[]
  currentEmotion?: string
  currentAction?: string
}

/**
 * Resolved visual specification after applying all strategy layers
 */
export interface ResolvedVisualSpec {
  camera?: CameraSpec & Record<string, unknown>
  lighting?: string | Record<string, unknown>
  composition?: string
  atmosphere?: string[]
  negative_prompts?: string[]
  style?: string[]
  color_scheme?: string[]
  color_temperature?: string
  depth_of_field?: string
  atmospheric_effects?: string[]
}

/**
 * Internal state for voting mechanism
 */
interface VotingState {
  thematicVotes: Map<string, number>
  appliedMappings: Set<string>
  totalWeight: number
}

// ============================================================================
// CONFIG LOADER
// ============================================================================

let cachedConfig: VisualConfig | null = null
let configLoadTime: number = 0
const CONFIG_CACHE_TTL = 60000 // 1 minute cache

/**
 * Gets the path to the visual config file.
 * Supports environment variable override.
 */
function getConfigPath(): string {
  const envPath = process.env.VISUAL_CONFIG_PATH
  if (envPath) {
    return resolve(envPath)
  }

  // Try multiple strategies to find the config file
  const candidates: string[] = []

  // Strategy 1: Try to get module directory from import.meta.url
  try {
    const url = import.meta.url
    if (url && url.startsWith("file://")) {
      let moduleDir = dirname(fileURLToPath(url))

      // Fix for bun sandbox paths (e.g., /$bunfs/root/...)
      if (moduleDir.startsWith("/$bunfs")) {
        // Extract the actual source path after the sandbox prefix
        const relativePath = moduleDir.replace(/^\/\$bunfs\/(?:root|home)/, "")
        // Try to resolve relative to current working directory
        moduleDir = resolve(process.cwd(), relativePath)
      }

      candidates.push(resolve(moduleDir, "visual-config.json"))
    }
  } catch (e) {
    log.debug("import.meta.url strategy failed", { error: String(e) })
  }

  // Strategy 2: Use __dirname (works in most Bun environments)
  try {
    if (typeof __dirname !== "undefined") {
      candidates.push(resolve(__dirname, "visual-config.json"))
    }
  } catch (e) {
    log.debug("__dirname strategy failed", { error: String(e) })
  }

  // Strategy 3: Try hardcoded path relative to package root
  candidates.push(
    resolve(process.cwd(), "src", "novel", "config", "visual-config.json"),
    resolve(process.cwd(), "packages", "opencode", "src", "novel", "config", "visual-config.json"),
  )

  // Find the first existing file
  for (const configPath of candidates) {
    try {
      if (existsSync(configPath)) {
        log.debug("config_path_found", { path: configPath })
        return configPath
      }
    } catch (e) {
      log.debug("config_path_check_failed", { path: configPath, error: String(e) })
    }
  }

  // Return the default path even if it doesn't exist (will error later)
  return candidates[0] ?? resolve(process.cwd(), "src", "novel", "config", "visual-config.json")
}

/**
 * Loads and validates the visual configuration.
 * Results are cached for performance.
 *
 * @param forceReload - Force reload from file, ignoring cache
 * @returns Validated configuration object
 * @throws Error if config file not found or validation fails
 */
export async function loadVisualConfig(forceReload = false): Promise<VisualConfig> {
  const now = Date.now()

  // Return cached config if still valid
  if (!forceReload && cachedConfig && now - configLoadTime < CONFIG_CACHE_TTL) {
    return cachedConfig
  }

  const configPath = getConfigPath()

  try {
    log.info("loading_visual_config", { path: configPath })

    const content = await readFile(configPath, "utf-8")
    const raw = JSON.parse(content)

    // Validate with Zod schema
    const result = VisualConfigSchema.safeParse(raw)

    if (!result.success) {
      const errors = result.error.issues.map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`).join("; ")

      log.error("config_validation_failed", { errors })

      // If we have a cached config, use it as fallback
      if (cachedConfig) {
        log.warn("using_cached_config_as_fallback")
        return cachedConfig
      }

      throw new Error(`Visual config validation failed: ${errors}`)
    }

    cachedConfig = result.data
    configLoadTime = now

    log.info("visual_config_loaded", {
      version: result.data.version,
      emotions: Object.keys(result.data.emotions).length,
      actions: Object.keys(result.data.actions).length,
      styles: Object.keys(result.data.styles).length,
    })

    return result.data
  } catch (error) {
    // If file not found but we have cached config, use it
    if (cachedConfig) {
      log.warn("config_load_failed_using_cache", { error: String(error) })
      return cachedConfig
    }

    log.error("visual_config_load_failed", { error: String(error), path: configPath })
    throw error
  }
}

/**
 * Gets the current cached config or throws if not loaded.
 * Use loadVisualConfig() for async loading with caching.
 */
export function getVisualConfig(): VisualConfig {
  if (!cachedConfig) {
    throw new Error("Visual config not loaded. Call loadVisualConfig() first.")
  }
  return cachedConfig
}

/**
 * Clears the config cache, forcing reload on next access.
 */
export function clearConfigCache(): void {
  cachedConfig = null
  configLoadTime = 0
  log.info("visual_config_cache_cleared")
}

/**
 * Reloads configuration from file.
 * Useful for hot-reload scenarios.
 */
export async function reloadVisualConfig(): Promise<VisualConfig> {
  log.info("reloading_visual_config")
  return loadVisualConfig(true)
}

// ============================================================================
// CONVENIENCE HELPERS
// ============================================================================

/**
 * Gets emotion visual mapping from config.
 */
export function getEmotionVisual(emotion: string, config?: VisualConfig): EmotionVisual | null {
  const cfg = config || cachedConfig
  if (!cfg) return null

  const normalized = emotion.toLowerCase().trim()
  return cfg.emotions[normalized] || null
}

/**
 * Gets action camera mapping from config.
 */
export function getActionMapping(action: string, config?: VisualConfig): ActionMapping | null {
  const cfg = config || cachedConfig
  if (!cfg) return null

  const normalized = action.toLowerCase().trim()
  return cfg.actions[normalized] || null
}

/**
 * Gets lighting preset from config.
 */
export function getLightingPreset(preset: string, config?: VisualConfig): string | null {
  const cfg = config || cachedConfig
  if (!cfg) return null

  return cfg.lighting_presets[preset.toLowerCase()] || null
}

/**
 * Gets style modifiers from config.
 */
export function getStyleModifiers(style: string, config?: VisualConfig): string[] {
  const cfg = config || cachedConfig
  if (!cfg) return []

  return cfg.styles[style.toLowerCase()] || []
}

/**
 * Checks if an emotion should trigger LLM usage.
 */
export function isComplexEmotion(emotion: string, config?: VisualConfig): boolean {
  const cfg = config || cachedConfig
  if (!cfg) return false

  const normalized = emotion.toLowerCase().trim()
  return cfg.strategy.llm_threshold.complex_emotions.some((e) => normalized.includes(e.toLowerCase()))
}

/**
 * Checks if an action should trigger LLM usage.
 */
export function isComplexAction(action: string, config?: VisualConfig): boolean {
  const cfg = config || cachedConfig
  if (!cfg) return false

  const normalized = action.toLowerCase().trim()
  return cfg.strategy.llm_threshold.complex_actions.some((a) => normalized.includes(a.toLowerCase()))
}

log.info("visual_config_loader_initialized")
