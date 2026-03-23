import { Log } from "../util/log"
import { generateText } from "ai"
import { getNovelLanguageModel } from "./model"
import {
  loadVisualConfig,
  getVisualConfig,
  isComplexEmotion,
  isComplexAction,
  getActionMapping,
  type VisualConfig,
} from "./config"
import {
  prioritizeAndTruncatePrompt,
  generateDeterministicVisualHash,
  generateStableCharacterRefUrl,
  translateEmotionToVisuals,
  translateActionToCamera,
  selectLightingPreset,
  selectStyleModifiers,
  selectAtmosphericEffects,
  getShotSpecificNegatives,
  getMovementSpecificNegatives,
  type CharacterState,
  type CharacterStateSnapshot,
} from "./visual-translator"
import type { VisualGenerationContext, LLMPromptEngineeringResult, VisualPanelSpec, CameraSpec } from "./types"

/**
 * Extended visual generation context with narrative and psychological information.
 */
export interface ExtendedVisualGenerationContext extends VisualGenerationContext {
  globalTheme?: string
  characterPsychologicalProfiles?: Record<string, { coreFear?: string; attachmentStyle?: string }>
}

const log = Log.create({ service: "visual-prompt-engineer" })

// ============================================================================
// CONFIGURATION-DRIVEN DECISION LOGIC
// ============================================================================

// Cached config
let config: VisualConfig | null = null

/**
 * Initializes the visual prompt engineer with configuration.
 */
export async function initVisualPromptEngineer(): Promise<void> {
  if (!config) {
    config = await loadVisualConfig()
    log.info("visual_prompt_engineer_initialized", {
      version: config.version,
      llmEnabled: config.llm.enabled,
    })
  }
}

/**
 * Gets config, loading if necessary.
 */
function getConfig(): VisualConfig {
  if (!config) {
    // Use cached config from loadVisualConfig if available
    // If not loaded, this will throw - caller should ensure initVisualPromptEngineer() was called
    config = getVisualConfig()
  }
  return config
}

/**
 * Determines whether the LLM should be invoked for visual prompt engineering.
 *
 * Decision factors are loaded from configuration:
 * 1. Complex/abstract emotions
 * 2. Rare or complex actions
 * 3. Complex style blends
 * 4. Long beat descriptions
 * 5. Previous panels for continuity
 */
function shouldUseLLM(context: VisualGenerationContext): boolean {
  const cfg = getConfig()
  const { beat, character, globalStyle, previousPanels } = context

  // Check complex emotions from config
  if (character.emotionalState && isComplexEmotion(character.emotionalState)) {
    return true
  }

  // Check complex actions from config
  if (beat.action && isComplexAction(beat.action)) {
    return true
  }

  // Check complex style patterns from config
  if (globalStyle) {
    for (const pattern of cfg.strategy.llm_threshold.complex_style_patterns) {
      try {
        const regex = new RegExp(pattern, "i")
        if (regex.test(globalStyle)) {
          return true
        }
      } catch {
        // Invalid regex, skip
      }
    }
  }

  // Check description length threshold from config
  if (beat.description.length > cfg.strategy.llm_threshold.description_length_threshold) {
    return true
  }

  // Check continuity requirements from config
  if (
    cfg.strategy.llm_threshold.use_llm_for_continuity &&
    previousPanels &&
    previousPanels.length >= cfg.strategy.llm_threshold.min_previous_panels_for_continuity
  ) {
    return true
  }

  return false
}

// ============================================================================
// LLM PROMPT BUILDING (Configuration-Driven)
// ============================================================================

/**
 * Builds the system prompt for LLM prompt engineering.
 * System prompt is loaded from configuration.
 */
function buildPromptEngineerSystemPrompt(): string {
  const cfg = getConfig()
  return cfg.llm.system_prompt
}

/**
 * Builds the user prompt for LLM prompt engineering.
 */
