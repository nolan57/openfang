import { Log } from "../util/log"
import { callLLMJson } from "./llm-wrapper"
import {
  loadVisualConfig,
  getVisualConfig,
  getEmotionVisual,
  getActionMapping,
  getLightingPreset as getConfigLightingPreset,
  getStyleModifiers as getConfigStyleModifiers,
  isComplexEmotion,
  isComplexAction,
  type VisualConfig,
  type EmotionVisual,
  type ActionMapping,
} from "./config"
import { type VisualPanelSpec, type CameraSpec, type ControlNetSignals, type EnrichedBeat } from "./types"

export type { VisualPanelSpec, CameraSpec, ControlNetSignals, EnrichedBeat }

const log = Log.create({ service: "visual-translator" })

// ============================================================================
// CONFIGURATION-DRIVEN DESIGN
// All hardcoded values have been moved to visual-config.json
// This module now reads from the config for all parameters.
// ============================================================================

// Cache for config (loaded lazily)
let config: VisualConfig | null = null

/**
 * Initializes the visual translator by loading configuration.
 * Must be called before using other functions in production.
 */
export async function initVisualTranslator(): Promise<void> {
  if (!config) {
    config = await loadVisualConfig()
    log.info("visual_translator_initialized", {
      version: config.version,
      emotions: Object.keys(config.emotions).length,
      actions: Object.keys(config.actions).length,
    })
  }
}

/**
 * Gets the current config, loading it if necessary.
 * For sync contexts where initVisualTranslator has already been called.
 */
function getConfig(): VisualConfig {
  if (!config) {
    config = getVisualConfig()
  }
  return config
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
 */
export function generateDeterministicVisualHash(characterId: string, stateSnapshot: CharacterStateSnapshot): string {
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

// ============================================================================
// MAIN PANEL SPEC ASSEMBLY
// ============================================================================

/**
 * Assembles a complete VisualPanelSpec from structured input.
 * All parameters are loaded from configuration.
 */
export function assemblePanelSpec(input: PanelSpecInput): VisualPanelSpec {
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

log.info("visual_translator_loaded", {
  version: "v3-config-driven",
  features: ["configuration-driven", "prioritized-prompts", "deterministic-hashes", "dynamic-negatives"],
})
