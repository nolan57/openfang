import { Log } from "../util/log"
import { writeFile, mkdir, readFile, readdir } from "fs/promises"
import { resolve, join } from "path"
import { getPanelsPath } from "./novel-config"
import { buildPanelSpecWithHybridEngine, initVisualPromptEngineer } from "./visual-prompt-engineer"
import { callLLMJson } from "./llm-wrapper"
import { ContinuityAnalyzer } from "./continuity-analyzer"
import type { VisualPanelSpec } from "./types"

const log = Log.create({ service: "visual-orchestrator" })

// ============================================================================
// TYPES
// ============================================================================

/**
 * Character state for visual panel generation
 */
export interface VisualCharacterState {
  name: string
  status: string
  stress: number
  traits: string[]
  visualDescription: string
  outfit: string
  injuries: string
  emotions: { type: string; intensity: number }[]
}

/**
 * Context for visual panel generation
 */
export interface VisualGenerationInput {
  storySegment: string
  characters: Record<string, any>
  narrativeSkeleton?: { tone?: string }
  chapterCount: number
  currentChapterTitle?: string
}

/**
 * Options for visual orchestration
 */
export interface VisualOrchestratorOptions {
  maxPanels?: number
  defaultStyle?: string
  verbose?: boolean
}

/**
 * LLM-driven panel planning result
 */
interface PanelPlan {
  panelCount: number
  segments: Array<{
    startIndex: number
    endIndex: number
    description: string
    keyMoment: string
    emotions: string[]
    characters: string[]
  }>
}

/**
 * Cached panel from previous chapter generation.
 */
interface CachedPanel {
  id: string
  contentHash: string
  panelSpec: VisualPanelSpec
}

// ============================================================================
// HASH UTILITY
// ============================================================================

/**
 * DJB2 hash for deterministic content hashing.
 */
function djb2Hash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

// ============================================================================
// MAIN EXPORT: GENERATE VISUAL PANELS
// ============================================================================

/**
 * Generates visual panels from a story segment using the hybrid engine.
 * This is the main entry point for visual panel generation.
 *
 * @param input - Story context and character states
 * @param options - Generation options
 * @returns Array of VisualPanelSpec ready for rendering
 */