function buildPromptEngineerUserPrompt(context: VisualGenerationContext | ExtendedVisualGenerationContext): string {
  const cfg = getConfig()

  // Build continuity context if previous panels exist
  let continuityContext = ""
  if (context.previousPanels && context.previousPanels.length > 0) {
    continuityContext = `\nPREVIOUS PANELS (for continuity):
${context.previousPanels.map((p, i) => `Panel ${i + 1}: ${p.visualPrompt?.slice(0, 100)}...`).join("\n")}
`
  }

  // 【NEW】Enhanced continuity instruction from continuity analyzer
  let continuityInstruction = ""
  if ("continuity" in context && context.continuity) {
    const continuityData = context.continuity as { analysis: any; instruction: string }
    continuityInstruction = `\n\n${continuityData.instruction}`

    if (continuityData.analysis.llmJudgement.shouldMaintainOutfit) {
      continuityInstruction += `\nIMPORTANT: Character outfit MUST remain exactly the same. Use this outfit description: ${continuityData.analysis.llmJudgement.outfitDescription}`
    }
  }

  // Build psychological context if available
  let psychologicalContext = ""
  if ("characterPsychologicalProfiles" in context && context.characterPsychologicalProfiles) {
    const charProfile = context.characterPsychologicalProfiles[context.character.name]
    if (charProfile) {
      psychologicalContext = `\nCharacter Psychology:
- Core Fear: ${charProfile.coreFear || "Unknown"}
- Attachment Style: ${charProfile.attachmentStyle || "Unknown"}
Incorporate these psychological traits subtly into body language and expression.`
    }
  }

  // Build theme context if available
  let themeContext = ""
  if ("globalTheme" in context && context.globalTheme) {
    themeContext = `\nGlobal Theme: ${context.globalTheme}
Ensure visual composition, lighting, and atmosphere reflect this thematic element.`
  }

  return `Context:
Story Beat: ${context.beat.description}
Character State: ${JSON.stringify({
    name: context.character.name,
    emotion: context.character.emotionalState,
    action: context.character.currentAction,
    outfit: context.character.outfitDetails,
  })}
Camera: ${JSON.stringify(context.camera)}
Global Style: ${context.globalStyle || "realistic"}
${themeContext}
${psychologicalContext}
${continuityContext}
${continuityInstruction}
Task:
Generate a refined visual prompt and negative prompt.
- If the scene is standard, keep it simple.
- If complex, be creative but precise.
- Consider the camera shot for specific negative prompts.
- ${continuityInstruction.includes("MAINTAIN") ? "CRITICAL: Maintain outfit consistency with previous panels." : "Outfit may have changed based on context."}
- Max tokens for visual prompt: ${cfg.prompt_engineering.max_token_limit}

OUTPUT JSON ONLY:
{
  "refinedVisualPrompt": "string (required, max ${cfg.prompt_engineering.max_token_limit} tokens)",
  "refinedNegativePrompt": "string (required)",
  "detectedAction": "string (optional, one of: fight, chase, conversation, monologue, revelation, romantic, tension, action, emotional)",
  "artisticNotes": "string (optional)",
  "confidenceScore": "number (optional, 0-1)"
}`
}

// ============================================================================
// LLM INVOCATION (Configuration-Driven)
// ============================================================================

/**
 * Calls the LLM for visual prompt engineering.
 * Temperature, timeout, and min confidence are loaded from configuration.
 */
async function callLLMForPromptEngineering(
  context: VisualGenerationContext,
): Promise<LLMPromptEngineeringResult | null> {
  const cfg = getConfig()

  if (!cfg.llm.enabled) {
    log.info("llm_disabled_in_config")
    return null
  }

  try {
    const languageModel = await getNovelLanguageModel()

    const result = await generateText({
      model: languageModel,
      system: buildPromptEngineerSystemPrompt(),
      prompt: buildPromptEngineerUserPrompt(context),
    })

    const text = result.text.trim()

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      log.warn("llm_no_json_found", { response: text.slice(0, 200) })
      return null
    }

    const parsed = JSON.parse(jsonMatch[0])

    // Validate required fields
    if (!parsed.refinedVisualPrompt || typeof parsed.refinedVisualPrompt !== "string") {
      log.warn("llm_missing_visual_prompt")
      return null
    }

    return {
      refinedVisualPrompt: parsed.refinedVisualPrompt,
      refinedNegativePrompt: parsed.refinedNegativePrompt || "",
      detectedAction: parsed.detectedAction,
      artisticNotes: parsed.artisticNotes,
      confidenceScore: typeof parsed.confidenceScore === "number" ? parsed.confidenceScore : 0.8,
    }
  } catch (error) {
    log.error("llm_call_failed", { error: String(error) })
    return null
  }
}

// ============================================================================
// HARDCODED FALLBACK LOGIC (Configuration-Driven)
// ============================================================================

/**
 * Generates visual prompts using the hardcoded fallback logic.
 * All parameters are loaded from configuration.
 */
