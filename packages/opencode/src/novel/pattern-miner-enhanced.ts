import { z } from "zod"
import { readFile, writeFile, access, mkdir } from "fs/promises"
import { resolve, dirname } from "path"
import { Log } from "../util/log"
import { generateText } from "ai"
import { getNovelLanguageModel } from "./model"
import { Instance } from "../project/instance"
import { memoize } from "./performance"
import { getPatternsDirPath } from "./novel-config"

const log = Log.create({ service: "pattern-miner-enhanced" })

export const ArchetypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum([
    "hero",
    "mentor",
    "shadow",
    "trickster",
    "herald",
    "shapeshifter",
    "guardian",
    "ally",
    "temptress",
    "threshold_guardian",
  ]),
  description: z.string(),
  traits: z.array(z.string()),
  narrative_role: z.string(),
  examples: z.array(z.string()).optional(),
  strength: z.number().min(0).max(100).default(50),
  decay_rate: z.number().min(0).max(1).default(0.1),
  last_reinforced: z.number(),
  occurrences: z.number().default(1),
})

export const PlotTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  structure: z.enum([
    "three_act",
    "hero_journey",
    "save_the_cat",
    "seven_point",
    "fichtean_curve",
    "kishoutenketsu",
    "in_media_res",
  ]),
  stages: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      narrative_beats: z.array(z.string()),
    }),
  ),
  theme_compatibility: z.array(z.string()).optional(),
  flexibility: z.number().min(0).max(100).default(50),
  usage_count: z.number().default(0),
  last_used: z.number().optional(),
})

export const MotifSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum([
    "symbolic",
    "thematic",
    "imagery",
    "recurring_object",
    "recurring_phrase",
    "color",
    "number",
    "nature",
  ]),
  description: z.string(),
  occurrences: z.array(
    z.object({
      chapter: z.number(),
      context: z.string(),
      significance: z.number().min(1).max(10),
    }),
  ),
  evolution: z
    .array(
      z.object({
        from_state: z.string(),
        to_state: z.string(),
        trigger_event: z.string(),
        chapter: z.number(),
      }),
    )
    .optional(),
  strength: z.number().min(0).max(100).default(50),
  decay_rate: z.number().min(0).max(1).default(0.05),
})

export const EnhancedPatternSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum([
    "character_trait",
    "world_rule",
    "skill",
    "plot_device",
    "tone",
    "archetype",
    "plot_template",
    "motif",
  ]),
  description: z.string(),
  embedding: z.array(z.number()).optional(),
  similarity_vector: z.string().optional(),
  strength: z.number().min(0).max(100).default(50),
  decay_rate: z.number().min(0).max(1).default(0.1),
  last_reinforced: z.number(),
  occurrences: z.number().default(1),
  cross_story_valid: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type Archetype = z.infer<typeof ArchetypeSchema>
export type PlotTemplate = z.infer<typeof PlotTemplateSchema>
export type Motif = z.infer<typeof MotifSchema>
export type EnhancedPattern = z.infer<typeof EnhancedPatternSchema>

// Lazy-initialized paths
let PatternsPath: string | null = null
let EnhancedPatternsPath: string | null = null
let ArchetypesPath: string | null = null
let PlotTemplatesPath: string | null = null
let MotifsPath: string | null = null

function getPatternsPath(): string {
  if (!PatternsPath) {
    PatternsPath = getPatternsDirPath()
  }
  return PatternsPath
}

function getEnhancedPatternsPath(): string {
  if (!EnhancedPatternsPath) {
    EnhancedPatternsPath = resolve(getPatternsPath(), "enhanced-patterns.json")
  }
  return EnhancedPatternsPath
}

function getArchetypesPath(): string {
  if (!ArchetypesPath) {
    ArchetypesPath = resolve(getPatternsPath(), "archetypes.json")
  }
  return ArchetypesPath
}

function getPlotTemplatesPath(): string {
  if (!PlotTemplatesPath) {
    PlotTemplatesPath = resolve(getPatternsPath(), "plot-templates.json")
  }
  return PlotTemplatesPath
}

