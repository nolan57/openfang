import { readFile, writeFile } from "fs/promises"
import { resolve, dirname } from "path"
import { mkdir } from "fs/promises"
import { generateText } from "ai"
import { Log } from "../util/log"
import { getNovelLanguageModel } from "./model"
import { Instance } from "../project/instance"

const log = Log.create({ service: "narrative-skeleton" })

function getProjectDirectory(): string {
  try {
    return Instance.directory
  } catch {
    return resolve(process.cwd())
  }
}

const NarrativeSkeletonPath = resolve(getProjectDirectory(), ".opencode/novel/narrative_skeleton.json")

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
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

/**
 * Creates a fallback skeleton when LLM parsing fails.
 * This ensures the novel can continue even if skeleton generation fails.
 */
function createFallbackSkeleton(theme: string, tone: string, initialPrompt: string): NarrativeSkeleton {
  log.info("creating_fallback_skeleton", { theme, tone })

  const now = Date.now()
  const skeleton: NarrativeSkeleton = {
    theme,
    tone,
    initialPrompt,
    createdAt: now,
    lastUpdated: now,
    storyLines: [
      {
        name: "Main Story",
        status: "active",
        currentBeatIndex: 0,
        keyBeats: Array.from({ length: 20 }, (_, i) => ({
          chapter: i + 1,
          description: `Chapter ${i + 1}: Continue developing the story`,
          characters: [],
          thematicRelevance: theme,
        })),
      },
    ],
    thematicMotifs: {
      core_theme: {
        description: theme,
        chapters: [1, 5, 10, 15, 20],
        variations: [
          "Initial introduction",
          "First development",
          "Deepening complexity",
          "Climax expression",
          "Resolution",
        ],
      },
    },
  }

  saveNarrativeSkeleton(skeleton).catch((err) => {
    log.error("fallback_skeleton_save_failed", { error: String(err) })
  })

  return skeleton
}

export async function createNarrativeSkeleton(
  theme: string,
  tone: string,
  initialPrompt: string,
): Promise<NarrativeSkeleton> {
  log.info("creating_narrative_skeleton", { theme, tone, promptLength: initialPrompt.length })

  try {
    const languageModel = await getNovelLanguageModel()

    const systemPrompt = `You are an expert literary architect specializing in epic narrative structures.
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

    const userPrompt = `Create a narrative skeleton for an epic story with:

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

    const result = await generateText({
      model: languageModel,
      system: systemPrompt,
      prompt: userPrompt,
    })

    const text = result.text.trim()
    log.info("llm_skeleton_output", { textLength: text.length, preview: text.slice(0, 500) })

    // Extract JSON from response (handle markdown code blocks)
    let jsonText = text
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim()
    } else {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        jsonText = jsonMatch[0]
      }
    }

    log.info("extracted_json", { jsonLength: jsonText.length, preview: jsonText.slice(0, 500) })

    let skeleton: NarrativeSkeleton
    try {
      skeleton = JSON.parse(jsonText)
    } catch (parseError) {
      log.error("json_parse_failed", {
        error: String(parseError),
        jsonPreview: jsonText.slice(0, 1000),
      })
      // Return fallback skeleton instead of throwing
      return createFallbackSkeleton(theme, tone, initialPrompt)
    }

    skeleton.createdAt = Date.now()
    skeleton.lastUpdated = Date.now()
    skeleton.theme = theme
    skeleton.tone = tone
    skeleton.initialPrompt = initialPrompt

    await saveNarrativeSkeleton(skeleton)
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
    const path = resolve(NarrativeSkeletonPath)
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
    const path = resolve(NarrativeSkeletonPath)
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
  const storyLine = skeleton.storyLines.find((sl) => sl.name === storyLineName)
  if (storyLine) {
    storyLine.currentBeatIndex = currentBeatIndex
    if (currentBeatIndex >= storyLine.keyBeats.length - 1) {
      storyLine.status = "resolved"
    } else {
      storyLine.status = "active"
    }
    await saveNarrativeSkeleton(skeleton)
    log.info("storyline_progress_updated", { storyLineName, currentBeatIndex })
  }
}

export function getNextKeyBeat(
  skeleton: NarrativeSkeleton,
  chapter: number,
): Array<{
  storyLine: string
  beat: any
}> {
  const nextBeats: Array<{ storyLine: string; beat: any }> = []

  for (const storyLine of skeleton.storyLines) {
    const currentIndex = storyLine.currentBeatIndex || 0
    const nextBeat = storyLine.keyBeats.find(
      (beat) => beat.chapter === chapter && (storyLine.currentBeatIndex || 0) < currentIndex + 1,
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

export function getActiveStoryLines(skeleton: NarrativeSkeleton): StoryLine[] {
  return skeleton.storyLines.filter((sl) => sl.status === "active" || sl.status === "dormant")
}

export function getThematicMotifString(skeleton: NarrativeSkeleton): string {
  const motifs = Object.entries(skeleton.thematicMotifs).map(([name, motif]) => {
    const variations = motif.variations.join("; ")
    return `${name}: ${motif.description} (Variations: ${variations})`
  })
  return motifs.join("\n")
}
