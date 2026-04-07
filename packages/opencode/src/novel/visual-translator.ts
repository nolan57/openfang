import { Log } from "../util/log"
import { callLLMJson } from "./llm-wrapper"
import {
  loadVisualConfig,
  getVisualConfig,
  getEmotionVisual,
  getLightingPreset as getConfigLightingPreset,
  getStyleModifiers as getConfigStyleModifiers,
  isComplexEmotion,
  isComplexAction,
  reloadVisualConfig as _reloadConfig,
  clearConfigCache as _clearConfigCache,
  type VisualConfig,
} from "./config"
import { type VisualPanelSpec, type CameraSpec, type ControlNetSignals } from "./types"

export type { VisualPanelSpec, CameraSpec, ControlNetSignals }

const log = Log.create({ service: "visual-translator" })

// ============================================================================
// CONFIGURATION-DRIVEN DESIGN
// All hardcoded values have been moved to visual-config.json
// This module now reads from the config for all parameters.
// ============================================================================

// Cache for config (loaded lazily)
let config: VisualConfig | null = null

/**
 * Gets the current config, loading it if necessary.
 * For sync contexts where config has already been loaded via `loadVisualConfig()`.
 */
function getConfig(): VisualConfig {
  if (!config) {
    config = getVisualConfig()
  }
  return config
}

// ============================================================================
// VISUAL PANEL CACHE (Phase B: Cache System)
// ============================================================================

/**
 * LRU cache for assembled panel specs.
 * Keyed by deterministic content hash — identical inputs always return cached result.
 */
interface CacheEntry {
  spec: VisualPanelSpec
  timestamp: number
}

const panelCache = new Map<string, CacheEntry>()
const DEFAULT_CACHE_MAX_SIZE = 256
const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

/**
 * Generates a cache key from panel input parameters.
 */
function generatePanelCacheKey(input: PanelSpecInput): string {
  const charNames = input.characters.map((c) => c.name).join(",")
  const canon = JSON.stringify({
    panelIndex: input.panelIndex,
    beatText: input.beat.text.slice(0, 100),
    chars: charNames,
    emotion: input.beat.emotion,
    action: input.beat.action,
    location: input.scene.location,
    timeOfDay: input.scene.timeOfDay,
    tone: input.scene.tone,
    style: input.scene.style,
  })
  return `panel:${djb2Hash(canon)}`
}

/**
 * Gets a panel from cache if available and not expired.
 */
function getCachedPanel(cacheKey: string): VisualPanelSpec | null {
  const entry = panelCache.get(cacheKey)
  if (!entry) return null

  const ttl = getConfig().cache?.ttl_ms ?? DEFAULT_CACHE_TTL_MS
  if (Date.now() - entry.timestamp > ttl) {
    panelCache.delete(cacheKey)
    return null
  }

  return entry.spec
}

/**
 * Stores a panel in the cache, evicting LRU entries if at capacity.
 */
function cachePanel(cacheKey: string, spec: VisualPanelSpec): void {
  const maxSize = getConfig().cache?.max_size ?? DEFAULT_CACHE_MAX_SIZE

  if (panelCache.size >= maxSize) {
    // Evict oldest entry
    const firstKey = panelCache.keys().next().value
    if (firstKey) panelCache.delete(firstKey)
  }

  panelCache.set(cacheKey, { spec, timestamp: Date.now() })
}

/**
 * Clears the visual panel cache.
 */
export function clearPanelCache(): void {
  panelCache.clear()
  log.info("panel_cache_cleared")
}

/**
 * Returns cache statistics for monitoring.
 */
export function getPanelCacheStats(): { size: number; maxSize: number } {
  const cfg = getConfig()
  return {
    size: panelCache.size,
    maxSize: cfg.cache?.max_size ?? DEFAULT_CACHE_MAX_SIZE,
  }
}

// ============================================================================
// COMPLEXITY DETECTION (Phase A: LLM Enhancement)
// ============================================================================

/**
 * Determines if a scene is complex enough to warrant LLM enhancement.
 *
 * Complexity triggers:
 * 1. Multiple characters with distinct emotions (3+)
 * 2. Complex/abstract emotion types
 * 3. Complex action types
 * 4. High emotion intensity (≥0.8)
 * 5. Theme-driven generic actions requiring thematic lighting
 */
