import { Log } from "../util/log"
import { writeFile, mkdir } from "fs/promises"
import { resolve, join } from "path"
import { Instance } from "../project/instance"
import { buildPanelSpecWithHybridEngine } from "./visual-prompt-engineer"
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
  const { maxPanels = 4, defaultStyle = "realistic", verbose = false } = options

  try {
    // Extract character states for visual generation
    const characterStates = extractCharacterStates(input.characters)

    if (characterStates.length === 0) {
      log.warn("no_characters_found_for_visual_generation")
      return []
    }

    // Split story into segments for panels
    const sentences = input.storySegment.split(/[。！？\n]/).filter((s) => s.trim().length > 10)
    const panelCount = Math.min(sentences.length, maxPanels)
    const step = Math.max(1, Math.floor(sentences.length / panelCount))

    // Get global style from narrative skeleton
    const globalStyle = input.narrativeSkeleton?.tone || defaultStyle

    const panels: VisualPanelSpec[] = []

    for (let i = 0; i < panelCount; i++) {
      const startIdx = i * step
      const endIdx = Math.min(startIdx + step, sentences.length)
      const panelText = sentences.slice(startIdx, endIdx).join("。")

      // Get main character for this panel
      const mainChar = characterStates[0]

      // Build context for hybrid engine
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
        previousPanels: panels.slice(-3), // Last 3 panels for continuity
      }

      // Use hybrid engine
      const { panel, detectedAction } = await buildPanelSpecWithHybridEngine(context, i)
      panels.push(panel)

      if (verbose) {
        log.info("panel_generated", { index: i + 1, action: detectedAction })
      }
    }

    return panels
  } catch (error) {
    log.error("visual_panel_generation_failed", { error: String(error) })
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
export async function saveVisualPanels(
  panels: VisualPanelSpec[],
  chapterCount: number,
): Promise<string | null> {
  if (panels.length === 0) {
    return null
  }

  try {
    const panelsDir = join(Instance.directory, ".opencode/novel/panels")
    await mkdir(panelsDir, { recursive: true })

    const fileName = `chapter_${chapterCount.toString().padStart(3, "0")}_panels.json`
    const filePath = resolve(panelsDir, fileName)

    await writeFile(
      filePath,
      JSON.stringify(
        {
          panels,
          chapter: chapterCount,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    )

    log.info("visual_panels_saved", { fileName, panelCount: panels.length })
    return filePath
  } catch (error) {
    log.error("visual_panels_save_failed", { error: String(error) })
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
