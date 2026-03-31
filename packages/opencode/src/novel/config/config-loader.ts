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

// ============================================================================
// NEW: CORE STRATEGY RESOLVER
// ============================================================================

/**
 * Predefined conflict groups for negative prompts
 * If two terms in the same group both appear, they cancel each other out
 */
const DEFAULT_CONFLICT_GROUPS: string[][] = [
  // Temperature conflicts
  ["warm_tones", "cold_tones", "warm", "cold", "cool"],
  // Lighting conflicts
  ["bright", "dark", "low_key", "high_key"],
  // Style conflicts
  ["realistic", "abstract", "surreal", "photorealistic"],
  // Composition conflicts
  ["centered", "off_center", "symmetrical", "asymmetric"],
  // Focus conflicts
  ["sharp_focus", "soft_focus", "blurry", "deep_focus"],
]

/**
 * Detects and resolves conflicts in negative prompts array
 *
 * @param negativePrompts - Array of negative prompt terms
 * @param conflictGroups - Custom conflict groups from config (or default)
 * @returns Resolved array with conflicts removed
 */
function resolveNegativePromptConflicts(
  negativePrompts: string[],
  conflictGroups: string[][] = DEFAULT_CONFLICT_GROUPS,
): string[] {
  const result = new Set<string>(negativePrompts)

  for (const group of conflictGroups) {
    // Find all terms from this conflict group that are present
    const presentTerms = group.filter((term) => result.has(term))

    // If multiple conflicting terms exist, remove all of them
    if (presentTerms.length > 1) {
      log.warn("negative_prompt_conflict_detected", {
        group,
        presentTerms,
        action: "removing_all_conflicting_terms",
      })

      presentTerms.forEach((term) => result.delete(term))
    }
  }

  return Array.from(result)
}

/**
 * Calculates dynamic weight for a thematic mapping based on:
 * 1. Base priority weight from config
 * 2. Number of active motifs that match
 * 3. Tension level bonus
 *
 * @param mapping - Thematic mapping from config
 * @param context - Current visual context
 * @param activeMotifCount - Number of active motifs that triggered this mapping
 * @returns Calculated weight (0-10 scale)
 */
function calculateDynamicWeight(mapping: ThematicMapping, context: VisualContext, activeMotifCount: number): number {
  // Base weight from config (default: 1)
  let weight = mapping.priority_weight || 1

  // Bonus for multiple motif matches (each additional motif adds 0.5)
  if (activeMotifCount > 1) {
    weight += (activeMotifCount - 1) * 0.5
  }

  // Bonus for high tension scenes (tension > 0.7 adds 1.0)
  if (context.tensionLevel > 0.7) {
    weight += 1.0
  }

  // Cap at 10
  return Math.min(10, weight)
}

/**
 * Applies thematic mapping with voting mechanism
 *
 * Instead of binary apply/skip, each motif casts "votes" proportional to its weight.
 * Mappings with higher votes have stronger influence on final result.
 */
function applyThematicMappingWithVoting(mapping: ThematicMapping, motifName: string, votingState: VotingState): void {
  votingState.thematicVotes.set(motifName, (votingState.thematicVotes.get(motifName) || 0) + 1)
  votingState.appliedMappings.add(motifName)
  votingState.totalWeight += mapping.priority_weight || 1
}

/**
 * Core strategy resolver: calculates final visual parameters based on current story state
 *
 * This is the main entry point for dynamic visual strategy.
 *
 * Flow:
 * 1. Base Layer: Read base configuration (e.g., default config based on emotion)
 * 2. Override Layer: Iterate through strategy_layers.overrides and check if context satisfies condition
 * 3. Merge: If condition is satisfied, deep merge effects into base configuration
 * 4. Thematic Voting: Apply thematic mappings with voting mechanism
 * 5. Conflict Resolution: Resolve conflicts in negative prompts
 *
 * @param context - Current story state (tension, motifs, emotion, action)
 * @returns Resolved visual specification with all strategy layers applied
 */