function isComplexScene(input: PanelSpecInput): boolean {
  const { beat, characters, scene } = input

  // Multiple characters on screen with distinct emotions
  if (characters.length >= 3) return true

  // Complex emotion types
  if (beat.emotion && isComplexEmotion(beat.emotion)) return true

  // High intensity emotion
  if (beat.emotionIntensity != null && beat.emotionIntensity >= 0.8) return true

  // Complex action types
  if (beat.action && isComplexAction(beat.action)) return true

  // Theme-driven generic action
  if (scene.tone && (beat.action === "conversation" || beat.action === "emotional")) {
    const toneLower = scene.tone.toLowerCase()
    if (toneLower.includes("betray") || toneLower.includes("redempt") || toneLower.includes("myster")) {
      return true
    }
  }

  return false
}

/**
 * LLM enhancement result for complex visual scenes.
 */
interface LLMEnhancement {
  /** LLM-suggested visual prompt additions/modifications */
  visualSuggestions?: string
  /** LLM-suggested negative prompt additions */
  negativeSuggestions?: string
  /** LLM-suggested composition changes */
  compositionSuggestion?: string
  /** Confidence score (0-1) */
  confidence: number
}

// ============================================================================
// PROMPT PRIORITY SYSTEM (Configuration-Driven)
// ============================================================================

/**
 * Categorizes a prompt element into its priority level.
 * Priority keywords are loaded from configuration.
 */
function categorizePromptElement(element: string): number {
  const cfg = getConfig()
  const lower = element.toLowerCase()
  const keywords = cfg.prompt_engineering.priority_keywords
  const weights = cfg.prompt_engineering.priority_weights

  // Check each priority category
  if (keywords.subject_action.some((kw) => lower.includes(kw)) || lower.startsWith("(")) {
    return weights.subject_action
  }
  if (keywords.camera_lighting.some((kw) => lower.includes(kw))) {
    return weights.camera_lighting
  }
  if (keywords.style_atmosphere.some((kw) => lower.includes(kw))) {
    return weights.style_atmosphere
  }

  return weights.background
}

/**
 * Estimates token count for a string.
 * Uses word count with configurable estimation factor.
 */
function estimateTokens(text: string): number {
  const cfg = getConfig()
  const words = text.split(/\s+/).filter((w) => w.length > 0)
  return Math.ceil(words.length * cfg.prompt_engineering.token_estimation_factor)
}

/**
 * Prioritizes and truncates prompt elements to fit within token limits.
 * Max tokens and priority weights are loaded from configuration.
 *
 * @param elements - Array of prompt element strings
 * @param maxTokens - Maximum allowed tokens (defaults to config value)
 * @returns Truncated and prioritized prompt string
 */
export function prioritizeAndTruncatePrompt(elements: string[], maxTokens?: number): string {
  const cfg = getConfig()
  const limit = maxTokens ?? cfg.prompt_engineering.max_token_limit

  // Tag each element with its priority
  const tagged = elements.map((el) => ({
    element: el,
    priority: categorizePromptElement(el),
    tokens: estimateTokens(el),
  }))

  // Sort by priority (lower number = higher priority)
  tagged.sort((a, b) => a.priority - b.priority)

  // Accumulate elements until we hit the token limit
  const selected: string[] = []
  let currentTokens = 0
  const highPriorityThreshold = cfg.prompt_engineering.priority_weights.camera_lighting

  for (const item of tagged) {
    if (currentTokens + item.tokens <= limit) {
      selected.push(item.element)
      currentTokens += item.tokens
    } else {
      // Try to fit a truncated version if it's high priority
      if (item.priority <= highPriorityThreshold) {
        const words = item.element.split(/\s+/)
        let truncated = ""
        let truncatedTokens = 0

        for (const word of words) {
          const wordTokens = estimateTokens(word)
          if (currentTokens + truncatedTokens + wordTokens <= limit) {
            truncated += (truncated ? " " : "") + word
            truncatedTokens += wordTokens
          } else {
            break
          }
        }

        if (truncated) {
          selected.push(truncated)
        }
      }
      break
    }
  }

  return selected.join(", ")
}

// ============================================================================
// DETERMINISTIC HASH ALGORITHM (Configuration-Driven)
// ============================================================================

/**
 * Character state snapshot for hash generation.
 */
export interface CharacterStateSnapshot {
  outfitDetails?: string
  injuryDetails?: string
  emotionalState?: string
}

/**
 * Psychological profile for character-aware visual translation.
 */
export interface PsychologicalProfile {
  coreFear?: string
  attachmentStyle?: string
}

