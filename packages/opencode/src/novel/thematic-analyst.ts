import { readFile, writeFile, readdir } from "fs/promises"
import { resolve, dirname, join } from "path"
import { mkdir } from "fs/promises"
import { callLLMJson } from "./llm-wrapper"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { getSummariesPath, getReflectionsPath, getStoryBiblePath } from "./novel-config"

const log = Log.create({ service: "thematic-analyst" })

interface ThematicReflection {
  turnNumber: number
  theme: string
  analysis: {
    thematicConsistency: {
      score: number
      assessment: string
      evidence: string[]
    }
    imageryEvolution: {
      recurringImages: string[]
      evolution: string
      recommendations: string[]
    }
    characterArcs: {
      character: string
      arcProgression: string
      alignmentWithTheme: string
      recommendations: string[]
    }[]
    narrativePacing: {
      assessment: string
      tensionCurve: string
      recommendations: string[]
    }
    philosophicalDepth: {
      questionsRaised: string[]
      insightsOffered: string[]
      unexploredAreas: string[]
    }
  }
  recommendations: {
    immediate: string[]
    longTerm: string[]
    warnings: string[]
  }
  timestamp: number
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

export async function runThematicReflection(turnNumber: number, theme: string): Promise<ThematicReflection> {
  log.info("thematic_reflection_started", { turnNumber, theme })

  try {
    const summaries = await loadTurnSummaries(turnNumber)
    const fullStory = await loadFullStory()

    const analysis = await analyzeThematicElements(summaries, fullStory, theme)

    const reflection: ThematicReflection = {
      turnNumber,
      theme,
      analysis,
      recommendations: {
        immediate: generateImmediateRecommendations(analysis),
        longTerm: generateLongTermRecommendations(analysis),
        warnings: generateWarnings(analysis),
      },
      timestamp: Date.now(),
    }

    await saveReflection(reflection)
    await saveReflectionMarkdown(reflection)

    log.info("thematic_reflection_completed", {
      turnNumber,
      recommendationsCount: reflection.recommendations.immediate.length + reflection.recommendations.longTerm.length,
    })

    return reflection
  } catch (error) {
    log.error("thematic_reflection_failed", { error: String(error) })
    throw error
  }
}

async function loadTurnSummaries(currentTurn: number): Promise<string[]> {
  const summaries: string[] = []
  const recentTurns = Math.min(10, currentTurn)
  const summariesPath = getSummariesPath()

  try {
    if (await fileExists(summariesPath)) {
      const files = await readdir(summariesPath)
      const turnFiles = files
        .filter((f) => f.includes("turn_") && f.endsWith(".md"))
        .sort()
        .slice(-recentTurns)

      for (const file of turnFiles) {
        const content = await readFile(join(summariesPath, file), "utf-8")
        summaries.push(content)
      }
    }
  } catch (error) {
    log.warn("failed_to_load_summaries", { error: String(error) })
  }

  log.info("summaries_loaded", { count: summaries.length })
  return summaries
}

async function loadFullStory(): Promise<string> {
  try {
    const storyBiblePath = getStoryBiblePath()
    if (await fileExists(storyBiblePath)) {
      const content = await readFile(storyBiblePath, "utf-8")
      const data = JSON.parse(content)
      return data.fullStory || ""
    }
  } catch (error) {
    log.warn("failed_to_load_full_story", { error: String(error) })
  }
  return ""
}

async function analyzeThematicElements(
  summaries: string[],
  fullStory: string,
  theme: string,
): Promise<ThematicReflection["analysis"]> {
  const contextText = `
THEME: ${theme}

RECENT TURN SUMMARIES:
${summaries.join("\n\n---\n\n")}

FULL STORY (last 3000 chars):
${fullStory.slice(-3000)}
`.trim()

  const systemPrompt = `You are a distinguished literary critic and narrative theorist with expertise in epic storytelling.
Your task is to conduct a rigorous thematic analysis of an ongoing long-form narrative.

ANALYSIS FRAMEWORK:

1. THEMATIC CONSISTENCY (score 1-10)
2. IMAGERY EVOLUTION (recurring images, evolution, recommendations)
3. CHARACTER ARCS (per-character assessment)
4. NARRATIVE PACING (tension curve, recommendations)
5. PHILOSOPHICAL DEPTH (questions raised, insights, unexplored areas)

Be specific, citing actual events and patterns. Balance praise with constructive critique.`

  try {
    const result = await callLLMJson<ThematicReflection["analysis"]>({
      prompt: contextText,
      system: systemPrompt,
      callType: "thematic_analysis",
      temperature: 0.3,
      useRetry: true,
    })
    log.info("thematic_analysis_completed")
    return result.data
  } catch (parseError) {
    log.error("analysis_parse_failed", { error: String(parseError) })
  }

  return {
    thematicConsistency: {
      score: 5,
      assessment: "Analysis failed to parse",
      evidence: [],
    },
    imageryEvolution: {
      recurringImages: [],
      evolution: "Unable to analyze",
      recommendations: [],
    },
    characterArcs: [],
    narrativePacing: {
      assessment: "Unable to analyze",
      tensionCurve: "Unknown",
      recommendations: [],
    },
    philosophicalDepth: {
      questionsRaised: [],
      insightsOffered: [],
      unexploredAreas: [],
    },
  }
}

function generateImmediateRecommendations(analysis: ThematicReflection["analysis"]): string[] {
  const recommendations: string[] = []

  if (analysis.thematicConsistency.score < 7) {
    recommendations.push(
      "Re-center the narrative on core theme in next chapter - consider a thematically charged event",
    )
  }

  if (analysis.characterArcs.some((arc) => arc.recommendations.length > 0)) {
    const stagnantChars = analysis.characterArcs
      .filter((arc) => arc.recommendations.length > 0)
      .map((arc) => arc.character)
      .join(", ")
    if (stagnantChars) {
      recommendations.push(`Address character development for: ${stagnantChars}`)
    }
  }

  if (analysis.narrativePacing.recommendations.length > 0) {
    recommendations.push(...analysis.narrativePacing.recommendations.slice(0, 2))
  }

  return recommendations
}

function generateLongTermRecommendations(analysis: ThematicReflection["analysis"]): string[] {
  const recommendations: string[] = []

  if (analysis.imageryEvolution.recommendations.length > 0) {
    recommendations.push(...analysis.imageryEvolution.recommendations)
  }

  if (analysis.philosophicalDepth.unexploredAreas.length > 0) {
    const area = analysis.philosophicalDepth.unexploredAreas[0]
    recommendations.push(`Explore philosophical dimension: ${area}`)
  }

  if (
    analysis.characterArcs.some(
      (arc) => arc.alignmentWithTheme.includes("weak") || arc.alignmentWithTheme.includes("misaligned"),
    )
  ) {
    recommendations.push("Realign character arcs with thematic exploration over next 3-5 chapters")
  }

  return recommendations
}

function generateWarnings(analysis: ThematicReflection["analysis"]): string[] {
  const warnings: string[] = []

  if (analysis.thematicConsistency.score < 5) {
    warnings.push("CRITICAL: Severe thematic drift detected - story may be losing its core identity")
  }

  if (analysis.characterArcs.length === 0) {
    warnings.push("No clear character arcs detected - risk of plot-driven narrative without emotional core")
  }

  if (analysis.philosophicalDepth.questionsRaised.length === 0) {
    warnings.push("Story raises no philosophical questions - consider deepening thematic exploration")
  }

  return warnings
}

async function saveReflection(reflection: ThematicReflection): Promise<void> {
  try {
    const reflectionsPath = getReflectionsPath()
    const path = resolve(reflectionsPath, `reflection_turn_${reflection.turnNumber}.json`)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(reflection, null, 2))
    log.info("reflection_saved", { turn: reflection.turnNumber })
  } catch (error) {
    log.error("reflection_save_failed", { error: String(error) })
  }
}