function generateHardcodedPrompt(
  context: VisualGenerationContext | ExtendedVisualGenerationContext,
): LLMPromptEngineeringResult {
  const cfg = getConfig()
  const { beat, character, camera, globalStyle } = context

  // Build prompt elements with priority
  const elements: string[] = []

  // Priority 1: Subject & Action (characters)
  // Get psychological profile if available
  const psychProfile =
    "characterPsychologicalProfiles" in context && context.characterPsychologicalProfiles
      ? context.characterPsychologicalProfiles[character.name]
      : undefined

  const emotionData = character.emotionalState
    ? translateEmotionToVisuals(character.emotionalState, 0.5, psychProfile)
    : null

  if (character.visualDescription) {
    elements.push(`(${character.name}: ${character.visualDescription})`)
  } else {
    elements.push(`(${character.name})`)
  }

  if (emotionData) {
    elements.push(`${emotionData.expression}`)
    elements.push(`${emotionData.bodyLanguage}`)
  }

  if (character.currentAction) {
    elements.push(`${character.currentAction}`)
  }

  // Priority 2: Camera & Lighting
  const lighting = beat.timeOfDay ? selectLightingPreset(beat.timeOfDay) : "natural lighting"
  elements.push(`lighting: ${lighting}`)

  // Priority 3: Style & Atmosphere
  const styleMods = globalStyle ? selectStyleModifiers(globalStyle) : []
  if (styleMods.length > 0) {
    elements.push(`style: ${styleMods.slice(0, 2).join(", ")}`)
  }

  // Priority 4: Background Details
  if (beat.location) {
    elements.push(`at ${beat.location}`)
  }

  if (beat.timeOfDay) {
    elements.push(`during ${beat.timeOfDay}`)
  }

  if (beat.tone) {
    elements.push(`${beat.tone} atmosphere`)
  }

  // Apply prioritization and truncation with config limit
  const visualPrompt = prioritizeAndTruncatePrompt(elements, cfg.prompt_engineering.max_token_limit)

  // Build negative prompt from config
  const baseNegatives = [...cfg.negative_prompts.base]

  const shotNegatives = getShotSpecificNegatives(camera.shot)
  const movementNegatives = getMovementSpecificNegatives(camera.movement)

  // Style-specific negatives from config
  const styleNegatives = cfg.style_negatives?.[globalStyle?.toLowerCase() || ""] || []

  // Emotion-specific negatives
  const emotionNegatives =
    character.emotionalState === "joy" || character.emotionalState === "happy"
      ? ["sad", "crying", "tears", "grief"]
      : character.emotionalState === "sadness"
        ? ["happy", "joy", "smiling", "laughing"]
        : []

  const allNegatives = [
    ...new Set([...baseNegatives, ...styleNegatives, ...shotNegatives, ...movementNegatives, ...emotionNegatives]),
  ]

  const negativePrompt = allNegatives.join(", ") + ", " + cfg.negative_prompts.quality_suffix

  return {
    refinedVisualPrompt: visualPrompt,
    refinedNegativePrompt: negativePrompt,
    artisticNotes: "Generated via hardcoded rules from configuration.",
    confidenceScore: 1.0,
    generationMethod: "hardcoded",
  }
}

// ============================================================================
// MAIN ENTRY: HYBRID VISUAL GENERATION
// ============================================================================

/**
 * Main entry point for optimized visual prompt generation.
 *
 * Decision flow:
 * 1. Check if LLM is needed (based on config thresholds)
 * 2. If YES: Call LLM with fallback to hardcoded
 * 3. If NO: Use hardcoded rules from config
 *
 * @param context - Visual generation context
 * @returns Optimized visual prompts with metadata
 */
export async function generateOptimizedVisuals(
  context: VisualGenerationContext,
): Promise<LLMPromptEngineeringResult & { generationMethod: string }> {
  const cfg = getConfig()

  // FAST PATH: Use hardcoded rules
  if (!shouldUseLLM(context)) {
    log.info("using_hardcoded_fast_path", {
      beat: context.beat.description.slice(0, 50),
      emotion: context.character.emotionalState,
    })

    const result = generateHardcodedPrompt(context)
    return {
      ...result,
      generationMethod: "hardcoded",
    }
  }

  // SLOW PATH: Invoke LLM for complex scenes
  log.info("invoking_llm_for_visual_engineering", {
    beat: context.beat.description.slice(0, 50),
    emotion: context.character.emotionalState,
  })

  const llmResult = await callLLMForPromptEngineering(context)

  // Check if LLM succeeded with sufficient confidence (threshold from config)
  if (
    llmResult &&
    llmResult.confidenceScore >= cfg.llm.min_confidence_score &&
    llmResult.refinedVisualPrompt.length > 0
  ) {
    log.info("llm_succeeded", {
      confidence: llmResult.confidenceScore,
      promptLength: llmResult.refinedVisualPrompt.length,
    })

    return {
      ...llmResult,
      generationMethod: "llm",
    }
  }

  // FALLBACK: LLM failed or returned low confidence
  log.warn("llm_failed_or_low_confidence", {
    llmSuccess: !!llmResult,
    confidence: llmResult?.confidenceScore,
    minRequired: cfg.llm.min_confidence_score,
    fallbackReason: llmResult ? "low confidence" : "call failed",
  })

  const fallbackResult = generateHardcodedPrompt(context)
  return {
    ...fallbackResult,
    generationMethod: "hybrid", // Hybrid = attempted LLM, fell back to hardcoded
  }
}