/**
 * Generates a deterministic hash using the DJB2 algorithm.
 * Initial value is loaded from configuration.
 */
function djb2Hash(str: string): string {
  const cfg = getConfig()
  let hash = cfg.hash.initial_value
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i)
  }
  return (hash >>> 0).toString(16)
}

/**
 * Generates a deterministic visual hash for character consistency.
 * Hash version is loaded from configuration.
 * Internal only — use `generateStableCharacterRefUrl()` for public API.
 */
function generateDeterministicVisualHash(characterId: string, stateSnapshot: CharacterStateSnapshot): string {
  const cfg = getConfig()

  // Create a canonical string representation
  const canonical = JSON.stringify({
    id: characterId.toLowerCase().trim(),
    outfit: (stateSnapshot.outfitDetails || "").toLowerCase().trim(),
    injury: (stateSnapshot.injuryDetails || "").toLowerCase().trim(),
    emotion: (stateSnapshot.emotionalState || "").toLowerCase().trim(),
  })

  // Generate hash with version prefix
  const hash = djb2Hash(canonical)
  return `${cfg.hash.version}_${hash}`
}

/**
 * Generates a stable character reference URL based on deterministic hash.
 */
export function generateStableCharacterRefUrl(characterId: string, stateSnapshot: CharacterStateSnapshot): string {
  const hash = generateDeterministicVisualHash(characterId, stateSnapshot)
  return `mock://chars/${hash}/ref.png`
}

// ============================================================================
// EMOTION VISUAL MAPPING (Configuration-Driven)
// ============================================================================

/**
 * Translates emotion to visual descriptions.
 * Emotion mappings are loaded from configuration.
 *
 * @param emotion - The emotion to translate
 * @param intensity - Emotion intensity (0-1)
 * @param psychologicalProfile - Optional psychological profile for character-aware translation
 * @returns Visual descriptors for expression, body language, and facial features
 */
export function translateEmotionToVisuals(
  emotion: string,
  intensity: number = 0.5,
  psychologicalProfile?: PsychologicalProfile,
): {
  expression: string
  bodyLanguage: string
  facialFeatures: string
} {
  const mapping = getEmotionVisual(emotion)

  if (!mapping) {
    return {
      expression: "neutral expression",
      bodyLanguage: "neutral stance",
      facialFeatures: "relaxed face",
    }
  }

  const intensityMultiplier = Math.min(Math.max(intensity, 0), 1)
  const boosted = intensityMultiplier > 0.7

  let expression = boosted ? mapping.expression : mapping.expression.split(", ").slice(0, 2).join(", ")
  let bodyLanguage = boosted ? mapping.bodyLanguage : mapping.bodyLanguage.split(", ").slice(0, 2).join(", ")
  let facialFeatures = boosted ? mapping.facialFeatures : mapping.facialFeatures.split(", ").slice(0, 2).join(", ")

  // Modify based on psychological profile for character-aware translation
  if (psychologicalProfile) {
    const { attachmentStyle, coreFear } = psychologicalProfile

    // Avoidant attachment: add distance/closure even in positive emotions
    if (attachmentStyle === "avoidant") {
      if (emotion === "joy" || emotion === "happy") {
        bodyLanguage = "smiling but with closed-off posture, arms crossed, maintaining distance"
      } else if (emotion === "love" || emotion === "affection") {
        expression = "gentle smile with hesitant eyes, guarded expression"
        bodyLanguage = "leaning slightly away, protective posture"
      }
    }

    // Anxious attachment: add neediness/clinginess
    if (attachmentStyle === "anxious") {
      if (emotion === "joy" || emotion === "happy") {
        bodyLanguage = "eager posture, leaning in, seeking validation through eye contact"
      } else if (emotion === "sadness" || emotion === "fear") {
        bodyLanguage = "clinging posture, seeking proximity, worried expression"
      }
    }

    // Core fear influence: add subtle tension related to core fear
    if (coreFear) {
      const fearLower = coreFear.toLowerCase()
      if (fearLower.includes("betray") || fearLower.includes("trust")) {
        facialFeatures += ", subtle wariness in eyes, guarded expression"
      } else if (fearLower.includes("abandon") || fearLower.includes("lonely")) {
        bodyLanguage += ", seeking connection, watchful gaze"
      } else if (fearLower.includes("fail") || fearLower.includes("incompetent")) {
        bodyLanguage += ", tense shoulders, self-conscious posture"
      }
    }
  }

  return {
    expression,
    bodyLanguage,
    facialFeatures,
  }
}

