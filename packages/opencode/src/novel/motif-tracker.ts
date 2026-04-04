import { z } from "zod"
import { readFile, writeFile, access, mkdir } from "fs/promises"
import { resolve, dirname } from "path"
import { Log } from "../util/log"
import { callLLMJson } from "./llm-wrapper"
import type { Motif } from "./pattern-miner-enhanced"
import { getMotifTrackingPath } from "./novel-config"

const log = Log.create({ service: "motif-tracker" })

// Lazy-initialized path
let MotifTrackingPath: string | null = null

function getTrackingPath(): string {
  if (!MotifTrackingPath) {
    MotifTrackingPath = getMotifTrackingPath()
  }
  return MotifTrackingPath
}

export const MotifEvolutionSchema = z.object({
  motifId: z.string(),
  motifName: z.string(),
  fromState: z.string(),
  toState: z.string(),
  triggerEvent: z.string(),
  triggerChapter: z.number(),
  characterInvolved: z.string().optional(),
  emotionalContext: z.string().optional(),
  thematicSignificance: z.number().min(1).max(10),
  timestamp: z.number(),
})

export const MotifCharacterCorrelationSchema = z.object({
  motifId: z.string(),
  characterName: z.string(),
  correlationStrength: z.number().min(0).max(100),
  arcPhase: z.enum(["denial", "resistance", "exploration", "integration", "mastery"]),
  impactType: z.enum(["positive", "negative", "transformative", "neutral"]),
  description: z.string(),
  chapters: z.array(z.number()),
})

export const MotifVariationSchema = z.object({
  parentMotifId: z.string(),
  variationName: z.string(),
  description: z.string(),
  differences: z.string(),
  chapter: z.number(),
  strength: z.number().min(0).max(100),
})

export type MotifEvolution = z.infer<typeof MotifEvolutionSchema>
export type MotifCharacterCorrelation = z.infer<typeof MotifCharacterCorrelationSchema>
export type MotifVariation = z.infer<typeof MotifVariationSchema>

export interface HighImpactMotifEvent {
  motifId: string
  motifName: string
  evolution: MotifEvolution
  impactScore: number
  eventType: "thematic_shift" | "strength_surge" | "character_transformation" | "narrative_climax"
}

export interface MotifTrackerConfig {
  highImpactThematicSignificanceThreshold: number
  highImpactStrengthChangeThreshold: number
  onHighImpactEvent?: (event: HighImpactMotifEvent) => void
}

const DEFAULT_CONFIG: MotifTrackerConfig = {
  highImpactThematicSignificanceThreshold: 8,
  highImpactStrengthChangeThreshold: 30,
  onHighImpactEvent: undefined,
}

export interface MotifTrackingData {
  evolutions: MotifEvolution[]
  correlations: MotifCharacterCorrelation[]
  variations: MotifVariation[]
  lastUpdated: number
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function ensureDir(): Promise<void> {
  await mkdir(getTrackingPath(), { recursive: true })
}

export class MotifTracker {
  private evolutions: Map<string, MotifEvolution[]> = new Map()
  private correlations: Map<string, MotifCharacterCorrelation[]> = new Map()
  private variations: Map<string, MotifVariation[]> = new Map()
  private motifStrengths: Map<string, number> = new Map()
  private config: MotifTrackerConfig