async function saveReflectionMarkdown(reflection: ThematicReflection): Promise<void> {
  try {
    const reflectionsPath = getReflectionsPath()
    const path = resolve(reflectionsPath, `reflection_turn_${reflection.turnNumber}.md`)
    await mkdir(dirname(path), { recursive: true })

    const md = `# Thematic Reflection - Turn ${reflection.turnNumber}

**Theme:** ${reflection.theme}

**Generated:** ${new Date(reflection.timestamp).toISOString()}

---

## Thematic Consistency: ${reflection.analysis.thematicConsistency.score}/10

${reflection.analysis.thematicConsistency.assessment}

**Evidence:**
${reflection.analysis.thematicConsistency.evidence.map((e) => `- ${e}`).join("\n")}

---

## Imagery Evolution

**Recurring Images:** ${reflection.analysis.imageryEvolution.recurringImages.join(", ") || "None identified"}

**Evolution:** ${reflection.analysis.imageryEvolution.evolution}

**Recommendations:**
${reflection.analysis.imageryEvolution.recommendations.map((r) => `- ${r}`).join("\n") || "None"}

---

## Character Arcs

${
  reflection.analysis.characterArcs
    .map(
      (arc) => `### ${arc.character}

**Progression:** ${arc.arcProgression}

**Thematic Alignment:** ${arc.alignmentWithTheme}

**Recommendations:**
${arc.recommendations.map((r) => `- ${r}`).join("\n") || "None"}
`,
    )
    .join("\n") || "No character arcs analyzed"
}

---

## Narrative Pacing

**Assessment:** ${reflection.analysis.narrativePacing.assessment}

**Tension Curve:** ${reflection.analysis.narrativePacing.tensionCurve}

**Recommendations:**
${reflection.analysis.narrativePacing.recommendations.map((r) => `- ${r}`).join("\n") || "None"}

---

## Philosophical Depth

**Questions Raised:**
${reflection.analysis.philosophicalDepth.questionsRaised.map((q) => `- ${q}`).join("\n") || "None identified"}

**Insights Offered:**
${reflection.analysis.philosophicalDepth.insightsOffered.map((i) => `- ${i}`).join("\n") || "None identified"}

**Unexplored Areas:**
${reflection.analysis.philosophicalDepth.unexploredAreas.map((a) => `- ${a}`).join("\n") || "None"}

---

## Recommendations

### Immediate (Next Chapter)
${reflection.recommendations.immediate.map((r) => `- ${r}`).join("\n") || "None"}

### Long-Term (Next 3-5 Chapters)
${reflection.recommendations.longTerm.map((r) => `- ${r}`).join("\n") || "None"}

### Warnings
${reflection.recommendations.warnings.map((w) => `⚠️ ${w}`).join("\n") || "None"}
`

    await writeFile(path, md)
    log.info("reflection_markdown_saved", { turn: reflection.turnNumber })
  } catch (error) {
    log.error("reflection_markdown_save_failed", { error: String(error) })
  }
}

export async function loadPreviousReflection(turnNumber: number): Promise<ThematicReflection | null> {
  try {
    const reflectionsPath = getReflectionsPath()
    const path = resolve(reflectionsPath, `reflection_turn_${turnNumber}.json`)
    if (await fileExists(path)) {
      const content = await readFile(path, "utf-8")
      return JSON.parse(content)
    }
  } catch (error) {
    log.warn("previous_reflection_load_failed", { turn: turnNumber, error: String(error) })
  }
  return null
}

export async function getLatestReflectionTurn(): Promise<number> {
  try {
    const reflectionsPath = getReflectionsPath()
    if (await fileExists(reflectionsPath)) {
      const files = await readdir(reflectionsPath)
      const reflectionFiles = files.filter((f) => f.startsWith("reflection_turn_") && f.endsWith(".json"))

      if (reflectionFiles.length > 0) {
        const turns = reflectionFiles.map((f) => {
          const match = f.match(/turn_(\d+)/)
          return match ? parseInt(match[1], 10) : 0
        })
        return Math.max(...turns)
      }
    }
  } catch (error) {
    log.warn("latest_reflection_check_failed", { error: String(error) })
  }
  return 0
}