// ============================================================================
// ACTION CAMERA MAPPING (Configuration-Driven)
// ============================================================================

/**
 * Translates action to camera settings.
 * Action mappings are loaded from configuration.
 *
 * @param action - The action to translate
 * @param context - Contextual information about the scene
 * @param currentTheme - Optional current story theme for thematic visual adjustments
 * @returns Camera settings, lighting, and composition
 */
export function translateActionToCamera(
  action: string,
  context: string = "",
  currentTheme?: string,
): {
  camera: Partial<CameraSpec>
  lighting: string
  composition: string
} {
  const cfg = getConfig()
  const normalizedAction = action.toLowerCase().trim()
  const contextLower = context.toLowerCase()

  let mapping = cfg.actions[normalizedAction]

  if (!mapping) {
    // One-way containment: config key must contain the input action.
    // E.g., config key "fight" matches input "intense fight" but not vice versa,
    // avoiding false matches like "talk" matching "walk".
    const actionKeys = Object.keys(cfg.actions)
    const keywordMatch = actionKeys.find((key) => key.includes(normalizedAction))
    if (keywordMatch) {
      mapping = cfg.actions[keywordMatch]
    }
  }

  if (!mapping) {
    // Context-based fallback
    if (contextLower.includes("dark") || contextLower.includes("secret")) {
      mapping = cfg.actions.mysterious
    } else if (contextLower.includes("love") || contextLower.includes("affection")) {
      mapping = cfg.actions.romantic
    } else if (contextLower.includes("fight") || contextLower.includes("battle")) {
      mapping = cfg.actions.action
    } else {
      mapping = cfg.actions.conversation
    }
  }

  // Cast camera properties to match CameraSpec types
  const camera: Partial<CameraSpec> = {
    shot: mapping.camera.shot as import("./types").CameraShot | undefined,
    angle: mapping.camera.angle as import("./types").CameraAngle | undefined,
    movement: mapping.camera.movement as import("./types").CameraMovement | undefined,
    depthOfField: mapping.camera.depthOfField as "shallow" | "deep" | "none" | undefined,
  }

  let lighting = mapping.lighting
  let composition = mapping.composition

  // Apply theme-based adjustments for generic actions
  if (currentTheme && (normalizedAction === "conversation" || normalizedAction === "emotional")) {
    const themeLower = currentTheme.toLowerCase()

    // Betrayal theme: add dramatic lighting even for conversations
    if (themeLower.includes("betray") || themeLower.includes("deceit")) {
      lighting = "chiaroscuro, high contrast lighting, dramatic shadows"
      composition = "asymmetric composition, character isolation"
    }

    // Redemption theme: warmer, more hopeful lighting
    if (themeLower.includes("redempt") || themeLower.includes("forgive")) {
      lighting = "warm golden hour lighting, soft glow"
      composition = "balanced composition, open framing"
    }

    // Mystery/thriller theme: darker, more suspenseful
    if (themeLower.includes("myster") || themeLower.includes("thrill")) {
      lighting = "low-key lighting, deep shadows, motivated light sources"
      composition = "dutch angle, tight framing"
    }

    // Romance theme: softer, more intimate
    if (themeLower.includes("romance") || themeLower.includes("love")) {
      lighting = "soft diffused lighting, warm tones"
      composition = "close two-shot, intimate framing"
    }
  }

  return {
    camera,
    lighting,
    composition,
  }
}

// ============================================================================
// LIGHTING PRESETS (Configuration-Driven)
// ============================================================================

/**
 * Selects a lighting preset by name.
 * Presets are loaded from configuration.
 */
export function selectLightingPreset(preset: string): string {
  const result = getConfigLightingPreset(preset)
  return result || getConfig().lighting_presets.natural
}

// ============================================================================
// STYLE MODIFIERS (Configuration-Driven)
// ============================================================================

/**
 * Selects style modifiers by style name.
 * Modifiers are loaded from configuration.
 */
export function selectStyleModifiers(style: string): string[] {
  const result = getConfigStyleModifiers(style)
  return result.length > 0 ? result : getConfig().styles.realistic
}

// ============================================================================
// ATMOSPHERIC EFFECTS (Configuration-Driven)
// ============================================================================

/**
 * Selects atmospheric effects by name.
 * Effects are loaded from configuration.
 */