export async function generateVisualPanels(
  input: VisualGenerationInput,
  options: VisualOrchestratorOptions = {},
): Promise<VisualPanelSpec[]> {
  const panelStart = Date.now()
  const { maxPanels, defaultStyle = "realistic", verbose = false } = options

  log.info("visual_panel_generation_start", {
    chapterCount: input.chapterCount,
    characterCount: Object.keys(input.characters).length,
    storySegmentLength: input.storySegment.length,
  })

  try {
    // Initialize visual config if not already loaded
    const initStart = Date.now()
    await initVisualPromptEngineer()
    log.info("visual_prompt_engineer_initialized", {
      durationMs: Date.now() - initStart,
    })

    // Extract character states for visual generation
    const extractStart = Date.now()
    const characterStates = extractCharacterStates(input.characters)
    log.info("character_states_extracted", {
      count: characterStates.length,
      durationMs: Date.now() - extractStart,
    })

    // If no characters, generate scene-only panels
    if (characterStates.length === 0) {
      log.warn("no_characters_found_generating_scene_panels", {
        chapterCount: input.chapterCount,
        storySegmentLength: input.storySegment.length,
      })

      const sceneStart = Date.now()
      const scenePanels = await generateSceneOnlyPanels(input, maxPanels ?? 4, defaultStyle)
      log.info("scene_only_panels_generated", {
        count: scenePanels.length,
        durationMs: Date.now() - sceneStart,
        totalDurationMs: Date.now() - panelStart,
      })
      return scenePanels
    }

    // IMPROVEMENT #2: Dynamic pacing control based on tone
    const dynamicMaxPanels = calculateDynamicPanelCount(input.storySegment, input.narrativeSkeleton?.tone, maxPanels ?? 4)

    // Split story into segments using LLM-driven planning
    const planStart = Date.now()
    const plan = await planPanelSegments(input.storySegment, dynamicMaxPanels, input.narrativeSkeleton?.tone)
    const panelCount = plan.segments.length

    log.info("panel_segments_planned", {
      plannedPanels: panelCount,
      tone: input.narrativeSkeleton?.tone,
      dynamicMaxPanels,
      durationMs: Date.now() - planStart,
    })

    // IMPROVEMENT #1: Shot List Caching — load previous panels for reuse
    const cachedPanels = await loadCachedPanels(input.chapterCount, input.storySegment)
    const cachedByHash = new Map<string, VisualPanelSpec>()
    for (const cached of cachedPanels) {
      cachedByHash.set(cached.contentHash, cached.panelSpec)
    }

    if (cachedPanels.length > 0) {
      log.info("shot_cache_loaded", {
        cachedPanels: cachedPanels.length,
        chapterCount: input.chapterCount,
      })
    }

    // Get global style from narrative skeleton
    const globalStyle = input.narrativeSkeleton?.tone || defaultStyle
    const globalTheme = input.narrativeSkeleton?.tone

    // Initialize continuity analyzer
    const continuityAnalyzer = new ContinuityAnalyzer()
    const panels: VisualPanelSpec[] = []

    for (let i = 0; i < panelCount; i++) {
      // IMPROVEMENT #3: Per-panel error boundary
      try {
        const panelGenStart = Date.now()
        const segment = plan.segments[i]
        const panelText = segment.description

        // Get main character for this panel
        const mainChar = characterStates[0]

        // Compute content hash for caching
        const contentHash = djb2Hash(`${panelText}|${mainChar.name}|${mainChar.outfit}`)

        // Check cache first
        const cachedPanel = cachedByHash.get(contentHash)
        if (cachedPanel) {
          const reused = { ...cachedPanel, panelIndex: i }
          panels.push(reused)
          log.info("panel_reused_from_cache", {
            panelIndex: i,
            contentHash,
            durationMs: Date.now() - panelGenStart,
          })
          continue
        }

        // Analyze continuity with previous panels
        const continuityStart = Date.now()
        const continuity = await continuityAnalyzer.analyze(panelText, {
          previousSegment: i > 0 ? plan.segments[i - 1].description : null,
          previousPanels: panels.slice(-3),
          chapterContext: {
            chapterCount: input.chapterCount,
            totalPanelsGenerated: panels.length,
          },
        })
        const continuityDuration = Date.now() - continuityStart

        log.info("continuity_analyzed", {
          panelIndex: i,
          shouldMaintainOutfit: continuity.llmJudgement.shouldMaintainOutfit,
          confidence: Math.round(continuity.llmJudgement.confidence * 100),
          durationMs: continuityDuration,
        })

        // Build psychological profiles for all characters
        const characterPsychologicalProfiles: Record<string, { coreFear?: string; attachmentStyle?: string }> = {}
        for (const char of characterStates) {
          if ((char as any).psychologicalProfile) {
            characterPsychologicalProfiles[char.name] = {
              coreFear: (char as any).psychologicalProfile.coreFear,
              attachmentStyle: (char as any).psychologicalProfile.attachmentStyle,
            }
          }
        }

        // Use outfit from continuity analysis if maintaining
        const outfitDetails =
          continuity.llmJudgement.shouldMaintainOutfit && panels.length > 0
            ? panels[panels.length - 1].character?.outfitDetails || mainChar.outfit
            : continuity.llmJudgement.outfitDescription || mainChar.outfit

        // Build context for hybrid engine
        const context = {
          beat: {
            description: panelText,
            action: undefined as string | undefined,
            emotion: mainChar.emotions?.[0]?.type,
            location: undefined as string | undefined,
            timeOfDay: "day" as const,
            tone: "narrative" as const,
          },
          character: {
            name: mainChar.name,
            emotionalState: mainChar.emotions?.[0]?.type,
            currentAction: undefined as string | undefined,
            outfitDetails,
            injuryDetails: mainChar.injuries,
            visualDescription: mainChar.visualDescription,
          },
          camera: {
            shot: "medium" as const,
            angle: "eye-level" as const,
            movement: "static" as const,
            depthOfField: "shallow" as const,
          },
          globalStyle,
          globalTheme,
          characterPsychologicalProfiles:
            Object.keys(characterPsychologicalProfiles).length > 0 ? characterPsychologicalProfiles : undefined,
          previousPanels: panels.slice(-3),
          continuity: {
            analysis: continuity,
            instruction: continuityAnalyzer.extractInstruction(continuity),
          },
        }

        // Use hybrid engine
        const { panel, detectedAction } = await buildPanelSpecWithHybridEngine(context, i)

        // Embed continuity metadata in panel
        panel.character = context.character
        panel.beat = context.beat
        panel.continuity = context.continuity
        // Embed content hash for future cache lookup
        panel.notes = `${panel.notes || ""} [hash:${contentHash}]`

        const panelDuration = Date.now() - panelGenStart

        log.info("panel_generated", {
          index: i + 1,
          action: detectedAction,
          durationMs: panelDuration,
          outfitMaintained: continuity.llmJudgement.shouldMaintainOutfit,
          cacheHit: false,
        })

        panels.push(panel)
      } catch (error) {
        // IMPROVEMENT #3: Per-panel error boundary — generate placeholder and continue
        log.error("single_panel_generation_failed", {
          panelIndex: i,
          error: String(error),
          segmentDescription: plan.segments[i]?.description?.slice(0, 100),
        })

        // Generate a placeholder panel so we don't break the whole chapter
        const placeholder: VisualPanelSpec = createPlaceholderPanel(
          plan.segments[i]?.description || "Scene transition",
          i,
          globalStyle,
          characterStates[0],
        )
        panels.push(placeholder)
      }
    }

    log.info("visual_panels_generated", {
      count: panels.length,
      cachedCount: panels.filter((p) => p.notes?.includes("reused")).length,
      placeholderCount: panels.filter((p) => p.id.startsWith("placeholder_")).length,
      totalDurationMs: Date.now() - panelStart,
    })

    return panels
  } catch (error) {
    log.error("visual_panel_generation_failed", {
      error: String(error),
      durationMs: Date.now() - panelStart,
    })
    return []
  }
}

