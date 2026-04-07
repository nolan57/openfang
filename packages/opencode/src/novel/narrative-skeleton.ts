import { readFile, writeFile } from "fs/promises"
import { resolve, dirname } from "path"
import { mkdir } from "fs/promises"
import { callLLMJson } from "./llm-wrapper"
import { Log } from "../util/log"
import { getNarrativeSkeletonPath } from "./novel-config"

const log = Log.create({ service: "narrative-skeleton" })

// Lazy-initialized path
let NarrativeSkeletonPath: string | null = null

function getSkeletonPath(): string {
  if (!NarrativeSkeletonPath) {
    NarrativeSkeletonPath = getNarrativeSkeletonPath()
  }
  return NarrativeSkeletonPath
}

export interface StoryLine {
  name: string
  keyBeats: Array<{
    chapter: number
    description: string
    characters?: string[]
    thematicRelevance?: string
  }>
  status?: "active" | "dormant" | "resolved"
  currentBeatIndex?: number
}

export interface ThematicMotifs {
  [motif: string]: {
    description: string
    chapters: number[]
    variations: string[]
  }
}

export interface NarrativeSkeleton {
  theme: string
  tone: string
  initialPrompt: string
  storyLines: StoryLine[]
  thematicMotifs: ThematicMotifs
  createdAt: number
  lastUpdated: number
  metaLearnerContext?: {
    preferredThreadCount?: number
    pacingPreference?: "fast" | "slow" | "balanced"
  }
}