export function resolveVisualSpec(context: VisualContext): ResolvedVisualSpec {
  const config = getVisualConfig()
  const result: ResolvedVisualSpec = {
    negative_prompts: [...config.negative_prompts.base],
    style: [],
  }

  // Initialize voting state for thematic mappings
  const votingState: VotingState = {
    thematicVotes: new Map<string, number>(),
    appliedMappings: new Set<string>(),
    totalWeight: 0,
  }

  // --- Step 1: Apply base mapping (enhanced version of original logic) ---
  if (context.currentEmotion) {
    const baseEmotion = getEmotionVisual(context.currentEmotion)
    if (baseEmotion) {
      // Map emotion visuals to resolved spec
      result.camera = {
        ...(result.camera || {}),
        // Body language and expression can inform camera framing
      }
    }
  }

  if (context.currentAction) {
    const baseAction = getActionMapping(context.currentAction)
    if (baseAction) {
      result.camera = { ...result.camera, ...baseAction.camera }
      result.lighting = baseAction.lighting
      result.composition = baseAction.composition
    }
  }

  // --- Step 2: Apply dynamic overrides (new core logic) ---
  if (config.strategy_layers?.overrides) {
    config.strategy_layers.overrides.forEach((override) => {
      let shouldApply = true

      // Check tension condition
      if (override.condition.story_tension?.min !== undefined) {
        if (context.tensionLevel < override.condition.story_tension.min) {
          shouldApply = false
        }
      }

      if (override.condition.story_tension?.max !== undefined) {
        if (context.tensionLevel > override.condition.story_tension.max) {
          shouldApply = false
        }
      }

      // Check motif condition
      if (override.condition.active_motifs?.length) {
        const hasMatch = override.condition.active_motifs.some((motif) => context.activeMotifs.includes(motif))
        if (!hasMatch) shouldApply = false
      }

      // --- Step 3: Merge effects if condition satisfied ---
      if (shouldApply && override.effects) {
        const effects = override.effects

        // Camera parameters deep merge
        if (effects.camera) {
          result.camera = { ...result.camera, ...effects.camera }
        }

        // Lighting merge
        if (effects.lighting) {
          if (typeof effects.lighting === "string") {
            result.lighting = effects.lighting
          } else {
            result.lighting = { ...(typeof result.lighting === "object" ? result.lighting : {}), ...effects.lighting }
          }
        }

        // Composition
        if (effects.composition) {
          result.composition = effects.composition
        }

        // Atmospheric effects merge
        if (effects.atmospheric_effects) {
          result.atmospheric_effects = [
            ...new Set([...(result.atmospheric_effects || []), ...effects.atmospheric_effects]),
          ]
        }

        // Negative prompts merge (deduplication - conflicts resolved later)
        if (effects.negative_prompts_add) {
          result.negative_prompts = [...new Set([...(result.negative_prompts || []), ...effects.negative_prompts_add])]
        }

        // Style merge (deduplication)
        if (effects.style) {
          result.style = [...new Set([...(result.style || []), ...effects.style])]
        }

        // Color scheme
        if (effects.color_scheme) {
          result.color_scheme = effects.color_scheme
        }

        // Color temperature
        if (effects.color_temperature) {
          result.color_temperature = effects.color_temperature
        }

        // Depth of field
        if (effects.depth_of_field) {
          result.depth_of_field = effects.depth_of_field
        }
      }
    })
  }

  // --- Step 4: Apply thematic mappings with VOTING MECHANISM ---
  if (config.thematic_mappings) {
    // Count motif matches for each mapping
    const motifMatchCounts = new Map<string, number>()

    for (const [motif, mapping] of Object.entries(config.thematic_mappings)) {
      if (context.activeMotifs.includes(motif)) {
        // Calculate dynamic weight based on matches and context
        const dynamicWeight = calculateDynamicWeight(mapping, context, 1)

        // Cast vote for this mapping
        applyThematicMappingWithVoting(mapping, motif, votingState)
        motifMatchCounts.set(motif, dynamicWeight)

        log.debug("thematic_mapping_voted", {
          motif,
          dynamicWeight,
          baseWeight: mapping.priority_weight || 1,
          tensionBonus: context.tensionLevel > 0.7 ? 1.0 : 0,
        })
      }
    }

    // Apply mappings based on voting results
    // Mappings with higher votes have stronger influence
    const sortedMotifs = Array.from(motifMatchCounts.entries()).sort((a, b) => b[1] - a[1]) // Sort by weight descending

    for (const [motif, weight] of sortedMotifs) {
      const mapping = config.thematic_mappings[motif]
      if (!mapping) continue

      // Normalize influence based on weight ratio
      const influenceRatio = weight / votingState.totalWeight

      log.info("applying_thematic_mapping", {
        motif,
        weight,
        influenceRatio: influenceRatio.toFixed(2),
        totalWeight: votingState.totalWeight,
      })

      // Apply with full strength if weight ratio > 0.3 (dominant theme)
      // Apply with partial strength if weight ratio 0.1-0.3 (supporting theme)
      // Skip if weight ratio < 0.1 (minor theme)
      if (influenceRatio >= 0.1) {
        if (influenceRatio >= 0.3) {
          // Dominant theme: full application
          if (mapping.lighting_style) result.lighting = mapping.lighting_style
          if (mapping.composition) result.composition = mapping.composition
          if (mapping.color_scheme) result.color_scheme = mapping.color_scheme
          if (mapping.color_temperature) result.color_temperature = mapping.color_temperature
          if (mapping.depth_of_field) result.depth_of_field = mapping.depth_of_field
          if (mapping.style) {
            result.style = [...new Set([...(result.style || []), ...mapping.style])]
          }
          if (mapping.atmospheric_effects) {
            result.atmospheric_effects = [
              ...new Set([...(result.atmospheric_effects || []), ...mapping.atmospheric_effects]),
            ]
          }
        } else {
          // Supporting theme: blend with existing (simplified - just add unique elements)
          if (mapping.color_scheme && !result.color_scheme) {
            result.color_scheme = mapping.color_scheme
          }
          if (mapping.atmospheric_effects) {
            const newEffects = mapping.atmospheric_effects.filter((e) => !result.atmospheric_effects?.includes(e))
            result.atmospheric_effects = [
              ...(result.atmospheric_effects || []),
              ...newEffects.slice(0, Math.floor(mapping.atmospheric_effects.length * influenceRatio * 3)),
            ]
          }
        }
      }
    }
  }

  // --- Step 5: Resolve negative prompt conflicts ---
  if (result.negative_prompts && result.negative_prompts.length > 0) {
    const conflictGroups = config.negative_prompts.conflict_groups || DEFAULT_CONFLICT_GROUPS
    result.negative_prompts = resolveNegativePromptConflicts(result.negative_prompts, conflictGroups)
  }

  // Log final resolved spec summary
  log.info("visual_spec_resolved", {
    context: {
      tension: context.tensionLevel.toFixed(2),
      motifs: context.activeMotifs.length,
      emotion: context.currentEmotion || "none",
      action: context.currentAction || "none",
    },
    appliedOverrides: config.strategy_layers?.overrides?.length || 0,
    appliedMappings: votingState.appliedMappings.size,
    totalThematicWeight: votingState.totalWeight.toFixed(1),
    finalNegativePrompts: result.negative_prompts?.length || 0,
  })

  return result
}

log.info("visual_config_loader_initialized")