  constructor(config: Partial<MotifTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async initialize(): Promise<void> {
    await ensureDir()
    await this.load()
  }

  private async load(): Promise<void> {
    try {
      const path = resolve(getTrackingPath(), "tracking-data.json")
      if (await fileExists(path)) {
        const content = await readFile(path, "utf-8")
        const data: MotifTrackingData = JSON.parse(content)

        for (const ev of data.evolutions || []) {
          const existing = this.evolutions.get(ev.motifId) || []
          existing.push(ev)
          this.evolutions.set(ev.motifId, existing)
        }

        for (const corr of data.correlations || []) {
          const key = `${corr.motifId}_${corr.characterName}`
          this.correlations.set(key, [corr])
        }

        for (const v of data.variations || []) {
          const existing = this.variations.get(v.parentMotifId) || []
          existing.push(v)
          this.variations.set(v.parentMotifId, existing)
        }

        log.info("motif_tracking_loaded", {
          evolutions: this.evolutions.size,
          correlations: this.correlations.size,
          variations: this.variations.size,
        })
      }
    } catch (error) {
      log.warn("motif_tracking_load_failed", { error: String(error) })
    }
  }

  async save(): Promise<void> {
    await ensureDir()

    const data: MotifTrackingData = {
      evolutions: Array.from(this.evolutions.values()).flat(),
      correlations: Array.from(this.correlations.values()).flat(),
      variations: Array.from(this.variations.values()).flat(),
      lastUpdated: Date.now(),
    }

    const path = resolve(getTrackingPath(), "tracking-data.json")
    await writeFile(path, JSON.stringify(data, null, 2))

    log.info("motif_tracking_saved", {
      evolutions: data.evolutions.length,
      correlations: data.correlations.length,
      variations: data.variations.length,
    })
  }

  recordEvolution(evolution: MotifEvolution): void {
    const existing = this.evolutions.get(evolution.motifId) || []
    existing.push(evolution)
    this.evolutions.set(evolution.motifId, existing)

    log.info("motif_evolution_recorded", {
      motifId: evolution.motifId,
      from: evolution.fromState,
      to: evolution.toState,
      chapter: evolution.triggerChapter,
    })
  }

  updateCorrelation(correlation: MotifCharacterCorrelation): void {
    const key = `${correlation.motifId}_${correlation.characterName}`
    this.correlations.set(key, [correlation])

    log.info("motif_correlation_updated", {
      motifId: correlation.motifId,
      character: correlation.characterName,
      strength: correlation.correlationStrength,
    })
  }

  addVariation(variation: MotifVariation): void {
    const existing = this.variations.get(variation.parentMotifId) || []
    existing.push(variation)
    this.variations.set(variation.parentMotifId, existing)

    log.info("motif_variation_added", {
      parentMotifId: variation.parentMotifId,
      variation: variation.variationName,
    })
  }

  getMotifEvolutions(motifId: string): MotifEvolution[] {
    return this.evolutions.get(motifId) || []
  }

  getCharacterCorrelations(characterName: string): MotifCharacterCorrelation[] {
    return Array.from(this.correlations.values())
      .flat()
      .filter((c) => c.characterName === characterName)
  }

  getMotifCorrelations(motifId: string): MotifCharacterCorrelation[] {
    return Array.from(this.correlations.values())
      .flat()
      .filter((c) => c.motifId === motifId)
  }

  getVariations(motifId: string): MotifVariation[] {
    return this.variations.get(motifId) || []
  }

  calculateThematicSaturation(coreMotifId: string): number {
    const evolutions = this.getMotifEvolutions(coreMotifId)
    const correlations = this.getMotifCorrelations(coreMotifId)
    const variations = this.getVariations(coreMotifId)

    if (evolutions.length === 0 && correlations.length === 0) {
      return 0
    }

    const avgSignificance =
      evolutions.length > 0 ? evolutions.reduce((sum, e) => sum + e.thematicSignificance, 0) / evolutions.length : 0

    const evolutionScore = Math.min(avgSignificance * 8, 40)

    const evolutionDiversityScore = Math.min(evolutions.length * 4, 20)

    const avgCorrelationStrength =
      correlations.length > 0
        ? correlations.reduce((sum, c) => sum + c.correlationStrength, 0) / correlations.length
        : 0
    const correlationScore = (avgCorrelationStrength / 100) * 25

    const variationScore = Math.min(variations.length * 5, 15)

    const totalScore = evolutionScore + evolutionDiversityScore + correlationScore + variationScore

    return Math.min(100, Math.round(totalScore))
  }

  generateThematicDeepeningSuggestion(coreMotifId: string, currentChapter: number): string | null {
    const evolutions = this.getMotifEvolutions(coreMotifId)
    const correlations = this.getMotifCorrelations(coreMotifId)

    if (evolutions.length === 0) {
      return null
    }

    const latestEvolution = evolutions[evolutions.length - 1]
    const currentStrength = this.motifStrengths.get(coreMotifId) || 50

    if (currentStrength < 40) {
      const stronglyCorrelatedChars = correlations.filter((c) => c.correlationStrength >= 70)
      if (stronglyCorrelatedChars.length > 0) {
        const char = stronglyCorrelatedChars[0]
        return `在下一章，让${char.characterName}在关键时刻${
          char.impactType === "positive" ? "展现" : "对抗"
        }"${latestEvolution.motifName}"的主题。通过${
          char.arcPhase === "denial"
            ? "拒绝接受现实"
            : char.arcPhase === "resistance"
              ? "内心挣扎后的妥协"
              : char.arcPhase === "exploration"
                ? "主动探索新的可能性"
                : char.arcPhase === "integration"
                  ? "将主题融入日常行为"
                  : "以大师级的方式展现主题"
        }，来强化此母题与角色弧光的关联。`
      }
    }

    if (latestEvolution.thematicSignificance >= 7) {
      return `"${latestEvolution.motifName}"已达到重要强度（${latestEvolution.thematicSignificance}/10）。建议：创造一次主题变奏——让此母题以相反或镜像的形式再次出现，形成呼应。例如，如果之前是"${latestEvolution.fromState}"，现在可以展现"${latestEvolution.toState}"的代价或后果。`
    }

    return null
  }

  async analyzeMotifEvolution(
    motifs: Motif[],
    storySegment: string,
    characters: Record<string, any>,
    chapter: number,
  ): Promise<MotifEvolution[]> {
    const motifContext = motifs
      .filter((m) => m.strength > 30)
      .map((m) => `${m.name}: ${m.description} (strength: ${m.strength}%)`)
      .join("\n")

    const charContext = Object.entries(characters)
      .slice(0, 5)
      .map(([name, char]) => {
        const arc = char.arcPhase || "exploration"
        const stress = char.stress || 0
        return `${name}: arc=${arc}, stress=${stress}`
      })
      .join("\n")

    const prompt = `Analyze this story segment for motif evolution and character-motif correlations.

MOTIFS:
${motifContext || "No active motifs"}

CHARACTERS:
${charContext || "No characters"}

STORY SEGMENT:
${storySegment.substring(0, 2000)}

CHAPTER: ${chapter}

For each motif that has evolved or relates to characters, output:
{
  "evolutions": [
    { "motifName": "name", "fromState": "previous state", "toState": "new state", "triggerEvent": "what caused the change", "characterInvolved": "character name", "emotionalContext": "emotional context", "thematicSignificance": 1-10 }
  ],
  "correlations": [
    { "motifName": "name", "characterName": "character", "correlationStrength": 0-100, "arcPhase": "denial|resistance|exploration|integration|mastery", "impactType": "positive|negative|transformative|neutral", "description": "how this motif relates to this character's arc" }
  ],
  "variations": [
    { "parentMotifName": "parent motif", "variationName": "new variation name", "description": "description", "differences": "how it differs from parent" }
  ]
}

Output JSON. If no evolution/correlation, use empty arrays.`

    try {
      const result = await callLLMJson<{
        evolutions?: Array<{ motifName: string; fromState: string; toState: string; triggerEvent: string; characterInvolved: string; emotionalContext: string; thematicSignificance: number }>
        correlations?: Array<{ motifName: string; characterName: string; correlationStrength: number; arcPhase: string; impactType: string; description: string }>
        variations?: Array<{ parentMotifName: string; variationName: string; description: string; differences: string }>
      }>({
        prompt,
        callType: "motif_evolution",
        temperature: 0.5,
        useRetry: true,
      })
      const data = result.data
      const newEvolutions: MotifEvolution[] = []

      for (const ev of data.evolutions || []) {
        const motif = motifs.find((m) => m.name === ev.motifName)
        if (!motif) continue

        const evolution: MotifEvolution = {
          motifId: motif.id,
          motifName: ev.motifName,
          fromState: ev.fromState,
          toState: ev.toState,
          triggerEvent: ev.triggerEvent,
          triggerChapter: chapter,
          characterInvolved: ev.characterInvolved,
          emotionalContext: ev.emotionalContext,
          thematicSignificance: ev.thematicSignificance || 5,
          timestamp: Date.now(),
        }

        this.recordEvolution(evolution)
        newEvolutions.push(evolution)

        const previousStrength = this.motifStrengths.get(motif.id) || motif.strength
        this.motifStrengths.set(motif.id, motif.strength)
        const strengthChange = Math.abs(motif.strength - previousStrength)

        const isHighImpact =
          evolution.thematicSignificance >= this.config.highImpactThematicSignificanceThreshold ||
          strengthChange >= this.config.highImpactStrengthChangeThreshold

        if (isHighImpact) {
          const impactScore = evolution.thematicSignificance * 10 + strengthChange
          let eventType: HighImpactMotifEvent["eventType"] = "thematic_shift"

          if (evolution.thematicSignificance >= 9) {
            eventType = "narrative_climax"
          } else if (strengthChange >= 40) {
            eventType = "strength_surge"
          } else if (evolution.characterInvolved) {
            const char = characters[evolution.characterInvolved]
            if (char?.arcPhase === "integration" || char?.arcPhase === "mastery") {
              eventType = "character_transformation"
            }
          }

          const highImpactEvent: HighImpactMotifEvent = {
            motifId: motif.id,
            motifName: evolution.motifName,
            evolution,
            impactScore,
            eventType,
          }

          log.warn("high_impact_motif_event_detected", {
            motifId: motif.id,
            motifName: evolution.motifName,
            eventType,
            impactScore,
            thematicSignificance: evolution.thematicSignificance,
            strengthChange,
          })

          if (this.config.onHighImpactEvent) {
            try {
              this.config.onHighImpactEvent(highImpactEvent)
            } catch (error) {
              log.error("high_impact_event_callback_failed", { error: String(error) })
            }
          }
        }
      }

      for (const corr of data.correlations || []) {
        const motif = motifs.find((m) => m.name === corr.motifName)
        if (!motif) continue

        const correlation: MotifCharacterCorrelation = {
          motifId: motif.id,
          characterName: corr.characterName,
          correlationStrength: corr.correlationStrength,
          arcPhase: corr.arcPhase as any,
          impactType: corr.impactType as any,
          description: corr.description,
          chapters: [chapter],
        }

        this.updateCorrelation(correlation)
      }

      for (const v of data.variations || []) {
        const parentMotif = motifs.find((m) => m.name === v.parentMotifName)
        if (!parentMotif) continue

        const variation: MotifVariation = {
          parentMotifId: parentMotif.id,
          variationName: v.variationName,
          description: v.description,
          differences: v.differences,
          chapter,
          strength: 40,
        }

        this.addVariation(variation)
      }

      await this.save()

      return newEvolutions
    } catch (error) {
      log.error("motif_evolution_analysis_failed", { error: String(error) })
      return []
    }
  }

  exportToKnowledgeGraph(): {
    nodes: Array<{ id: string; type: string; name: string; data: any }>
    edges: Array<{ source: string; target: string; type: string; weight: number }>
  } {
    const nodes: Array<{ id: string; type: string; name: string; data: any }> = []
    const edges: Array<{ source: string; target: string; type: string; weight: number }> = []

    for (const [motifId, evolutions] of this.evolutions) {
      for (const ev of evolutions) {
        nodes.push({
          id: `evolution_${ev.timestamp}`,
          type: "motif_evolution",
          name: `${ev.motifName} evolution`,
          data: ev,
        })

        edges.push({
          source: motifId,
          target: `evolution_${ev.timestamp}`,
          type: "evolved_to",
          weight: ev.thematicSignificance / 10,
        })

        if (ev.characterInvolved) {
          edges.push({
            source: `character_${ev.characterInvolved}`,
            target: `evolution_${ev.timestamp}`,
            type: "triggered_by",
            weight: 0.8,
          })
        }
      }
    }

    for (const [key, correlations] of this.correlations) {
      for (const corr of correlations) {
        edges.push({
          source: corr.motifId,
          target: `character_${corr.characterName}`,
          type: "correlates_with",
          weight: corr.correlationStrength / 100,
        })
      }
    }

    for (const [parentMotifId, variations] of this.variations) {
      for (const v of variations) {
        nodes.push({
          id: `variation_${v.variationName}`,
          type: "motif_variation",
          name: v.variationName,
          data: v,
        })

        edges.push({
          source: parentMotifId,
          target: `variation_${v.variationName}`,
          type: "varies_as",
          weight: v.strength / 100,
        })
      }
    }

    return { nodes, edges }
  }

  getMotifEvolutionReport(): string {
    const lines: string[] = ["# Motif Evolution Report\n"]

    for (const [motifId, evolutions] of this.evolutions) {
      if (evolutions.length === 0) continue

      const firstEv = evolutions[0]
      lines.push(`## ${firstEv.motifName}`)
      lines.push(`**Total Evolutions:** ${evolutions.length}\n`)

      for (const ev of evolutions) {
        lines.push(`### Chapter ${ev.triggerChapter}`)
        lines.push(`**Change:** ${ev.fromState} → ${ev.toState}`)
        lines.push(`**Trigger:** ${ev.triggerEvent}`)
        if (ev.characterInvolved) {
          lines.push(`**Character:** ${ev.characterInvolved}`)
        }
        if (ev.emotionalContext) {
          lines.push(`**Emotional Context:** ${ev.emotionalContext}`)
        }
        lines.push(`**Significance:** ${ev.thematicSignificance}/10\n`)
      }

      const correlations = this.getMotifCorrelations(motifId)
      if (correlations.length > 0) {
        lines.push(`### Character Correlations`)
        for (const corr of correlations) {
          lines.push(`- **${corr.characterName}**: ${corr.correlationStrength}% (${corr.impactType})`)
          lines.push(`  ${corr.description}`)
        }
        lines.push("")
      }
    }

    return lines.join("\n")
  }

  getStats(): {
    motifs: number
    evolutions: number
    correlations: number
    variations: number
    avgStrength: number
  } {
    const allEvolutions = Array.from(this.evolutions.values()).flat()
    const allCorrelations = Array.from(this.correlations.values()).flat()
    const allVariations = Array.from(this.variations.values()).flat()

    return {
      motifs: this.evolutions.size,
      evolutions: allEvolutions.length,
      correlations: allCorrelations.length,
      variations: allVariations.length,
      avgStrength:
        allEvolutions.length > 0
          ? (allEvolutions.reduce((sum, e) => sum + e.thematicSignificance, 0) / allEvolutions.length) * 10
          : 50,
    }
  }

  clear(): void {
    this.evolutions.clear()
    this.correlations.clear()
    this.variations.clear()
    log.info("motif_tracking_cleared")
  }
}

export const motifTracker = new MotifTracker()