export interface SkeletonUpdatePlan {
  extendStoryLine?: {
    storyLineName: string
    newBeats: Array<{
      chapter: number
      description: string
      characters?: string[]
      thematicRelevance?: string
    }>
  }
  accelerateBeat?: {
    storyLineName: string
    beatIndex: number
    newChapter: number
  }
  addStoryLine?: {
    name: string
    keyBeats: Array<{
      chapter: number
      description: string
      characters?: string[]
      thematicRelevance?: string
    }>
  }
  updateThematicMotif?: {
    motifName: string
    newChapters?: number[]
    newVariations?: string[]
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

export class NarrativeSkeletonManager {
  private skeleton: NarrativeSkeleton | null = null

  getSkeleton(): NarrativeSkeleton | null {
    return this.skeleton
  }

  setSkeleton(skeleton: NarrativeSkeleton): void {
    this.skeleton = skeleton
  }

  getOverallCompletionPercentage(): number {
    if (!this.skeleton || this.skeleton.storyLines.length === 0) {
      return 0
    }

    const totalBeats = this.skeleton.storyLines.reduce((sum, sl) => sum + sl.keyBeats.length, 0)
    const completedBeats = this.skeleton.storyLines.reduce((sum, sl) => {
      const completedIndex = sl.currentBeatIndex !== undefined ? sl.currentBeatIndex + 1 : 0
      return sum + Math.min(completedIndex, sl.keyBeats.length)
    }, 0)

    if (totalBeats === 0) return 0

    return Math.round((completedBeats / totalBeats) * 100)
  }

  getStoryLineCompletion(storyLineName: string): number {
    if (!this.skeleton) return 0

    const storyLine = this.skeleton.storyLines.find((sl) => sl.name === storyLineName)
    if (!storyLine || storyLine.keyBeats.length === 0) return 0

    const completedIndex = storyLine.currentBeatIndex !== undefined ? storyLine.currentBeatIndex + 1 : 0
    return Math.round((completedIndex / storyLine.keyBeats.length) * 100)
  }

  getNextKeyBeat(chapter: number): Array<{ storyLine: string; beat: StoryLine["keyBeats"][number] }> {
    if (!this.skeleton) return []

    const nextBeats: Array<{ storyLine: string; beat: StoryLine["keyBeats"][number] }> = []

    for (const storyLine of this.skeleton.storyLines) {
      const currentIndex = storyLine.currentBeatIndex || 0
      const nextBeat = storyLine.keyBeats.find(
        (beat) =>
          beat.chapter === chapter &&
          storyLine.currentBeatIndex !== undefined &&
          storyLine.currentBeatIndex < currentIndex + 1,
      )

      if (nextBeat && storyLine.status !== "resolved") {
        nextBeats.push({
          storyLine: storyLine.name,
          beat: nextBeat,
        })
      }
    }

    return nextBeats
  }

  getThematicMotifString(): string {
    if (!this.skeleton) return ""

    const motifs = Object.entries(this.skeleton.thematicMotifs).map(([name, motif]) => {
      const variations = motif.variations.join("; ")
      return `${name}: ${motif.description} (Variations: ${variations})`
    })
    return motifs.join("\n")
  }

  async updateStoryLineProgress(storyLineName: string, currentBeatIndex: number): Promise<void> {
    if (!this.skeleton) return

    const storyLine = this.skeleton.storyLines.find((sl) => sl.name === storyLineName)
    if (storyLine) {
      storyLine.currentBeatIndex = currentBeatIndex
      if (currentBeatIndex >= storyLine.keyBeats.length - 1) {
        storyLine.status = "resolved"
      } else {
        storyLine.status = "active"
      }
      await saveNarrativeSkeleton(this.skeleton)
      log.info("storyline_progress_updated", { storyLineName, currentBeatIndex })
    }
  }

  async updateNarrativeSkeleton(updatePlan: SkeletonUpdatePlan): Promise<boolean> {
    if (!this.skeleton) {
      log.error("skeleton_update_failed", { reason: "No skeleton loaded" })
      return false
    }

    try {
      if (updatePlan.extendStoryLine) {
        const { storyLineName, newBeats } = updatePlan.extendStoryLine
        const storyLine = this.skeleton.storyLines.find((sl) => sl.name === storyLineName)

        if (!storyLine) {
          log.warn("storyline_not_found_for_extension", { storyLineName })
          return false
        }

        const lastChapter =
          storyLine.keyBeats.length > 0 ? storyLine.keyBeats[storyLine.keyBeats.length - 1].chapter : 0

        for (const beat of newBeats) {
          if (beat.chapter <= lastChapter) {
            log.error("invalid_beat_chapter", {
              storyLineName,
              beatChapter: beat.chapter,
              lastChapter,
            })
            return false
          }

          storyLine.keyBeats.push({
            chapter: beat.chapter,
            description: beat.description,
            characters: beat.characters,
            thematicRelevance: beat.thematicRelevance,
          })
        }

        log.info("storyline_extended", {
          storyLineName,
          newBeatsCount: newBeats.length,
          totalBeats: storyLine.keyBeats.length,
        })
      }

      if (updatePlan.accelerateBeat) {
        const { storyLineName, beatIndex, newChapter } = updatePlan.accelerateBeat
        const storyLine = this.skeleton.storyLines.find((sl) => sl.name === storyLineName)

        if (!storyLine) {
          log.warn("storyline_not_found_for_acceleration", { storyLineName })
          return false
        }

        if (beatIndex < 0 || beatIndex >= storyLine.keyBeats.length) {
          log.error("invalid_beat_index", { storyLineName, beatIndex })
          return false
        }

        if (beatIndex > 0) {
          const prevBeatChapter = storyLine.keyBeats[beatIndex - 1].chapter
          if (newChapter <= prevBeatChapter) {
            log.error("invalid_acceleration", {
              storyLineName,
              beatIndex,
              newChapter,
              prevBeatChapter,
            })
            return false
          }
        }

        if (beatIndex < storyLine.keyBeats.length - 1) {
          const nextBeatChapter = storyLine.keyBeats[beatIndex + 1].chapter
          if (newChapter >= nextBeatChapter) {
            log.error("invalid_acceleration", {
              storyLineName,
              beatIndex,
              newChapter,
              nextBeatChapter,
            })
            return false
          }
        }

        storyLine.keyBeats[beatIndex].chapter = newChapter
        log.info("beat_accelerated", { storyLineName, beatIndex, newChapter })
      }

      if (updatePlan.addStoryLine) {
        const { name, keyBeats } = updatePlan.addStoryLine

        if (this.skeleton.storyLines.length >= 6) {
          log.warn("too_many_storylines", { count: this.skeleton.storyLines.length })
          return false
        }

        if (keyBeats.length === 0) {
          log.error("empty_storyline_beats", { name })
          return false
        }

        for (let i = 1; i < keyBeats.length; i++) {
          if (keyBeats[i].chapter <= keyBeats[i - 1].chapter) {
            log.error("invalid_storyline_beat_order", {
              storyLineName: name,
              beatIndex: i,
              currentChapter: keyBeats[i].chapter,
              prevChapter: keyBeats[i - 1].chapter,
            })
            return false
          }
        }

        this.skeleton.storyLines.push({
          name,
          keyBeats,
          status: "active",
          currentBeatIndex: 0,
        })

        log.info("storyline_added", { name, beatsCount: keyBeats.length })
      }

      if (updatePlan.updateThematicMotif) {
        const { motifName, newChapters, newVariations } = updatePlan.updateThematicMotif
        const motif = this.skeleton.thematicMotifs[motifName]

        if (!motif) {
          log.warn("motif_not_found", { motifName })
          return false
        }

        if (newChapters) {
          motif.chapters = newChapters
        }

        if (newVariations) {
          motif.variations = [...motif.variations, ...newVariations]
        }

        log.info("motif_updated", { motifName })
      }

      this.skeleton.lastUpdated = Date.now()
      await saveNarrativeSkeleton(this.skeleton)

      return true
    } catch (error) {
      log.error("skeleton_update_failed", { error: String(error) })
      return false
    }
  }

  clear(): void {
    this.skeleton = null
    log.info("skeleton_manager_cleared")
  }
}

export const narrativeSkeletonManager = new NarrativeSkeletonManager()

export async function createNarrativeSkeleton(
  theme: string,
  tone: string,
  initialPrompt: string,
  metaLearnerContext?: { preferredThreadCount?: number; pacingPreference?: "fast" | "slow" | "balanced" },
): Promise<NarrativeSkeleton> {
  log.info("creating_narrative_skeleton", { theme, tone, promptLength: initialPrompt.length })

  try {
    let systemPrompt = `You are an expert literary architect specializing in epic narrative structures.
Your task is to create a comprehensive narrative skeleton for a long-form story.

OUTPUT REQUIREMENTS:
- Generate 3-5 distinct story lines (plot threads) that will interweave throughout the narrative
- Each story line must have 8-12 key beats (major plot points) distributed across chapters
- Define 3-5 thematic motifs that will recur and evolve throughout the story
- Ensure each story line has clear narrative function and thematic relevance
- Create interdependencies between story lines (they should affect each other)

STRUCTURAL GUIDELINES:
1. PRIMARY STORY LINE: Main protagonist's journey
2. SECONDARY STORY LINE: Antagonist force or opposing philosophy
3. RELATIONSHIP STORY LINE: Key character relationship arc
4. WORLD/PLOT STORY LINE: External events forcing change
5. THEMATIC STORY LINE: Abstract theme made concrete (optional)

Each key beat should:
- Specify which chapter it occurs in
- Describe the event concisely (20-50 words)
- Note which characters are involved
- Explain thematic relevance

Output STRICT JSON only, no markdown, no explanations.`

    if (metaLearnerContext) {
      const threadCountInstruction = metaLearnerContext.preferredThreadCount
        ? `User prefers approximately ${metaLearnerContext.preferredThreadCount} story lines.`
        : ""

      const pacingInstruction = metaLearnerContext.pacingPreference
        ? metaLearnerContext.pacingPreference === "fast"
          ? "User prefers fast pacing with quick transitions and frequent plot developments."
          : metaLearnerContext.pacingPreference === "slow"
            ? "User prefers slow-burn pacing with deep character exploration and detailed world-building."
            : "User prefers balanced pacing mixing action with character development."
        : ""

      systemPrompt += `\n\nUSER PREFERENCES:\n${threadCountInstruction}\n${pacingInstruction}`
    }

    let userPrompt = `Create a narrative skeleton for an epic story with:

Theme: ${theme}
Tone: ${tone}
Initial Context/Prompt: ${initialPrompt}

Generate a JSON structure with this exact format:
{
  "storyLines": [
    {
      "name": "Story Line Name",
      "keyBeats": [
        {
          "chapter": 1,
          "description": "Event description",
          "characters": ["Character1", "Character2"],
          "thematicRelevance": "How this beat serves the theme"
        }
      ],
      "status": "active",
      "currentBeatIndex": 0
    }
  ],
  "thematicMotifs": {
    "motif_name": {
      "description": "What this motif represents",
      "chapters": [1, 3, 5],
      "variations": ["Variation 1", "Variation 2"]
    }
  }
}`

    if (metaLearnerContext) {
      userPrompt += `\n\nPlease tailor the skeleton to the user's preferences: ${
        metaLearnerContext.preferredThreadCount ? `${metaLearnerContext.preferredThreadCount} story lines` : ""
      } ${metaLearnerContext.pacingPreference ? `with ${metaLearnerContext.pacingPreference} pacing` : ""}.`
    }

    const result = await callLLMJson<NarrativeSkeleton>({
      prompt: userPrompt,
      system: systemPrompt,
      callType: "narrative_skeleton_creation",
      temperature: 0.7,
      useRetry: true,
    })

    const skeleton = result.data
    log.info("llm_skeleton_output", {
      storyLines: skeleton.storyLines?.length || 0,
      motifs: Object.keys(skeleton.thematicMotifs || {}).length,
    })

    skeleton.createdAt = Date.now()
    skeleton.lastUpdated = Date.now()
    skeleton.theme = theme
    skeleton.tone = tone
    skeleton.initialPrompt = initialPrompt
    skeleton.metaLearnerContext = metaLearnerContext

    await saveNarrativeSkeleton(skeleton)

    narrativeSkeletonManager.setSkeleton(skeleton)

    log.info("narrative_skeleton_created", {
      storyLines: skeleton.storyLines.length,
      thematicMotifs: Object.keys(skeleton.thematicMotifs).length,
      totalKeyBeats: skeleton.storyLines.reduce((sum, sl) => sum + sl.keyBeats.length, 0),
    })

    return skeleton
  } catch (error) {
    log.error("skeleton_creation_failed", { error: String(error) })
    throw error
  }
}

export async function loadNarrativeSkeleton(): Promise<NarrativeSkeleton | null> {
  try {
    const path = resolve(getSkeletonPath())
    if (await fileExists(path)) {
      const content = await readFile(path, "utf-8")
      const skeleton = JSON.parse(content)
      log.info("narrative_skeleton_loaded", {
        storyLines: skeleton.storyLines?.length || 0,
        thematicMotifs: Object.keys(skeleton.thematicMotifs || {}).length,
      })
      return skeleton
    }
  } catch (error) {
    log.error("skeleton_load_failed", { error: String(error) })
  }
  return null
}

export async function saveNarrativeSkeleton(skeleton: NarrativeSkeleton): Promise<void> {
  try {
    const path = resolve(getSkeletonPath())
    await mkdir(dirname(path), { recursive: true })
    skeleton.lastUpdated = Date.now()
    await writeFile(path, JSON.stringify(skeleton, null, 2))
    log.info("narrative_skeleton_saved")
  } catch (error) {
    log.error("skeleton_save_failed", { error: String(error) })
    throw error
  }
}

export async function updateStoryLineProgress(
  skeleton: NarrativeSkeleton,
  storyLineName: string,
  currentBeatIndex: number,
): Promise<void> {
  await narrativeSkeletonManager.updateStoryLineProgress(storyLineName, currentBeatIndex)
}

export function getNextKeyBeat(
  skeleton: NarrativeSkeleton,
  chapter: number,
): Array<{
  storyLine: string
  beat: any
}> {
  narrativeSkeletonManager.setSkeleton(skeleton)
  return narrativeSkeletonManager.getNextKeyBeat(chapter)
}

export function getThematicMotifString(skeleton: NarrativeSkeleton): string {
  narrativeSkeletonManager.setSkeleton(skeleton)
  return narrativeSkeletonManager.getThematicMotifString()
}

export function getOverallCompletionPercentage(skeleton: NarrativeSkeleton): number {
  narrativeSkeletonManager.setSkeleton(skeleton)
  return narrativeSkeletonManager.getOverallCompletionPercentage()
}

export async function updateNarrativeSkeleton(
  skeleton: NarrativeSkeleton,
  updatePlan: SkeletonUpdatePlan,
): Promise<boolean> {
  narrativeSkeletonManager.setSkeleton(skeleton)
  return narrativeSkeletonManager.updateNarrativeSkeleton(updatePlan)
}