export function selectAtmosphericEffects(effect: string): string[] {
  const cfg = getConfig()
  return cfg.atmospheric_effects[effect.toLowerCase()] || []
}

// ============================================================================
// NEGATIVE PROMPTS (Configuration-Driven)
// ============================================================================

/**
 * Gets shot-specific negative prompts.
 * Loaded from configuration.
 */
export function getShotSpecificNegatives(shot: string): string[] {
  const cfg = getConfig()
  return cfg.negative_prompts.shot_specific[shot] || []
}

/**
 * Gets movement-specific negative prompts.
 * Loaded from configuration.
 */
export function getMovementSpecificNegatives(movement: string): string[] {
  const cfg = getConfig()
  return cfg.negative_prompts.movement_specific[movement] || []
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Internal type for beat-level visual translation input.
 * Use the canonical types from ./types.ts for external consumers.
 */
interface LiteraryBeat {
  text: string
  emotion?: string
  emotionIntensity?: number
  action?: string
  context?: string
  tone?: string
  location?: string
  timeOfDay?: string
}

/**
 * Internal type for character visual state during translation.
 * Use the canonical types from ./types.ts for external consumers.
 */
interface CharacterState {
  name: string
  status?: string
  stress?: number
  traits?: string[]
  emotions?: { type: string; intensity: number }[]
  visualDescription?: string
  outfit?: string
  expression?: string
  injuries?: string
}

/**
 * Internal input type for panel spec assembly.
 * Not exported — consumers should construct the object shape inline.
 */
interface PanelSpecInput {
  beat: LiteraryBeat
  characters: CharacterState[]
  scene: {
    location?: string
    timeOfDay?: string
    tone?: string
    weather?: string
    style?: string
  }
  panelIndex: number
}

// ============================================================================
// PROMPT BUILDING
// ============================================================================

interface VisualPromptInput {
  characters: { name: string; description: string; expression: string; bodyLanguage: string }[]
  location?: string
  timeOfDay?: string
  tone?: string
  lighting?: string
  atmosphericEffects?: string[]
  styleModifiers?: string[]
}

/**
 * Builds and prioritizes a visual prompt from structured input.
 * Token limit and quality suffix are loaded from configuration.
 */
function buildVisualPrompt(input: VisualPromptInput, maxTokens?: number): string {
  const cfg = getConfig()
  const limit = maxTokens ?? cfg.prompt_engineering.max_token_limit

  const elements: string[] = []

  // Priority 1: Subject & Action
  for (const char of input.characters) {
    elements.push(`(${char.name}: ${char.description}, ${char.expression}, ${char.bodyLanguage})`)
  }

  // Priority 2: Camera & Lighting
  if (input.lighting) {
    elements.push(`lighting: ${input.lighting}`)
  }

  // Priority 3: Style & Atmosphere
  if (input.styleModifiers && input.styleModifiers.length > 0) {
    elements.push(`style: ${input.styleModifiers.slice(0, 3).join(", ")}`)
  }

  if (input.atmosphericEffects && input.atmosphericEffects.length > 0) {
    elements.push(`effects: ${input.atmosphericEffects.slice(0, 3).join(", ")}`)
  }

  // Priority 4: Background Details
  if (input.location) {
    elements.push(`at ${input.location}`)
  }

  if (input.timeOfDay) {
    elements.push(`during ${input.timeOfDay}`)
  }

  if (input.tone) {
    elements.push(`${input.tone} atmosphere`)
  }

  // Quality tags from config
  elements.push(cfg.prompt_engineering.quality_suffix.split(", ").slice(0, 2).join(", "))

  return prioritizeAndTruncatePrompt(elements, limit)
}

/**
 * Builds a dynamic negative prompt.
 * Base negatives and shot/movement specifics are loaded from configuration.
 */
function buildNegativePrompt(input: {
  emotions?: string
  style?: string
  shot?: string
  movement?: string
  avoid?: string[]
}): string {
  const cfg = getConfig()

  // Base negatives from config
  const baseAvoid = [...cfg.negative_prompts.base]

  // Style-specific negatives from config
  const styleAvoid = cfg.style_negatives?.[input.style?.toLowerCase() || ""] || []

  // Emotion-specific negatives
  const emotionAvoid =
    input.emotions === "joy" || input.emotions === "happy"
      ? ["sad", "crying", "tears", "grief"]
      : input.emotions === "sadness"
        ? ["happy", "joy", "smiling", "laughing"]
        : []

  // Shot-specific negatives from config
  const shotAvoid = input.shot ? getShotSpecificNegatives(input.shot) : []

  // Movement-specific negatives from config
  const movementAvoid = input.movement ? getMovementSpecificNegatives(input.movement) : []

  // Combine all negatives
  const allAvoid = [
    ...baseAvoid,
    ...styleAvoid,
    ...shotAvoid,
    ...movementAvoid,
    ...emotionAvoid,
    ...(input.avoid || []),
  ]

  // Remove duplicates
  const uniqueAvoid = [...new Set(allAvoid)]

  return uniqueAvoid.join(", ") + `, ${cfg.negative_prompts.quality_suffix}`
}

// ============================================================================
// COLOR PALETTE GENERATION (Configuration-Driven)
// ============================================================================

/**
 * Generates a color palette based on tone and weather.
 * Palettes are loaded from configuration.
 */
function generateColorPalette(tone?: string, weather?: string): string[] {
  const cfg = getConfig()

  if (weather && cfg.weather_palettes?.[weather.toLowerCase()]) {
    return cfg.weather_palettes[weather.toLowerCase()]
  }

  return cfg.color_palettes[tone?.toLowerCase() || ""] || cfg.color_palettes.light
}

/**
 * Uses LLM to validate and enhance a rule-based visual panel spec.
 * Only invoked for complex scenes where hardcoded rules may be insufficient.
 *
 * @param ruleBasedSpec - The spec generated by rules
 * @param input - Original panel input for context
 * @returns Enhancement suggestions from LLM
 */
async function enhanceWithLLM(ruleBasedSpec: VisualPanelSpec, input: PanelSpecInput): Promise<LLMEnhancement> {
  const charContext = input.characters
    .map((c) => `${c.name}: ${c.visualDescription || c.name}, stress=${c.stress ?? 0}, emotions=[${(c.emotions ?? []).map((e) => e.type).join(",")}]`)
    .join("\n")

  const prompt = `You are a visual composition expert for image generation prompts. Review this visual panel specification and suggest improvements.

## Scene Context
Characters on screen:
${charContext}

Beat text: ${input.beat.text.slice(0, 200)}
Emotion: ${input.beat.emotion ?? "none"} (intensity: ${input.beat.emotionIntensity ?? "default"})
Action: ${input.beat.action ?? "none"}
Tone: ${input.scene.tone ?? "narrative"}

## Current Panel Spec
- Camera: ${ruleBasedSpec.camera.shot} shot, ${ruleBasedSpec.camera.angle}, ${ruleBasedSpec.camera.movement}
- Lighting: ${ruleBasedSpec.lighting}
- Composition: ${ruleBasedSpec.composition}
- Visual Prompt: ${ruleBasedSpec.visualPrompt.slice(0, 200)}
- Negative Prompt: ${ruleBasedSpec.negativePrompt.slice(0, 100)}

## Task
Suggest improvements to make this panel more cinematically compelling and visually accurate.
Consider: character interactions, emotional undertones, thematic consistency, and visual storytelling.

Return ONLY a JSON object with these optional fields:
- "visualSuggestions": additional visual elements to append to the prompt
- "negativeSuggestions": additional negative terms to exclude  
- "compositionSuggestion": improved composition description
- "confidence": your confidence in these suggestions (0.0 to 1.0)`

  try {
    const result = await callLLMJson<LLMEnhancement>({
      prompt,
      system: "You are a visual composition expert. Respond with valid JSON only.",
      callType: "visual_enhancement",
      temperature: 0.3,
      maxTokens: 300,
      useRetry: true,
      metadata: { module: "visual-translator", task: "panel-enhancement" },
    })

    const enhancement = result.data
    if (!enhancement || enhancement.confidence < 0.3) {
      return { confidence: 0, visualSuggestions: "", negativeSuggestions: "" }
    }

    return {
      visualSuggestions: enhancement.visualSuggestions ?? "",
      negativeSuggestions: enhancement.negativeSuggestions ?? "",
      compositionSuggestion: enhancement.compositionSuggestion,
      confidence: enhancement.confidence ?? 0,
    }
  } catch (error) {
    log.error("llm_enhancement_failed", { error: String(error) })
    return { confidence: 0, visualSuggestions: "", negativeSuggestions: "" }
  }
}

// ============================================================================
// MAIN PANEL SPEC ASSEMBLY
// ============================================================================

/**
 * Assembles a complete VisualPanelSpec from structured input.
 * All parameters are loaded from configuration.
 * Uses panel cache for repeated identical inputs.
 */
export function assemblePanelSpec(input: PanelSpecInput): VisualPanelSpec {
  // Phase B: Cache lookup
  const cacheKey = generatePanelCacheKey(input)
  const cached = getCachedPanel(cacheKey)
  if (cached) {
    log.debug("panel_cache_hit", { key: cacheKey })
    return cached
  }

  const spec = _assemblePanelSpecInternal(input)

  // Phase B: Store in cache
  cachePanel(cacheKey, spec)

  return spec
}

/**
 * Assembles a VisualPanelSpec with optional LLM enhancement for complex scenes.
 *
 * For simple scenes, behaves identically to `assemblePanelSpec()`.
 * For complex scenes (multi-character, abstract emotions, thematic actions),
 * invokes LLM to validate and enhance the rule-based spec.
 *
 * @param input - Panel input parameters
 * @param options - Enhancement options
 * @returns VisualPanelSpec, optionally enhanced by LLM
 */
export async function assemblePanelSpecWithLLM(
  input: PanelSpecInput,
  options?: {
    /** Force LLM enhancement even for simple scenes */
    forceEnhancement?: boolean
    /** Minimum confidence threshold to apply LLM suggestions (default: 0.5) */
    minConfidence?: number
  },
): Promise<VisualPanelSpec> {
  // Build the rule-based spec first
  const ruleBasedSpec = _assemblePanelSpecInternal(input)

  // Check if LLM enhancement is warranted
  const shouldEnhance = options?.forceEnhancement ?? isComplexScene(input)
  if (!shouldEnhance) {
    // Cache the result even for simple scenes
    const cacheKey = generatePanelCacheKey(input)
    cachePanel(cacheKey, ruleBasedSpec)
    return ruleBasedSpec
  }

  // Phase A: LLM enhancement for complex scenes
  const enhancement = await enhanceWithLLM(ruleBasedSpec, input)
  const minConfidence = options?.minConfidence ?? 0.5

  if (enhancement.confidence >= minConfidence) {
    // Apply LLM suggestions
    let enhancedVisualPrompt = ruleBasedSpec.visualPrompt
    let enhancedNegativePrompt = ruleBasedSpec.negativePrompt
    let enhancedComposition = ruleBasedSpec.composition

    if (enhancement.visualSuggestions) {
      enhancedVisualPrompt += `, ${enhancement.visualSuggestions}`
    }
    if (enhancement.negativeSuggestions) {
      enhancedNegativePrompt += `, ${enhancement.negativeSuggestions}`
    }
    if (enhancement.compositionSuggestion) {
      enhancedComposition = enhancement.compositionSuggestion
    }

    const enhancedSpec: VisualPanelSpec = {
      ...ruleBasedSpec,
      visualPrompt: enhancedVisualPrompt,
      negativePrompt: enhancedNegativePrompt,
      composition: enhancedComposition,
      notes: `${ruleBasedSpec.notes} [llm-enhanced:confidence=${enhancement.confidence.toFixed(2)}]`,
    }

    // Cache the enhanced result
    const cacheKey = generatePanelCacheKey(input)
    cachePanel(cacheKey, enhancedSpec)

    log.info("panel_llm_enhanced", {
      confidence: enhancement.confidence,
      cacheKey,
    })

    return enhancedSpec
  }

  // LLM confidence too low — fall back to rule-based
  const cacheKey = generatePanelCacheKey(input)
  cachePanel(cacheKey, ruleBasedSpec)

  log.info("panel_llm_low_confidence", {
    confidence: enhancement.confidence,
    threshold: minConfidence,
  })

  return ruleBasedSpec
}

/**
 * Internal panel spec assembly — the core logic without cache or LLM.
 * Used by both `assemblePanelSpec()` and `assemblePanelSpecWithLLM()`.
 */
function _assemblePanelSpecInternal(input: PanelSpecInput): VisualPanelSpec {
  const cfg = getConfig()
  const { beat, characters, scene, panelIndex } = input

  const emotionData = beat.emotion ? translateEmotionToVisuals(beat.emotion, beat.emotionIntensity ?? 0.5) : null
  const actionData = beat.action ? translateActionToCamera(beat.action, beat.context ?? beat.text) : null

  const lighting = scene.timeOfDay
    ? selectLightingPreset(scene.timeOfDay)
    : actionData?.lighting || cfg.lighting_presets.natural

  const styleMods = scene.style ? selectStyleModifiers(scene.style) : selectStyleModifiers("realistic")
  const atmosEffects = scene.weather ? selectAtmosphericEffects(scene.weather) : []

  const mainCharacter = characters[0]
  const expression = emotionData?.expression || mainCharacter?.expression || "neutral expression"
  const bodyLanguage = emotionData?.bodyLanguage || "standing"

  // Generate deterministic character references
  const characterRefs = characters.map((c) =>
    generateStableCharacterRefUrl(c.name, {
      outfitDetails: c.outfit,
      injuryDetails: c.injuries,
      emotionalState: c.emotions?.[0]?.type || beat.emotion,
    }),
  )

  // Build camera spec
  const camera: CameraSpec = {
    shot: actionData?.camera.shot || "medium",
    angle: actionData?.camera.angle || "eye-level",
    movement: actionData?.camera.movement || "static",
    depthOfField: actionData?.camera.depthOfField || "shallow",
  }

  // Build prioritized visual prompt
  const visualPrompt = buildVisualPrompt(
    {
      characters: characters.map((c) => ({
        name: c.name,
        description: c.visualDescription || `character ${c.name}`,
        expression,
        bodyLanguage,
      })),
      location: scene.location || beat.location,
      timeOfDay: scene.timeOfDay || beat.timeOfDay,
      tone: scene.tone || beat.tone,
      lighting,
      atmosphericEffects: atmosEffects,
      styleModifiers: styleMods,
    },
    cfg.prompt_engineering.max_token_limit,
  )

  // Build dynamic negative prompt
  const negativePrompt = buildNegativePrompt({
    emotions: beat.emotion,
    style: scene.style,
    shot: camera.shot,
    movement: camera.movement,
  })

  // Generate deterministic panel ID using DJB2 hash of canonical input
  const charNames = characters.map((c) => c.name).join(",")
  const canonicalInput = `${panelIndex}|${beat.text.slice(0, 100)}|${charNames}`
  const contentHash = djb2Hash(canonicalInput)

  const controlNetSignals: ControlNetSignals = {
    poseReference: characters.length > 0 ? characterRefs[0] : null,
    depthReference: scene.location ? `mock://loc/${scene.location.replace(/\s+/g, "-")}/depth.png` : null,
    characterRefUrl: characters.length > 0 ? characterRefs[0] : null,
    scribbleReference: null,
    normalMapReference: null,
  }

  return {
    id: `panel-${panelIndex}-${contentHash}`,
    panelIndex,
    camera,
    lighting,
    composition: actionData?.composition || "rule of thirds",
    visualPrompt,
    negativePrompt,
    controlNetSignals,
    styleModifiers: styleMods,
    colorPalette: generateColorPalette(scene.tone, scene.weather),
    atmosphericEffects: atmosEffects,
    notes: `Generated from beat: ${beat.text.slice(0, 50)}...`,
    promptVersion: cfg.version,
    hashStrategy: cfg.hash.algorithm,
  }
}

// ============================================================================
// RE-EXPORT CONFIG HELPERS FOR CONVENIENCE
// ============================================================================

export { isComplexEmotion, isComplexAction }

// ============================================================================
// CONFIG HOT-RELOAD (Phase C)
// ============================================================================

/**
 * Reloads visual configuration from file, clearing the config cache.
 * Useful for live config updates without restarting the engine.
 *
 * Note: This does NOT clear the panel cache — cached panels remain valid
 * since they were generated from the previous config. Use `clearPanelCache()`
 * to also invalidate cached panels.
 */
export async function reloadVisualConfig(): Promise<VisualConfig> {
  log.info("reloading_visual_config")
  const newConfig = await _reloadConfig()
  return newConfig
}

/**
 * Clears both the config cache and the visual panel cache.
 * Use this when switching between entirely different visual styles mid-session.
 */
export async function resetVisualTranslator(): Promise<void> {
  _clearConfigCache()
  clearPanelCache()
  config = null
  log.info("visual_translator_reset")
}

log.info("visual_translator_loaded", {
  version: "v3-config-driven",
  features: [
    "configuration-driven",
    "prioritized-prompts",
    "deterministic-hashes",
    "dynamic-negatives",
    "panel-cache",
    "llm-enhancement",
    "config-hot-reload",
  ],
})