// ============================================================================
// SAVE VISUAL PANELS
// ============================================================================

/**
 * Saves visual panels to a JSON file for later processing.
 * Also stores a content hash index for shot list caching.
 *
 * @param panels - Array of panel specs to save
 * @param chapterCount - Current chapter number
 * @returns Path to saved file, or null if failed
 */
export async function saveVisualPanels(panels: VisualPanelSpec[], chapterCount: number): Promise<string | null> {
  const saveStart = Date.now()

  if (panels.length === 0) {
    log.warn("no_panels_to_save", { chapterCount, durationMs: Date.now() - saveStart })
    return null
  }

  const fileName = `chapter_${chapterCount.toString().padStart(3, "0")}_panels.json`
  const indexFileName = `chapter_${chapterCount.toString().padStart(3, "0")}_hash_index.json`

  try {
    const panelsDir = getPanelsPath()
    await mkdir(panelsDir, { recursive: true })

    const filePath = resolve(panelsDir, fileName)

    await writeFile(
      filePath,
      JSON.stringify(
        {
          panels,
          chapter: chapterCount,
          generatedAt: new Date().toISOString(),
          panelCount: panels.length,
          hasCharacters: panels.some((p) => p.controlNetSignals?.characterRefUrl !== null),
        },
        null,
        2,
      ),
    )

    // Save hash index for shot list caching
    const hashIndex: Array<{ contentHash: string; panelIndex: number; panelId: string }> = []
    for (const p of panels) {
      if (p.notes?.includes("[hash:")) {
        const match = p.notes.match(/\[hash:([a-z0-9]+)\]/)
        if (match?.[1]) {
          hashIndex.push({
            contentHash: match[1],
            panelIndex: p.panelIndex,
            panelId: p.id,
          })
        }
      }
    }

    if (hashIndex.length > 0) {
      const indexPath = resolve(panelsDir, indexFileName)
      await writeFile(indexPath, JSON.stringify({ chapter: chapterCount, hashIndex }, null, 2))
    }

    const saveDuration = Date.now() - saveStart
    log.info("visual_panels_saved", {
      fileName,
      panelCount: panels.length,
      path: filePath,
      chapterCount,
      hashIndexCount: hashIndex.length,
      durationMs: saveDuration,
    })
    return filePath
  } catch (error) {
    log.error("visual_panels_save_failed", {
      error: String(error),
      chapterCount,
      fileName,
      durationMs: Date.now() - saveStart,
    })
    return null
  }
}