// ============================================================================
// INTEGRATION HELPER: BUILD COMPLETE PANEL SPEC
// ============================================================================

/**
 * Action keywords for fallback detection (loaded from config).
 */
function detectActionFallback(text: string): string {
  const cfg = getConfig()
  const textLower = text.toLowerCase()

  for (const [action, keywords] of Object.entries(cfg.action_keywords)) {
    if (keywords.some((kw) => textLower.includes(kw.toLowerCase()))) {
      return action
    }
  }

  return "emotional"
}

/**
 * Builds a complete VisualPanelSpec using the hybrid engine.
 * This is the main integration point for the orchestrator.
 *
 * @param context - Visual generation context
 * @param panelIndex - Index of the panel in the sequence
 * @returns Object containing panel spec and detected action
 */
export async function buildPanelSpecWithHybridEngine(
  context: VisualGenerationContext,
  panelIndex: number,
): Promise<{ panel: VisualPanelSpec; detectedAction: string }> {
  const cfg = getConfig()

  // Generate optimized prompts
  const promptResult = await generateOptimizedVisuals(context)

  // Use LLM-detected action if available, otherwise fallback to keyword matching
  const detectedAction = promptResult.detectedAction || detectActionFallback(context.beat.description)

  // Generate deterministic character reference
  const characterSnapshot: CharacterStateSnapshot = {
    outfitDetails: context.character.outfitDetails,
    injuryDetails: context.character.injuryDetails,
    emotionalState: context.character.emotionalState,
  }

  const characterRefUrl = generateStableCharacterRefUrl(context.character.name, characterSnapshot)

  // Determine camera based on detected action
  const globalTheme = "globalTheme" in context ? context.globalTheme : undefined
  const actionCameraData = translateActionToCamera(
    detectedAction,
    context.beat.description,
    globalTheme as string | undefined,
  )

  // Build camera spec
  const camera: CameraSpec = {
    shot: actionCameraData.camera.shot || context.camera.shot,
    angle: actionCameraData.camera.angle || context.camera.angle,
    movement: actionCameraData.camera.movement || context.camera.movement,
    depthOfField: actionCameraData.camera.depthOfField || context.camera.depthOfField || "shallow",
  }

  // Get style modifiers
  const styleModifiers = context.globalStyle ? selectStyleModifiers(context.globalStyle) : []

  // Build ControlNet signals
  const controlNetSignals = {
    poseReference: characterRefUrl,
    depthReference: context.beat.location ? `mock://loc/${context.beat.location.replace(/\s+/g, "-")}/depth.png` : null,
    characterRefUrl,
    scribbleReference: null,
    normalMapReference: null,
  }

  // Determine lighting from action camera data or time of day
  const lighting =
    actionCameraData.lighting ||
    (context.beat.timeOfDay ? selectLightingPreset(context.beat.timeOfDay) : cfg.lighting_presets.natural)

  const panel: VisualPanelSpec = {
    id: `panel-${panelIndex}-${Date.now()}`,
    panelIndex,
    camera,
    lighting,
    composition: actionCameraData.composition || "rule of thirds",
    visualPrompt: promptResult.refinedVisualPrompt,
    negativePrompt: promptResult.refinedNegativePrompt,
    controlNetSignals,
    styleModifiers,
    atmosphericEffects: [],
    notes: promptResult.artisticNotes,
    promptVersion: cfg.version,
    hashStrategy: cfg.hash.algorithm,
  }

  return { panel, detectedAction }
}

log.info("visual_prompt_engineer_loaded", {
  features: ["hybrid-architecture", "llm-fallback", "hardcoded-fast-path", "config-driven"],
})