function getMotifsPath(): string {
  if (!MotifsPath) {
    MotifsPath = resolve(getPatternsPath(), "motifs.json")
  }
  return MotifsPath
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function ensurePatternsDir(): Promise<void> {
  await mkdir(getPatternsPath(), { recursive: true })
}

export interface PatternDecayConfig {
  baseDecayRate: number
  reinforcementBoost: number
  minStrengthThreshold: number
  crossStoryBonus: number
}

const DEFAULT_DECAY_CONFIG: PatternDecayConfig = {
  baseDecayRate: 0.1,
  reinforcementBoost: 20,
  minStrengthThreshold: 10,
  crossStoryBonus: 5,
}

export class EnhancedPatternMiner {
  private patterns: Map<string, EnhancedPattern> = new Map()
  private archetypes: Map<string, Archetype> = new Map()
  private plotTemplates: Map<string, PlotTemplate> = new Map()
  private motifs: Map<string, Motif> = new Map()
  private config: PatternDecayConfig
  private turnCount: number = 0

  constructor(config: Partial<PatternDecayConfig> = {}) {
    this.config = { ...DEFAULT_DECAY_CONFIG, ...config }
  }

  async initialize(): Promise<void> {
    await ensurePatternsDir()
    await this.loadPatterns()
  }

  private async loadPatterns(): Promise<void> {
    try {
      if (await fileExists(getEnhancedPatternsPath())) {
        const content = await readFile(getEnhancedPatternsPath(), "utf-8")
        const data = JSON.parse(content)
        for (const pattern of data.patterns || []) {
          this.patterns.set(pattern.id, pattern)
        }
      }

      if (await fileExists(getArchetypesPath())) {
        const content = await readFile(getArchetypesPath(), "utf-8")
        const data = JSON.parse(content)
        for (const archetype of data.archetypes || []) {
          this.archetypes.set(archetype.id, archetype)
        }
      }

      if (await fileExists(getPlotTemplatesPath())) {
        const content = await readFile(getPlotTemplatesPath(), "utf-8")
        const data = JSON.parse(content)
        for (const template of data.templates || []) {
          this.plotTemplates.set(template.id, template)
        }
      }

      if (await fileExists(getMotifsPath())) {
        const content = await readFile(getMotifsPath(), "utf-8")
        const data = JSON.parse(content)
        for (const motif of data.motifs || []) {
          this.motifs.set(motif.id, motif)
        }
      }

      log.info("patterns_loaded", {
        patterns: this.patterns.size,
        archetypes: this.archetypes.size,
        templates: this.plotTemplates.size,
        motifs: this.motifs.size,
      })
    } catch (error) {
      log.warn("pattern_load_failed", { error: String(error) })
    }
  }

  async savePatterns(): Promise<void> {
    await ensurePatternsDir()

    const patternsData = {
      patterns: Array.from(this.patterns.values()),
      lastUpdated: Date.now(),
      version: "2.0",
    }
    await writeFile(getEnhancedPatternsPath(), JSON.stringify(patternsData, null, 2))

    const archetypesData = {
      archetypes: Array.from(this.archetypes.values()),
      lastUpdated: Date.now(),
    }
    await writeFile(getArchetypesPath(), JSON.stringify(archetypesData, null, 2))

    const templatesData = {
      templates: Array.from(this.plotTemplates.values()),
      lastUpdated: Date.now(),
    }
    await writeFile(getPlotTemplatesPath(), JSON.stringify(templatesData, null, 2))

    const motifsData = {
      motifs: Array.from(this.motifs.values()),
      lastUpdated: Date.now(),
    }
    await writeFile(getMotifsPath(), JSON.stringify(motifsData, null, 2))

    log.info("patterns_saved", {
      patterns: this.patterns.size,
      archetypes: this.archetypes.size,
      templates: this.plotTemplates.size,
      motifs: this.motifs.size,
    })
  }

  applyDecay(): void {
    const now = Date.now()
    const dayInMs = 24 * 60 * 60 * 1000

    for (const [id, pattern] of this.patterns) {
      const daysSinceReinforcement = (now - pattern.last_reinforced) / dayInMs
      const decayAmount = pattern.decay_rate * daysSinceReinforcement
      pattern.strength = Math.max(0, pattern.strength - decayAmount)

      if (pattern.strength < this.config.minStrengthThreshold) {
        this.patterns.delete(id)
        log.info("pattern_decayed_removed", { id, finalStrength: pattern.strength })
      }
    }

    for (const [id, archetype] of this.archetypes) {
      const daysSinceReinforcement = (now - archetype.last_reinforced) / dayInMs
      const decayAmount = archetype.decay_rate * daysSinceReinforcement
      archetype.strength = Math.max(0, archetype.strength - decayAmount)

      if (archetype.strength < this.config.minStrengthThreshold) {
        this.archetypes.delete(id)
        log.info("archetype_decayed_removed", { id, finalStrength: archetype.strength })
      }
    }

    for (const [id, motif] of this.motifs) {
      const daysSinceReinforcement =
        motif.occurrences.length > 0
          ? (now - motif.occurrences[motif.occurrences.length - 1].chapter * 1000) / dayInMs
          : 0
      const decayAmount = motif.decay_rate * daysSinceReinforcement
      motif.strength = Math.max(0, motif.strength - decayAmount)

      if (motif.strength < this.config.minStrengthThreshold && motif.occurrences.length < 3) {
        this.motifs.delete(id)
        log.info("motif_decayed_removed", { id, finalStrength: motif.strength })
      }
    }
  }

  reinforcePattern(patternId: string): void {
    const pattern = this.patterns.get(patternId)
    if (pattern) {
      pattern.strength = Math.min(100, pattern.strength + this.config.reinforcementBoost)
      pattern.last_reinforced = Date.now()
      pattern.occurrences++
      this.patterns.set(patternId, pattern)
      log.info("pattern_reinforced", { id: patternId, newStrength: pattern.strength })
    }
  }

  reinforceArchetype(archetypeId: string): void {
    const archetype = this.archetypes.get(archetypeId)
    if (archetype) {
      archetype.strength = Math.min(100, archetype.strength + this.config.reinforcementBoost)
      archetype.last_reinforced = Date.now()
      archetype.occurrences++
      this.archetypes.set(archetypeId, archetype)
      log.info("archetype_reinforced", { id: archetypeId, newStrength: archetype.strength })
    }
  }

  async extractArchetypes(
    storySegment: string,
    characters: Record<string, any>,
    chapter: number,
  ): Promise<Archetype[]> {
    const languageModel = await getNovelLanguageModel()

    const charSummary = Object.entries(characters)
      .map(([name, char]) => `${name}: ${JSON.stringify(char.traits || [])}, stress: ${char.stress || 0}`)
      .join("\n")

    const prompt = `Analyze the following story segment and character states. Identify which characters embody classic narrative archetypes.

Story Segment:
${storySegment.substring(0, 2000)}

Characters:
${charSummary}

For each character that clearly embodies an archetype, output:
{
  "characterName": "name",
  "archetypeType": "hero|mentor|shadow|trickster|herald|shapeshifter|guardian|ally|temptress|threshold_guardian",
  "description": "Why this character fits this archetype",
  "traits": ["relevant", "traits"],
  "narrativeRole": "What role they play in the story"
}

Output JSON array. If no clear archetypes, output empty array.`

    try {
      const result = await generateText({ model: languageModel, prompt })
      const match = result.text.match(/\[[\s\S]*\]/)
      if (!match) return []

      const extracted = JSON.parse(match[0])
      const newArchetypes: Archetype[] = []

      for (const item of extracted) {
        const id = `archetype_${item.characterName}_${item.archetypeType}`
        const existing = this.archetypes.get(id)

        if (existing) {
          this.reinforceArchetype(id)
          newArchetypes.push(existing)
        } else {
          const archetype: Archetype = {
            id,
            name: `${item.characterName} as ${item.archetypeType}`,
            type: item.archetypeType,
            description: item.description,
            traits: item.traits || [],
            narrative_role: item.narrativeRole,
            strength: 50,
            decay_rate: 0.1,
            last_reinforced: Date.now(),
            occurrences: 1,
          }
          this.archetypes.set(id, archetype)
          newArchetypes.push(archetype)
          log.info("archetype_extracted", { id, type: archetype.type })
        }
      }

      return newArchetypes
    } catch (error) {
      log.error("archetype_extraction_failed", { error: String(error) })
      return []
    }
  }

  async extractPlotTemplates(storySegment: string, chapter: number, fullStory: string): Promise<PlotTemplate[]> {
    const languageModel = await getNovelLanguageModel()

    const prompt = `Analyze this story segment in context of the full narrative. Identify if it follows a classic plot structure.

Previous Story Summary:
${fullStory.slice(-1000)}

Current Chapter (${chapter}):
${storySegment.substring(0, 1500)}

Identify the plot structure being used. Output:
{
  "structureType": "three_act|hero_journey|save_the_cat|seven_point|fichtean_curve|kishoutenketsu|in_media_res",
  "currentStage": "name of current stage",
  "stages": [
    {
      "name": "Stage name",
      "description": "What happens",
      "narrativeBeats": ["beat1", "beat2"]
    }
  ],
  "themeCompatibility": ["theme1", "theme2"]
}

If unclear, output a basic structure that best fits.`

    try {
      const result = await generateText({ model: languageModel, prompt })
      const match = result.text.match(/\{[\s\S]*\}/)
      if (!match) return []

      const extracted = JSON.parse(match[0])
      const id = `template_${extracted.structureType}_${chapter}`

      const template: PlotTemplate = {
        id,
        name: extracted.structureType.replace(/_/g, " "),
        structure: extracted.structureType,
        stages: extracted.stages || [],
        theme_compatibility: extracted.themeCompatibility,
        flexibility: 50,
        usage_count: 1,
        last_used: Date.now(),
      }

      this.plotTemplates.set(id, template)
      log.info("plot_template_extracted", { id, structure: template.structure })

      return [template]
    } catch (error) {
      log.error("plot_template_extraction_failed", { error: String(error) })
      return []
    }
  }

  async extractMotifs(storySegment: string, chapter: number): Promise<Motif[]> {
    const languageModel = await getNovelLanguageModel()

    const prompt = `Analyze this story segment for recurring motifs, symbols, or thematic elements.

Story Segment:
${storySegment.substring(0, 2000)}

Identify motifs. Output JSON array:
[
  {
    "name": "motif name",
    "type": "symbolic|thematic|imagery|recurring_object|recurring_phrase|color|number|nature",
    "description": "what this motif represents",
    "significance": 1-10,
    "context": "brief context of occurrence"
  ]

Focus on elements that could recur and evolve throughout the story.`

    try {
      const result = await generateText({ model: languageModel, prompt })
      const match = result.text.match(/\[[\s\S]*\]/)
      if (!match) return []

      const extracted = JSON.parse(match[0])
      const newMotifs: Motif[] = []

      for (const item of extracted) {
        const id = `motif_${item.name.toLowerCase().replace(/\s+/g, "_")}`
        const existing = this.motifs.get(id)

        if (existing) {
          existing.occurrences.push({
            chapter,
            context: item.context,
            significance: item.significance,
          })
          existing.strength = Math.min(100, existing.strength + 10)
          this.motifs.set(id, existing)
          newMotifs.push(existing)
        } else {
          const motif: Motif = {
            id,
            name: item.name,
            type: item.type,
            description: item.description,
            occurrences: [
              {
                chapter,
                context: item.context,
                significance: item.significance,
              },
            ],
            strength: 30 + item.significance * 5,
            decay_rate: 0.05,
          }
          this.motifs.set(id, motif)
          newMotifs.push(motif)
          log.info("motif_extracted", { id, type: motif.type })
        }
      }

      return newMotifs
    } catch (error) {
      log.error("motif_extraction_failed", { error: String(error) })
      return []
    }
  }

  evolveMotif(motifId: string, newState: string, triggerEvent: string, chapter: number): void {
    const motif = this.motifs.get(motifId)
    if (!motif) return

    if (!motif.evolution) {
      motif.evolution = []
    }

    const lastState = motif.evolution.length > 0 ? motif.evolution[motif.evolution.length - 1].to_state : "initial"

    motif.evolution.push({
      from_state: lastState,
      to_state: newState,
      trigger_event: triggerEvent,
      chapter,
    })

    motif.strength = Math.min(100, motif.strength + 15)
    this.motifs.set(motifId, motif)

    log.info("motif_evolved", {
      id: motifId,
      from: lastState,
      to: newState,
      trigger: triggerEvent,
    })
  }

  getActiveArchetypes(threshold: number = 30): Archetype[] {
    return Array.from(this.archetypes.values())
      .filter((a) => a.strength >= threshold)
      .sort((a, b) => b.strength - a.strength)
  }

  getActiveMotifs(threshold: number = 30): Motif[] {
    return Array.from(this.motifs.values())
      .filter((m) => m.strength >= threshold)
      .sort((a, b) => b.strength - a.strength)
  }

  getPlotTemplates(): PlotTemplate[] {
    return Array.from(this.plotTemplates.values()).sort((a, b) => b.usage_count - a.usage_count)
  }

  getMotifEvolutionReport(): string {
    const lines: string[] = ["# Motif Evolution Report\n"]

    for (const motif of this.getActiveMotifs()) {
      lines.push(`## ${motif.name} (${motif.type})`)
      lines.push(`**Strength:** ${motif.strength.toFixed(1)}%`)
      lines.push(`**Description:** ${motif.description}`)
      lines.push(`**Occurrences:** ${motif.occurrences.length}`)

      if (motif.evolution && motif.evolution.length > 0) {
        lines.push("\n### Evolution:")
        for (const ev of motif.evolution) {
          lines.push(`- Ch.${ev.chapter}: ${ev.from_state} → ${ev.to_state}`)
          lines.push(`  Trigger: ${ev.trigger_event}`)
        }
      }

      lines.push(`\n### Occurrences:`)
      for (const occ of motif.occurrences.slice(-5)) {
        lines.push(`- Ch.${occ.chapter}: ${occ.context.slice(0, 100)}... (significance: ${occ.significance}/10)`)
      }
      lines.push("")
    }

    return lines.join("\n")
  }

  getArchetypeReport(): string {
    const lines: string[] = ["# Character Archetypes Report\n"]

    for (const archetype of this.getActiveArchetypes()) {
      lines.push(`## ${archetype.name}`)
      lines.push(`**Type:** ${archetype.type}`)
      lines.push(`**Strength:** ${archetype.strength.toFixed(1)}%`)
      lines.push(`**Occurrences:** ${archetype.occurrences}`)
      lines.push(`**Description:** ${archetype.description}`)
      lines.push(`**Traits:** ${archetype.traits.join(", ")}`)
      lines.push(`**Narrative Role:** ${archetype.narrative_role}`)
      lines.push("")
    }

    return lines.join("\n")
  }

  async onTurn(turnData: {
    storySegment: string
    characters: Record<string, any>
    chapter: number
    fullStory: string
  }): Promise<{
    archetypes: Archetype[]
    templates: PlotTemplate[]
    motifs: Motif[]
  }> {
    this.turnCount++

    if (this.turnCount % 5 === 0) {
      this.applyDecay()
    }

    const [archetypes, templates, motifs] = await Promise.all([
      this.extractArchetypes(turnData.storySegment, turnData.characters, turnData.chapter),
      this.extractPlotTemplates(turnData.storySegment, turnData.chapter, turnData.fullStory),
      this.extractMotifs(turnData.storySegment, turnData.chapter),
    ])

    await this.savePatterns()

    return { archetypes, templates, motifs }
  }

  getStats(): {
    patterns: number
    archetypes: number
    templates: number
    motifs: number
    avgStrength: number
  } {
    const allPatterns = [
      ...Array.from(this.patterns.values()),
      ...Array.from(this.archetypes.values()),
      ...Array.from(this.motifs.values()),
    ]

    const avgStrength =
      allPatterns.length > 0 ? allPatterns.reduce((sum, p) => sum + p.strength, 0) / allPatterns.length : 0

    return {
      patterns: this.patterns.size,
      archetypes: this.archetypes.size,
      templates: this.plotTemplates.size,
      motifs: this.motifs.size,
      avgStrength,
    }
  }

  clear(): void {
    this.patterns.clear()
    this.archetypes.clear()
    this.plotTemplates.clear()
    this.motifs.clear()
    log.info("patterns_cleared")
  }
}

export const enhancedPatternMiner = new EnhancedPatternMiner()
