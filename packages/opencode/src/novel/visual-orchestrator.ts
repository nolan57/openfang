import { Log } from "../util/log"
import { writeFile, mkdir } from "fs/promises"
import { resolve, join } from "path"
import { getPanelsPath } from "./novel-config"
import { buildPanelSpecWithHybridEngine, initVisualPromptEngineer } from "./visual-prompt-engineer"
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
  const { maxPanels = 4, defaultStyle = "realistic", verbose = false } = options

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

    // 【修改】即使没有角色，也生成场景面板
    if (characterStates.length === 0) {
      log.warn("no_characters_found_generating_scene_panels", {
        chapterCount: input.chapterCount,
        storySegmentLength: input.storySegment.length,
      })

      // 降级：生成纯场景/环境面板，使用相同的风格配置
      const sceneStart = Date.now()
      const scenePanels = await generateSceneOnlyPanels(input, maxPanels, defaultStyle)
      log.info("scene_only_panels_generated", {
        count: scenePanels.length,
        durationMs: Date.now() - sceneStart,
        totalDurationMs: Date.now() - panelStart,
      })
      return scenePanels
    }

    // Split story into segments for panels
    const sentences = input.storySegment.split(/[。！？\n]/).filter((s) => s.trim().length > 10)
    const panelCount = Math.min(sentences.length, maxPanels)
    const step = Math.max(1, Math.floor(sentences.length / panelCount))

    // Get global style from narrative skeleton
    const globalStyle = input.narrativeSkeleton?.tone || defaultStyle
    const globalTheme = input.narrativeSkeleton?.tone

    const panels: VisualPanelSpec[] = []

    for (let i = 0; i < panelCount; i++) {
      const panelGenStart = Date.now()
      const startIdx = i * step
      const endIdx = Math.min(startIdx + step, sentences.length)
      const panelText = sentences.slice(startIdx, endIdx).join(".")

      // Get main character for this panel
      const mainChar = characterStates[0]

      // Build psychological profiles for all characters
      const characterPsychologicalProfiles: Record<string, { coreFear?: string; attachmentStyle?: string }> = {}
      for (const char of characterStates) {
        // Note: In a full implementation, this would come from character-deepener
        // For now, we extract from character state if available
        if ((char as any).psychologicalProfile) {
          characterPsychologicalProfiles[char.name] = {
            coreFear: (char as any).psychologicalProfile.coreFear,
            attachmentStyle: (char as any).psychologicalProfile.attachmentStyle,
          }
        }
      }

      // Build context for hybrid engine with enhanced narrative information
      const context = {
        beat: {
          description: panelText,
          action: undefined, // Will be detected by LLM or fallback
          emotion: mainChar.emotions?.[0]?.type,
          location: undefined,
          timeOfDay: "day",
          tone: "narrative",
        },
        character: {
          name: mainChar.name,
          emotionalState: mainChar.emotions?.[0]?.type,
          currentAction: undefined, // Will be detected by LLM or fallback
          outfitDetails: mainChar.outfit,
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
        previousPanels: panels.slice(-3), // Last 3 panels for continuity
      }

      // Use hybrid engine
      const { panel, detectedAction } = await buildPanelSpecWithHybridEngine(context, i)
      const panelDuration = Date.now() - panelGenStart
      log.info("panel_generated", {
        index: i + 1,
        action: detectedAction,
        durationMs: panelDuration,
      })

      panels.push(panel)
    }

    log.info("visual_panels_generated", {
      count: panels.length,
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

    const saveDuration = Date.now() - saveStart
    log.info("visual_panels_saved", {
      fileName,
      panelCount: panels.length,
      path: filePath,
      chapterCount,
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
// HELPER FUNCTIONS
// ============================================================================

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