// ============================================================================
// SHOT LIST CACHING (IMPROVEMENT #1)
// ============================================================================

/**
 * Loads cached panels from previous chapter generations.
 * Reads the hash index file and returns panels whose content hash
 * matches the current story segments.
 */
async function loadCachedPanels(chapterCount: number, storySegment: string): Promise<CachedPanel[]> {
  try {
    const panelsDir = getPanelsPath()
    const files = await readdir(panelsDir).catch((): string[] => [])
    const hashIndexFiles = files.filter((f) => f.endsWith("_hash_index.json"))

    if (hashIndexFiles.length === 0) {
      return []
    }

    const cachedPanels: CachedPanel[] = []

    // Load the most recent hash index (previous chapter)
    const latestIndexFile = hashIndexFiles.sort().reverse()[0]
    if (!latestIndexFile) return []

    const indexPath = resolve(panelsDir, latestIndexFile)
    const indexContent = await readFile(indexPath, "utf-8")
    const indexData = JSON.parse(indexContent)

    // Load the corresponding panels file
    const panelsFile = latestIndexFile.replace("_hash_index.json", "_panels.json")
    const panelsPath = resolve(panelsDir, panelsFile)

    if (!files.includes(panelsFile)) {
      return []
    }

    const panelsContent = await readFile(panelsPath, "utf-8")
    const panelsData = JSON.parse(panelsContent)

    // Map hashes to panel specs
    for (const entry of indexData.hashIndex || []) {
      const panel = panelsData.panels?.find((p: VisualPanelSpec) => p.panelIndex === entry.panelIndex)
      if (panel) {
        cachedPanels.push({
          id: entry.panelId,
          contentHash: entry.contentHash,
          panelSpec: panel,
        })
      }
    }

    return cachedPanels
  } catch (error) {
    log.warn("shot_cache_load_failed", { error: String(error) })
    return []
  }
}

// ============================================================================
// DYNAMIC PACING CONTROL (IMPROVEMENT #2)
// ============================================================================

/**
 * Calculates dynamic panel count based on story tone and content.
 *
 * Rules:
 * - Action/tension scenes: 1 panel per ~50 characters (more panels, close-ups)
 * - Narrative/descriptive scenes: 1 panel per ~150 characters (fewer panels, wide shots)
 * - Horror/suspense: 1 panel per ~80 characters
 * - Falls back to default maxPanels if tone is unrecognized
 */
function calculateDynamicPanelCount(storySegment: string, tone?: string, maxPanels?: number): number {
  const charLength = storySegment.length
  const defaultMax = maxPanels ?? 4

  if (!tone) return defaultMax

  const toneLower = tone.toLowerCase()

  let charsPerPanel: number
  if (toneLower.includes("action") || toneLower.includes("thriller") || toneLower.includes("battle")) {
    charsPerPanel = 50 // Dense panels for action
  } else if (toneLower.includes("horror") || toneLower.includes("suspense") || toneLower.includes("mystery")) {
    charsPerPanel = 80 // Moderate for tension
  } else if (toneLower.includes("romance") || toneLower.includes("slice-of-life") || toneLower.includes("calm")) {
    charsPerPanel = 150 // Sparse for narrative
  } else {
    return defaultMax
  }

  const calculatedPanels = Math.ceil(charLength / charsPerPanel)
  return Math.min(calculatedPanels, defaultMax + 2) // Allow slight override of max
}

// ============================================================================
// PLACEHOLDER PANEL (IMPROVEMENT #3)
// ============================================================================

/**
 * Creates a placeholder panel when LLM generation fails.
 * Ensures "some image is better than no image."
 */
function createPlaceholderPanel(
  fallbackDescription: string,
  index: number,
  style: string,
  character?: VisualCharacterState,
): VisualPanelSpec {
  return {
    id: `placeholder_${index}_${Date.now()}`,
    panelIndex: index,
    camera: {
      shot: "medium",
      angle: "eye-level",
      movement: "static",
      depthOfField: "shallow",
    },
    lighting: "natural",
    composition: "rule-of-thirds",
    visualPrompt: `Scene: ${fallbackDescription.slice(0, 200)}`,
    negativePrompt: "blurry, low quality, distorted, watermark, text",
    controlNetSignals: {
      poseReference: null,
      depthReference: null,
      characterRefUrl: character ? `mock://chars/placeholder/ref.png` : null,
    },
    styleModifiers: [style, "placeholder", "generated as fallback"],
    notes: `Placeholder panel — original generation failed. Scene intent: ${fallbackDescription.slice(0, 100)}`,
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * LLM-driven panel segment planning.
 * Analyzes the complete story segment to determine optimal panel count and content.
 * Incorporates tone-based density adjustments.
 */
export async function planPanelSegments(
  storySegment: string,
  maxPanels: number,
  tone?: string,
): Promise<PanelPlan> {
  const toneContext = tone ? `\nTone: ${tone}. Adjust panel density accordingly — action scenes need more panels, narrative scenes need fewer.` : ""

  try {
    const result = await callLLMJson<PanelPlan>({
      prompt: `Analyze this story segment and plan visual panels (max ${maxPanels}):${toneContext}\n\n${storySegment}\n\nReturn JSON with panelCount and segments array.`,
      system: `You are an expert visual director for comic generation. Plan optimal visual panels. Rules: determine panel count (1-${maxPanels}), identify key visual moments, ensure character continuity.${tone ? ` Tone is "${tone}" — adjust panel density: action/tension scenes need more panels (close-ups), calm/narrative scenes need fewer panels (wide shots).` : ""} Output JSON only.`,
      callType: "panel_planning",
      temperature: 0.3,
      useRetry: true,
    })
    return result.data
  } catch (error) {
    log.error("llm_panel_plan_failed", { error: String(error) })
    return fallbackPanelPlan(storySegment, maxPanels)
  }
}

/**
 * Fallback panel planning using sentence-based splitting.
 * Used when LLM fails or returns invalid results.
 */
async function fallbackPanelPlan(storySegment: string, maxPanels: number): Promise<PanelPlan> {
  const sentences = storySegment.split(/[.!? \n]/).filter((s) => s.trim().length > 10)

  // If no sentences meet length requirement, use whole text as single segment
  if (sentences.length === 0) {
    const trimmedText = storySegment.trim()
    if (trimmedText.length > 0) {
      // Use LLM to analyze the single segment
      const analysis = await analyzeSegmentWithLLM(trimmedText)
      return {
        panelCount: 1,
        segments: [analysis],
      }
    }

    // Empty text
    return {
      panelCount: 0,
      segments: [],
    }
  }

  const panelCount = Math.min(sentences.length, maxPanels)
  const step = Math.max(1, Math.floor(sentences.length / panelCount))

  const segments: PanelPlan["segments"] = []

  for (let i = 0; i < panelCount; i++) {
    const startIdx = i * step
    const endIdx = Math.min(startIdx + step, sentences.length)
    const text = sentences.slice(startIdx, endIdx).join(".")

    // 【REMOVED】Hardcoded character extraction
    // 【REMOVED】Hardcoded emotion detection

    // Use LLM to analyze segment
    const analysis = await analyzeSegmentWithLLM(text)

    segments.push(analysis)
  }

  return {
    panelCount: segments.length,
    segments,
  }
}

/**
 * Analyzes a story segment using LLM to extract characters, emotions, and key moments.
 * Replaces hardcoded keyword matching with LLM understanding.
 */
async function analyzeSegmentWithLLM(text: string): Promise<PanelPlan["segments"][number]> {
  try {
    const result = await callLLMJson<{
      characters: string[]
      emotions: string[]
      keyMoment: string
    }>({
      prompt: `Analyze this story segment:\n\n${text.substring(0, 500)}`,
      system: `Extract character names, emotions, and key visual moment from text. Output JSON with characters (names), emotions (list), keyMoment (brief description).`,
      callType: "segment_analysis",
      temperature: 0.3,
      useRetry: true,
    })

    return {
      startIndex: 0,
      endIndex: 1,
      description: text,
      keyMoment: result.data.keyMoment || "Scene moment",
      emotions: Array.isArray(result.data.emotions) ? result.data.emotions : [],
      characters: Array.isArray(result.data.characters) ? result.data.characters : [],
    }
  } catch (error) {
    log.warn("segment_llm_analysis_failed", { error: String(error) })
  }

  // Fallback to basic extraction
  return {
    startIndex: 0,
    endIndex: 1,
    description: text,
    keyMoment: "Scene moment",
    emotions: [],
    characters: [],
  }
}

/**
 * Extracts character states from the story state for visual generation.
 */
function extractCharacterStates(characters: Record<string, any>): VisualCharacterState[] {
  return Object.entries(characters).map(([name, char]) => ({
    name,
    status: (char.status as string) || "active",
    stress: (char.stress as number) || 0,
    traits: (char.traits as string[]) || [],
    visualDescription: (char.visualDescription as string) || "",
    outfit: (char.outfit as string) || "",
    injuries: (char.injuries as string) || "",
    emotions: (char.emotions as { type: string; intensity: number }[]) || [],
  }))
}

/**
 * Generate scene-only panels when no characters are available.
 * Uses the same style configuration as character panels.
 */
async function generateSceneOnlyPanels(
  input: VisualGenerationInput,
  maxPanels: number,
  defaultStyle: string,
): Promise<VisualPanelSpec[]> {
  log.info("generating_scene_only_panels", {
    chapterCount: input.chapterCount,
    maxPanels,
    style: defaultStyle,
  })

  // Split story into segments
  const sentences = input.storySegment.split(/[.!? \n]/).filter((s) => s.trim().length > 10)
  const panelCount = Math.min(sentences.length, maxPanels)

  // Get global style from narrative skeleton (same as character panels)
  const globalStyle = input.narrativeSkeleton?.tone || defaultStyle

  const panels: VisualPanelSpec[] = []

  for (let i = 0; i < panelCount; i++) {
    const sentence = sentences[i]

    // Use LLM to generate scene description
    const panel: VisualPanelSpec = {
      id: `scene_panel_${input.chapterCount}_${i}`,
      panelIndex: i,
      camera: {
        shot: "wide",
        angle: "eye-level",
        movement: "static",
        depthOfField: "deep",
      },
      lighting: "natural",
      composition: "rule-of-thirds",
      visualPrompt: `Cinematic scene: ${sentence.substring(0, 200)}`,
      negativePrompt: "blurry, low quality, distorted, ugly",
      controlNetSignals: {
        poseReference: null,
        depthReference: null,
        characterRefUrl: null,
      },
      styleModifiers: [globalStyle, "cinematic", "high detail", "atmospheric"],
    }

    panels.push(panel)
  }

  log.info("scene_only_panels_generated", {
    count: panels.length,
    style: globalStyle,
  })

  return panels
}

// ============================================================================
// CONVENIENCE: GENERATE AND SAVE
// ============================================================================

/**
 * Convenience function that generates and saves visual panels in one call.
 *
 * @param input - Story context and character states
 * @param options - Generation options
 * @returns Object containing panels and save path (if saved)
 */
export async function generateAndSaveVisualPanels(
  input: VisualGenerationInput,
  options: VisualOrchestratorOptions = {},
): Promise<{ panels: VisualPanelSpec[]; savedPath: string | null }> {
  const panels = await generateVisualPanels(input, options)
  const savedPath = await saveVisualPanels(panels, input.chapterCount)

  return { panels, savedPath }
}

log.info("visual_orchestrator_loaded")
